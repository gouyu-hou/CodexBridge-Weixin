export function parseJsonObject(value: unknown): Record<string, any> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  const text = normalizeJsonLikeText(String(value ?? ''));
  if (!text) {
    return null;
  }
  const fenced = normalizeJsonLikeText(text.match(/```(?:json)?\s*([\s\S]*?)```/iu)?.[1] ?? '');
  const balanced = extractBalancedJsonObject(text);
  const candidates = [fenced, balanced, text].filter(Boolean);
  for (const candidate of candidates) {
    const parsed = tryParseJsonObjectCandidate(candidate);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function normalizeJsonLikeText(value: string): string {
  return String(value ?? '')
    .replace(/\uFEFF/gu, '')
    .replace(/[\u200B-\u200D\u2060]/gu, '')
    .trim();
}

function extractBalancedJsonObject(text: string): string | null {
  const source = normalizeJsonLikeText(text);
  const start = source.indexOf('{');
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let quote: '"' | '\'' | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (char === quote && !isEscapedJsonChar(source, index)) {
        inString = false;
        quote = null;
      }
      continue;
    }
    if ((char === '"' || char === '\'') && !isEscapedJsonChar(source, index)) {
      inString = true;
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return null;
}

function isEscapedJsonChar(text: string, index: number): boolean {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function tryParseJsonObjectCandidate(candidate: string): Record<string, any> | null {
  const base = normalizeJsonLikeText(candidate);
  if (!base) {
    return null;
  }
  const attempts = Array.from(new Set([
    base,
    normalizeJsonTypography(base),
    stripTrailingCommas(base),
    stripTrailingCommas(normalizeJsonTypography(base)),
    escapeRawNewlinesInsideJsonStrings(stripTrailingCommas(normalizeJsonTypography(base))),
  ]));
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function normalizeJsonTypography(text: string): string {
  return text
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, '\'')
    .replace(/：/gu, ':')
    .replace(/，/gu, ',');
}

function stripTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/gu, '$1');
}

function escapeRawNewlinesInsideJsonStrings(text: string): string {
  let output = '';
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === '"' && !isEscapedJsonChar(text, index)) {
      inString = !inString;
      output += char;
      continue;
    }
    if (inString && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      output += '\\n';
      continue;
    }
    output += char;
  }
  return output;
}
