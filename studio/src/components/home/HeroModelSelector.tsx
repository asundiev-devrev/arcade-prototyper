import { useCallback, useEffect, useState } from "react";
import { Select } from "@xorkavi/arcade-gen";

const MODEL_DEFAULT_SENTINEL = "__default__";

const MODEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: MODEL_DEFAULT_SENTINEL, label: "Auto" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "haiku", label: "Haiku" },
];

export function HeroModelSelector() {
  const [value, setValue] = useState<string>(MODEL_DEFAULT_SENTINEL);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setValue(data?.studio?.model || MODEL_DEFAULT_SENTINEL);
        }
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const onChange = useCallback(async (next: string) => {
    setValue(next);
    // PATCH deep-merges; `null` explicitly unsets `studio.model` without
    // clobbering sibling studio.* keys (e.g., studio.mode).
    const persisted = next === MODEL_DEFAULT_SENTINEL ? null : next;
    try {
      await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studio: { model: persisted } }),
      });
    } catch { /* non-critical — UI already updated */ }
  }, []);

  return (
    <Select.Root value={value} onValueChange={onChange}>
      {/* Arcade's default Select.Trigger is `w-full min-w-[160px]`. In the
          hero trailing row we want a compact pill sized to its label, like
          the Figma reference shows. `w-auto min-w-0` + pill radius does it. */}
      <Select.Trigger
        id="hero-model-selector"
        aria-label="Model"
        className="w-auto min-w-0 rounded-circle-x2 h-8 px-3 border-0 bg-transparent hover:bg-(--bg-neutral-soft)"
      />
      <Select.Content>
        {MODEL_OPTIONS.map((opt) => (
          <Select.Item key={opt.value} value={opt.value}>
            {opt.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
