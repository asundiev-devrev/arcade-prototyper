import { SplitButton, SplitButtonItem } from "@xorkavi/arcade-gen";
import { devicePresets, type DevicePreset } from "../../lib/devicePresets";

export function DeviceToggle({
  value,
  onValueChange,
}: {
  value: DevicePreset;
  onValueChange: (value: DevicePreset) => void;
}) {
  const presets: DevicePreset[] = ["mobile", "tablet", "desktop", "wide", "fit"];

  return (
    <SplitButton variant="secondary">
      {presets.map((preset) => {
        const active = preset === value;
        return (
          <SplitButtonItem
            key={preset}
            aria-pressed={active}
            onClick={() => onValueChange(preset)}
            style={
              active
                ? {
                    background: "var(--component-button-primary-bg-idle)",
                    color: "var(--component-button-primary-fg-idle)",
                  }
                : undefined
            }
          >
            {devicePresets[preset].label}
          </SplitButtonItem>
        );
      })}
    </SplitButton>
  );
}
