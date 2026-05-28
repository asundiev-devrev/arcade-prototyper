import { SHAPES, type SkeletonShape } from "./skeletonShapes";

const FALLBACK: Array<{ name: string; shape: SkeletonShape }> = [
  { name: "Header", shape: SHAPES.Header },
  { name: "block-a", shape: { kind: "block", height: "30%" } },
  { name: "block-b", shape: { kind: "block", height: "30%" } },
  { name: "Footer", shape: SHAPES.Footer },
];

function blockStyle(): React.CSSProperties {
  return {
    background: "var(--surface-overlay-2, rgba(255,255,255,0.08))",
    borderRadius: 8,
    animation: "arcade-studio-skeleton-pulse 1.6s ease-in-out infinite alternate",
  };
}

export function FrameSkeleton({
  composites,
  visible,
}: {
  composites: string[];
  visible: boolean;
}) {
  if (!visible) return null;

  const known = composites
    .map((name) => ({ name, shape: SHAPES[name] }))
    .filter((entry): entry is { name: string; shape: SkeletonShape } => Boolean(entry.shape));

  const entries = known.length > 0 ? known : FALLBACK;

  const top = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "top");
  const bottom = entries.filter((e) => e.shape.kind === "bar" && (e.shape as any).anchor === "bottom");
  const left = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "left");
  const right = entries.filter((e) => e.shape.kind === "rail" && (e.shape as any).anchor === "right");
  const center = entries.filter((e) =>
    e.shape.kind !== "bar" && e.shape.kind !== "rail",
  );

  return (
    <div
      data-testid="frame-skeleton"
      style={{
        position: "absolute",
        inset: 0,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      {top.map((e, i) => (
        <div
          key={`top-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(), height: (e.shape as any).height }}
        />
      ))}
      <div style={{ flex: 1, display: "flex", gap: 16 }}>
        {left.map((e, i) => (
          <div
            key={`left-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(), width: (e.shape as any).width }}
          />
        ))}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
          {center.flatMap((e, i) => {
            if (e.shape.kind === "tile") {
              const tiles = Array.from({ length: e.shape.repeat }).map((_, j) => (
                <div
                  key={`tile-${e.name}-${i}-${j}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(),
                    aspectRatio: e.shape.aspect,
                    flex: 1,
                  }}
                />
              ));
              return [
                <div
                  key={`tile-row-${i}`}
                  style={{ display: "flex", gap: 16, flex: 1 }}
                >
                  {tiles}
                </div>,
              ];
            }
            if (e.shape.kind === "centered") {
              return [
                <div
                  key={`center-${e.name}-${i}`}
                  data-skeleton-block={e.name}
                  style={{
                    ...blockStyle(),
                    width: e.shape.width,
                    height: e.shape.height,
                    alignSelf: "center",
                    margin: "auto",
                  }}
                />,
              ];
            }
            return [
              <div
                key={`block-${e.name}-${i}`}
                data-skeleton-block={e.name}
                style={{ ...blockStyle(), height: (e.shape as any).height ?? "100%" }}
              />,
            ];
          })}
        </div>
        {right.map((e, i) => (
          <div
            key={`right-${e.name}-${i}`}
            data-skeleton-block={e.name}
            style={{ ...blockStyle(), width: (e.shape as any).width }}
          />
        ))}
      </div>
      {bottom.map((e, i) => (
        <div
          key={`bottom-${e.name}-${i}`}
          data-skeleton-block={e.name}
          style={{ ...blockStyle(), height: (e.shape as any).height }}
        />
      ))}
    </div>
  );
}
