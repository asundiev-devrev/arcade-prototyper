import { useEffect, useState, type ReactElement } from "react";

const SCENE_DURATION_MS = 50_000;
const CROSSFADE_MS = 600;

type Scene = {
  id: string;
  caption: string;
  render: () => ReactElement;
};

// All scene art uses `currentColor` so it inherits the wrapper's
// `color`. The wrapper sets `color: var(--fg-neutral-medium)` so scenes
// stay neutral and theme-aware. Per-element opacity provides hierarchy.
const STROKE_STRONG = 0.55;
const STROKE_SOFT = 0.18;
const FILL_SOFT = 0.06;
const ACCENT = 0.78;

function FrameOutline() {
  return (
    <rect
      x={1}
      y={1}
      width={478}
      height={318}
      rx={14}
      fill="none"
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
      strokeWidth={1.5}
      strokeDasharray="8 8"
      style={{
        animation:
          "arcade-studio-loading-dash-drift 2400ms linear infinite",
      }}
      className="arcade-studio-loading-frame"
    />
  );
}

const sceneThinking = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {/* Three rings expanding outward in sequence, only one fully visible
     *  at a time — staggered animation creates a single ripple effect
     *  rather than three independent pulses. */}
    {[0, 1, 2].map((i) => (
      <circle
        key={i}
        cx={240}
        cy={160}
        r={20}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        style={{
          transformOrigin: "240px 160px",
          animation:
            "arcade-studio-loading-ripple 2400ms ease-out infinite",
          animationDelay: `${i * 800}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
    <circle cx={240} cy={160} r={6} fill="currentColor" fillOpacity={ACCENT} />
  </svg>
);

const sceneReading = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {[0, 1, 2].map((i) => (
      <g
        key={i}
        style={{
          transformOrigin: `${240 + i * 14}px ${160 + i * 14}px`,
          animation: `arcade-studio-loading-glyph-pulse 3000ms ease-in-out infinite`,
          animationDelay: `${i * 700}ms`,
        }}
        className="arcade-studio-loading-glyph"
      >
        <rect
          x={140 + i * 14}
          y={108 + i * 14}
          width={200}
          height={100}
          rx={10}
          fill="currentColor"
          fillOpacity={FILL_SOFT}
          stroke="currentColor"
          strokeOpacity={STROKE_SOFT}
          strokeWidth={1.5}
          strokeDasharray="6 6"
        />
        <line
          x1={156 + i * 14}
          y1={134 + i * 14}
          x2={300 + i * 14}
          y2={134 + i * 14}
          stroke="currentColor"
          strokeOpacity={STROKE_SOFT}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={156 + i * 14}
          y1={154 + i * 14}
          x2={260 + i * 14}
          y2={154 + i * 14}
          stroke="currentColor"
          strokeOpacity={STROKE_SOFT}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={156 + i * 14}
          y1={174 + i * 14}
          x2={280 + i * 14}
          y2={174 + i * 14}
          stroke="currentColor"
          strokeOpacity={STROKE_SOFT}
          strokeWidth={4}
          strokeLinecap="round"
        />
      </g>
    ))}
  </svg>
);

const sceneSketching = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {[
      { x: 120, y: 80, w: 240, h: 40 },
      { x: 120, y: 140, w: 110, h: 110 },
      { x: 250, y: 140, w: 110, h: 50 },
      { x: 250, y: 200, w: 110, h: 50 },
    ].map((b, i) => (
      <rect
        key={i}
        x={b.x}
        y={b.y}
        width={b.w}
        height={b.h}
        rx={8}
        fill="currentColor"
        fillOpacity={FILL_SOFT}
        stroke="currentColor"
        strokeOpacity={STROKE_STRONG}
        strokeWidth={1.5}
        strokeDasharray="6 6"
        style={{
          transformOrigin: `${b.x + b.w / 2}px ${b.y + b.h / 2}px`,
          animation: `arcade-studio-loading-glyph-pulse 2800ms ease-in-out infinite`,
          animationDelay: `${i * 350}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
  </svg>
);

const sceneComponents = (): ReactElement => {
  // Three clean rows. No avatars/faces — small SVG portraits never look
  // good. Each row is a stack of common UI primitives sized at the same
  // baseline grid so the composition reads as a real component palette.
  const rows = [
    // Header row: title bar + small badge
    [
      { kind: "rect", x: 100, y: 70, w: 200, h: 14, r: 7, fill: STROKE_STRONG },
      { kind: "rect", x: 320, y: 68, w: 60, h: 18, r: 9, fill: STROKE_SOFT, stroke: STROKE_STRONG },
    ],
    // Button row: primary button + ghost button
    [
      { kind: "rect", x: 100, y: 124, w: 110, h: 32, r: 16, fill: STROKE_STRONG },
      { kind: "rect", x: 230, y: 124, w: 110, h: 32, r: 16, fill: 0, stroke: STROKE_STRONG },
    ],
    // Input row: full-width text input
    [
      { kind: "rect", x: 100, y: 184, w: 280, h: 32, r: 6, fill: 0, stroke: STROKE_STRONG },
    ],
    // Chip row: three pills
    [
      { kind: "rect", x: 100, y: 240, w: 70, h: 22, r: 11, fill: FILL_SOFT, stroke: STROKE_SOFT },
      { kind: "rect", x: 180, y: 240, w: 90, h: 22, r: 11, fill: FILL_SOFT, stroke: STROKE_SOFT },
      { kind: "rect", x: 280, y: 240, w: 60, h: 22, r: 11, fill: FILL_SOFT, stroke: STROKE_SOFT },
    ],
  ];
  let idx = 0;
  return (
    <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
      <FrameOutline />
      {rows.map((row, ri) =>
        row.map((el) => {
          const i = idx++;
          return (
            <rect
              key={i}
              x={el.x}
              y={el.y}
              width={el.w}
              height={el.h}
              rx={el.r}
              fill={el.fill ? "currentColor" : "none"}
              fillOpacity={el.fill || 0}
              stroke={el.stroke ? "currentColor" : "none"}
              strokeOpacity={el.stroke || 0}
              strokeWidth={1.5}
              style={{
                transformOrigin: `${el.x + el.w / 2}px ${el.y + el.h / 2}px`,
                animation:
                  "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
                animationDelay: `${ri * 250 + i * 60}ms`,
              }}
              className="arcade-studio-loading-glyph"
            />
          );
        }),
      )}
    </svg>
  );
};

const sceneColors = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {/* Neutral palette: 6 swatches in a lightness gradient. Reads as a
     *  swatch picker without breaking the monochrome rule. */}
    {[0.08, 0.18, 0.32, 0.5, 0.7, 0.9].map((opacity, i) => (
      <rect
        key={i}
        x={88 + i * 52}
        y={140}
        width={40}
        height={40}
        rx={20}
        fill="currentColor"
        fillOpacity={opacity}
        stroke="currentColor"
        strokeOpacity={STROKE_SOFT}
        strokeWidth={1}
        style={{
          transformOrigin: `${108 + i * 52}px 160px`,
          animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
          animationDelay: `${i * 220}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
  </svg>
);

const scenePolishing = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <rect
      x={1}
      y={1}
      width={478}
      height={318}
      rx={14}
      fill="none"
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
      strokeWidth={1.5}
    />
    <rect
      x={120}
      y={84}
      width={240}
      height={28}
      rx={6}
      fill="currentColor"
      fillOpacity={FILL_SOFT}
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
    />
    <rect
      x={120}
      y={124}
      width={110}
      height={110}
      rx={10}
      fill="currentColor"
      fillOpacity={FILL_SOFT}
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
    />
    <rect
      x={250}
      y={124}
      width={110}
      height={50}
      rx={8}
      fill="currentColor"
      fillOpacity={FILL_SOFT}
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
    />
    <rect
      x={250}
      y={184}
      width={110}
      height={50}
      rx={8}
      fill="currentColor"
      fillOpacity={FILL_SOFT}
      stroke="currentColor"
      strokeOpacity={STROKE_SOFT}
    />
    {/* Subtle dots traveling around the composition. Fewer, smaller,
     *  monochrome — no sparkles. */}
    {[
      { x: 96, y: 80 },
      { x: 392, y: 110 },
      { x: 200, y: 252 },
      { x: 376, y: 252 },
      { x: 96, y: 192 },
    ].map((s, i) => (
      <circle
        key={i}
        cx={s.x}
        cy={s.y}
        r={4}
        fill="currentColor"
        fillOpacity={ACCENT}
        style={{
          transformOrigin: `${s.x}px ${s.y}px`,
          animation: "arcade-studio-loading-glyph-pulse 1800ms ease-in-out infinite",
          animationDelay: `${i * 280}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
  </svg>
);

const SCENES: Scene[] = [
  { id: "thinking", caption: "Thinking through your idea", render: sceneThinking },
  { id: "reading", caption: "Reading your design context", render: sceneReading },
  { id: "sketching", caption: "Sketching the layout", render: sceneSketching },
  { id: "components", caption: "Adding components", render: sceneComponents },
  { id: "colors", caption: "Choosing colors", render: sceneColors },
  { id: "polishing", caption: "Polishing details", render: scenePolishing },
];

export function LoadingShow({
  /** Override scene rotation interval. Default 50_000ms. Tests pass low values. */
  intervalMs = SCENE_DURATION_MS,
  /** Crossfade duration. Default 600ms. */
  crossfadeMs = CROSSFADE_MS,
  /** Optional initial scene index (testing only). */
  initialIndex = 0,
}: {
  intervalMs?: number;
  crossfadeMs?: number;
  initialIndex?: number;
} = {}) {
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  useEffect(() => {
    const id = window.setInterval(() => {
      setActiveIndex((i) => (i + 1) % SCENES.length);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  const active = SCENES[activeIndex];

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={active.caption}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        pointerEvents: "none",
        background: "var(--bg-neutral-soft)",
        color: "var(--fg-neutral-medium)",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 480,
          height: 320,
          flex: "none",
        }}
      >
        {SCENES.map((scene, i) => (
          <div
            key={scene.id}
            data-scene={scene.id}
            data-active={i === activeIndex || undefined}
            className="arcade-studio-loading-scene"
            style={{
              position: "absolute",
              inset: 0,
              opacity: i === activeIndex ? 1 : 0,
              transition: `opacity ${crossfadeMs}ms ease`,
            }}
          >
            {scene.render()}
          </div>
        ))}
      </div>
      <div
        style={{
          fontSize: 14,
          color: "var(--fg-neutral-medium)",
          fontVariantNumeric: "tabular-nums",
          minHeight: 20,
          transition: `opacity ${crossfadeMs}ms ease`,
        }}
      >
        {active.caption}
      </div>
    </div>
  );
}

export const _SCENES_FOR_TEST = SCENES;
