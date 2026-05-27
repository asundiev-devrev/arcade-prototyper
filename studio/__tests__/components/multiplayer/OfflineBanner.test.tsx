// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { OfflineBanner } from "../../../src/components/multiplayer/OfflineBanner";

afterEach(cleanup);

describe("OfflineBanner", () => {
  it("renders host name and reassuring copy", () => {
    render(<OfflineBanner hostName="Gil" />);
    expect(screen.getByText(/Gil hasn't been online/i)).toBeTruthy();
    expect(screen.getByText(/comments will be sent/i)).toBeTruthy();
  });
});
