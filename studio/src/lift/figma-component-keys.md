# Figma component-key mapping (seed)

The load-bearing table for sub-project #2 of the Figma export: kit component +
prop/variant → published Figma library component key + variant property. Seeded
by Slice 0, which proved the first entry end-to-end (stamp → SLJ → Bridge →
real instance in Figma).

**Published library:** "Arcade UI Kit v0.3" — file key `a2uKnm88LxRXEWAL1kOqeQ`.

## Proven entries (Slice 0)

| Kit component | Kit prop | Figma component set | Set key | Variant property | Value map |
|---|---|---|---|---|---|
| `ChatBubble` | `variant` | "Bubble" (`7789:29601`) | `edd2821db8a05b808da334a1c6aed7646d23e82e` | `Type` | `receiver`→`Receiver`, `sender`→`Sender` |

Notes from the Slice 0 run (feed into #2's design):
- The "Bubble" set has extra variant props beyond `Type`: `hasTail` (Yes/No),
  `State` (`:idle`/`:hover`), `Only emojis` (True/False), plus a boolean
  `Show mention`. Slice 0 set `Type=Receiver`, `State=:idle`. #2 must map our
  `tail` prop → `hasTail`, and decide defaults for the rest.
- The instance carries several template text nodes; the main message body in the
  Slice 0 run was the node named after the long placeholder string
  (`...;7789:29665`). #2/#3 need a reliable way to target "the message text"
  node rather than relying on its index/name — e.g. the lowest-depth TEXT node,
  or a documented layer name.
- **Cross-file `importComponentByKeyAsync` is slow via the Bridge** (>30s,
  exceeds the tool's 30s cap). Slice 0 worked around it by kicking the import
  off async (stash status on `globalThis`, poll) rather than awaiting in one
  call. #3's consumer must handle this latency (async/queue), not assume a fast
  synchronous import.

## Open items for #2 (from Slice 0 live findings)
- **Token collision by property context.** In the live SLJ, the bubble text
  `color` resolved to `--bg-neutral-prominent` (a *background* token whose value
  collides with the intended `--fg-` token). `resolveToken` returns the first
  candidate; #2 must disambiguate by the property the value is used for
  (text `color` → prefer `--fg-*`; `fill` → prefer `--bg-*`).
- **Component nodes carry no `style`.** The SLJ schema puts `style` only on
  element nodes, so a component's own fill/background isn't captured. Fine for
  Slice 0 (the real instance brings its own styling from the variant), but #2/#3
  should confirm nothing needed from the component node's own computed style.
