const FIGMA_HOST = /(?:^|\/\/)(?:www\.)?figma\.com/;

export function extractFigmaUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const u of urls) if (FIGMA_HOST.test(u) && /node-id=/.test(u)) return u;
  return null;
}

/**
 * Every Figma node URL in the prompt, in document order, de-duplicated. The
 * single-URL extractFigmaUrl returns only the first — which silently dropped
 * the SECOND url in prompts like "implement this <screen> … the modal is
 * <modal>". A wire-up turn needs both: url[0] is the base screen, url[1] the
 * overlay to import and trigger.
 */
export function extractFigmaUrls(text: string): string[] {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  const out: string[] = [];
  for (const u of urls) {
    if (FIGMA_HOST.test(u) && /node-id=/.test(u) && !out.includes(u)) out.push(u);
  }
  return out;
}

/**
 * Words that signal the designer wants BEHAVIOR wired, not just a static
 * import: "when you click X show Y", "modal appears", "on hover", "opens",
 * "toggles". The deterministic importer can't produce interactivity, so a turn
 * with this intent must hand off to the LLM wiring pass AFTER the import(s).
 * Deliberately broad on interaction verbs but anchored to click/open/show/
 * toggle/appear so a plain "implement this screen precisely" never trips it.
 *
 * Pure + exported for unit testing.
 */
const INTERACTION_PATTERNS: RegExp[] = [
  /\bwhen (?:you |a user |someone )?(?:click|tap|press|hover|select|choose)/i,
  /\bon (?:click|tap|press|hover|clicking|tapping|pressing|hovering)\b/i,
  /\bclick(?:ing|s|ed)?\b[^.]*\b(?:open|show|appear|display|reveal|trigger|launch|pop|navigate)/i,
  /\b(?:modal|dialog|popover|popup|pop-up|drawer|sheet|tooltip|dropdown|menu|overlay)\b[^.]*\b(?:appear|open|show|display|pop|reveal|trigger)/i,
  /\b(?:appear|open|show|display|pop|reveal|trigger)s?\b[^.]*\b(?:modal|dialog|popover|popup|pop-up|drawer|sheet|tooltip|dropdown|menu|overlay)\b/i,
  /\bwire\b[^.]*\b(?:interaction|click|modal|button|state|behaviou?r)/i,
  /\b(?:toggle|expand|collapse|close|dismiss)\b[^.]*\b(?:on|when|after)\b/i,
  /\binteraction\b/i,
];

export function detectInteractionIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return INTERACTION_PATTERNS.some((re) => re.test(prompt));
}

export function decoratePromptWithFigma(prompt: string, url: string): string {
  if (prompt.includes(url)) return prompt;
  return `${prompt}\n\nFigma reference: ${url}`;
}
