/**
 * Sol Mechs — design tokens.
 *
 * Every screen had its own inline style object and its own copy of the
 * palette — the same six hex values were pasted into four files, and each
 * screen invented its own font sizes. That is why the UI reads as unrelated
 * panels rather than one product.
 *
 * This is the single source. Colours are sampled from the Unity Workshop art
 * (bar.png), so the CSS chrome and the imported sprites agree.
 *
 * ## Type scale
 *
 * Sizes start at 12px, not 9. The old scale bottomed out around 9-10px for
 * labels and 12px for body copy, which is below comfortable reading size on a
 * dense dark panel — the single most common complaint about these screens.
 * Body copy is 15px and nothing but a tracked-out eyebrow label goes under 12.
 */

export const C = {
  /** Brand */
  teal: "#21dda0",
  cyan: "#3fe0ff",
  purple: "#9a46fe",
  blue: "#6686db",

  /** Surfaces, darkest first */
  ink: "#0b0616",
  panel: "#150c2b",
  raised: "#1d1140",
  line: "#33235c",
  lineBright: "#4a3480",

  /** Text, brightest first */
  text: "#f0ecfa",
  body: "#c9bfe4",
  dim: "#9d8fc4",
  faint: "#7a6ba3",

  /** Semantic */
  good: "#21dda0",
  warn: "#ffa726",
  bad: "#ff5468",
} as const;

/** px. `eyebrow` is the only size allowed below body copy. */
export const T = {
  eyebrow: 12,
  small: 13,
  body: 15,
  lead: 17,
  title: 22,
  display: 28,
} as const;

export const SP = { xs: 4, sm: 8, md: 12, lg: 16, xl: 22, xxl: 30 } as const;
export const R = { sm: 6, md: 8, lg: 12, pill: 999 } as const;

/**
 * The game's own face, shipped with the Unity project (`Assets/Fonts`).
 *
 * Used for numbers, labels and titles — anything that should read as the
 * game rather than as the browser. Body copy stays on the system stack,
 * which is more legible at paragraph length.
 */
export const DISPLAY = '"MEK Mono", ui-monospace, monospace';
export const MONO = '"MEK Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
export const SANS = "system-ui, -apple-system, Segoe UI, sans-serif";

export const PIXELATED: React.CSSProperties = { imageRendering: "pixelated" };

/** Tracked-out section label. The one place small type is correct. */
export const eyebrow: React.CSSProperties = {
  fontSize: T.eyebrow,
  letterSpacing: 2,
  color: C.faint,
  textTransform: "uppercase",
  fontWeight: 700,
};

/** The dark inset a panel's contents sit in. */
export const inset: React.CSSProperties = {
  background: C.ink,
  border: `1px solid ${C.line}`,
  borderRadius: R.md,
};

/** Modal backdrop shared by every Sol Mechs screen. */
export const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(4,2,10,.92)",
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: SP.md,
};

/**
 * Panel widths.
 *
 * Sol Mechs is registered as a mini-game, but it is a full battle screen with
 * an arena backdrop, a paper-doll editor and a squad manager — none of which
 * belong in the small centred box the other mini-games use. These take real
 * screen, capped only so the layout doesn't stretch absurdly on ultrawides.
 *
 * `vw`/`vh` rather than percentages: the panel should size against the
 * VIEWPORT, not against whatever the backdrop happens to be.
 */
export const W = {
  /** Menus and other short lists. */
  narrow: "min(760px, 94vw)",
  /**
   * Battle: the arena is the screen, so it takes what the window will give.
   * Capped at 1600 because past that the mechs, drawn at a fixed 2x, start to
   * look lost on the platform.
   */
  battle: "min(1600px, 96vw)",
  /** Workshop and squad builder: three working columns. */
  wide: "min(1360px, 96vw)",
} as const;

/** Full-height screens leave a little breathing room top and bottom. */
const UI = "/assets/minigames/sol-mechs/ui";

export const PANEL_HEIGHT = "min(94vh, 1000px)";

/**
 * The panel itself, framed in the Unity border and floored with the Workshop
 * comp's plotting grid.
 *
 * `frame()` supplies the border, so nothing here sets one — a rounded CSS
 * outline was standing in for it, which is what made these screens look
 * unrelated to the game's own art.
 */
