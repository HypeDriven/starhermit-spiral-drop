// The look of the HUD, panels and screens: the browser build's
// css/style.css, rewritten class-based in tools/ui-style.css and converted
// once with `starhermit css` into assets/ui-style.json (`npm run css`),
// registered at start with the theme the runtime's own widgets (scroll bars,
// focus rings, selects, sliders) take. The runtime's high contrast option is
// the old body.high-contrast token set.
import { files } from "starhermit:engine";
import * as ui from "starhermit:ui";

type Tokens = Record<string, string>;
const BASE: Tokens = {
  "ui-bg": "#0e0a1ad1", "ui-bg-solid": "#171126", "ui-panel": "#0e0a1af2", "ui-fg": "#f2eefc", "ui-dim": "#b6aad4",
  "ui-accent": "#ffd66e", "ui-ink": "#20162e", "ui-danger": "#ff5d73", "ui-line": "#ffffff24", "ui-hover": "#ffffff0f", "ui-kbd": "#ffffff1f",
};
/** body.high-contrast. */
const CONTRAST: Tokens = {
  "ui-bg": "#000000f0", "ui-bg-solid": "#000000", "ui-panel": "#000000f5", "ui-fg": "#ffffff", "ui-dim": "#e8e8e8",
  "ui-line": "#ffffff8c", "ui-accent": "#ffe600",
};

let current: Tokens = { ...BASE };
let key = "";
function theme(t: Tokens): void {
  ui.setTheme({
    text: t["ui-fg"]!, muted: t["ui-dim"]!, panel: t["ui-bg-solid"]!, control: t["ui-bg-solid"]!, hovered: "#2a2140",
    pressed: "#3a2f55", field: t["ui-bg-solid"]!, accent: t["ui-accent"]!, focus: t["ui-accent"]!, outline: t["ui-line"]!,
  });
}
export function initStyles(): void {
  const css = files.readJson("assets/ui-style.json") as unknown as ui.CssStyles;
  ui.setFont({ family: "sans-serif" });
  ui.setTheme({ fontSize: 16, smallSize: 13.6, headingSize: 21.6, padding: 8, spacing: 10, radius: 12 });
  theme(BASE);
  ui.setTokens(css.tokens);
  ui.setStyles({
    ...css.styles,
    label: { text: { color: "$ui-fg" } },
    paragraph: { text: { color: "$ui-fg" } },
    heading: { text: { color: "$ui-fg" } },
    widget: { focusRing: { color: "$ui-accent", width: 3, offset: 2 } },
    scrollArea: { parts: { bar: { background: "$ui-line", radius: 4 } } },
    tooltip: { background: "$ui-bg-solid", text: { color: "$ui-fg" }, radius: 6, padding: 6 },
    // .screen: rgba(8, 5, 18, 0.45) behind the panels.
    dialog: { background: "#00000000", padding: 0, parts: { backdrop: { background: "#08051273" } } },
  });
  key = "";
  applyContrast(false);
}

/** The base or high-contrast tokens (cheap when unchanged). */
export function applyContrast(highContrast: boolean): void {
  const k = String(highContrast);
  if (k === key) return;
  key = k;
  current = { ...BASE, ...(highContrast ? CONTRAST : {}) };
  ui.setTokens(current);
  theme(current);
}
/** A token's current colour (for draw calls, which take real colours). */
export function token(name: string): string { return current[name] ?? "#000000"; }
