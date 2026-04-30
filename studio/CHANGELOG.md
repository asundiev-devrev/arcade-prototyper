# Changelog

All notable changes to Arcade Studio. Versions follow [semver](https://semver.org/)
where we can; pre-1.0 the minor number is the "meaningful batch of work" counter
and the patch is reserved for quick follow-up fixes.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — 2026-04-30

First version with a version number. Before this, builds were distinguishable
only by file mtime — which made beta debugging harder than it needed to be.
Everything below has shipped in the last couple of weeks; this entry
backfills the highlights so the "What's new" list has something to point at.

### Added

- **Vercel share deploys work end-to-end.** Generated frames can now be shared
  as public Vercel URLs. Bundles Tailwind per frame, inlines DevRev fonts as
  data URLs (the CDN referer-blocks `*.vercel.app`), and auto-disables SSO
  protection on each new project.
- **Figma integration, now with a PAT input in Settings.** Paste a Figma
  personal access token; studio validates it against the Figma API and
  stores it via figmanage. Previously the "Connect Figma" button tried to
  run an interactive CLI with closed stdin and silently failed.
- **AWS Bedrock bootstrap is one command.** On first launch, the app writes
  DevRev's SSO profile into `~/.aws/config` and spawns all child processes
  with `AWS_PROFILE=dev`. New beta testers only need to run
  `aws sso login --profile dev` once.
- **Build versioning.** DMG filename, Settings footer, Finder Get Info, and
  the launcher log all show the current version + git SHA.

### Fixed

- **Agent errors no longer hang on "Thinking…".** When Claude's Bedrock creds
  expire mid-turn, the error ("run `aws sso login`") surfaces in the chat
  immediately instead of after a 4-minute stall.
- **Generated frames on Vercel now match the studio preview.** Tailwind v4
  is compiled per-frame with `@source` pointing at the frame's code, so
  classes like `pt-12`, `text-title-3`, and arbitrary values like
  `max-w-[832px]` actually exist in the deployed CSS.
- **Fonts load on shared deploys.** DevRev's font CDN rejects requests from
  `*.vercel.app` via referer whitelist; fonts are now base64-inlined into
  the CSS bundle at build time.
- Shared Vercel URLs no longer serve raw base64, and no longer serve the
  Vercel SSO login wall instead of the frame.

### Changed

- Figma PAT now lives in Settings → Figma integration, alongside DevRev
  and Vercel. The standalone "Connect Figma" button in the header is gone.

### Known issues

- `aws sso login` still has to be re-run every ~8 hours (AWS SSO session
  TTL; nothing studio can work around).
- If your mac doesn't have the AWS CLI installed, you'll hit
  `aws: command not found`. Next release bundles it in the DMG.
