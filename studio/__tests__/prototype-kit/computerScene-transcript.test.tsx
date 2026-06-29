// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ComputerScene } from "../../prototype-kit/composites/ComputerScene";

const TX = [
  { id: 1, role: "user" as const, text: "Custom first message" },
  { id: 2, role: "assistant" as const, text: "Custom reply", artefact: { tag: "DOC", title: "My Brief" } },
];

describe("ComputerScene transcript prop", () => {
  it("renders the passed transcript, not the baked seed", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    expect(container.textContent).toContain("Custom first message");
    expect(container.textContent).toContain("Custom reply");
    expect(container.textContent).not.toContain("Help me prep a marketing keynote");
  });
  it("stamps each seeded message's text with a data-arcade-bind by id", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    const m1 = container.querySelector('[data-arcade-bind="transcript[id=1].text"]');
    const m2 = container.querySelector('[data-arcade-bind="transcript[id=2].text"]');
    expect(m1?.textContent).toContain("Custom first message");
    expect(m2?.textContent).toContain("Custom reply");
  });
  it("stamps the artefact title with its own bind", () => {
    const { container } = render(<ComputerScene transcript={TX} />);
    const a = container.querySelector('[data-arcade-bind="transcript[id=2].artefact.title"]');
    expect(a?.textContent).toContain("My Brief");
  });
  it("bare ComputerScene still renders the seed (no regression)", () => {
    const { container } = render(<ComputerScene />);
    expect(container.textContent).toContain("Help me prep a marketing keynote");
  });
  it("state=empty renders no messages even with a transcript", () => {
    const { container } = render(<ComputerScene state="empty" transcript={TX} />);
    expect(container.textContent).not.toContain("Custom first message");
  });
});
