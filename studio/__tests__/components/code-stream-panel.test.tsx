import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { CodeStreamPanel } from "../../src/components/viewport/CodeStreamPanel";

describe("CodeStreamPanel", () => {
  afterEach(() => cleanup());

  it("renders the partial content", () => {
    const { container } = render(
      <CodeStreamPanel
        partial="import React from 'react';"
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    const panel = container.querySelector('[data-testid="code-stream-panel"]');
    expect(panel).not.toBeNull();
    expect(panel!.textContent).toContain("import React");
  });

  it("shows filename basename in header", () => {
    const { container } = render(
      <CodeStreamPanel
        partial=""
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    const header = container.querySelector('[data-testid="code-stream-header"]');
    expect(header).not.toBeNull();
    expect(header!.textContent).toContain("index.tsx");
  });

  it("shows char count in header", () => {
    const { container } = render(
      <CodeStreamPanel
        partial="abcde"
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    const header = container.querySelector('[data-testid="code-stream-header"]');
    expect(header!.textContent).toContain("5 chars");
  });

  it("renders empty body for empty partial", () => {
    const { container } = render(
      <CodeStreamPanel
        partial=""
        filePath="/projects/p/frames/hero/index.tsx"
      />,
    );
    const body = container.querySelector('[data-testid="code-stream-body"]');
    expect(body!.textContent).toBe("");
  });
});
