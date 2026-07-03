// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import * as React from "react";
import { render, cleanup } from "@testing-library/react";
import { ComputerScene } from "../../../prototype-kit";

afterEach(() => cleanup());

describe("ComputerScene renders under the frame's arcade/components resolution", () => {
  it("mounts the empty state without throwing (wrapper swap is sound — review M4)", () => {
    const { container } = render(<ComputerScene state="empty" />);
    expect(container.firstChild).toBeTruthy();
  });
});
