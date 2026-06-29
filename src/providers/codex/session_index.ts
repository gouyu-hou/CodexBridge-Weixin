import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProviderThreadSummary } from '../../types/provider.js';

interface CodexSessionIndexRow {
  id?: unknown;
  thread_name?: unknown;
  updated_at?: unknown;
  cwd?: unknown;
  path?: unknown;
}

export interface CodexSessionIndexEntry {
  threadId: string;
  title: string | null;
  updatedAt: number | null;
  cwd: string | null;
  path: string | null;
  sessionPath: string | null;
  hasSessionFile: boolean;
}

export function resolveCodexHome(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = normalizeString(env.CODEX_HOME);
  if (explicit) {
    return path.resolve(explicit);
  }
  return path.join(os.homedir(), '.codex');
}

export function readCodexSessionIndex({
  codexHome = resolveCodexHome(),
}: {
  codexHome?: string | null;
} = {}): CodexSessionIndexEntry[] {
  const resolvedHome = normalizeString(codexHome);
  if (!resolvedHome) {
    return [];
  }
  const indexPath = path.join(resolvedHome, 'session_index.jsonl');
  let content = '';
  try {
    content = fs.readFileSync(indexPath, 'utf8');
  } catch {
    return [];
  }
  const sessionPathsByThreadId = readCodexSessionPathsByThreadId(resolvedHome);
  const byThreadId = new Map<string, CodexSessionIndexEntry>();
  for (const line of content.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let row: CodexSessionIndexRow;
    try {
      row = JSON.parse(trimmed) as CodexSessionIndexRow;
    } catch {
      continue;
    }
    const threadId = normalizeString(row.id);
    if (!threadId) {
      continue;
    }
    const indexedPath = normalizeString(row.path);
    const sessionPath = sessionPathsByThreadId.get(threadId)
      ?? resolveExistingSessionPath(indexedPath, resolvedHome);
    const entry: CodexSessionIndexEntry = {
      threadId,
      title: normalizeString(row.thread_name),
      updatedAt: normalizeTimestamp(row.updated_at),
      cwd: normalizeString(row.cwd),
      path: indexedPath,
      sessionPath,
      hasSessionFile: Boolean(sessionPath),
    };
    const previous = byThreadId.get(threadId);
    if (!previous || Number(entry.updatedAt ?? 0) >= Number(previous.updatedAt ?? 0)) {
      byThreadId.set(threadId, entry);
    }
  }
  return [...byThreadId.values()];
}

export function mergeCodexSessionIndexThreads({
  items,
  sessionIndex,
  searchTerm = null,
  archived = false,
}: {
  items: ProviderThreadSummary[];
  sessionIndex: CodexSessionIndexEntry[];
  searchTerm?: string | null;
  archived?: boolean | null;
}): ProviderThreadSummary[] {
  if (archived) {
    return items;
  }
  const merged = new Map<string, ProviderThreadSummary>();
  for (const item of items) {
    if (!item?.threadId) {
      continue;
    }
    merged.set(item.threadId, {
      ...item,
      title: item.title || sessionIndex.find((entry) => entry.threadId === item.threadId)?.title || item.title,
      updatedAt: item.updatedAt ?? sessionIndex.find((entry) => entry.threadId === item.threadId)?.updatedAt ?? null,
    });
  }
  for (const entry of sessionIndex) {
    if (!entry.threadId || !entry.hasSessionFile || !matchesSearch(entry, searchTerm)) {
      continue;
    }
    const previous = merged.get(entry.threadId);
    if (previous) {
      merged.set(entry.threadId, {
        ...previous,
        title: previous.title || entry.title,
        cwd: previous.cwd || entry.cwd,
        path: previous.path || entry.path,
        updatedAt: previous.updatedAt ?? entry.updatedAt,
      });
      continue;
    }
    merged.set(entry.threadId, {
      threadId: entry.threadId,
      title: entry.title,
      cwd: entry.cwd,
      updatedAt: entry.updatedAt,
      preview: '',
      turns: [],
      path: entry.path,
    });
  }
  return [...merged.values()].sort((left, right) => {
    const leftUpdatedAt = Number(left.updatedAt ?? 0);
    const rightUpdatedAt = Number(right.updatedAt ?? 0);
    if (leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt - leftUpdatedAt;
    }
    return String(left.threadId).localeCompare(String(right.threadId));
  });
}

export function findCodexSessionIndexEntry(
  threadId: string,
  {
    codexHome = resolveCodexHome(),
    requireSessionFile = false,
  }: {
    codexHome?: string | null;
    requireSessionFile?: boolean;
  } = {},
): CodexSessionIndexEntry | null {
  const normalizedThreadId = normalizeString(threadId);
  if (!normalizedThreadId) {
    return null;
  }
  return readCodexSessionIndex({ codexHome })
    .find((entry) => entry.threadId === normalizedThreadId && (!requireSessionFile || entry.hasSessionFile)) ?? null;
}

function readCodexSessionPathsByThreadId(codexHome: string): Map<string, string> {
  const sessionsDir = path.join(codexHome, 'sessions');
  const pathsByThreadId = new Map<string, string>();
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const threadId = extractThreadIdFromSessionFileName(entry.name);
      if (!threadId || pathsByThreadId.has(threadId)) {
        continue;
      }
      pathsByThreadId.set(threadId, entryPath);
    }
  }
  return pathsByThreadId;
}

function resolveExistingSessionPath(value: string | null, codexHome: string): string | null {
  if (!value) {
    return null;
  }
  const candidates = [
    path.isAbsolute(value) ? value : path.resolve(codexHome, value),
    path.isAbsolute(value) ? value : path.resolve(codexHome, 'sessions', value),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Keep trying other path shapes.
    }
  }
  return null;
}

function extractThreadIdFromSessionFileName(fileName: string): string | null {
  const match = String(fileName).match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/iu);
  return match?.[1] ?? null;
}

function matchesSearch(entry: CodexSessionIndexEntry, searchTerm: string | null | undefined): boolean {
  const needle = normalizeLookupText(searchTerm);
  if (!needle) {
    return true;
  }
  return normalizeLookupText([
    entry.threadId,
    entry.title,
    entry.cwd,
    entry.path,
  ].filter(Boolean).join(' ')).includes(needle);
}

function normalizeString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function normalizeLookupText(value: unknown): string {
  return String(value ?? '').replace(/\s+/gu, ' ').trim().toLowerCase();
}

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? time : null;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}
