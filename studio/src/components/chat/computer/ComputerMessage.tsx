import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import { Computer } from "@xorkavi/arcade-gen";

/**
 * Matches DevRev's `AIAssistantMessage` layout (see
 * `libs/chat-timeline/shared/assistant-message/src/components/ai-assistant-message.tsx`
 * and the `.editor-content--experience-agent` SCSS rule in
 * `libs/design-system/shared/themes/*`): the sprite sits absolutely at the
 * top-left of the container, and the first child block gets an inline-block
 * `::before` pseudo that reserves ~18px of horizontal space for the sprite
 * on the first line. Subsequent lines and blocks flow at the normal left
 * edge — the gutter is only for line 1.
 */

export const markdownComponents: Components = {
  p: ({ children }) => (
    <p className="my-2 leading-relaxed text-(--fg-neutral-prominent) first:mt-0 last:mb-0">{children}</p>
  ),
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-base font-medium text-(--fg-neutral-prominent) first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-base font-medium text-(--fg-neutral-prominent) first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-sm font-medium text-(--fg-neutral-prominent) first:mt-0">{children}</h3>
  ),
  strong: ({ children }) => <strong className="font-medium text-(--fg-neutral-prominent)">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-0.5 marker:text-(--fg-neutral-subtle)">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-0.5 marker:text-(--fg-neutral-subtle)">{children}</ol>,
  li: ({ children }) => (
    <li className="leading-relaxed text-(--fg-neutral-prominent)">{children}</li>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-(--fg-accent-prominent) hover:underline"
    >
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /^language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} text-[0.9em]`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-(--bg-neutral-soft) px-1 py-0.5 text-[0.9em] text-(--fg-neutral-prominent)"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-(--bg-neutral-soft) p-3 text-[0.9em] text-(--fg-neutral-prominent)">
      {children}
    </pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-(--stroke-neutral-subtle) pl-3 text-(--fg-neutral-medium)">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-(--stroke-neutral-subtle)" />,
};

export function ComputerMessage({ content }: { content: string }) {
  return (
    <div className="computer-message relative text-body text-(--fg-neutral-prominent) pr-2">
      <style>{`
        .computer-message > div > :first-child::before {
          content: '';
          display: inline-block;
          width: 22px;
          height: 1em;
          vertical-align: bottom;
        }
      `}</style>
      <span
        className="absolute left-0 top-0 w-5 h-5 flex items-center justify-center text-(--fg-neutral-prominent) pointer-events-none"
        aria-hidden
      >
        <Computer size={18} />
      </span>
      <div>
        <ReactMarkdown components={markdownComponents}>{content}</ReactMarkdown>
      </div>
    </div>
  );
}
