/*
 * Spiral Drop — UI module: semantic HTML screens over the canvas, HUD,
 * focus management, live-region announcements, captions, responsive shell.
 * UI state is fully separate from simulation state.
 */
import { PRESETS, CATEGORIES, presetTier, choosePreset, describe } from './gfx.js';
import { gfxStrings } from './gfx-i18n.js';
import { T, currentLang } from './i18n.js';

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
  // The open screen's builder, so a language change can redraw it in place.
  let redraw = null;

  function announce(msg) { live.textContent = ''; requestAnimationFrame(() => { live.textContent = msg; }); }
  function announceUrgent(msg) { liveAssertive.textContent = ''; requestAnimationFrame(() => { liveAssertive.textContent = msg; }); }
  function toast(msg, ms) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    // screens pad their top by the toast so it never covers a panel heading
    document.documentElement.style.setProperty('--toast-h', toastEl.offsetHeight + 'px');
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
    // a round's cue caption does not carry over onto (or past) a panel
    clearTimeout(captionTimer);
    captionEl.classList.remove('show');
    const screen = h('div', { class: 'screen' + (opts && opts.transparent ? ' transparent-bg' : ''), role: 'dialog', 'aria-modal': 'true' });
    const panel = h('div', { class: 'panel', role: 'document' });
    // builders pass conditional children as null; native append would render
    // the literal text "null"
    const nativeAppend = panel.append.bind(panel);
    panel.append = (...nodes) => nativeAppend(...nodes.flat(9).filter(n => n != null && n !== false));
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
    // preventScroll: a tall panel must open at its heading, not scrolled to its first button
    if (focusable) focusable.focus({ preventScroll: true });
    panel.scrollTop = 0;
    return panel;
  }
  function close() {
    redraw = null;
    screensRoot.textContent = '';
    if (lastFocus && lastFocus.isConnected) lastFocus.focus();
    lastFocus = null;
  }
  function backButton(action, label) {
    return h('button', { class: 'ghost', onclick: action }, '← ' + T(label || 'Back'));
  }

  /** Language change: rebuild the open screen in place (scroll kept, language select refocused). */
  function relocalize() {
    labelStatic();
    if (!redraw || !screensRoot.childElementCount) return;
    const panel = screensRoot.querySelector('.panel');
    const top = panel ? panel.scrollTop : 0;
    const focusLang = !!(document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-game-language]'));
    const keepFocus = lastFocus;
    const fn = redraw;
    fn(true);
    lastFocus = keepFocus;
    setTimeout(() => {
      const p2 = screensRoot.querySelector('.panel');
      if (p2) p2.scrollTop = top;
      if (focusLang) screensRoot.querySelector('[data-game-language="choice"]')?.focus({ preventScroll: true });
    }, 30);
  }

  /** Static HUD markup from index.html (aria-labels and chip text). */
  function labelStatic() {
    const set = (id, attr, text) => { const el = document.getElementById(id); if (el) { if (attr) el.setAttribute(attr, text); else el.textContent = text; } };
    set('game-region', 'aria-label', T('Spiral Drop playfield'));
    set('hud-score', 'aria-label', T('Score'));
    set('hud-streak', 'title', T('Smash charge'));
    set('btn-pause', 'aria-label', T('Pause (Esc)'));
    set('btn-rot-left', 'aria-label', T('Rotate tower left'));
    set('btn-rot-right', 'aria-label', T('Rotate tower right'));
    set('btn-undo', null, T('Undo'));
    set('btn-hint', null, T('Hint'));
    if (lastHud) hudView(lastHud, true);
  }

  // ---------------- Title / home ----------------
  // Builders may take a data thunk so a redraw picks up current text.
  const val = (d) => (typeof d === 'function' ? d() : d);

  function title(dataOrFn, relabel) {
    redraw = (r) => title(dataOrFn, r);
    const data = val(dataOrFn);
    open(p => {
      p.append(
        h('h1', null, 'Spiral Drop'),
        h('p', { class: 'sub' }, T('Rotate the tower. Thread the gaps. Dodge the danger sectors.')),
        h('div', { class: 'btn-col' },
          h('button', { class: 'big', onclick: actions.onPlay, autofocus: true },
            T('▶ Play — {next}', { next: data.nextLabel })),
          h('button', { class: 'ghost', onclick: actions.onDaily },
            data.dailyDone ? T('Daily Drop ✓ done today') : T('Daily Drop')),
          h('button', { class: 'ghost', onclick: actions.onShowJourney }, T('Journey')),
          h('button', { class: 'ghost', onclick: actions.onShowPractice }, T('Practice')),
          h('button', { class: 'ghost', onclick: actions.onShowChallenge }, T('Challenges')),
          h('button', { class: 'ghost', onclick: actions.onShowLearn }, T('Learn to Play')),
          h('button', { class: 'ghost', onclick: actions.onShowScores }, T('Scores')),
          h('button', { class: 'ghost', onclick: actions.onShowSettings }, T('Settings')),
          h('button', { class: 'ghost', onclick: actions.onShowHelp }, T('How to Play')),
          data.signInLabel ? h('button', { class: 'ghost', id: 'btn-signin', onclick: actions.onSignIn }, data.signInLabel) : null,
          data.inviteLabel ? h('button', { class: 'ghost', id: 'btn-invite', onclick: actions.onInvite }, data.inviteLabel) : null
        ),
        h('p', { class: 'sub' }, data.summary)
      );
    });
    if (!relabel) announce(T('Title screen. {summary}', { summary: data.summary }));
  }

  // ---------------- Mode setup (rules, duration, ranked?) ----------------
  function setup(infoOrFn) {
    redraw = () => setup(infoOrFn);
    const raw = val(infoOrFn);
    // info.text() supplies the translated title/description/rules on every (re)draw
    const info = raw.text ? Object.assign({}, raw, raw.text()) : raw;
    open(p => {
      p.append(
        h('h2', null, info.title),
        h('p', null, info.description),
        h('div', null,
          h('span', { class: 'badge ' + (info.ranked ? 'ranked' : 'casual') }, info.ranked ? T('Ranked') : T('Casual — not rated')),
          ' ',
          h('span', { class: 'badge' }, '~' + info.duration),
          info.assists ? h('span', null, ' ', h('span', { class: 'badge' }, T('Assists: {list}', { list: info.assists }))) : null
        ),
        h('h3', null, T('Rules')),
        h('ul', null, info.rules.map(r => h('li', null, r))),
        h('div', { class: 'btn-row' },
          h('button', { class: 'big', onclick: () => { close(); info.onStart(); } }, T('Start')),
          backButton(info.onBack || actions.onHome)
        )
      );
    });
  }

  // ---------------- Journey ----------------
  function journey(stages, progress, best, relabel) {
    redraw = (r) => journey(stages, progress, best, r);
    open(p => {
      const done = progress.stages || {};
      p.append(
        h('h2', null, T('Journey')),
        h('p', { class: 'sub' }, T('{done} / {total} stages cleared. Mastery stages glow gold.', { done: Object.keys(done).length, total: stages.length }))
      );
      // plain container: giving the buttons role="listitem" would strip their
      // button semantics from assistive technology
      const grid = h('div', { class: 'grid', 'aria-label': T('Journey stages') });
      const unlocked = actions.journeyUnlocked();
      stages.forEach((st, i) => {
        const cleared = !!done[st.id];
        const isUnlocked = i <= unlocked;
        const stars = done[st.id] ? done[st.id].stars : 0;
        grid.append(h('button', {
          class: 'stage-btn' + (st.mastery ? ' mastery' : '') + (isUnlocked ? '' : ' locked'),
          disabled: !isUnlocked,
          'aria-label': T('Stage {n} {name}', { n: i + 1, name: T(st.name) }) + (cleared ? T(', cleared, {n} stars', { n: stars }) : isUnlocked ? '' : T(', locked')),
          onclick: () => { close(); actions.onStartStage(i); }
        },
          h('span', null, String(i + 1)),
          h('span', { class: 'stars' }, '★'.repeat(stars) + '☆'.repeat(Math.max(0, 3 - stars)))
        ));
      });
      p.append(grid, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
    if (!relabel) announce(T('Journey map opened.'));
  }

  // ---------------- Practice ----------------
  function practice(presets) {
    redraw = () => practice(presets);
    open(p => {
      p.append(h('h2', null, T('Practice')),
        h('p', { class: 'sub' }, T('Free play. Undo and hints allowed. Never affects ratings.')));
      const col = h('div', { class: 'btn-col' });
      for (const pr of presets) {
        const danger = pr.params.dangerProb > 0.5 ? T('heavy danger') : pr.params.dangerProb > 0.25 ? T('some danger') : T('light danger');
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartPractice(pr.id); } },
          T('{name} — {n} layers, {danger}', { name: T(pr.name), n: pr.params.layers, danger })));
      }
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Challenges ----------------
  function challenge(list, best) {
    redraw = () => challenge(list, best);
    open(p => {
      p.append(h('h2', null, T('Challenges')), h('p', { class: 'sub' }, T('Constrained goals: move budgets, clocks, altered layouts.')));
      const col = h('div', { class: 'btn-col' });
      for (const c of list) {
        const b = best[c.id];
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartChallenge(c.id); } },
          h('strong', null, T(c.name)), h('br'),
          h('span', { class: 'sub' }, T(c.description) + (b ? ' — ' + T('best {n}', { n: b }) : ''))));
      }
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Learn ----------------
  function learn(lessons, progress) {
    redraw = () => learn(lessons, progress);
    open(p => {
      p.append(h('h2', null, T('Learn to Play')), h('p', { class: 'sub' }, T('One rule at a time. You must perform each action to advance.')));
      const col = h('div', { class: 'btn-col' });
      lessons.forEach((l, i) => {
        const done = (progress.lessons || {})[l.id];
        col.append(h('button', { class: 'ghost', onclick: () => { close(); actions.onStartLesson(i); } },
          (done ? '✓ ' : '') + (i + 1) + '. ' + T(l.name)));
      });
      p.append(col, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
    });
  }

  // ---------------- Scores ----------------
  function scores(data) {
    redraw = () => scores(data);
    open(p => {
      p.append(h('h2', null, T('Scores')));
      const tabs = h('div', { class: 'tabs', role: 'tablist' });
      const body = h('div', null);
      const render = (rows, label) => {
        body.textContent = '';
        if (!rows.length) { body.append(h('p', { class: 'sub' }, T('No scores yet — be the first.'))); return; }
        const tbl = h('div', null);
        rows.slice(0, 20).forEach((r, i) => {
          const rank = h('span', null, (i + 1) + '. ' + (r.label ? r.label() : r.name || T('Player')));
          const val = h('span', null, String(r.score));
          tbl.append(h('div', { class: 'kv' }, rank, val));
        });
        body.append(h('p', { class: 'sub' }, label), tbl);
      };
      const allTabs = [];
      // The chosen tab survives a language redraw.
      const select = (tab, rows, label, key) => { data._tab = key; render(rows, label); allTabs.forEach(t => t.setAttribute('aria-selected', String(t === tab))); };
      const tabLocal = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'true' }, T('Local'));
      const tabGlobal = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'false' }, T('Global'));
      const tabFriends = h('button', { class: 'ghost', role: 'tab', 'aria-selected': 'false' }, T('Friends'));
      allTabs.push(tabLocal, tabGlobal, tabFriends);
      const pick = {
        local: () => select(tabLocal, data.local, T('Local bests on this device.'), 'local'),
        global: () => select(tabGlobal, data.global,
          data.hosted ? (data.globalLabel ? T(data.globalLabel) : T('Global board.')) : T('Offline — global boards need the hosted version.'), 'global'),
        friends: () => select(tabFriends, data.friends, T('Friends-only board.'), 'friends'),
      };
      tabLocal.addEventListener('click', pick.local);
      tabGlobal.addEventListener('click', pick.global);
      tabFriends.addEventListener('click', pick.friends);
      tabs.append(tabLocal, tabGlobal, tabFriends);
      p.append(tabs, body, h('div', { class: 'btn-row' }, backButton(actions.onHome)));
      (pick[data._tab] || pick.local)();
    });
  }

  // ---------------- Help (rule cards from current bindings) ----------------
  function help(bindings) {
    redraw = () => help(bindings);
    const kbd = (k) => h('kbd', null, k);
    open(p => {
      p.append(
        h('h2', null, T('How to Play')),
        h('div', { class: 'rule-card' }, h('strong', null, T('Goal')), h('p', null, T('Guide the ball to the base by rotating the tower so each ring’s gap passes beneath the ball.'))),
        h('div', { class: 'rule-card' }, h('strong', null, T('Rotate')), h('p', null, kbd(bindings.left), ' / ', kbd(bindings.right), T(', the round arrow buttons, drag sideways, or a gamepad stick. The ball never moves sideways — only the tower turns.'))),
        h('div', { class: 'rule-card' }, h('strong', null, T('Danger sectors')), h('p', null, T('Striped arcs. Landing on one ends the run. They are striped as well as colored, so color is never the only signal.'))),
        h('div', { class: 'rule-card' }, h('strong', null, T('Combos & smashing')), h('p', null, T('Fall through 3+ rings without landing to charge the ball. A charged ball smashes straight through one danger sector. Centered drops earn precision bonuses.'))),
        h('div', { class: 'rule-card' }, h('strong', null, T('Other keys')), h('p', null, kbd(bindings.pause), ' ' + T('pause') + ' · ', kbd(bindings.undo), ' ' + T('undo (practice)') + ' · ', kbd(bindings.hint), ' ' + T('hint') + ' · ', kbd('Enter'), ' ' + T('confirm'))),
        h('div', { class: 'btn-row' }, backButton(actions.onHome))
      );
    });
  }

  // ---------------- Settings ----------------
  function settings(s, graphicsInfo) {
    redraw = () => settings(s, graphicsInfo);
    open(p => {
      p.append(h('h2', null, T('Settings')));
      const slider = (label, key, val) => h('label', { class: 'slider' },
        h('span', null, label),
        h('input', {
          type: 'range', min: 0, max: 1, step: 0.05, value: val,
          oninput: (e) => actions.onSettingsChanged({ [key]: Number(e.target.value) })
        }),
        h('span', null, Math.round(val * 100) + '%'));
      p.append(
        h('h3', null, T('Audio')),
        slider(T('Music'), 'music', s.music),
        slider(T('Effects'), 'effects', s.effects),
        slider(T('Ambience'), 'ambience', s.ambience),
        slider(T('Voice'), 'voice', s.voice),
        checkbox(T('Mute all'), 'muted', s.muted),
        checkbox(T('Captions for audio cues'), 'captions', s.captions),
        graphicsSection(s, graphicsInfo),
        h('h3', null, T('Accessibility & controls')),
        checkbox(T('Reduced motion (no shake/swoops)'), 'reducedMotion', s.reducedMotion),
        checkbox(T('High contrast'), 'highContrast', s.highContrast),
        checkbox(T('Color-vision-safe palette'), 'cvdPalette', s.cvdPalette),
        checkbox(T('Larger text'), 'largeText', s.largeText),
        checkbox(T('Left-handed controls'), 'leftHanded', s.leftHanded),
        checkbox(T('Hold-to-rotate buttons (vs toggle)'), 'holdToRotate', s.holdToRotate),
        h('h3', null, T('Data')),
        h('div', { class: 'btn-row' },
          h('button', { class: 'ghost', onclick: actions.onReplayTutorial }, T('Replay tutorial')),
          h('button', { class: 'ghost', onclick: actions.onResetData }, T('Erase local data'))),
        h('div', { class: 'btn-row' }, backButton(actions.onSettingsBack || actions.onHome))
      );
    });
    function checkbox(label, key, val) {
      return h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!val, onchange: (e) => actions.onSettingsChanged({ [key]: e.target.checked }) }),
        label);
    }
  }

  // ---------------- Graphics section (quality model in gfx.js) ----------------
  /**
   * Only the inner box redraws on a change; the shared Frame rate / Language /
   * Sound / Report sections (game-options.js) mount after it in the section.
   */
  function graphicsSection(s, graphicsInfo) {
    const T = gfxStrings(currentLang());
    const section = h('section', { id: 'gfx-section', 'aria-labelledby': 'gfx-heading', 'data-options-graphics': '' });
    const wrap = h('div', { class: 'gfx-inner' });
    section.append(wrap);
    const fill = (str, vars) => str.replace(/\{(\w+)\}/g, (_, k) => vars[k]);
    const commit = (next, focusId) => {
      actions.onSettingsChanged({ gfx: next });
      render(focusId);
    };
    function render(focusId) {
      const saved = Object.assign({}, s.gfx || {});
      const info = graphicsInfo ? graphicsInfo() : null;
      const r = info ? info.resolved : null;
      const tier = r ? r.preset : 'balanced';
      wrap.textContent = '';
      wrap.append(h('h3', { id: 'gfx-heading' }, T.graphics));
      const row = (label, id, control) => h('label', { class: 'slider gfx-row gfx-sel', for: id },
        h('span', null, label), control);

      // Quality preset
      const presetSel = h('select', {
        id: 'gfx-preset', 'data-gfx': 'preset',
        onchange: (e) => commit(choosePreset(saved, e.target.value), 'gfx-preset')
      },
        h('option', { value: 'auto', selected: !PRESETS.includes(saved.preset) },
          fill(T.auto, { tier: T.presets[info ? info.detected : 'balanced'] })),
        PRESETS.map(p => h('option', { value: p, selected: saved.preset === p }, T.presets[p])));
      wrap.append(row(T.quality, 'gfx-preset', presetSel));

      // Render scale 50–200 %
      const pct = Math.round((Number(saved.render_scale) || 1) * 100);
      const scaleVal = h('span', { class: 'gfx-val' }, pct + '%');
      const scale = h('input', {
        id: 'gfx-scale', 'data-gfx': 'render_scale', type: 'range', min: 50, max: 200, step: 5, value: pct,
        oninput: (e) => { scaleVal.textContent = e.target.value + '%'; },
        onchange: (e) => commit(Object.assign({}, saved, { render_scale: Number(e.target.value) / 100 }), 'gfx-scale')
      });
      wrap.append(h('label', { class: 'slider gfx-row', for: 'gfx-scale' }, h('span', null, T.renderScale), scale, scaleVal));

      // One select per category, defaulting to the preset's own tier
      for (const [cat, tiers] of Object.entries(CATEGORIES)) {
        const own = presetTier(tier, cat);
        const sel = h('select', {
          id: 'gfx-' + cat, 'data-gfx': cat,
          onchange: (e) => {
            const next = Object.assign({}, saved);
            if (e.target.value === 'preset') delete next[cat]; else next[cat] = e.target.value;
            commit(next, 'gfx-' + cat);
          }
        },
          h('option', { value: 'preset', selected: !tiers.includes(saved[cat]) }, fill(T.fromPreset, { tier: T.tiers[own] || own })),
          tiers.map(t => h('option', { value: t, selected: saved[cat] === t }, T.tiers[t] || t)));
        wrap.append(row(T.cats[cat], 'gfx-' + cat, sel));
      }

      const toggle = (label, id, key, val) => h('label', { class: 'check' },
        h('input', {
          type: 'checkbox', id, 'data-gfx': key, checked: !!val,
          onchange: (e) => commit(Object.assign({}, saved, { [key]: e.target.checked }), id)
        }), label);
      wrap.append(
        toggle(T.adaptive, 'gfx-adaptive', 'adaptive', saved.adaptive !== false),
        toggle(T.showFps, 'gfx-fps', 'show_fps', !!saved.show_fps));

      if (info) {
        wrap.append(h('p', { id: 'gfx-summary', class: 'sub gfx-summary', 'data-gfx-preset': r.preset },
          info.gpu + ' · ' + describe(r, info.pixels, T.describe)));
        if (info.postFailed) wrap.append(h('p', { id: 'gfx-note', class: 'gfx-note', role: 'note' }, T.postUnavailable));
      }
      if (focusId) { const el = wrap.querySelector('#' + focusId); if (el) el.focus(); }
    }
    render();
    return section;
  }

  // ---------------- Pause ----------------
  function pause(relabel) {
    redraw = (r) => pause(r);
    open(p => {
      p.append(
        h('h2', null, T('Paused')),
        h('div', { class: 'btn-col' },
          h('button', { class: 'big', onclick: actions.onResume, autofocus: true }, T('Resume')),
          h('button', { class: 'ghost', onclick: actions.onRestart }, T('Restart')),
          h('button', { class: 'ghost', onclick: actions.onShowSettings }, T('Settings')),
          h('button', { class: 'ghost', onclick: actions.onShowHelp }, T('Help')),
          h('button', { class: 'ghost', onclick: actions.onLeave }, T('Leave round')))
      );
    });
    if (!relabel) announce(T('Paused. Resume is the first option.'));
  }

  // ---------------- Results ----------------
  function results(r, relabel) {
    redraw = (x) => results(r, x);
    const won = r.reason === 'completed';
    const txt = (v) => (typeof v === 'function' ? v() : v);
    open(p => {
      p.append(
        h('h2', null, won ? T('Base Reached!') : T(r.headline)),
        h('p', { class: 'sub' }, txt(r.subline)),
        h('h3', null, T('Score breakdown')),
        h('div', null,
          ...r.components.map(c => h('div', { class: 'kv' }, h('span', null, T(c[0])), h('span', null, String(c[1])))),
          h('div', { class: 'kv total' }, h('span', null, T('Total')), h('span', null, String(r.total)))),
        h('h3', null, T('Run')),
        h('div', null,
          h('div', { class: 'kv' }, h('span', null, T('Layers descended')), h('span', null, r.stats.layersPassed + ' / ' + r.totalLayers)),
          h('div', { class: 'kv' }, h('span', null, T('Best single drop')), h('span', null, '×' + r.stats.bestFall)),
          h('div', { class: 'kv' }, h('span', null, T('Smashes')), h('span', null, String(r.stats.smashes))),
          h('div', { class: 'kv' }, h('span', null, T('Time')), h('span', null, r.time)),
          h('div', { class: 'kv' }, h('span', null, T('Invalid actions')), h('span', null, String(r.stats.invalidActions)))),
        r.stars != null ? h('p', null, T('Journey stars: {stars}', { stars: '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars) })) : null,
        r.achievements && r.achievements.length ? h('p', null, '🏆 ' + r.achievements.map((a) => T(a)).join(', ')) : null,
        r.lbText ? h('p', { class: 'sub', id: 'results-lb' }, txt(r.lbText)) : null,
        h('div', { class: 'btn-row' },
          h('button', { class: 'big', onclick: won && r.nextLabel ? actions.onNext : actions.onRestart, autofocus: true }, won && r.nextLabel ? T('Next: {name}', { name: T(r.nextLabel) }) : T('Retry')),
          r.nextLabel && won ? h('button', { class: 'ghost', onclick: actions.onRetry }, T('Replay this stage')) : null,
          h('button', { class: 'ghost', onclick: actions.onWatchReplay }, T('Watch replay')),
          backButton(actions.onLeave, 'Menu'))
      );
    });
    if (!relabel) announceUrgent(T(won ? 'Stage complete. Total score {n}.' : 'Run over. Total score {n}.', { n: r.total }));
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
  let lastHud = null;

  function hudView(v, relabel) {
    lastHud = v;
    elObj.textContent = typeof v.objective === 'function' ? v.objective() : v.objective;
    elScore.textContent = String(v.score);
    elProg.textContent = T('Layer {n} / {total}', { n: v.layer, total: v.totalLayers });
    elStreak.textContent = v.streak > 0 ? '⚡'.repeat(Math.min(3, v.streak)) + (v.smashReady ? ' ' + T('SMASH') : '') : '';
    elTimer.hidden = v.timer == null;
    if (v.timer != null) elTimer.textContent = v.timer;
    btnUndo.hidden = !v.canUndo;
    btnHint.hidden = !v.canHint;
    if (v.layer !== lastAnnouncedLayer && !relabel) {
      announce(T('Layer {n} of {total}. Score {score}.', { n: v.layer, total: v.totalLayers, score: v.score }));
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
    close, open, hudView, relocalize, labelStatic, showHud, countdown, toast, caption, announce, announceUrgent, applyA11y,
    get isScreenOpen() { return screensRoot.childElementCount > 0; }
  };
}
