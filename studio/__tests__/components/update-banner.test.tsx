import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { UpdateBanner } from "../../src/components/feedback/UpdateBanner";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  try { localStorage.clear(); } catch {}
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

function mockUpdateAvailable(current: string, latest: string) {
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => ({
      current,
      latest,
      upToDate: false,
      downloadUrl: `https://example.com/Arcade-Studio-${latest}-arm64.dmg`,
      releaseUrl: `https://example.com/release/${latest}`,
      releaseNotes: null,
      publishedAt: null,
    }),
  });
}

describe("UpdateBanner", () => {
  it("shows the Electron migration warning when crossing 0.21", async () => {
    mockUpdateAvailable("0.20.1", "0.21.1");
    render(<UpdateBanner />);
    await waitFor(() => {
      expect(screen.getByText(/major upgrade/i)).toBeTruthy();
    });
    expect(screen.getByText(/Drag the old/i)).toBeTruthy();
  });

  it("does NOT show the migration warning for 0.21.x → 0.21.y bumps", async () => {
    mockUpdateAvailable("0.21.1", "0.21.2");
    render(<UpdateBanner />);
    await waitFor(() => {
      expect(screen.getByText(/Arcade Studio 0.21.2/)).toBeTruthy();
    });
    expect(screen.queryByText(/major upgrade/i)).toBeNull();
    expect(screen.queryByText(/Drag the old/i)).toBeNull();
  });

  it("does NOT show the migration warning for old < 0.21 → < 0.21 bumps", async () => {
    // Hypothetical: a user on 0.18.x getting offered 0.20.x. Pre-migration,
    // no warning needed.
    mockUpdateAvailable("0.18.6", "0.20.1");
    render(<UpdateBanner />);
    await waitFor(() => {
      expect(screen.getByText(/Arcade Studio 0.20.1/)).toBeTruthy();
    });
    expect(screen.queryByText(/major upgrade/i)).toBeNull();
  });
});
