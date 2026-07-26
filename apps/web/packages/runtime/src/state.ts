import type fsType from 'node:fs';
import type osType from 'node:os';
import type pathType from 'node:path';

const fs = process.getBuiltinModule('node:fs') as typeof fsType;
const os = process.getBuiltinModule('node:os') as typeof osType;
const path = process.getBuiltinModule('node:path') as typeof pathType;

export type WebPaths = {
  stateDir: string;
  runtimeDir: string;
};

type WebPathEnvironment = NodeJS.ProcessEnv;

type CacheEntry = {
  expiresAt: number;
  value: unknown;
};

const CACHE_TTL_MS = 3_000;
const runtimeJsonCache = new Map<string, CacheEntry>();

export function resolveWebPaths(
  env: WebPathEnvironment = process.env,
  homeDir = os.homedir(),
): WebPaths {
  const stateDir = path.resolve(
    env.CODEXBRIDGE_WEB_STATE_DIR
    ?? env.CODEXBRIDGE_STATE_DIR
    ?? path.join(homeDir, '.codexbridge'),
  );
  return {
    stateDir,
    runtimeDir: path.join(stateDir, 'runtime'),
  };
}

export function getWebPaths(): WebPaths {
  return resolveWebPaths();
}

export function readRuntimeJson<T>(filename: string, fallback: T): T {
  const now = Date.now();
  const cached = runtimeJsonCache.get(filename);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const filePath = path.join(getWebPaths().runtimeDir, filename);
  if (!fs.existsSync(filePath)) {
    runtimeJsonCache.set(filename, {
      expiresAt: now + CACHE_TTL_MS,
      value: fallback,
    });
    return fallback;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
    runtimeJsonCache.set(filename, {
      expiresAt: now + CACHE_TTL_MS,
      value: parsed,
    });
    return parsed;
  } catch {
    runtimeJsonCache.set(filename, {
      expiresAt: now + CACHE_TTL_MS,
      value: fallback,
    });
    return fallback;
  }
}

export function clearRuntimeJsonCache(filename?: string): void {
  if (filename) {
    runtimeJsonCache.delete(filename);
    return;
  }
  runtimeJsonCache.clear();
}
