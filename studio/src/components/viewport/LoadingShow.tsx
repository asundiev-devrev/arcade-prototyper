import { useEffect, useState, type ReactElement } from "react";

const SCENE_DURATION_MS = 50_000;
const CROSSFADE_MS = 600;

type Scene = {
  id: string;
  caption: string;
  render: () => ReactElement;
};

const PURPLE = "#6E56F4";
const PURPLE_SOFT = "rgba(110, 86, 244, 0.22)";
const PURPLE_FILL = "rgba(110, 86, 244, 0.10)";

function FrameOutline({
  width = 480,
  height = 320,
  dashed = true,
  drift = true,
}: {
  width?: number;
  height?: number;
  dashed?: boolean;
  drift?: boolean;
}) {
  return (
    <rect
      x={1}
      y={1}
      width={width - 2}
      height={height - 2}
      rx={14}
      fill="none"
      stroke={PURPLE_SOFT}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "8 8" : undefined}
      style={
        dashed && drift
          ? {
              animation:
                "arcade-studio-loading-dash-drift 2400ms linear infinite",
            }
          : undefined
      }
      className="arcade-studio-loading-frame"
    />
  );
}

const sceneThinking = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {[0, 1, 2].map((i) => (
      <circle
        key={i}
        cx={240}
        cy={160}
        r={36 + i * 26}
        fill="none"
        stroke={PURPLE}
        strokeOpacity={0.22 - i * 0.06}
        strokeWidth={1.5}
        style={{
          transformOrigin: "240px 160px",
          animation: `arcade-studio-loading-glyph-pulse ${2200 + i * 400}ms ease-in-out infinite`,
          animationDelay: `${i * 200}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
    <circle cx={240} cy={160} r={6} fill={PURPLE} />
  </svg>
);

const sceneReading = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {[0, 1, 2].map((i) => (
      <g
        key={i}
        style={{
          transformOrigin: "240px 160px",
          animation: `arcade-studio-loading-glyph-pulse ${3000}ms ease-in-out infinite`,
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
          fill={PURPLE_FILL}
          stroke={PURPLE_SOFT}
          strokeWidth={1.5}
          strokeDasharray="6 6"
        />
        <line
          x1={156 + i * 14}
          y1={134 + i * 14}
          x2={300 + i * 14}
          y2={134 + i * 14}
          stroke={PURPLE_SOFT}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={156 + i * 14}
          y1={154 + i * 14}
          x2={260 + i * 14}
          y2={154 + i * 14}
          stroke={PURPLE_SOFT}
          strokeWidth={4}
          strokeLinecap="round"
        />
        <line
          x1={156 + i * 14}
          y1={174 + i * 14}
          x2={280 + i * 14}
          y2={174 + i * 14}
          stroke={PURPLE_SOFT}
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
        fill={PURPLE_FILL}
        stroke={PURPLE}
        strokeOpacity={0.55}
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

const sceneComponents = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {/* button */}
    <rect
      x={140}
      y={120}
      width={120}
      height={36}
      rx={18}
      fill={PURPLE}
      style={{ animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite" }}
      className="arcade-studio-loading-glyph"
    />
    {/* avatar */}
    <circle
      cx={300}
      cy={138}
      r={18}
      fill="none"
      stroke={PURPLE}
      strokeWidth={2}
      style={{
        animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
        animationDelay: "200ms",
      }}
      className="arcade-studio-loading-glyph"
    />
    <circle
      cx={300}
      cy={132}
      r={6}
      fill={PURPLE}
      style={{
        animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
        animationDelay: "200ms",
      }}
      className="arcade-studio-loading-glyph"
    />
    <path
      d="M286 152 q14 -10 28 0"
      stroke={PURPLE}
      strokeWidth={2}
      fill="none"
      strokeLinecap="round"
      style={{
        animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
        animationDelay: "200ms",
      }}
      className="arcade-studio-loading-glyph"
    />
    {/* chip */}
    <rect
      x={150}
      y={186}
      width={84}
      height={24}
      rx={12}
      fill="none"
      stroke={PURPLE}
      strokeWidth={1.5}
      style={{
        animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
        animationDelay: "400ms",
      }}
      className="arcade-studio-loading-glyph"
    />
    <circle cx={164} cy={198} r={4} fill={PURPLE} opacity={0.6} />
    {/* input */}
    <rect
      x={250}
      y={186}
      width={108}
      height={24}
      rx={6}
      fill="none"
      stroke={PURPLE}
      strokeOpacity={0.55}
      strokeWidth={1.5}
      style={{
        animation: "arcade-studio-loading-glyph-pulse 2400ms ease-in-out infinite",
        animationDelay: "600ms",
      }}
      className="arcade-studio-loading-glyph"
    />
  </svg>
);

const sceneColors = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline />
    {[
      "#6E56F4",
      "#FF7A7A",
      "#FFC857",
      "#3CC79A",
      "#4D9EE8",
      "#B36CFF",
    ].map((c, i) => (
      <circle
        key={c}
        cx={120 + i * 48}
        cy={160}
        r={20}
        fill={c}
        opacity={0.85}
        style={{
          transformOrigin: `${120 + i * 48}px 160px`,
          animation: "arcade-studio-loading-glyph-pulse 2200ms ease-in-out infinite",
          animationDelay: `${i * 220}ms`,
        }}
        className="arcade-studio-loading-glyph"
      />
    ))}
  </svg>
);

const scenePolishing = (): ReactElement => (
  <svg viewBox="0 0 480 320" width="100%" height="100%" aria-hidden="true">
    <FrameOutline dashed={false} />
    {/* Composed wireframe */}
    <rect x={120} y={84} width={240} height={28} rx={6} fill={PURPLE_FILL} stroke={PURPLE_SOFT} />
    <rect x={120} y={124} width={110} height={110} rx={10} fill={PURPLE_FILL} stroke={PURPLE_SOFT} />
    <rect x={250} y={124} width={110} height={50} rx={8} fill={PURPLE_FILL} stroke={PURPLE_SOFT} />
    <rect x={250} y={184} width={110} height={50} rx={8} fill={PURPLE_FILL} stroke={PURPLE_SOFT} />
    {/* Sparkles */}
    {[
      { x: 100, y: 80 },
      { x: 380, y: 120 },
      { x: 200, y: 240 },
      { x: 360, y: 248 },
      { x: 110, y: 200 },
    ].map((s, i) => (
      <g
        key={i}
        style={{
          transformOrigin: `${s.x}px ${s.y}px`,
          animation: "arcade-studio-loading-glyph-pulse 1600ms ease-in-out infinite",
          animationDelay: `${i * 280}ms`,
        }}
        className="arcade-studio-loading-glyph"
      >
        <path
          d={`M${s.x} ${s.y - 10} L${s.x + 3} ${s.y - 3} L${s.x + 10} ${s.y} L${s.x + 3} ${s.y + 3} L${s.x} ${s.y + 10} L${s.x - 3} ${s.y + 3} L${s.x - 10} ${s.y} L${s.x - 3} ${s.y - 3} Z`}
          fill={PURPLE}
        />
      </g>
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
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 24,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "relative",
          width: 480,
          height: 320,
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