export function panel(width: string): React.CSSProperties {
  return {
    position: "relative",
    background: C.panel,
    backgroundImage:
      `linear-gradient(${C.line}44 1px, transparent 1px), linear-gradient(90deg, ${C.line}44 1px, transparent 1px)`,
    backgroundSize: "26px 26px",
    ...frame(),
    width,
    maxHeight: "100%",
    boxShadow: `0 18px 60px rgba(0,0,0,.7)`,
    fontFamily: SANS,
    color: C.body,
  };
}

/**
 * The Unity panel frame (`arena/WinLoseCard/frame.png`) as a 9-slice.
 *
 * Chamfered corners and a cyan/purple neon edge — the same border language as
 * the main menu's `mainframe.png`, but without a scene baked into it. Imported
 * with its teal interior flood-filled to transparent so only the ring renders
 * and the panel keeps its own background.
 *
 * Slice 26 is the 22px chamfer plus margin, so the cut corners land in the
 * corner tiles instead of being stretched along the edges.
 */
export function frame(): React.CSSProperties {
  return {
    borderStyle: "solid",
    borderWidth: 14,
    borderImage: `url(${UI}/frame.png) 26 / 14px / 0 stretch`,
    // The 9-slice draws the edge; a radius would fight the chamfer.
    borderRadius: 0,
    imageRendering: "pixelated",
  };
}

/**
 * The Unity action button (`UI/button3.png`) as a 9-slice, with `button2.png`
 * as its held state — the same frame with the corner accents lit.
 *
 * Slice 22 keeps the corner brackets in the corner tiles; the border width is
 * smaller so they scale down with the frame.
 */
export function actionButton(opts: { selected?: boolean; disabled?: boolean; held?: boolean } = {}): React.CSSProperties {
  const sprite = opts.held ? "btn-action-hold.png" : "btn-action.png";
  return {
    borderStyle: "solid",
    borderWidth: 9,
    borderImage: `url(${UI}/${sprite}) 22 fill / 9px / 0 stretch`,
    background: "transparent",
    color: opts.selected ? C.teal : C.text,
    fontFamily: "inherit",
    fontSize: T.small,
    fontWeight: 700,
    padding: "5px 10px",
    cursor: opts.disabled ? "not-allowed" : "pointer",
    opacity: opts.disabled ? 0.45 : 1,
    textAlign: "left",
    lineHeight: 1.25,
    imageRendering: "pixelated",
  };
}

export type ButtonTone = "primary" | "ghost" | "danger" | "neutral";

/** One button treatment, so no screen invents its own. */
export function button(tone: ButtonTone = "neutral", opts: { block?: boolean; disabled?: boolean } = {}): React.CSSProperties {
  const base: React.CSSProperties = {
    fontFamily: "inherit",
    fontSize: T.small,
    fontWeight: 700,
    letterSpacing: 1,
    borderRadius: R.sm,
    padding: "11px 18px",
    cursor: opts.disabled ? "not-allowed" : "pointer",
    opacity: opts.disabled ? 0.4 : 1,
    width: opts.block ? "100%" : undefined,
    lineHeight: 1.2,
    border: "1px solid transparent",
  };
  switch (tone) {
    case "primary":
      return { ...base, background: C.teal, color: C.ink, borderColor: C.teal, fontSize: T.body, fontWeight: 800 };
    case "danger":
      return { ...base, background: "#5c1830", color: C.text, borderColor: C.bad };
    case "ghost":
      return { ...base, background: "transparent", color: C.dim, borderColor: C.line };
    default:
      return { ...base, background: C.raised, color: C.text, borderColor: C.line };
  }
}

/**
 * The gradient plate the Unity menu labels are drawn on, rebuilt in CSS.
 *
 * Used for modes whose label doesn't exist as art, so a text button sits
 * beside a sprite without looking like a different control.
 */
export function labelPlate(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    height: LABEL_HEIGHT,
    padding: "0 16px",
    background: `linear-gradient(180deg, ${C.cyan}, ${C.purple})`,
    color: "#fff",
    fontSize: T.small,
    fontWeight: 800,
    letterSpacing: 1.5,
    WebkitTextStroke: "0.6px rgba(0,0,0,.6)",
    clipPath: "polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)",
    whiteSpace: "nowrap",
  };
}

/**
 * Every mode label renders at this height, art or CSS. The Unity sprites have
 * different baked widths and internal padding, so matching on HEIGHT is what
 * makes a row of them read as one set.
 */
export const LABEL_HEIGHT = 30;
