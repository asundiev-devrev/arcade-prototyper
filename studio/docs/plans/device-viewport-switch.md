# Device Viewport Switch (Feature 4.6)

## Goal

Add a runtime device viewport toggle that allows users to preview frames at different device breakpoints (Mobile / Tablet / Desktop / Wide) without modifying the persisted frame size. This is a global control at the viewport-column level that applies to all visible frames simultaneously.

## Current State

Each `Frame` has a `size: "375" | "1024" | "1440" | "1920"` property persisted in `project.json`. The `FrameCard` component includes a size selector in `FrameCornerMenu` that sends a PATCH request to update the stored size, causing unnecessary file churn for what should be a runtime viewport concern.

## Design Decisions (Locked)

**Scope:** Global toggle for the entire viewport column. One active device preset applies to all visible frames simultaneously.

**Persistence:** Runtime-only. Device selection is NOT persisted to `project.json` or `frame.size`. The stored `frame.size` remains as a legacy field (used by Vercel share plan for default export dimensions).

**Device Presets:**

| Preset   | Width | Description                    |
|----------|-------|--------------------------------|
| Mobile   | 375   | iPhone SE / standard mobile    |
| Tablet   | 1024  | iPad / standard tablet         |
| Desktop  | 1440  | Standard desktop viewport      |
| Wide     | 1920  | Large desktop / external       |
| Fit      | auto  | Fill available column width    |

**Zoom Control:** Optional slider (50–150%) alongside device picker. Deferred to v1.1 if too much scope for v1.

**Device Bezels/Chrome:** NOT included in v1. The iframe simply changes CSS `max-width`/`width` based on preset. Complexity not justified since Option B viewport wrapper already provides visual differentiation.

**UI Placement:** Device toggle lives in a toolbar at the top of the viewport column, inside `ViewportPreview` (the tinted wrapper from redesign Phase 4). Simple segmented control: `[Mobile] [Tablet] [Desktop] [Wide] [Fit]`.

**Legacy `frame.size`:** Keep the field (cheap to maintain, used by Vercel share). Retire the UI for setting it—remove size selector from `FrameCornerMenu`.

**Per-frame override:** Skip for v1. Cleaner UX without per-frame complexity.

## Data Flow

```
ProjectDetail (holds devicePreset state, default "desktop")
    ↓
Viewport (renders DeviceToggle + maps frames)
    ↓
FrameCard (computes effectiveSize = computeFrameSize(devicePreset, frame.size))
    ↓
<iframe style={{width: effectiveSize, ...}} />
```

**State:** `devicePreset` lives in `ProjectDetail` component state (React useState). NOT persisted—runtime-only UI state.

## Files to Create/Modify

### New Files

**1. `studio/src/lib/devicePresets.ts`**

```typescript
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
```

**2. `studio/src/components/viewport/DeviceToggle.tsx`**

Segmented control for device presets. Place inside `ViewportPreview` toolbar (next to "Preview" label or as bottom strip).

### Modified Files

**3. `studio/src/routes/ProjectDetail.tsx`**

Add `devicePreset` state and pass to Viewport:
```typescript
const [devicePreset, setDevicePreset] = useState<DevicePreset>("desktop");
```

**4. `studio/src/components/viewport/Viewport.tsx`**

Accept `devicePreset` and `onDeviceChange` props, render `DeviceToggle` inside `ViewportPreview`, pass `devicePreset` to each `FrameCard`.

**5. `studio/src/components/viewport/FrameCard.tsx`**

Accept `devicePreset` prop, compute `effectiveWidth = computeFrameSize(devicePreset)`, apply to iframe wrapper with CSS transition for smooth resize.

**6. `studio/src/components/viewport/FrameCornerMenu.tsx`**

Remove size selector dropdown and `onSize` callback. Keep rename, duplicate, delete actions.

## Implementation Phases

### Phase 1: Device preset library + DeviceToggle component

**Create:**
- `devicePresets.ts` with preset definitions and `computeFrameSize` helper
- `DeviceToggle.tsx` segmented control component

**Verify:** DeviceToggle renders all 5 presets and calls onChange correctly.

### Phase 2: Wire device state into Viewport + FrameCard

**Modify:**
- `ProjectDetail`: add `devicePreset` state
- `Viewport`: render `DeviceToggle` inside `ViewportPreview`, pass `devicePreset` to FrameCards
- `FrameCard`: compute effective size from `devicePreset`, apply with CSS transition
- `FrameCornerMenu`: remove size selector

**Verify:**
- Switch device preset → all frames resize together in <200ms
- `project.json` NOT modified when changing device preset
- Frame labels show current effective width

## Future Enhancements (v1.1+)

- Zoom control (50–150% slider)
- Per-frame override (lock icon for side-by-side mobile/desktop comparison)
- Persist devicePreset to localStorage with per-project key
- Device bezels/chrome (optional polish, adds complexity without strong payoff)
- Ultra-wide preset (2560px) or custom width input

## Risks

**Iframe content overflow:** Frame content designed for 1440px may not scale gracefully to 375px. This is by design—exposes responsive issues. Document as expected behavior.

**Performance with many frames:** Resizing 10+ iframes simultaneously could cause jank. Use CSS transitions with `will-change: width` for smooth animation. Test with multiple frames to ensure <200ms resize time.

## Success Criteria

- [ ] Device toggle appears inside `ViewportPreview` (viewport column toolbar)
- [ ] Changing device preset resizes all visible frames within 200ms
- [ ] Frame labels show current effective width (e.g., "375px" or "Fit")
- [ ] No writes to `project.json` when changing device preset
- [ ] Per-frame size selector removed from `FrameCornerMenu`
- [ ] User can switch between Mobile/Tablet/Desktop/Wide/Fit seamlessly

## Related Work

Vercel share integration: Export frames at their stored `frame.size` (not the runtime device preset).

## Revision History

**2026-04-24:** Resolved open decisions, locked scope for v1. Device toggle is global (viewport-column level), runtime-only (no persistence), uses 5 presets (Mobile/Tablet/Desktop/Wide/Fit). Removed device bezels, zoom control, per-frame override from v1 scope. Trimmed verbose content and implementation pseudocode. Retired per-frame size selector UI from `FrameCornerMenu`.
