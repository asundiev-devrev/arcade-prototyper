// studio/src/lib/serializeFrameForExport.ts
import { exportFrameToSlj } from "./exportFrameToSlj";
import type { SljDocument } from "../export/slj";

export interface SerializeArgs {
  projectSlug: string;
  frameSlug: string;
  width: number;
  mode: "light" | "dark";
}

export interface SerializeOpts {
  /** Injectable for tests; defaults to the real exportFrameToSlj. */
  serialize?: (args: { iframe: HTMLIFrameElement } & SerializeArgs) => Promise<SljDocument>;
  /** Wait after load for async frame data (chat data) to settle. Default 2500ms. */
  settleMs?: number;
  /** Max wait for the iframe load event. Default 15000ms. */
  loadTimeoutMs?: number;
}

/** Mount a hidden iframe at the frame URL, serialize its rendered React tree to
 *  SLJ once loaded + settled, then clean up. The serializer (exportFrameToSlj)
 *  also POSTs the SLJ so the server has a fresh SLJ.json. */
export function serializeFrameForExport(args: SerializeArgs, opts: SerializeOpts = {}): Promise<SljDocument> {
  const serialize = opts.serialize ?? exportFrameToSlj;
  const settleMs = opts.settleMs ?? 2500;
  const loadTimeoutMs = opts.loadTimeoutMs ?? 15000;

  return new Promise<SljDocument>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:absolute;width:1280px;height:900px;left:-99999px;top:0;border:0;visibility:hidden;";
    iframe.src = `/api/frames/${args.projectSlug}/${args.frameSlug}?mode=${args.mode}`;

    let done = false;
    const cleanup = () => { if (iframe.parentNode) iframe.parentNode.removeChild(iframe); };
    const fail = (e: Error) => { if (done) return; done = true; clearTimeout(timer); cleanup(); reject(e); };
    const ok = (slj: SljDocument) => { if (done) return; done = true; clearTimeout(timer); cleanup(); resolve(slj); };

    const timer = setTimeout(() => fail(new Error("Frame load timed out")), loadTimeoutMs);

    iframe.addEventListener("load", () => {
      setTimeout(async () => {
        try {
          const slj = await serialize({ iframe, ...args });
          ok(slj);
        } catch (e: any) {
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      }, settleMs);
    });

    document.body.appendChild(iframe);
  });
}
