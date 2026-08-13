import path from 'node:path';
import type { OutputArtifact, OutputArtifactKind } from './provider.js';

export function extractUniqueOutputArtifacts<Item, Artifact extends Pick<OutputArtifact, 'kind' | 'path'>>(
  items: readonly Item[],
  extractItem: (item: Item) => readonly Artifact[],
): Artifact[] {
  const seen = new Set<string>();
  return items.flatMap((item) => extractItem(item)).filter((artifact) => {
    const key = `${artifact.kind}:${artifact.path}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function extractTurnOutputArtifacts<Item, Artifact extends Pick<OutputArtifact, 'kind' | 'path'>>(
  turn: { items: readonly Item[] },
  extractItem: (item: Item) => readonly Artifact[],
): Artifact[] {
  return extractUniqueOutputArtifacts(turn.items, extractItem);
}

export function normalizeLegacyImageMedia(
  artifacts: readonly OutputArtifact[],
): Array<OutputArtifact & { kind: 'image' }> {
  return artifacts.filter(
    (artifact): artifact is OutputArtifact & { kind: 'image' } => artifact?.kind === 'image',
  );
}

export function inferArtifactKindFromPath(filePath: unknown): OutputArtifactKind {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(extension)) {
    return 'image';
  }
  if (['.mp4', '.mov', '.mkv', '.webm'].includes(extension)) {
    return 'video';
  }
  if (['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.amr'].includes(extension)) {
    return 'audio';
  }
  return 'file';
}

export function inferMimeTypeFromPath(filePath: unknown): string | null {
  const extension = path.extname(String(filePath ?? '')).toLowerCase();
  return ({
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.csv': 'text/csv',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.html': 'text/html',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.tgz': 'application/gzip',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
  } as Record<string, string>)[extension] ?? null;
}

export function isLocalFilePath(value: unknown): boolean {
  const normalized = String(value ?? '').trim();
  if (!normalized || /^(?:https?:)?\/\//iu.test(normalized) || /^data:/iu.test(normalized)) {
    return false;
  }
  return path.isAbsolute(normalized);
}
