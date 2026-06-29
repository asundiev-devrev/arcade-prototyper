// studio/__tests__/server/codeWriter/compositeProps.test.ts
import { describe, it, expect } from "vitest";
import { parseCompositeProps } from "../../../server/codeWriter/compositeProps";

// Mirrors ComputerScene's real shape (ReactNode text-slots, a union, a boolean,
// plain strings, an id prop, an array, a function).
const SRC = `
import * as React from "react";
type Session = { id: string };
export type ComputerSceneProps = {
  state?: "empty" | "streaming" | "transcript";
  withCanvasPanel?: boolean;
  headerTitle?: React.ReactNode;
  userName?: React.ReactNode;
  userSubtitle?: React.ReactNode;
  userAvatarSrc?: string;
  activeSessionId?: string;
  sessions?: Session[];
  chatInputPlaceholder?: string;
  onOpenSettings?: () => void;
};
export function ComputerScene({
  state = "transcript",
  withCanvasPanel,
  headerTitle,
  userName = "Ava Wright",
  userSubtitle = "DevRev",
  userAvatarSrc,
  activeSessionId: activeSessionIdProp = "strategic",
  sessions = [],
  chatInputPlaceholder = "Ask me anything",
  onOpenSettings,
}: ComputerSceneProps = {}) {
  return null;
}
`;

describe("parseCompositeProps", () => {
  const props = parseCompositeProps(SRC, "ComputerScene");
  const by = (n: string) => props.find((p) => p.name === n);

  it("string-literal union → select with values + default", () => {
    expect(by("state")).toEqual({ name: "state", kind: "select", values: ["empty", "streaming", "transcript"], default: "transcript" });
  });
  it("boolean → toggle", () => {
    expect(by("withCanvasPanel")).toEqual({ name: "withCanvasPanel", kind: "toggle" });
  });
  it("plain string → text (with default when present)", () => {
    expect(by("chatInputPlaceholder")).toEqual({ name: "chatInputPlaceholder", kind: "text", default: "Ask me anything" });
    expect(by("userAvatarSrc")).toEqual({ name: "userAvatarSrc", kind: "text" });
  });
  it("ReactNode WITH string-literal default → text", () => {
    expect(by("userName")).toEqual({ name: "userName", kind: "text", default: "Ava Wright" });
    expect(by("userSubtitle")).toEqual({ name: "userSubtitle", kind: "text", default: "DevRev" });
  });
  it("ReactNode WITHOUT a string default → skipped", () => {
    expect(by("headerTitle")).toBeUndefined();
  });
  it("id-like string prop → skipped", () => {
    expect(by("activeSessionId")).toBeUndefined();
  });
  it("array + function props → skipped", () => {
    expect(by("sessions")).toBeUndefined();
    expect(by("onOpenSettings")).toBeUndefined();
  });
});

describe("parseCompositeProps — other shapes", () => {
  it("handles `interface XProps {…}` the same as a type alias", () => {
    const src = `interface FooProps { label?: string; big?: boolean; }
export function Foo({ label = "Hi", big }: FooProps) { return null; }`;
    const props = parseCompositeProps(src, "Foo");
    expect(props).toContainEqual({ name: "label", kind: "text", default: "Hi" });
    expect(props).toContainEqual({ name: "big", kind: "toggle" });
  });
  it("number → number; mixed non-literal union → skipped", () => {
    const src = `type BarProps = { count?: number; weird?: string | number };
export function Bar({ count = 3 }: BarProps) { return null; }`;
    const props = parseCompositeProps(src, "Bar");
    expect(props).toContainEqual({ name: "count", kind: "number", default: "3" });
    expect(props.find((p) => p.name === "weird")).toBeUndefined();
  });
  it("ReactNode with a JSX default → skipped (default is not a string literal)", () => {
    const src = `import * as React from "react";
type BazProps = { node?: React.ReactNode };
export function Baz({ node = <span/> }: BazProps) { return null; }`;
    expect(parseCompositeProps(src, "Baz").find((p) => p.name === "node")).toBeUndefined();
  });
  it("returns [] when the Props type is absent", () => {
    expect(parseCompositeProps(`export function X(){return null;}`, "X")).toEqual([]);
  });
});
