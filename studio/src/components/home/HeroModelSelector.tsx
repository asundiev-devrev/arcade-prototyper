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
      {/* Arcade's default Select.Trigger is `w-full min-w-[160px]` and its
          cn() helper doesn't resolve class conflicts, so className overrides
          for width don't reliably beat the defaults. Force width via inline
          style instead — it always wins over class-based utilities. The
          <Select.Value /> child is required for the current option's label
          to render; without it the trigger shows only the chevron. */}
      <Select.Trigger
        id="hero-model-selector"
        aria-label="Model"
        className="rounded-circle-x2 h-8 px-3 border-0 bg-transparent hover:bg-(--bg-neutral-soft)"
        style={{ width: "auto", minWidth: 0, maxWidth: 160 }}
      >
        <Select.Value />
      </Select.Trigger>
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
