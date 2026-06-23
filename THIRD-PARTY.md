# Third-Party Code

## design-mode (overlay)

`studio/src/frame/overlay/` adapts the DOM-highlighting overlay from
[design-mode](https://github.com/SandeepBaskaran/design-mode) by Sandeep
Baskaran, used under the MIT License (© 2026 Sandeep Baskaran).

Adapted: `overlays.ts`, `measure-guides.ts` (passive parts only),
`layout-guides.ts`, and geometry helpers. Changes: removed the Chrome-extension
runtime coupling (chrome.storage / chrome.runtime), removed interactive
resize/move handles, and switched to viewport (non-scroll-offset) coordinates
for Studio's zoomed-iframe rendering.

MIT License text: https://github.com/SandeepBaskaran/design-mode/blob/main/LICENSE
