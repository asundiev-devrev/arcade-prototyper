import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@xorkavi/arcade-gen", async () => {
  const React = await import("react");
  const Modal: any = {
    Root: ({ children, open }: any) => (open ? React.createElement("div", null, children) : null),
    Content: ({ children }: any) => React.createElement("div", null, children),
    Header: ({ children }: any) => React.createElement("div", null, children),
    Title: ({ children }: any) => React.createElement("h2", null, children),
    Description: ({ children }: any) => React.createElement("p", null, children),
    Body: ({ children }: any) => React.createElement("div", null, children),
    Footer: ({ children }: any) => React.createElement("div", null, children),
  };
  return {
    Modal,
    Button: ({ children, onClick, disabled, ...rest }: any) =>
      React.createElement("button", { onClick, disabled, ...rest }, children),
  };
});

const trackSpy = vi.fn();
vi.mock("../../src/lib/telemetry/renderer", () => ({
  track: (...args: any[]) => trackSpy(...args),
  captureError: () => {},
}));

import { ShareModal } from "../../src/components/shell/ShareModal";

const FRAMES = [{ slug: "hero", name: "Hero", size: 1440 }] as any;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ShareModal SSL probe", () => {
  it("shows 'waiting for SSL certificate' until the URL becomes reachable", async () => {
    let probeAttempts = 0;
    const url = "https://hero.test-proj.pages.dev/";
    const fetchSpy = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
      const u = String(input);
      if (u.endsWith("/share") && init?.method === "POST") {
        return new Response(JSON.stringify({ url, deployId: "abc" }), { status: 200 });
      }
      probeAttempts += 1;
      // First probe rejects (TLS handshake failure on a freshly-issued
      // pages.dev hostname), second succeeds.
      if (probeAttempts < 2) throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    render(
      <ShareModal
        open={true}
        onClose={() => {}}
        projectSlug="test-proj"
        frames={FRAMES}
        probeIntervalMs={5}
        probeTimeoutMs={2000}
      />,
    );

    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Deploy to Cloudflare"));

    await waitFor(() => expect(screen.getByText(/Deployed successfully/)).toBeTruthy());
    expect(probeAttempts).toBeGreaterThanOrEqual(2);
  });

  it("does not hang when a probe fetch never resolves (Cloudflare Access redirect chain)", async () => {
    // Regression for 0.22.5: a no-cors fetch to a Cloudflare Pages URL
    // sitting behind Access OTP would never resolve nor reject, so the
    // global probeTimeoutMs never fired. The per-attempt timeout makes
    // each hung fetch count as a failed probe and lets the loop progress.
    let attempts = 0;
    const url = "https://hero.test-proj.pages.dev/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const u = String(input);
        if (u.endsWith("/share") && init?.method === "POST") {
          return new Response(JSON.stringify({ url, deployId: "abc" }), { status: 200 });
        }
        attempts += 1;
        // Hung forever unless the caller aborts.
        return await new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }),
    );

    render(
      <ShareModal
        open={true}
        onClose={() => {}}
        projectSlug="test-proj"
        frames={FRAMES}
        probeIntervalMs={5}
        probeTimeoutMs={200}
        probeAttemptTimeoutMs={20}
      />,
    );

    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Deploy to Cloudflare"));

    await waitFor(() =>
      expect(screen.getByText(/URL isn't responding yet/i)).toBeTruthy(),
    );
    expect(attempts).toBeGreaterThanOrEqual(2);
  });

  it("shows the timeout warning if the probe never succeeds", async () => {
    const url = "https://hero.test-proj.pages.dev/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo, init?: RequestInit) => {
        const u = String(input);
        if (u.endsWith("/share") && init?.method === "POST") {
          return new Response(JSON.stringify({ url, deployId: "abc" }), { status: 200 });
        }
        throw new TypeError("Failed to fetch");
      }),
    );

    render(
      <ShareModal
        open={true}
        onClose={() => {}}
        projectSlug="test-proj"
        frames={FRAMES}
        probeIntervalMs={5}
        probeTimeoutMs={50}
      />,
    );

    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Deploy to Cloudflare"));

    await waitFor(() =>
      expect(screen.getByText(/URL isn't responding yet/i)).toBeTruthy(),
    );
  });
});

describe("ShareModal — Copy Figma Export", () => {
  it("copies an export prompt to the clipboard and fires the figma_export_copied event", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } } as any);

    render(
      <ShareModal open={true} onClose={() => {}} projectSlug="test-proj" frames={FRAMES} />,
    );

    fireEvent.click(screen.getByDisplayValue("hero"));
    fireEvent.click(screen.getByText("Copy Figma Export"));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const payload = writeText.mock.calls[0][0] as string;
    // the prompt references the selected frame + the hybrid-export steps
    expect(payload).toContain("hero");
    expect(payload).toMatch(/Export this Arcade Studio frame to Figma/i);
    expect(payload).toMatch(/swap/i);

    // the button flips to its copied affirmation
    await waitFor(() => expect(screen.getByText("Copied!")).toBeTruthy());

    // the telemetry event fired with the frame count
    expect(trackSpy).toHaveBeenCalledWith({ name: "figma_export_copied", props: { frame_count: 1 } });
  });
});
