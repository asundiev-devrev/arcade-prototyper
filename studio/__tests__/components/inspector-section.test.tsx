// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Section } from "../../src/components/inspector/Section";

afterEach(cleanup);

describe("Section", () => {
  it("renders title and shows children when open by default", () => {
    render(<Section title="Layout"><div>body-content</div></Section>);
    expect(screen.getByText("Layout")).toBeTruthy();
    expect(screen.getByText("body-content")).toBeTruthy();
  });
  it("collapses and expands on header click", () => {
    render(<Section title="Layout"><div>body-content</div></Section>);
    fireEvent.click(screen.getByText("Layout"));
    expect(screen.queryByText("body-content")).toBeNull();
    fireEvent.click(screen.getByText("Layout"));
    expect(screen.getByText("body-content")).toBeTruthy();
  });
  it("respects defaultOpen=false", () => {
    render(<Section title="Layout" defaultOpen={false}><div>body-content</div></Section>);
    expect(screen.queryByText("body-content")).toBeNull();
  });
});
