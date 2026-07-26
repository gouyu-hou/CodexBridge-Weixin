export function normalizeNullableString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

export function normalizeStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
}

export function normalizeOptionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function formatConfigKeyPath(segments: string[]): string {
  return segments
    .map((segment) => {
      const value = String(segment ?? '').trim();
      if (/^[A-Za-z0-9_]+$/u.test(value)) {
        return value;
      }
      return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
    })
    .join('.');
}

export function normalizeFeatureList(features: string[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const feature of features) {
    if (typeof feature !== 'string') {
      continue;
    }
    const value = feature.trim();
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function normalizeProtocolTimestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

export function normalizeTurnStatusKey(status: unknown): string {
  return String(status ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/gu, '');
}
