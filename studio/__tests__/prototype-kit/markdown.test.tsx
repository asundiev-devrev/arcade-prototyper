// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Markdown } from "../../prototype-kit/composites/Markdown";

afterEach(() => cleanup());

describe("Markdown", () => {
  it("renders bold markdown as <strong>, not literal asterisks", () => {
    render(<Markdown>{"Here's the **Dashboard** plan"}</Markdown>);
    const strong = screen.getByText("Dashboard");
    expect(strong.tagName).toBe("STRONG");
    // The literal "**Dashboard**" string must NOT appear anywhere.
    expect(screen.queryByText(/\*\*Dashboard\*\*/)).toBeNull();
  });

  it("renders inline code as <code>", () => {
    render(<Markdown>{"runs `/meeting-memory` daily"}</Markdown>);
    const code = screen.getByText("/meeting-memory");
    expect(code.tagName).toBe("CODE");
  });

  it("renders blockquotes (the leading > syntax) as <blockquote>", () => {
    const { container } = render(<Markdown>{"> quoted question\n\nanswer"}</Markdown>);
    expect(container.querySelector("blockquote")).not.toBeNull();
  });

  it("renders ordered lists as <ol><li>", () => {
    const { container } = render(<Markdown>{"1. first\n2. second"}</Markdown>);
    expect(container.querySelector("ol")).not.toBeNull();
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("uses color-inheriting styles (no hard-coded fg token) so it works in any bubble", () => {
    const { container } = render(<Markdown>{"**bold** and `code`"}</Markdown>);
    const html = container.innerHTML;
    // Must not pin a foreground color — bubbles set their own text color.
    expect(html).not.toContain("--fg-neutral");
    expect(html).not.toContain("text-(--fg");
  });

  it("renders nothing for empty or nullish input", () => {
    const { container: empty } = render(<Markdown>{""}</Markdown>);
    expect(empty.innerHTML).toBe("");
    const { container: nul } = render(<Markdown>{null}</Markdown>);
    expect(nul.innerHTML).toBe("");
  });
});
