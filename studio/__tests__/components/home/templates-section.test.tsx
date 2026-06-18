import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { TemplatesSection } from "../../../src/components/home/TemplatesSection";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/templates") {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: "computer", name: "Computer: Chat", description: "Agent chat screen" },
          { id: "settings-page", name: "Computer: Skills settings", description: "Computer skills settings page" },
        ],
      } as Response;
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
});

describe("TemplatesSection", () => {
  it("renders a card per template and fires onStart on click", async () => {
    const onStart = vi.fn();
    render(<TemplatesSection onStart={onStart} />);
    await waitFor(() => expect(screen.getByText("Computer: Chat")).toBeTruthy());
    expect(screen.getByText("Computer: Skills settings")).toBeTruthy();
    fireEvent.click(screen.getByText("Computer: Chat"));
    expect(onStart).toHaveBeenCalledWith("computer");
  });
});
