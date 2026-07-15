import path from 'node:path';
import { readJsonFileSafely, writeJsonFileAtomically } from '../../../store/file_json/json_file_io.js';

export function getSyncBufFilePath(accountsDir: string, accountId: string): string {
  return path.join(accountsDir, `${accountId}.sync.json`);
}

export function loadGetUpdatesBuf(filePath: string): string | undefined {
  const data = readJsonFileSafely<{ get_updates_buf?: string } | null>(filePath, { fallback: null });
  if (typeof data?.get_updates_buf === 'string') {
    return data.get_updates_buf;
  }
  return undefined;
}

export function saveGetUpdatesBuf(filePath: string, getUpdatesBuf: string): void {
  writeJsonFileAtomically(filePath, { get_updates_buf: getUpdatesBuf });
}
