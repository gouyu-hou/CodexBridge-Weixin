import path from 'node:path';

const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const BINARY_ARTIFACT_PATTERN = /\.(?:7z|blockmap|dll|exe|node|pdb|zip)$/iu;
const PRIVATE_FILE_NAMES = new Set([
  'auth.json',
  'credentials.json',
  'id_ed25519',
  'id_rsa',
]);

/** @type {ReadonlyArray<readonly [string, RegExp]>} */
const SENSITIVE_PATTERNS = Object.freeze([
  ['aws-access-key', /AKIA[0-9A-Z]{16}/u],
  ['github-token', /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/u],
  ['google-api-key', /AIza[0-9A-Za-z_-]{30,}/u],
  ['local-user-path', /(?:[A-Za-z]:\\Users\\[^\\/\s]+(?:\\|\/)|\/home\/[^/\s]+\/|\/Users\/[^/\s]+\/)/u],
  ['openai-secret', /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/u],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/u],
  ['slack-token', /xox[baprs]-[A-Za-z0-9-]{10,}/u],
]);

/**
 * @param {string[]} argv
 * @returns {{ help: true } | {
 *   help: false,
 *   mode: 'dry-run' | 'publish' | 'resume',
 *   notesFile: string,
 *   version: string,
 * }}
 */
export function parseReleaseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    return { help: true };
  }

  let version = '';
  let notesFile = '';
  let dryRun = false;
  let publish = false;
  let resume = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--publish') {
      publish = true;
      continue;
    }
    if (arg === '--resume') {
      resume = true;
      continue;
    }
    if (arg === '--version' || arg === '--notes-file') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === '--version') {
        version = value;
      } else {
        notesFile = value;
      }
      index += 1;
      continue;
    }
    throw new Error(`unknown release option: ${arg}`);
  }

  if ([dryRun, publish, resume].filter(Boolean).length !== 1) {
    throw new Error('exactly one of --dry-run, --publish, or --resume is required');
  }
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error('--version must be an exact semantic version such as 0.1.7');
  }

  return {
    help: false,
    mode: dryRun ? 'dry-run' : publish ? 'publish' : 'resume',
    notesFile: path.normalize(notesFile || `docs/releases/v${version}.md`),
    version,
  };
}

export function validateReleaseNotes(text, version = '') {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('release notes must not be empty');
  }
  if (text.includes('\uFFFD')) {
    throw new Error('release notes contain an invalid UTF-8 replacement character');
  }
  if (/\?{4,}/u.test(text)) {
    throw new Error('release notes contain likely question-mark corruption');
  }
  if (version) {
    const installerName = `CodexBridge-Weixin-Admin-Setup-${version}.exe`;
    if (!text.includes(`v${version}`) || !text.includes(installerName) || text.includes('X.X.X')) {
      throw new Error('release notes must contain the target version and installer name');
    }
  }
}

export function findUnsafeReleasePaths(paths) {
  const unsafe = [];
  for (const originalPath of paths) {
    const normalized = String(originalPath).replaceAll('\\', '/').replace(/^\.\//u, '');
    const lower = normalized.toLowerCase();
    const segments = lower.split('/');
    const baseName = segments.at(-1) ?? '';
    const unsafePath = lower === 'release'
      || lower.startsWith('release/')
      || lower === 'codexbridgedata'
      || lower.startsWith('codexbridgedata/')
      || segments.includes('node_modules')
      || baseName === 'weixin.service.env'
      || baseName === '.env'
      || baseName.startsWith('.env.')
      || baseName.endsWith('.env')
      || baseName.endsWith('.key')
      || baseName.endsWith('.pem')
      || baseName.endsWith('.log')
      || PRIVATE_FILE_NAMES.has(baseName)
      || BINARY_ARTIFACT_PATTERN.test(baseName);
    if (unsafePath && !unsafe.includes(originalPath)) {
      unsafe.push(originalPath);
    }
  }
  return unsafe;
}

export function findSensitiveAdditions(diff) {
  let currentFile = '';
  const findings = [];
  for (const line of String(diff).split(/\r?\n/u)) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      continue;
    }
    if (!line.startsWith('+') || line.startsWith('+++')) {
      continue;
    }
    addSensitiveFindings(findings, line, currentFile || '(unknown)');
  }
  return sortSensitiveFindings(findings);
}

export function findSensitiveText(text, file = '(unknown)') {
  const findings = [];
  for (const line of String(text).split(/\r?\n/u)) {
    addSensitiveFindings(findings, line, file);
  }
  return sortSensitiveFindings(findings);
}

export function normalizeReleaseNotes(text) {
  return String(text).replace(/\r\n?/gu, '\n').replace(/\n+$/u, '');
}

export function artifactPaths(version) {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error('artifact version must be an exact semantic version');
  }
  const installerName = `CodexBridge-Weixin-Admin-Setup-${version}.exe`;
  return {
    blockmap: path.normalize(`release/${installerName}.blockmap`),
    installer: path.normalize(`release/${installerName}`),
    latestYml: path.normalize('release/latest.yml'),
    unpackedExecutable: path.normalize('release/win-unpacked/CodexBridge Weixin Admin.exe'),
  };
}

export function buildReleaseSteps({ mode }) {
  const shared = [
    'preflight',
    'align-version',
    'verify-release',
    'build-distribution',
    'verify-artifacts',
    'smoke-packaged',
    'audit-source',
  ];
  if (mode === 'dry-run') {
    return shared;
  }
  if (mode === 'resume') {
    return [
      'preflight-resume',
      'verify-resume-local',
      'verify-resume-remote',
      'reconcile-release-remote',
      'verify-draft-remote',
      'publish-release-remote',
      'verify-final-remote',
      'clear-recovery',
    ];
  }
  if (mode !== 'publish') {
    throw new Error(`unsupported release mode: ${mode}`);
  }
  return [
    ...shared,
    'stage',
    'audit-staged',
    'commit',
    'tag',
    'write-push-pending',
    'push-refs-atomic',
    'mark-refs-pushed',
    'create-release-remote',
    'mark-draft-created',
    'verify-draft-remote',
    'mark-draft-verified',
    'publish-release-remote',
    'verify-final-remote',
  ];
}

function addSensitiveFindings(findings, text, file) {
  for (const [category, pattern] of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      const finding = { category, file };
      if (!findings.some((item) => item.category === category && item.file === file)) {
        findings.push(finding);
      }
    }
  }
}

function sortSensitiveFindings(findings) {
  return findings.sort((left, right) => (
    left.category.localeCompare(right.category) || left.file.localeCompare(right.file)
  ));
}
