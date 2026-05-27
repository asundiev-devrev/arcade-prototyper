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
