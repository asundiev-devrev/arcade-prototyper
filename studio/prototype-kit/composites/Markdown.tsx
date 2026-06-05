/**
 * Markdown — renders a markdown string as formatted rich text, for chat
 * message bodies and any other place a prototype shows real (markdown)
 * content rather than hand-written copy.
 *
 * Why this exists:
 * - Computer / Agent Studio chat bodies (and most real DevRev timeline
 *   text) are markdown: `**bold**`, `` `code` ``, `> quotes`, numbered
 *   lists. Dropping that string straight into a `<ChatBubble>` renders the
 *   literal asterisks and backticks — it does not look like real Computer.
 *   Wrap the body in `<Markdown>` so it renders the way Computer does.
 *
 * Color-inheriting by design: every element uses `color: inherit` (no
 * hard-coded foreground token), so the same `<Markdown>` looks right inside
 * a dark sender bubble (light text) AND a light receiver / agent bubble
 * (dark text). Inline code and blockquotes use `currentColor` at low
 * opacity for the same reason — they adapt to whichever bubble holds them.
 *
 * Raw HTML in the source is NOT rendered (no `rehype-raw`) — markdown text
 * from a live API is treated as untrusted, so only markdown syntax is
 * interpreted.
 *
 * Usage:
 *
 *   <ChatBubble variant="sender">
 *     <Markdown>{message.body}</Markdown>
 *   </ChatBubble>
 *
 *   <ChatMessages.Agent thoughts={<ChatMessages.Thoughts label="Thought for 4s" />}>
 *     <Markdown>{message.body}</Markdown>
 *   </ChatMessages.Agent>
 */
import ReactMarkdown, { type Components } from "react-markdown";

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mt-3 mb-1.5 text-base font-medium first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 mb-1.5 text-base font-medium first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 mb-1 text-sm font-medium first:mt-0">{children}</h3>,
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-0.5 first:mt-0 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-0.5 first:mt-0 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /^language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} font-mono text-[0.9em]`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-current/10 px-1 py-0.5 font-mono text-[0.9em]" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-current/10 p-3 font-mono text-[0.9em] first:mt-0 last:mb-0">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-current/30 pl-3 opacity-80 first:mt-0 last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-current/20" />,
};

export type MarkdownProps = {
  /** The markdown source string to render. */
  children?: string | null;
};

export function Markdown({ children }: MarkdownProps) {
  if (!children) return null;
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
