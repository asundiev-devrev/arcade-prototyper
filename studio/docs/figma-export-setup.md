# Export to Figma — one-time setup

Export runs through a small Figma "Desktop Bridge" plugin that talks to Studio
on your machine. v1 reuses the existing `figma-console-mcp` bridge plugin (a
Studio-owned, branded plugin is a v2 hardening item).

1. Open Figma Desktop and the file you want to export into.
2. Run the **Figma Desktop Bridge** plugin (Plugins → Development). If not yet
   installed, import its manifest from `~/.figma-console-mcp/plugin/manifest.json`.
3. It scans ports 9223–9232 and connects to Studio automatically.
4. In Studio, open a frame → Export to Figma. The frame rebuilds in Figma using
   real Arcade components where mapped, faithful layers everywhere else.

Keep the plugin running while you export. If Studio isn't found, start it, then
the plugin retries automatically.
