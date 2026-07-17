export type PluginSearchSynonymGroups = readonly (readonly string[])[];

export function normalizePluginLookupToken(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .replace(/[_/\\-]+/gu, ' ')
    .replace(/\s+/gu, ' ');
}

export function splitPluginSearchTokens(value: unknown): string[] {
  const normalized = normalizePluginLookupToken(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

export function buildPluginSearchTokens(
  searchTerm: string,
  synonymGroups: PluginSearchSynonymGroups,
): string[] {
  const normalizedQuery = normalizePluginLookupToken(searchTerm);
  const tokens = new Set(splitPluginSearchTokens(normalizedQuery));
  for (const group of synonymGroups) {
    const normalizedGroup = group
      .flatMap((entry) => [normalizePluginLookupToken(entry), ...splitPluginSearchTokens(entry)])
      .filter(Boolean);
    if (normalizedGroup.some((entry) => tokens.has(entry) || (entry.length >= 2 && normalizedQuery.includes(entry)))) {
      for (const entry of normalizedGroup) {
        tokens.add(entry);
      }
    }
  }
  return Array.from(tokens).filter((token) => token.length > 0);
}

export function isPluginSubsequenceMatch(needle: string, haystack: string): boolean {
  if (needle.length < 3 || haystack.length < 3 || needle.length > haystack.length + 2) {
    return false;
  }
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) {
      index += 1;
      if (index >= needle.length) {
        return true;
      }
    }
  }
  return false;
}

export function pluginEditDistance(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  if (!left) {
    return right.length;
  }
  if (!right) {
    return left.length;
  }
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + cost,
      );
    }
    for (let index = 0; index < previous.length; index += 1) {
      previous[index] = current[index];
    }
  }
  return previous[right.length] ?? Math.max(left.length, right.length);
}

export function isPluginFuzzyTokenMatch(token: string, fieldToken: string): boolean {
  if (token.length < 3 || fieldToken.length < 3) {
    return false;
  }
  if (isPluginSubsequenceMatch(token, fieldToken)) {
    return true;
  }
  const maxDistance = token.length <= 5 ? 1 : 2;
  return Math.abs(token.length - fieldToken.length) <= maxDistance
    && pluginEditDistance(token, fieldToken) <= maxDistance;
}

export function scorePluginTokenAgainstField(
  token: string,
  normalizedField: string,
): number {
  if (!token || !normalizedField) {
    return 0;
  }
  if (normalizedField === token) {
    return 72;
  }
  if (normalizedField.startsWith(token)) {
    return 48;
  }
  if (normalizedField.includes(token)) {
    return token.length >= 3 ? 32 : 12;
  }
  const fieldTokens = splitPluginSearchTokens(normalizedField);
  let best = 0;
  for (const fieldToken of fieldTokens) {
    if (fieldToken === token) {
      best = Math.max(best, 64);
    } else if (fieldToken.startsWith(token)) {
      best = Math.max(best, 36);
    } else if (fieldToken.includes(token)) {
      best = Math.max(best, 24);
    } else if (token.length >= 3 && token.includes(fieldToken) && fieldToken.length >= 3) {
      best = Math.max(best, 18);
    } else if (isPluginFuzzyTokenMatch(token, fieldToken)) {
      best = Math.max(best, 16);
    }
  }
  return best;
}
