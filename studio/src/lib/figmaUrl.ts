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
 * Deliberately broad on interaction verbs but anchored to a concrete TRIGGER
 * (click/tap/press/hover/…) or a motion VERB, so a plain "implement this screen
 * precisely" — or prose that merely names a transition/animation as something to
 * copy ("it's the transition state", "the animation spec sheet") — never trips
 * it. A faithful-reproduction ask must stay on the deterministic engine.
 *
 * Pure + exported for unit testing.
 */
const INTERACTION_PATTERNS: RegExp[] = [
  // Trigger clause. The subject alternation used to be a closed three-literal
  // set (you / a user / someone), so FIRST-PERSON and "the user" phrasings —
  // how designers actually write — silently missed. Live bug, 2026-08-06: 'When
  // I click on "Save", I want you to animate the transition to this screen'
  // returned false, the turn fell through to the deterministic importer, and
  // the second screen was stamped as a separate frame (the one thing the prompt
  // forbade). Subject stays a CLOSED list (never a wildcard span) so it can't
  // bridge unrelated clauses, and "hit" joins the trigger verbs ("when I hit
  // Save").
  //
  // The subject is MANDATORY, and "after"/"once" are deliberately EXCLUDED. Both
  // were tried and both over-matched on ordinary faithful-copy prose: designers
  // name a node's position in a flow ("this is the screen after clicking
  // Continue", "the state after selecting a workspace") or the state it depicts
  // ("the row shows the active style once selected"). Those are descriptions to
  // transcribe, not interactions to wire — and matching them pulled a faithful
  // ask off the deterministic engine onto the LLM reconstructor. An optional
  // subject did the same via bare participles ("once selected", "after
  // pressing"). Same scar tissue as "drop shadow" (commit 4b1aa4c).
  /\b(?:when|whenever)\s+(?:i|you|we|they|s?he|someone|anyone|a\s+user|the\s+user|users|a\s+customer|the\s+customer)\s+(?:click|tap|press|hit|hover|select|choose)/i,
  /\bon (?:click|tap|press|hover|clicking|tapping|pressing|hovering)\b/i,
  /\bclick(?:ing|s|ed)?\b[^.]*\b(?:open|show|appear|display|reveal|trigger|launch|pop|navigate)/i,
  /\b(?:modal|dialog|popover|popup|pop-up|drawer|sheet|tooltip|dropdown|menu|overlay)\b[^.]*\b(?:appear|open|show|display|pop|reveal|trigger)/i,
  /\b(?:appear|open|show|display|pop|reveal|trigger)s?\b[^.]*\b(?:modal|dialog|popover|popup|pop-up|drawer|sheet|tooltip|dropdown|menu|overlay)\b/i,
  /\bwire\b[^.]*\b(?:interaction|click|modal|button|state|behaviou?r)/i,
  /\b(?:toggle|expand|collapse|close|dismiss)\b[^.]*\b(?:on|when|after)\b/i,
  /\binteraction\b/i,
  // Gerund trigger + result ("pressing Save navigates to the next screen",
  // "tapping the row expands the section", "clicking Save should transition to
  // this screen"). The click-only pattern above required the trigger to start
  // with the literal "click" AND the result to be open/show-family, so every
  // other trigger verb and every motion result missed. Gerunds are enumerated
  // literally because consonant-doubling (tap→tapping, hit→hitting) makes a
  // bare "ing" suffix wrong.
  // Gerund trigger + result ("pressing Save navigates to the next screen",
  // "tapping the row expands the section", "clicking Save should transition to
  // this screen"). The click-only pattern above required the trigger to start
  // with the literal "click" AND the result to be open/show-family, so every
  // other trigger verb and every motion result missed. Gerunds are enumerated
  // literally because consonant-doubling (tap→tapping, hit→hitting) makes a
  // bare "ing" suffix wrong. The span is [^.\n]* — NEWLINE-bounded, not just
  // period-bounded: in a bulleted prompt a plain [^.]* bridged "typing
  // indicator" on one bullet to a "show" several bullets later.
  /\b(?:clicking|tapping|pressing|hitting|hovering|selecting|choosing|submitting|typing|toggling|dragging)\b[^.\n]*\b(?:open|show|appear|display|reveal|trigger|launch|pop|navigate|transition|animate|expand|collapse|switch|slide|fade)/i,
  // Motion asked for as an action ("animate the transition between these two
  // screens"). Requires a real OBJECT after the verb, which is what separates a
  // request from a mention. A bare /animat(e|es|ing)/ was tried and fired inside
  // negations and descriptions — "Don't animate anything, I just want the static
  // screen" and "No need to animate the loader, just draw it as it is in the
  // frame" both matched, losing the faithful import on prompts that explicitly
  // asked for NO motion. The nouns "animation"/"transition" and the adjective
  // "animated" stay unmatched for the same reason: they're copy-this prose
  // ("it's the transition state of the flow", "the animation spec sheet — copy
  // it exactly").
  // The negative lookbehind is what makes the OBJECT requirement sufficient:
  // "No need to animate the loader" and "don't animate the transition" both
  // satisfy verb+object, so the object alone does not distinguish a request from
  // a refusal. The lookbehind spans up to 3 words so "do not ever animate the …"
  // is still caught without letting the guard bridge whole sentences.
  /(?<!\b(?:don'?t|do\s+not|doesn'?t|no\s+need\s+to|never|without|avoid|ignore)\s(?:\w+\s){0,3})\banimate\s+(?:the|this|that|it|between|from)\b/i,
];

export function detectInteractionIntent(prompt: string): boolean {
  if (typeof prompt !== "string" || !prompt) return false;
  return INTERACTION_PATTERNS.some((re) => re.test(prompt));
}

export function decoratePromptWithFigma(prompt: string, url: string): string {
  if (prompt.includes(url)) return prompt;
  return `${prompt}\n\nFigma reference: ${url}`;
}
