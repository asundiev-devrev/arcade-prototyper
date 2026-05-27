// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { CommentInput } from "../../../src/components/multiplayer/CommentInput";

afterEach(cleanup);

describe("CommentInput", () => {
  it("clears the textarea after a successful send", async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<CommentInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Comment on this prototype/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "looks great" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(onSend).toHaveBeenCalledWith("looks great"));
    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("recovers from a rejected post: keeps text, surfaces error, re-enables Send", async () => {
    // Simulate `postComment` rejecting (network error, 5xx, expired PAT).
    const onSend = vi.fn().mockRejectedValue(new Error("Network down"));
    render(<CommentInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Comment on this prototype/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "needs a retry" } });
    const sendBtn = screen.getByRole("button", { name: /send/i }) as HTMLButtonElement;
    fireEvent.click(sendBtn);

    // Error message rendered inline.
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/Network down/);

    // Textarea preserved so the user can retry.
    expect(textarea.value).toBe("needs a retry");

    // busy=false → Send is enabled again (text is non-empty).
    await waitFor(() => expect(sendBtn.disabled).toBe(false));
  });

  it("clears the inline error once the user starts typing again", async () => {
    const onSend = vi.fn().mockRejectedValue(new Error("Boom"));
    render(<CommentInput onSend={onSend} />);
    const textarea = screen.getByPlaceholderText(/Comment on this prototype/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    fireEvent.change(textarea, { target: { value: "hello!" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("falls back to a generic message when the error is not an Error instance", async () => {
    const onSend = vi.fn().mockRejectedValue("nope");
    render(<CommentInput onSend={onSend} />);
    fireEvent.change(screen.getByPlaceholderText(/Comment on this prototype/i), {
      target: { value: "x" },
    });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/Failed to post comment/);
  });
});
