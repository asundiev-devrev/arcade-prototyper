export type DevicePreset = "mobile" | "tablet" | "desktop" | "wide" | "fit";

export interface DeviceDimensions {
  width: number | "auto";
  label: string;
}

export const devicePresets: Record<DevicePreset, DeviceDimensions> = {
  mobile: { width: 375, label: "Mobile" },
  tablet: { width: 1024, label: "Tablet" },
  desktop: { width: 1440, label: "Desktop" },
  wide: { width: 1920, label: "Wide" },
  fit: { width: "auto", label: "Fit" },
};

export function computeFrameSize(
  preset: DevicePreset,
  viewportWidth?: number
): number | string {
  const dims = devicePresets[preset];

  if (preset === "fit") {
    return viewportWidth ? viewportWidth - 48 : "100%";
  }

  return dims.width;
}
