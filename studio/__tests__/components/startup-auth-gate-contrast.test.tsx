// @vitest-environment jsdom
import * as React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";

// arcade-gen is mocked across the suite; Button is all this component uses.
vi.mock("@xorkavi/arcade-gen", () => ({
  Button: (props: any) => React.createElement("button", props, props.children),
}));

import { StartupAuthGate } from "../../src/components/feedback/StartupAuthGate";

/**
 * Regression: the startup AWS auth-gate card rendered white text on a white
 * card in dark theme. Root cause: the card background used a token that was
 * never defined (`--surface-default`), so the `#fff` fallback fired in BOTH
 * themes, while the headings set no color and inherited the app's (light in
 * dark theme) root text color → white-on-white "Checking AWS sign-in…".
 *
 * The fix pairs a real theme-aware surface with an explicit foreground on the
 * card container so text always contrasts. This test guards that the card
 * (a) never reaches for the phantom `--surface-default` token, and
 * (b) sets an explicit `color` so children can't inherit a clashing color.
 */
describe("StartupAuthGate — card contrast", () => {
  beforeEach(() => {
    // Keep the gate in its blocking "checking" state: a fetch that never
    // resolves means the effect never flips state to signedIn.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("card sets an explicit color and does not use the phantom --surface-default token", async () => {
    render(
      <StartupAuthGate>
        <div>app</div>
      </StartupAuthGate>,
    );
    // The heading proves we're in the blocking checking state.
    const heading = await screen.findByText("Checking AWS sign-in…");
    // Card = the heading's containing styled panel (has background + color).
    // Walk up to the element carrying the inline background style.
    let card: HTMLElement | null = heading.parentElement;
    while (card && !card.style.background) card = card.parentElement;
    expect(card).not.toBeNull();
    const bg = card!.style.background;
    const color = card!.style.color;
    // (a) must NOT reference the token that was never defined.
    expect(bg).not.toContain("--surface-default");
    // (b) must set an explicit foreground so headings don't inherit root color.
    expect(color).not.toBe("");
    expect(color).toContain("--fg-neutral-prominent");
  });
});
