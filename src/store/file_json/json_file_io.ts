import fs from 'node:fs';
import path from 'node:path';

interface ReadJsonFileOptions<T> {
  fallback: T;
  reinitializeOnCorrupt?: boolean;
}

export function readJsonFileSafely<T>(
  filePath: string,
  { fallback, reinitializeOnCorrupt = false }: ReadJsonFileOptions<T>,
): T {
  recoverInterruptedFileReplacement(filePath);
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/u, '')) as T;
  } catch {
    quarantineCorruptJsonFile(filePath, raw);
    if (reinitializeOnCorrupt) {
      writeJsonFileAtomically(filePath, fallback);
    }
    return fallback;
  }
}

export function recoverInterruptedFileReplacement(filePath: string): boolean {
  if (fs.existsSync(filePath)) {
    return false;
  }
  const directory = path.dirname(filePath);
  if (!fs.existsSync(directory)) {
    return false;
  }
  const prefix = `${path.basename(filePath)}.`;
  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith('.previous'))
    .map((entry) => {
      const candidatePath = path.join(directory, entry.name);
      return { candidatePath, mtimeMs: fs.statSync(candidatePath).mtimeMs };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const candidate = candidates[0];
  if (!candidate) {
    return false;
  }
  try {
    fs.renameSync(candidate.candidatePath, filePath);
    setOwnerOnlyPermissions(filePath);
    return true;
  } catch (error) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    throw error;
  }
}

export function writeJsonFileAtomically<T>(filePath: string, value: T): T {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  writeTextFileAtomically(filePath, payload);
  return value;
}

export function writeTextFileAtomically(filePath: string, payload: string): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const nonce = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
  const tempPath = `${filePath}.${nonce}.tmp`;
  const previousPath = `${filePath}.${nonce}.previous`;
  fs.writeFileSync(tempPath, payload, { encoding: 'utf8', mode: 0o600 });

  let previousMoved = false;
  try {
    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, previousPath);
      previousMoved = true;
    }
    fs.renameSync(tempPath, filePath);
    setOwnerOnlyPermissions(filePath);
    if (previousMoved) {
      try {
        fs.rmSync(previousPath, { force: true });
      } catch {
        // The new file is already committed; stale backup cleanup is best effort.
      }
    }
    return;
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {}
    if (previousMoved && !fs.existsSync(filePath)) {
      try {
        fs.renameSync(previousPath, filePath);
      } catch {}
    }
    throw error;
  } finally {
    if (fs.existsSync(previousPath) && fs.existsSync(filePath)) {
      try {
        fs.rmSync(previousPath, { force: true });
      } catch {}
    }
  }
}

export function quarantineCorruptJsonFile(filePath: string, raw: string) {
  const corruptPath = nextSiblingPath(filePath, 'corrupt');
  try {
    fs.renameSync(filePath, corruptPath);
    setOwnerOnlyPermissions(corruptPath);
    return corruptPath;
  } catch {
    try {
      fs.writeFileSync(corruptPath, raw, { encoding: 'utf8', mode: 0o600 });
      fs.rmSync(filePath, { force: true });
      return corruptPath;
    } catch {
      return null;
    }
  }
}

function nextSiblingPath(filePath: string, label: string) {
  const stamp = new Date().toISOString().replace(/[-:TZ]/gu, '').replace('.', '-');
  let candidate = `${filePath}.${label}-${stamp}`;
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = `${filePath}.${label}-${stamp}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function setOwnerOnlyPermissions(filePath: string) {
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Windows ACLs are inherited from the containing user data directory.
  }
}
