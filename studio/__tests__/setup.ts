if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// Radix Menu portals need IntersectionObserver
if (typeof globalThis.IntersectionObserver === "undefined") {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any;
}

// jsdom does not implement EventSource; useProjectPresence and any other
// SSE-consuming hook reaches for `new EventSource(...)` on mount, which would
// throw. Stub it with an inert connection — tests that exercise SSE behaviour
// can still mock per-suite.
if (typeof globalThis.EventSource === "undefined") {
  class StubEventSource {
    url: string;
    readyState = 0;
    onopen: ((ev: Event) => void) | null = null;
    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: Event) => void) | null = null;
    constructor(url: string) {
      this.url = url;
    }
    addEventListener() {}
    removeEventListener() {}
    close() {}
  }
  globalThis.EventSource = StubEventSource as any;
}

// Radix Select requires hasPointerCapture + scrollIntoView on elements
if (typeof window !== "undefined") {
  if (!(Element.prototype as any).hasPointerCapture) {
    (Element.prototype as any).hasPointerCapture = () => false;
  }
  if (!(Element.prototype as any).releasePointerCapture) {
    (Element.prototype as any).releasePointerCapture = () => {};
  }
  if (!(Element.prototype as any).setPointerCapture) {
    (Element.prototype as any).setPointerCapture = () => {};
  }
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
}
