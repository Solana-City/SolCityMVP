import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

/**
 * Glow for a chamfered element. `clip-path` clips the element's own
 * `box-shadow`, so the glow lives here on a wrapper instead, as a CSS
 * `drop-shadow()` that follows the chamfered shape it wraps.
 *
 * `glow` is a filter value, e.g. "drop-shadow(0 0 12px rgba(153,69,255,0.5))".
 * Layout props (margin, width, flex...) go on this wrapper via `style`.
 */
export default function ChamferGlow({
  glow,
  style,
  children,
  ...rest
}: { glow: string; style?: CSSProperties; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} style={{ filter: glow, ...style }}>
      {children}
    </div>
  );
}
