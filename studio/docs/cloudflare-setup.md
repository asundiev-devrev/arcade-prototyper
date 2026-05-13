# Sharing frames to the web

Arcade Studio can deploy any frame as a public `pages.dev` URL — useful for pasting into Slack, PRD docs, or reviews. The deploy goes to the **DevRev Product & Design** Cloudflare account, shared across the team.

## One-time setup (30 seconds)

1. Ping Andrey in Slack and ask for a **Studio share key**. They'll run a script on their laptop and send you a one-time-paste URL over DM. Each teammate gets their own personal key.
2. **Open the URL.** It shows your key exactly **once** — the second time you open it, it'll be empty. If you close the tab before copying, ask Andrey to generate a new one.
3. Copy the 64-character hex string the URL shows.
4. In Studio, click the gear icon → **Settings**.
5. Scroll to **Share to web**.
6. Paste the key into **Studio share key** → **Save**.
7. Delete the Slack message with the URL (the URL itself is already dead, but tidiness is free).

You'll see **Key configured** next to the field when it's stored.

## How to share a frame

1. Open a project that has at least one frame.
2. Click the **Share** button (↗ icon) in the project header.
3. Pick the frame you want to share, click **Deploy to Cloudflare**.
4. After ~10 seconds you'll get a `<frame>.<project>.pages.dev` URL. Click **Copy Link** to put it on your clipboard.

That URL is stable for that frame. Re-deploying the same frame updates the same URL — no need to re-share the link.

## Troubleshooting

**"Paste your Studio share key in Settings" tooltip on the Share button**
The key isn't set yet. Follow the one-time setup above.

**"Share key is not recognized" when you click Deploy**
Your key was revoked, mis-pasted, or a new teammate list hasn't propagated yet. Ping Andrey.

**I lost the one-time URL / I closed the tab too fast**
Ping Andrey. They can generate a new URL from the same key without rotating it.

**The deploy worked but the page looks broken**
That's a bundling bug, not a share-service problem. File it with the frame name and the `pages.dev` URL.

## Privacy notes

- Your share key lives in `~/Library/Application Support/arcade-studio/settings.json` on your laptop. Treat it like any other work credential — don't paste it anywhere except Studio Settings.
- Anything you share lands on the **DevRev Product & Design** Cloudflare account and is publicly accessible at its URL. Don't deploy anything you wouldn't paste in `#general`.
- Lost laptop? Ping Andrey to revoke your key.
