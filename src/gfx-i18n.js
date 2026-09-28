// Spiral Drop — strings for the Graphics settings panel in every supported
// locale. The locale comes from navigator.language (exact tag, then the
// language's first listed variant, then en-US).

const STRINGS = {
  'en-US': {
    graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})', renderScale: 'Render scale',
    fromPreset: 'From preset ({tier})', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    postUnavailable: 'Post-processing is unavailable on this device, so effects render without it.',
    presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
    cats: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade', antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail', particles: 'Particles', background: 'Background' },
    tiers: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated' },
    describe: { noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing' },
  },
  'en-GB': {
    graphics: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})', renderScale: 'Render scale',
    fromPreset: 'From preset ({tier})', adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
    postUnavailable: 'Post-processing is unavailable on this device, so effects render without it.',
    presets: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra' },
    cats: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Colour grade', antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail', particles: 'Particles', background: 'Background' },
    tiers: { off: 'Off', on: 'On', low: 'Low', medium: 'Medium', high: 'High', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed', static: 'Static', animated: 'Animated' },
    describe: { noShadows: 'no shadows', shadows: '{n}² shadows', ao: 'ambient occlusion', aoFull: 'full ambient occlusion', bloom: 'bloom', reflections: 'reflections', noAA: 'no anti-aliasing' },
  },
  'es-419': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})', renderScale: 'Escala de render',
    fromPreset: 'Según ajuste ({tier})', adaptive: 'Resolución adaptable', showFps: 'Mostrar cuadros por segundo',
    postUnavailable: 'El posprocesado no está disponible en este dispositivo; los efectos se muestran sin él.',
    presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color', antialias: 'Antialiasing', reflections: 'Reflejos', detail: 'Detalle de superficies', particles: 'Partículas', background: 'Fondo' },
    tiers: { off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado', static: 'Estático', animated: 'Animado' },
    describe: { noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin antialiasing' },
  },
  'es-ES': {
    graphics: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})', renderScale: 'Escala de renderizado',
    fromPreset: 'Según preajuste ({tier})', adaptive: 'Resolución adaptativa', showFps: 'Mostrar fotogramas por segundo',
    postUnavailable: 'El posprocesado no está disponible en este dispositivo; los efectos se muestran sin él.',
    presets: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Etalonaje', antialias: 'Suavizado', reflections: 'Reflejos', detail: 'Detalle de superficies', particles: 'Partículas', background: 'Fondo' },
    tiers: { off: 'No', on: 'Sí', low: 'Bajas', medium: 'Medias', high: 'Altas', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado', static: 'Estático', animated: 'Animado' },
    describe: { noShadows: 'sin sombras', shadows: 'sombras {n}²', ao: 'oclusión ambiental', aoFull: 'oclusión ambiental completa', bloom: 'resplandor', reflections: 'reflejos', noAA: 'sin suavizado' },
  },
  'de-DE': {
    graphics: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})', renderScale: 'Renderskalierung',
    fromPreset: 'Aus Voreinstellung ({tier})', adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postUnavailable: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; Effekte werden ohne sie dargestellt.',
    presets: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra' },
    cats: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Bloom', grade: 'Farbkorrektur', antialias: 'Kantenglättung', reflections: 'Reflexionen', detail: 'Oberflächendetails', particles: 'Partikel', background: 'Hintergrund' },
    tiers: { off: 'Aus', on: 'An', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert', static: 'Statisch', animated: 'Animiert' },
    describe: { noShadows: 'keine Schatten', shadows: '{n}²-Schatten', ao: 'Umgebungsverdeckung', aoFull: 'volle Umgebungsverdeckung', bloom: 'Bloom', reflections: 'Reflexionen', noAA: 'keine Kantenglättung' },
  },
  'fr-FR': {
    graphics: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})', renderScale: 'Échelle de rendu',
    fromPreset: 'Selon le préréglage ({tier})', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    postUnavailable: 'Le post-traitement est indisponible sur cet appareil ; les effets sont rendus sans lui.',
    presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
    cats: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Lueur', grade: 'Étalonnage', antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces', particles: 'Particules', background: 'Arrière-plan' },
    tiers: { off: 'Non', on: 'Oui', low: 'Basses', medium: 'Moyennes', high: 'Hautes', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animé' },
    describe: { noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète', bloom: 'lueur', reflections: 'reflets', noAA: 'sans anticrénelage' },
  },
  'fr-CA': {
    graphics: 'Graphiques', quality: 'Qualité', auto: 'Auto (détectée : {tier})', renderScale: 'Échelle de rendu',
    fromPreset: 'Selon le préréglage ({tier})', adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
    postUnavailable: 'Le post-traitement n’est pas offert sur cet appareil; les effets sont rendus sans lui.',
    presets: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra' },
    cats: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Lueur', grade: 'Correction des couleurs', antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces', particles: 'Particules', background: 'Arrière-plan' },
    tiers: { off: 'Non', on: 'Oui', low: 'Basses', medium: 'Moyennes', high: 'Hautes', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé', static: 'Statique', animated: 'Animé' },
    describe: { noShadows: 'sans ombres', shadows: 'ombres {n}²', ao: 'occlusion ambiante', aoFull: 'occlusion ambiante complète', bloom: 'lueur', reflections: 'reflets', noAA: 'sans anticrénelage' },
  },
  'pt-BR': {
    graphics: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})', renderScale: 'Escala de renderização',
    fromPreset: 'Do predefinido ({tier})', adaptive: 'Resolução adaptativa', showFps: 'Mostrar taxa de quadros',
    postUnavailable: 'O pós-processamento não está disponível neste dispositivo; os efeitos são exibidos sem ele.',
    presets: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Sombras', ao: 'Oclusão ambiente', bloom: 'Brilho', grade: 'Correção de cor', antialias: 'Antisserrilhamento', reflections: 'Reflexos', detail: 'Detalhe das superfícies', particles: 'Partículas', background: 'Fundo' },
    tiers: { off: 'Não', on: 'Sim', low: 'Baixas', medium: 'Médias', high: 'Altas', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado', static: 'Estático', animated: 'Animado' },
    describe: { noShadows: 'sem sombras', shadows: 'sombras {n}²', ao: 'oclusão ambiente', aoFull: 'oclusão ambiente completa', bloom: 'brilho', reflections: 'reflexos', noAA: 'sem antisserrilhamento' },
  },
  'it-IT': {
    graphics: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})', renderScale: 'Scala di rendering',
    fromPreset: 'Da preimpostazione ({tier})', adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postUnavailable: 'La post-elaborazione non è disponibile su questo dispositivo; gli effetti vengono resi senza.',
    presets: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra' },
    cats: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore', antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici', particles: 'Particelle', background: 'Sfondo' },
    tiers: { off: 'No', on: 'Sì', low: 'Basse', medium: 'Medie', high: 'Alte', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato', static: 'Statico', animated: 'Animato' },
    describe: { noShadows: 'senza ombre', shadows: 'ombre {n}²', ao: 'occlusione ambientale', aoFull: 'occlusione ambientale completa', bloom: 'bagliore', reflections: 'riflessi', noAA: 'senza antialiasing' },
  },
};

export const GFX_LOCALES = Object.keys(STRINGS);

export function pickLocale(lang) {
  const tag = String(lang || '').trim();
  if (STRINGS[tag]) return tag;
  const lower = tag.toLowerCase();
  for (const k of GFX_LOCALES) if (k.toLowerCase() === lower) return k;
  const base = lower.split('-')[0];
  // Latin-American Spanish covers every es-* region except Spain
  if (base === 'es') return 'es-419';
  for (const k of GFX_LOCALES) if (k.split('-')[0] === base) return k;
  return 'en-US';
}

export function gfxStrings(lang) {
  const l = lang || (typeof navigator !== 'undefined' ? navigator.language : 'en-US');
  return STRINGS[pickLocale(l)];
}
