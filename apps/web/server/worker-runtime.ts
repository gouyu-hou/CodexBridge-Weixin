import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workerSourceDir = path.dirname(fileURLToPath(import.meta.url));

export function resolveWorkerRepoRoot(explicitRoot?: unknown): string {
  const normalized = typeof explicitRoot === 'string' ? explicitRoot.trim() : '';
  return path.resolve(normalized || path.join(workerSourceDir, '..', '..', '..'));
}
