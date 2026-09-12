/*
 * Spiral Drop — UI module: semantic HTML screens over the canvas, HUD,
 * focus management, live-region announcements, captions, responsive shell.
 * UI state is fully separate from simulation state.
 */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat(9)) {
    if (c == null) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function createUI(actions) {
  const screensRoot = document.getElementById('screens');
  const hud = document.getElementById('hud');
  const live = document.getElementById('live');
  const liveAssertive = document.getElementById('live-assertive');
  const toastEl = document.getElementById('toast');
  const captionEl = document.getElementById('caption-line');
  let lastFocus = null;
  let captionTimer = null;
  let toastTimer = null;

  function announce(msg) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); }
  function announceUrgent(msg) { liveAssertive.textContent = ''; requestAnimationFrame(() => { liveAssertive.textContent = msg; }); }
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms || 2600);
  }
  function caption(text) {
    captionEl.textContent = text;
    captionEl.classList.add('show');
    clearTimeout(captionTimer);
    captionTimer = setTimeout(() => captionEl.classList.remove('show'), 1600);
  }

  function open(build, opts) {
    lastFocus = document.activeElement;
    screensRoot.textContent = '';
    const screen = h('div', { class: 'screen' + (opts && opts.transparent ? ' transparent-bg' : ''), role: 'dialog', 'aria-modal': 'true' });
    const panel = h('div', { class: 'panel', role: 'document' });
    screen.append(panel);
    build(panel);
    // name the dialog from its own heading so screen readers announce it
    const heading = panel.querySelector('h1, h2');
    if (heading) {
      if (!heading.id) heading.id = 'screen-heading';
      screen.setAttribute('aria-labelledby', heading.id);
    }
    screensRoot.append(screen);
    const focusable = panel.querySelector('button, select, input, [tabindex]');
    if (focusable) focusable.focus();
    return panel;
  }
  function close() {
    screensRoot.textContent = '';
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
    lastFocus = null;
  }
  function backButton(action, label) {
    return h('button', { class: 'ghost', onclick: action }, '← ' + (label || 'Back'));
  }

  // ---------------- Title / home ----------------
  function title(data) {
    open(p => {
      p.append(
        h('h1', null, 'Spiral Drop'),
        h('p', { class: 'sub' }, 'Rotate the tower. Thread the gaps. Dodge the danger sectors.'),
        h('div', { class: 'btn-col' },
          h('button', { class: 'big', onclick: actions.onPlay, autofocus: true },
            '▶ Play — ' + data.nextLabel),
          h('button', { class: 'ghost', onclick: actions.onDaily },
            'Daily Drop' + (data.dailyDone ? ' ✓ done today' : '')),
          h('button', { class: 'ghost', onclick: actions.onShowJourney }, 'Journey'),
          h('button', { class: 'ghost', onclick: actions.onShowPractice }, 'Practice'),
          h('button', { class: 'ghost', onclick: actions.onShowChallenge }, 'Challenges'),
          h('button', { class: 'ghost', onclick: actions.onShowLearn }, 'Learn to Play'),
          h('button', { class: 'ghost', onclick: actions.onShowScores }, 'Scores'),
          h('button', { class: 'ghost', onclick: actions.onShowSettings }, 'Settings'),
          h('button', { class: 'ghost', onclick: actions.onShowHelp }, 'How to Play')
        ),
        h('p', { class: 'sub' }, data.summary)
      );
    });
    announce('Title screen. ' + data.summary);
  }

  // ---------------- Mode setup (rules, duration, ranked?) ----------------
  function setup(info) {
    open(p => {
      p.append(
        h('h2', null, info.title),
        h('p', null, info.description),
        h('div', null,
          h('span', { class: 'badge ' + (info.ranked ? 'ranked' : 'casual') }, info.ranked ? 'Ranked' : 'Casual — not rated'),
          ' ',
          h('span', { class: 'badge' }, '~' + info.duration),
          info.assists ? h('span', null, ' ', h('span', { class: 'badge' }, 'Assists: ' + info.assists)) : null
        ),
        h('h3', null, 'Rules'),
        h('ul', null, info.rules.map(r => h('li', null, r))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'big', onclick: () => { close(); info.onStart(); } }, 'Start'),
          backButton(info.onBack || actions.onHome)
        )
      );
    });
  }

  // ---------------- Journey ----------------
  function journey(stages, progress, best) {
    open(p => {
      const done = progress.stages || {};
      p.append(
        h('h2', null, 'Journey'),
        h('p', { class: 'sub' }, Object.keys(done).length + ' / ' + stages.length + ' stages cleared. Mastery stages glow gold.')
      );
      // plain container: giving the buttons role="listitem" would strip their
      // button semantics from assistive technology
      const grid = h('div', { class: 'grid', 'aria-label': 'Journey stages' });
      const unlocked = actions.journeyUnlocked();
      stages.forEach((st, i) => {
        const cleared = !!done[st.id];
        const isUnlocked = i <= unlocked;
        const stars = done[st.id] ? done[st.id].stars : 0;
        grid.append(h('button', {
          class: 'stage-btn' + (st.mastery ? ' mastery' : '') + (isUnlocked ? '' : ' locked'),
          disabled: !isUnlocked,
          'aria-label': 'Stage ' + (i + 1) + ' ' + st.name + (cleared ? ', cleared, ' + stars + ' stars' : isUnlocked ? '' : ', locked'),
          onclick: () => { close(); actions.onStartStage(i); }
        },
          h('span', null, String(i + 1)),
          h('span', { class: 'stars' }, '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)))
        ));
      });
      p.append(grid, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
    announce('Journey map opened.');
  }

  // ---------------- Practice ----------------
  function practice(presets) {
    open(p => {
      p.append(h('h2', null, 'Practice'),
        h('p', { class: 'sub' }, 'Free play. Undo and hints allowed. Never affects ratings.'));
      const col = h('div', { class: 'btn-col' });
      for (const pr of presets) {
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartPractice(pr.id); } },
          pr.name + ' — ' + pr.params.layers + ' layers, ' +
          (pr.params.dangerProb > 0.5 ? 'heavy' : pr.params.dangerProb > 0.25 ? 'some' : 'light') + ' danger'));
      }
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Challenges ----------------
  function challenge(list, best) {
    open(p => {
      p.append(h('h2', null, 'Challenges'), h('p', { class: 'sub' }, 'Constrained goals: move budgets, clocks, altered layouts.'));
      const col = h('div', { class: 'btn-col' });
      for (const c of list) {
        const b = best[c.id];
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartChallenge(c.id); } },
          h('strong', null, c.name), h('br'),
          h('span', { class: 'sub' }, c.description + (b ? ' — best ' + b : ''))));
      }
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Learn ----------------
  function learn(lessons, progress) {
    open(p => {
      p.append(h('h2', null, 'Learn to Play'), h('p', { class: 'sub' }, 'One rule at a time. You must perform each action to advance.'));
      const col = h('div', { class: 'btn-col' });
      lessons.forEach((l, i) => {
        const done = (progress.lessons || {})[l.id];
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartLesson(i); } },
          (done ? '✓ ' : '') + (i + 1) + '. ' + l.name));
      });
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Scores ----------------
  function scores(data) {
    open(p => {
      p.append(h('h2', null, 'Scores'));
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const body = h('div', null);
      const render = (rows, label) => {
        body.textContent = '';
        if (!rows.length) { body.append(h('p', { class: 'sub' }, 'No scores yet — be the first.')); return; }
        const tbl = h('div', null);
        rows.slice(0, 20).forEach((r, i) => {
          const rank = h('span', null, (i + 1) + '. ' + r.name);
          const val = h('span', null, String(r.score));
          tbl.append(h('div', { class: 'kv' }, rank, val));
        });
        body.append(h('p', { class: 'sub' }, label), tbl);
      };
      const allTabs = [];
      const select = (tab, rows, label) => { render(rows, label); allTabs.forEach(t => t.setAttribute('aria-selected', String(t === tab))); };
      const tabLocal = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'true' }, 'Local');
      const tabGlobal = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'false' }, 'Global');
      const tabFriends = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'false' }, 'Friends');
      allTabs.push(tabLocal, tabGlobal, tabFriends);
      tabLocal.addEventListener('click', () => select(tabLocal, data.local, 'Local bests on this device.'));
      tabGlobal.addEventListener('click', () => select(tabGlobal, data.global,
        data.hosted ? (data.globalLabel || 'Global board.') : 'Offline — global boards need the hosted version.'));
      tabFriends.addEventListener('click', () => select(tabFriends, data.friends, 'Friends-only board.'));
      tabs.append(tabLocal, tabGlobal, tabFriends);
      p.append(tabs, body, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
      render(data.local, 'Local bests on this device.');
    });
  }

  // ---------------- Help (rule cards from current bindings) ----------------
  function help(bindings) {
    const kbd = (k) => h('kbd', null, k);
    open(p => {
      p.append(
        h('h2', null, 'How to Play'),
        h('div', { class: 'rule-card' }, h('strong', null, 'Goal'), h('p', null, 'Guide the ball to the base by rotating the tower so each ring’s gap passes beneath the ball.')),
        h('div', { class: 'rule-card' }, h('strong', null, 'Rotate'), h('p', null, kbd(bindings.left), ' / ', kbd(bindings.right), ', the round arrow buttons, drag sideways, or a gamepad stick. The ball never moves sideways — only the tower turns.')),
        h('div', { class: 'rule-card' }, h('strong', null, 'Danger sectors'), h('p', null, 'Striped arcs. Landing on one ends the run. They are striped as well as colored, so color is never the only signal.')),
        h('div', { class: 'rule-card' }, h('strong', null, 'Combos & smashing'), h('p', null, 'Fall through 3+ rings without landing to charge the ball. A charged ball smashes straight through one danger sector. Centered drops earn precision bonuses.')),
        h('div', { class: 'rule-card' }, h('strong', null, 'Other keys'), h('p', null, kbd('Esc') + ' pause · ', kbd(bindings.undo), ' undo (practice) · ', kbd(bindings.hint), ' hint · ', kbd('Enter'), ' confirm')),
        h('div', { class: 'btn-row' }, backButton(actions.onHome))
      );
    });
  }

  // ---------------- Settings ----------------
  function settings(s) {
    open(p => {
      p.append(h('h2', null, 'Settings'));
      const slider = (label, key, val) => h('label', { class: 'slider' },
        h('span', null, label),
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.05, value: val,
          oninput: (e) => actions.onSettingsChanged({ [key]: Number(e.target.value) })
        }),
        h('span', null, Math.round(val * 100) + '%'));
      p.append(
        h('h3', null, 'Audio'),
        slider('Music', 'music', s.music),
        slider('Effects', 'effects', s.effects),
        slider('Ambience', 'ambience', s.ambience),
        slider('Voice', 'voice', s.voice),
        checkbox('Mute all', 'muted', s.muted),
        checkbox('Captions for audio cues', 'captions', s.captions),
        h('h3', null, 'Graphics'),
        h('label', { class: 'slider' }, h('span', null, 'Quality tier'),
          h('select', { onchange: (e) => actions.onSettingsChanged({ quality: e.target.value }) },
            ['low', 'medium', 'high'].map(t => h('option', { value: t, selected: s.quality === t }, t[0].toUpperCase() + t.slice(1)))),
          h('span', null, '')),
        h('h3', null, 'Accessibility & controls'),
        checkbox('Reduced motion (no shake/swoops)', 'reducedMotion', s.reducedMotion),
        checkbox('High contrast', 'highContrast', s.highContrast),
        checkbox('Color-vision-safe palette', 'cvdPalette', s.cvdPalette),
        checkbox('Larger text', 'largeText', s.largeText),
        checkbox('Left-handed controls', 'leftHanded', s.leftHanded),
        checkbox('Hold-to-rotate buttons (vs toggle)', 'holdToRotate', s.holdToRotate),
        h('h3', null, 'Data'),
        h('div', { class: 'btn-row' },
          h('button', { class: 'ghost', onclick: actions.onReplayTutorial }, 'Replay tutorial'),
          h('button', { class: 'ghost', onclick: actions.onResetData }, 'Erase local data')),
        h('div', { class: 'btn-row' }, backButton(actions.onSettingsBack || actions.onHome))
      );
    });
    function checkbox(label, key, val) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!val, onchange: (e) => actions.onSettingsChanged({ [key]: e.target.checked }) }),
        label);
    }
  }

  // ---------------- Pause ----------------
  function pause() {
    open(p => {
      p.append(
        h('h2', null, 'Paused'),
        h('div', { class: 'btn-col' },
          h('button', { class: 'big', onclick: actions.onResume, autofocus: true }, 'Resume'),
          h('button', { class: 'ghost', onclick: actions.onRestart }, 'Restart'),
          h('button', { class: 'ghost', onclick: actions.onShowSettings }, 'Settings'),
          h('button', { class: 'ghost', onclick: actions.onShowHelp }, 'Help'),
          h('button', { class: 'ghost', onclick: actions.onLeave }, 'Leave round'))
      );
    });
    announce('Paused. Resume is the first option.');
  }

  // ---------------- Results ----------------
  function results(r) {
    const won = r.reason === 'completed';
    open(p => {
      p.append(
        h('h2', null, won ? 'Base Reached!' : r.headline),
        h('p', { class: 'sub' }, r.subline),
        h('h3', null, 'Score breakdown'),
        h('div', null,
          ...r.components.map(c => h('div', { class: 'kv' }, h('span', null, c[0]), h('span', null, String(c[1])))),
          h('div', { class: 'kv total' }, h('span', null, 'Total'), h('span', null, String(r.total)))),
        h('h3', null, 'Run'),
        h('div', null,
          h('div', { class: 'kv' }, h('span', null, 'Layers descended'), h('span', null, r.stats.layersPassed + ' / ' + r.totalLayers)),
          h('div', { class: 'kv' }, h('span', null, 'Best single drop'), h('span', null, '×' + r.stats.bestFall)),
          h('div', { class: 'kv' }, h('span', null, 'Smashes'), h('span', null, String(r.stats.smashes))),
          h('div', { class: 'kv' }, h('span', null, 'Time'), h('span', null, r.time)),
          h('div', { class: 'kv' }, h('span', null, 'Invalid actions'), h('span', null, String(r.stats.invalidActions)))),
        r.stars != null ? h('p', null, 'Journey stars: ' + '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)) : null,
        r.achievements && r.achievements.length ? h('p', null, '🏆 ' + r.achievements.join(', ')) : null,
        r.rankLine ? h('p', { class: 'sub' }, r.rankLine) : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'big', onclick: actions.onRestart, autofocus: true }, won && r.nextLabel ? 'Next: ' + r.nextLabel : 'Retry'),
          r.nextLabel && won ? h('button', { class: 'ghost', onclick: actions.onRetry }, 'Replay this stage') : null,
          h('button', { class: 'ghost', onclick: actions.onWatchReplay }, 'Watch replay'),
          backButton(actions.onLeave, 'Menu'))
      );
    });
    announceUrgent((won ? 'Stage complete. ' : 'Run over. ') + 'Total score ' + r.total + '.');
  }

  // ---------------- HUD ----------------
  const elObj = document.getElementById('hud-objective');
  const elScore = document.getElementById('hud-score');
  const elProg = document.getElementById('hud-progress');
  const elStreak = document.getElementById('hud-streak');
  const elTimer = document.getElementById('hud-timer');
  const btnUndo = document.getElementById('btn-undo');
  const btnHint = document.getElementById('btn-hint');
  let lastAnnouncedLayer = -1;

  function hudView(v) {
    elObj.textContent = v.objective;
    elScore.textContent = String(v.score);
    elProg.textContent = 'Layer ' + v.layer + ' / ' + v.totalLayers;
    elStreak.textContent = v.streak > 0 ? '⚡'.repeat(Math.min(3, v.streak)) + (v.smashReady ? ' SMASH' : '') : '';
    elTimer.hidden = v.timer == null;
    if (v.timer != null) elTimer.textContent = v.timer;
    btnUndo.hidden = !v.canUndo;
    btnHint.hidden = !v.canHint;
    if (v.layer !== lastAnnouncedLayer) {
      announce('Layer ' + v.layer + ' of ' + v.totalLayers + '. Score ' + v.score + '.');
      lastAnnouncedLayer = v.layer;
    }
  }

  function showHud(show) { hud.hidden = !show; }
  function countdown(text) {
    const el = document.getElementById('countdown');
    if (text == null) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = text;
    announce(text);
  }

  function applyA11y(s) {
    document.body.classList.toggle('large-text', !!s.largeText);
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.body.classList.toggle('left-handed', !!s.leftHanded);
  }

  return {
    title, setup, journey, practice, challenge, learn, scores, help, settings, pause, results,
    close, open, hudView, showHud, countdown, toast, caption, announce, announceUrgent, applyA11y,
    get isScreenOpen() { return screensRoot.childElementCount > 0; }
  };
}
