import { describe, it, expect, beforeEach } from "vitest";
import {
  setPending, clearPending, requestInstall, getUpdateState, __resetForTest,
} from "../../server/updateRegistry";

describe("updateRegistry", () => {
  beforeEach(() => __resetForTest());

  it("starts empty", () => {
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });
  it("records a pending version", () => {
    setPending("0.43.0");
    expect(getUpdateState().pendingVersion).toBe("0.43.0");
  });
  it("records an install request", () => {
    setPending("0.43.0");
    requestInstall();
    expect(getUpdateState()).toEqual({ pendingVersion: "0.43.0", installRequested: true });
  });
  it("clearPending resets both fields", () => {
    setPending("0.43.0"); requestInstall(); clearPending();
    expect(getUpdateState()).toEqual({ pendingVersion: null, installRequested: false });
  });
});
