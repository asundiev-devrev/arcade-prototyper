// studio/__tests__/components/structure-toolbar.test.tsx
import { describe, it, expect } from "vitest";
import { isTranscriptEntry } from "../../src/components/inspector/InspectorPanel";

describe("isTranscriptEntry", () => {
  it("matches a transcript bindPath and returns the id", () => {
    expect(isTranscriptEntry("transcript[id=3].text")).toEqual({ id: 3 });
    expect(isTranscriptEntry("transcript[id=12].artefact.title")).toEqual({ id: 12 });
  });
  it("rejects non-transcript / undefined", () => {
    expect(isTranscriptEntry(undefined)).toBeNull();
    expect(isTranscriptEntry("sessions[id=1].name")).toBeNull(); // only transcript in v1
    expect(isTranscriptEntry("not a bind")).toBeNull();
  });
});
