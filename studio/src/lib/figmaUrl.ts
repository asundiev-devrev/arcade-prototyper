const FIGMA_HOST = /(?:^|\/\/)(?:www\.)?figma\.com/;

export function extractFigmaUrl(text: string): string | null {
  const urls = text.match(/https?:\/\/[^\s]+/g) ?? [];
  for (const u of urls) if (FIGMA_HOST.test(u) && /node-id=/.test(u)) return u;
  return null;
}

export function decoratePromptWithFigma(prompt: string, url: string): string {
  if (prompt.includes(url)) return prompt;
  return `${prompt}\n\nFigma reference: ${url}`;
}
