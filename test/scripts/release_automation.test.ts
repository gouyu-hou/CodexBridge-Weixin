import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  artifactPaths,
  buildReleaseSteps,
  findSensitiveAdditions,
  findSensitiveText,
  findUnsafeReleasePaths,
  normalizeReleaseNotes,
  parseReleaseArgs,
  validateReleaseNotes,
} from '../../scripts/release/release_contract.mjs';
import {
  isLoopbackHttpUrl,
  isPathInside,
  packagedExecutablePath,
  waitForCondition,
} from '../../scripts/release/smoke_packaged.mjs';
import {
  assertRemoteRefsMatch,
  assertGitHubPublicationReady,
  assertGitPushReady,
  assertNoRecoveryState,
  assertReleaseRemoteConfiguration,
  buildNpmInvocation,
  buildPublicationCommands,
  compareReleaseVersions,
  compareRemoteReleaseAssets,
  assertRemoteReleaseAssetsComplete,
  createReleaseDependencies,
  isExpectedReleaseRemote,
  parseLatestYml,
  restorePrePublishState,
  runRelease,
  validateRemoteReleaseMetadata,
} from '../../scripts/release/release.mjs';

test('release automation scripts are not excluded by Git ignore rules', () => {
  const result = spawnSync('git', [
    'check-ignore',
    '--quiet',
    '--',
    'scripts/release/release.mjs',
  ], { cwd: process.cwd() });

  assert.equal(result.status, 1, 'scripts/release must be available in a clean clone');
});

test('parseReleaseArgs requires one explicit safe release mode', () => {
  assert.deepEqual(
    parseReleaseArgs(['--version', '0.1.7', '--dry-run']),
    {
      help: false,
      mode: 'dry-run',
      notesFile: path.normalize('docs/releases/v0.1.7.md'),
      version: '0.1.7',
    },
  );
  assert.deepEqual(
    parseReleaseArgs([
      '--publish',
      '--notes-file',
      'notes/release.md',
      '--version',
      '1.2.3',
    ]),
    {
      help: false,
      mode: 'publish',
      notesFile: path.normalize('notes/release.md'),
      version: '1.2.3',
    },
  );
  assert.throws(
    () => parseReleaseArgs(['--version', '0.1.7']),
    /exactly one of --dry-run, --publish, or --resume/u,
  );
  assert.throws(
    () => parseReleaseArgs(['--version', '0.1.7', '--dry-run', '--publish']),
    /exactly one of --dry-run, --publish, or --resume/u,
  );
});

test('parseReleaseArgs rejects non-release versions and unknown options', () => {
  for (const version of ['v0.1.7', '0.1', '01.2.3', '1.2.3-beta.1']) {
    assert.throws(
      () => parseReleaseArgs(['--version', version, '--dry-run']),
      /semantic version/u,
    );
  }
  assert.throws(
    () => parseReleaseArgs(['--version', '0.1.7', '--dry-run', '--force']),
    /unknown release option/u,
  );
  assert.deepEqual(parseReleaseArgs(['--help']), { help: true });
});

test('parseReleaseArgs accepts explicit resume mode and rejects mixed modes', () => {
  assert.deepEqual(
    parseReleaseArgs(['--version', '0.1.7', '--resume']),
    {
      help: false,
      mode: 'resume',
      notesFile: path.normalize('docs/releases/v0.1.7.md'),
      version: '0.1.7',
    },
  );
  assert.throws(
    () => parseReleaseArgs(['--version', '0.1.7', '--publish', '--resume']),
    /exactly one of --dry-run, --publish, or --resume/u,
  );
});

test('validateReleaseNotes accepts Chinese UTF-8 and rejects corruption', () => {
  const validNotes = [
    '# CodexBridge Weixin Admin v0.1.7',
    '',
    '### 更新内容',
    '',
    '- 新增发布自动化。',
    '',
    '`CodexBridge-Weixin-Admin-Setup-0.1.7.exe`',
  ].join('\n');
  assert.doesNotThrow(() => validateReleaseNotes(validNotes));
  assert.doesNotThrow(() => validateReleaseNotes(validNotes, '0.1.7'));
  assert.throws(() => validateReleaseNotes(''), /must not be empty/u);
  assert.throws(() => validateReleaseNotes('更新内容：????'), /question-mark corruption/u);
  assert.throws(() => validateReleaseNotes('更新内容：\uFFFD'), /invalid UTF-8 replacement/u);
  assert.throws(
    () => validateReleaseNotes('# CodexBridge Weixin Admin vX.X.X', '0.1.7'),
    /target version and installer name/u,
  );
});

test('findUnsafeReleasePaths rejects private and generated release content', () => {
  assert.deepEqual(
    findUnsafeReleasePaths([
      'src/index.ts',
      'scripts/release/release.mjs',
      'docs/releases/v0.1.7.md',
    ]),
    [],
  );
  assert.deepEqual(
    findUnsafeReleasePaths([
      'release/latest.yml',
      'CodexBridgeData/runtime/state.json',
      'node_modules/pkg/index.js',
      'config/.env.production',
      'config/production.env',
      'weixin.service.env',
      '.codex/auth.json',
      'secrets/credentials.json',
      'secrets/provider.pem',
      'secrets/id_ed25519',
      'logs/service.log',
      'installer.exe',
    ]),
    [
      'release/latest.yml',
      'CodexBridgeData/runtime/state.json',
      'node_modules/pkg/index.js',
      'config/.env.production',
      'config/production.env',
      'weixin.service.env',
      '.codex/auth.json',
      'secrets/credentials.json',
      'secrets/provider.pem',
      'secrets/id_ed25519',
      'logs/service.log',
      'installer.exe',
    ],
  );
});

test('findSensitiveAdditions reports categories and paths without secret text', () => {
  const fakeSecret = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
  const fakeLocalPath = ['C:', 'Users', 'ExampleUser', 'private', 'file.txt'].join('\\');
  const findings = findSensitiveAdditions([
    '+++ b/config/example.txt',
    `+OPENAI_API_KEY=${fakeSecret}`,
    '+++ b/docs/local.md',
    `+${fakeLocalPath}`,
    '+++ b/src/safe.ts',
    "+const token = 'placeholder';",
  ].join('\n'));

  assert.deepEqual(findings, [
    { category: 'local-user-path', file: 'docs/local.md' },
    { category: 'openai-secret', file: 'config/example.txt' },
  ]);
  assert.doesNotMatch(JSON.stringify(findings), /sk-proj-/u);
});

test('release notes are scanned directly and compared with normalized remote text', () => {
  const fakeSecret = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz123456'].join('-');
  assert.deepEqual(findSensitiveText(`token=${fakeSecret}`, 'docs/releases/v0.1.7.md'), [
    { category: 'openai-secret', file: 'docs/releases/v0.1.7.md' },
  ]);
  assert.equal(
    normalizeReleaseNotes('# v0.1.7\r\n\r\n更新内容\r\n'),
    normalizeReleaseNotes('# v0.1.7\n\n更新内容'),
  );
});

test('artifactPaths and release steps keep publication out of dry-run', () => {
  assert.deepEqual(artifactPaths('0.1.7'), {
    blockmap: path.normalize('release/CodexBridge-Weixin-Admin-Setup-0.1.7.exe.blockmap'),
    installer: path.normalize('release/CodexBridge-Weixin-Admin-Setup-0.1.7.exe'),
    latestYml: path.normalize('release/latest.yml'),
    unpackedExecutable: path.normalize('release/win-unpacked/CodexBridge Weixin Admin.exe'),
  });

  const dryRunSteps = buildReleaseSteps({ mode: 'dry-run' });
  assert.deepEqual(dryRunSteps, [
    'preflight',
    'align-version',
    'verify-release',
    'build-distribution',
    'verify-artifacts',
    'smoke-packaged',
    'audit-source',
  ]);
  assert.ok(!dryRunSteps.some((step) => /commit|tag|push|release-remote/u.test(step)));
  assert.deepEqual(buildReleaseSteps({ mode: 'publish' }).slice(-13), [
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
  ]);
});

test('resume steps never stage, commit, create tags, or push refs', () => {
  const steps = buildReleaseSteps({ mode: 'resume' });
  assert.deepEqual(steps, [
    'preflight-resume',
    'verify-resume-local',
    'verify-resume-remote',
    'reconcile-release-remote',
    'verify-draft-remote',
    'publish-release-remote',
    'verify-final-remote',
    'clear-recovery',
  ]);
  assert.ok(!steps.some((step) => /stage|commit|tag|push/u.test(step)));
});

test('packaged smoke helpers keep execution and cleanup inside safe boundaries', () => {
  const rootDir = path.resolve('C:/workspace/CodexBridge');
  assert.equal(
    packagedExecutablePath(rootDir),
    path.join(rootDir, 'release', 'win-unpacked', 'CodexBridge Weixin Admin.exe'),
  );
  assert.equal(isPathInside(path.resolve('C:/temp'), path.resolve('C:/temp/smoke-1')), true);
  assert.equal(isPathInside(path.resolve('C:/temp'), path.resolve('C:/outside')), false);
  assert.equal(isPathInside(path.resolve('C:/temp'), path.resolve('C:/temp')), false);
  assert.equal(isLoopbackHttpUrl('http://127.0.0.1:43183/api/state'), true);
  assert.equal(isLoopbackHttpUrl('http://localhost:43183/'), true);
  assert.equal(isLoopbackHttpUrl('http://0.0.0.0:43183/'), false);
  assert.equal(isLoopbackHttpUrl('https://127.0.0.1:43183/'), false);
});

test('waitForCondition returns the observed value and fails at its deadline', async () => {
  let attempts = 0;
  const value = await waitForCondition(async () => {
    attempts += 1;
    return attempts === 3 ? { ok: true } : null;
  }, {
    intervalMs: 0,
    timeoutMs: 100,
  });
  assert.deepEqual(value, { ok: true });

  let now = 0;
  await assert.rejects(
    waitForCondition(async () => null, {
      intervalMs: 1,
      now: () => now,
      sleep: async () => { now += 5; },
      timeoutMs: 10,
    }),
    /timed out/u,
  );
});

test('runRelease executes dry-run steps without publication mutations', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls);

  await runRelease({
    mode: 'dry-run',
    notesFile: 'docs/releases/v0.1.7.md',
    version: '0.1.7',
  }, dependencies);

  assert.deepEqual(calls, buildReleaseSteps({ mode: 'dry-run' }));
  assert.ok(!calls.includes('stage'));
  assert.ok(!calls.includes('create-release-remote'));
});

test('runRelease executes only resume-safe steps in resume mode', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls, 'resume');

  await runRelease({
    mode: 'resume',
    notesFile: 'docs/releases/v0.1.7.md',
    version: '0.1.7',
  }, dependencies);

  assert.deepEqual(calls, buildReleaseSteps({ mode: 'resume' }));
  assert.ok(!calls.some((step) => /stage|commit|tag|push/u.test(step)));
});

test('runRelease stops before publication when a shared release step fails', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls);
  dependencies['verify-artifacts'] = async () => {
    calls.push('verify-artifacts');
    throw new Error('artifact verification failed');
  };

  await assert.rejects(
    runRelease({
      mode: 'publish',
      notesFile: 'docs/releases/v0.1.7.md',
      version: '0.1.7',
    }, dependencies),
    /artifact verification failed/u,
  );
  assert.deepEqual(calls, [
    'preflight',
    'align-version',
    'verify-release',
    'build-distribution',
    'verify-artifacts',
  ]);
});

test('runRelease restores local source changes when the atomic push fails', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls);
  dependencies['push-refs-atomic'] = async () => {
    calls.push('push-refs-atomic');
    throw new Error('push rejected');
  };

  await assert.rejects(
    runRelease({
      mode: 'publish',
      notesFile: 'docs/releases/v0.1.7.md',
      version: '0.1.7',
    }, dependencies),
    /push rejected/u,
  );
  assert.equal(calls.at(-1), 'cleanup-local-release');
  assert.ok(!calls.includes('create-release-remote'));
});

test('runRelease records a recoverable stage after remote refs are pushed', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls);
  dependencies['create-release-remote'] = async () => {
    calls.push('create-release-remote');
    throw new Error('upload interrupted');
  };
  dependencies['record-recovery'] = async (_options, failedStep) => {
    calls.push(`record-recovery:${failedStep}`);
  };

  await assert.rejects(
    runRelease({
      mode: 'publish',
      notesFile: 'docs/releases/v0.1.7.md',
      version: '0.1.7',
    }, dependencies),
    /upload interrupted/u,
  );
  assert.equal(calls.at(-1), 'record-recovery:create-release-remote');
  assert.ok(!calls.includes('cleanup-local-release'));
});

test('publish flow records recovery phases around remote mutations', async () => {
  const calls: string[] = [];
  const dependencies = releaseStepRecorder(calls);

  await runRelease({
    mode: 'publish',
    notesFile: 'docs/releases/v0.1.7.md',
    version: '0.1.7',
  }, dependencies);

  assert.deepEqual(calls.slice(-10), [
    'write-push-pending',
    'push-refs-atomic',
    'mark-refs-pushed',
    'create-release-remote',
    'mark-draft-created',
    'verify-draft-remote',
    'mark-draft-verified',
    'publish-release-remote',
    'verify-final-remote',
    'clear-recovery',
  ]);
});

test('publication commands bypass git proxy and pass UTF-8 notes as a file', () => {
  const artifacts = artifactPaths('0.1.7');
  const commands = buildPublicationCommands({
    artifacts,
    notesFile: path.normalize('docs/releases/v0.1.7.md'),
    version: '0.1.7',
  });

  assert.deepEqual(commands.pushRefsAtomic, {
    args: [
      '-c',
      'http.proxy=',
      '-c',
      'https.proxy=',
      'push',
      '--atomic',
      'gouyu',
      'main',
      'v0.1.7',
    ],
    command: 'git',
  });
  assert.deepEqual(commands.createRelease.args, [
    'release',
    'create',
    'v0.1.7',
    artifacts.installer,
    artifacts.blockmap,
    artifacts.latestYml,
    '--repo',
    'gouyu-hou/CodexBridge-Weixin',
    '--verify-tag',
    '--title',
    'v0.1.7',
    '--notes-file',
    path.normalize('docs/releases/v0.1.7.md'),
    '--draft',
  ]);
  assert.deepEqual(commands.publishRelease, {
    args: [
      'release',
      'edit',
      'v0.1.7',
      '--repo',
      'gouyu-hou/CodexBridge-Weixin',
      '--draft=false',
    ],
    command: 'gh',
  });
  assert.ok(!commands.createRelease.args.includes('origin'));
});

test('publication command builder uploads only explicitly missing assets', () => {
  const artifacts = artifactPaths('0.1.7');
  const commands = buildPublicationCommands({
    artifacts,
    missingAssets: [artifacts.blockmap],
    notesFile: path.normalize('docs/releases/v0.1.7.md'),
    version: '0.1.7',
  });

  assert.deepEqual(commands.uploadReleaseAssets, {
    args: [
      'release',
      'upload',
      'v0.1.7',
      artifacts.blockmap,
      '--repo',
      'gouyu-hou/CodexBridge-Weixin',
    ],
    command: 'gh',
  });
  assert.ok(!commands.uploadReleaseAssets.args.includes('--clobber'));
});

test('resume asset reconciliation returns only missing assets and rejects conflicts', () => {
  const localAssets = [
    { name: 'setup.exe', size: 10, sha256: 'a'.repeat(64) },
    { name: 'setup.exe.blockmap', size: 20, sha256: 'b'.repeat(64) },
  ];
  assert.deepEqual(
    compareRemoteReleaseAssets([
      { name: 'setup.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
    ], localAssets),
    [localAssets[1]],
  );
  assert.throws(
    () => compareRemoteReleaseAssets([
      { name: 'setup.exe', size: 11, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
    ], localAssets),
    /asset mismatch/u,
  );
  assert.throws(
    () => compareRemoteReleaseAssets([
      { name: 'unexpected.zip', size: 1, state: 'uploaded', digest: `sha256:${'c'.repeat(64)}` },
    ], localAssets),
    /unexpected asset/u,
  );
});

test('resume rejects a public Release that is missing a recorded asset', () => {
  const localAssets = [
    { name: 'setup.exe', size: 10, sha256: 'a'.repeat(64) },
    { name: 'setup.exe.blockmap', size: 20, sha256: 'b'.repeat(64) },
  ];
  assert.throws(
    () => assertRemoteReleaseAssetsComplete([
      { name: 'setup.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
    ], localAssets),
    /missing recorded release asset/u,
  );
  assert.doesNotThrow(() => assertRemoteReleaseAssetsComplete([
    { name: 'setup.exe', size: 10, state: 'uploaded', digest: `sha256:${'a'.repeat(64)}` },
    { name: 'setup.exe.blockmap', size: 20, state: 'uploaded', digest: `sha256:${'b'.repeat(64)}` },
  ], localAssets));
});

test('resume requires both remote refs to point to the recorded release commit', () => {
  const expected = '0123456789abcdef0123456789abcdef01234567';
  assert.doesNotThrow(() => assertRemoteRefsMatch({
    'refs/heads/main': expected,
    'refs/tags/v0.1.7': expected,
  }, expected, '0.1.7'));
  assert.throws(
    () => assertRemoteRefsMatch({ 'refs/heads/main': expected }, expected, '0.1.7'),
    /remote refs do not match/u,
  );
});

test('real release dependencies persist and advance the recovery state', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-release-state-integration-'));
  const artifacts = artifactPaths('0.1.7');
  const installerPath = path.join(rootDir, artifacts.installer);
  const blockmapPath = path.join(rootDir, artifacts.blockmap);
  const latestPath = path.join(rootDir, artifacts.latestYml);
  const unpackedExecutablePath = path.join(rootDir, artifacts.unpackedExecutable);
  const installer = Buffer.from('installer-content');
  const blockmap = Buffer.from('{"blockmap":true}\n');
  const installerSha512 = createHash('sha512').update(installer).digest('base64');
  const releaseCommit = '0123456789abcdef0123456789abcdef01234567';
  fs.mkdirSync(path.dirname(installerPath), { recursive: true });
  fs.mkdirSync(path.dirname(unpackedExecutablePath), { recursive: true });
  fs.writeFileSync(installerPath, installer);
  fs.writeFileSync(blockmapPath, blockmap);
  fs.writeFileSync(unpackedExecutablePath, 'packaged-executable');
  fs.writeFileSync(latestPath, [
    'version: 0.1.7',
    'files:',
    `  - url: ${path.basename(installerPath)}`,
    `    sha512: ${installerSha512}`,
    `    size: ${installer.length}`,
    `path: ${path.basename(installerPath)}`,
    `sha512: ${installerSha512}`,
    "releaseDate: '2026-07-16T00:00:00.000Z'",
  ].join('\n'));
  const commandRunner = (command: string, args: string[], options: any = {}) => {
    if (command !== 'git') {
      throw new Error(`unexpected command in state integration: ${command}`);
    }
    let stdout = '';
    if (args[0] === 'rev-parse' && args[1] === '--git-dir') {
      fs.mkdirSync(path.join(rootDir, '.git'), { recursive: true });
      stdout = '.git\n';
    } else if (args[0] === 'rev-parse' && args[1] === 'HEAD') {
      stdout = `${releaseCommit}\n`;
    }
    return { status: 0, stderr: '', stdout: options.capture ? stdout : '' };
  };
  try {
    const dependencies = createReleaseDependencies({ rootDir, commandRunner, log: () => true });
    await dependencies['verify-artifacts']({ version: '0.1.7' });
    await dependencies.commit({ version: '0.1.7' });
    await dependencies['write-push-pending']({
      mode: 'publish',
      notesFile: 'docs/releases/v0.1.7.md',
      version: '0.1.7',
    });
    const recoveryPath = path.join(rootDir, '.git', 'codexbridge-release-recovery.json');
    assert.equal(JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).phase, 'push-pending');
    await dependencies['mark-refs-pushed']();
    assert.equal(JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).phase, 'refs-pushed');
    await dependencies['mark-draft-created']();
    await dependencies['mark-draft-verified']();
    assert.equal(JSON.parse(fs.readFileSync(recoveryPath, 'utf8')).phase, 'draft-verified');
    await dependencies['clear-recovery']();
    assert.equal(fs.existsSync(recoveryPath), false);
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
});

test('release remote matching rejects URLs that merely contain the expected repository', () => {
  assert.equal(isExpectedReleaseRemote('git@github.com:gouyu-hou/CodexBridge-Weixin.git'), true);
  assert.equal(isExpectedReleaseRemote('https://github.com/gouyu-hou/CodexBridge-Weixin.git'), true);
  assert.equal(isExpectedReleaseRemote('ssh://git@github.com/gouyu-hou/CodexBridge-Weixin.git'), true);
  assert.equal(
    isExpectedReleaseRemote('https://example.invalid/github.com/gouyu-hou/CodexBridge-Weixin.git'),
    false,
  );
});

test('release remote configuration requires one matching fetch URL and push URL', () => {
  const expected = 'https://github.com/gouyu-hou/CodexBridge-Weixin.git';
  assert.doesNotThrow(() => assertReleaseRemoteConfiguration([expected], [expected]));
  assert.throws(
    () => assertReleaseRemoteConfiguration(
      [expected],
      ['https://github.com/example/other.git'],
    ),
    /push URL/u,
  );
  assert.throws(
    () => assertReleaseRemoteConfiguration([expected], [expected, expected]),
    /exactly one push URL/u,
  );
});

test('Git push credentials are checked with the actual remote before local mutation', () => {
  const calls: Array<{ args: string[]; command: string }> = [];
  assertGitPushReady((command: string, args: string[]) => {
    calls.push({ args, command });
    return { status: 0, stderr: '', stdout: '' };
  }, '0.1.7');
  assert.deepEqual(calls, [{
    args: [
      '-c',
      'http.proxy=',
      '-c',
      'https.proxy=',
      'push',
      '--dry-run',
      '--porcelain',
      '--atomic',
      'gouyu',
      'HEAD:refs/heads/main',
      'HEAD:refs/tags/v0.1.7',
    ],
    command: 'git',
  }]);
});

test('GitHub credentials, write permission, and release conflicts are checked before publication', () => {
  const calls: string[] = [];
  const commandRunner = (command: string, args: string[]) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'api' && args[1] !== 'graphql') {
      return { status: 0, stderr: '', stdout: 'true\n' };
    }
    if (args[0] === 'api' && args[1] === 'graphql') {
      return { status: 0, stderr: '', stdout: '\n' };
    }
    return { status: 0, stderr: '', stdout: '' };
  };

  assert.doesNotThrow(() => assertGitHubPublicationReady(commandRunner, {}, '0.1.7'));
  assert.deepEqual(calls.map((call) => call.split(' ').slice(0, 3).join(' ')), [
    'gh api user',
    'gh api repos/gouyu-hou/CodexBridge-Weixin',
    'gh api graphql',
  ]);
  assert.ok(calls.every((call) => !/git (?:commit|push)|npm version/u.test(call)));
});

test('an existing recovery state blocks a new release preflight', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-recovery-test-'));
  const gitDir = path.join(rootDir, '.git');
  fs.mkdirSync(gitDir);
  const commandRunner = () => ({ status: 0, stderr: '', stdout: '.git\n' });
  try {
    assert.doesNotThrow(() => assertNoRecoveryState(commandRunner, rootDir));
    fs.writeFileSync(
      path.join(gitDir, 'codexbridge-release-recovery.json'),
      '{"version":"0.1.7"}\n',
      'utf8',
    );
    assert.throws(
      () => assertNoRecoveryState(commandRunner, rootDir),
      /unresolved release recovery state/u,
    );
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
});

test('pre-push cleanup restores source changes in a real temporary Git repository', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-release-git-test-'));
  const runGit = (args: string[]) => spawnSync('git', args, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const commandRunner = (command: string, args: string[], options: any = {}) => {
    assert.equal(command, 'git');
    const result = runGit(args);
    const allowExitCodes = options.allowExitCodes ?? [0];
    if (!allowExitCodes.includes(result.status)) {
      throw new Error(result.stderr || `git exited ${result.status}`);
    }
    return {
      status: result.status,
      stderr: options.capture ? result.stderr : '',
      stdout: options.capture ? result.stdout : '',
    };
  };
  try {
    assert.equal(runGit(['init']).status, 0);
    assert.equal(runGit(['config', 'user.email', 'release-test@example.invalid']).status, 0);
    assert.equal(runGit(['config', 'user.name', 'Release Test']).status, 0);
    fs.writeFileSync(path.join(rootDir, 'tracked.txt'), 'before\n', 'utf8');
    assert.equal(runGit(['add', 'tracked.txt']).status, 0);
    assert.equal(runGit(['commit', '-m', 'base']).status, 0);
    const baseCommit = runGit(['rev-parse', 'HEAD']).stdout.trim();

    fs.writeFileSync(path.join(rootDir, 'tracked.txt'), 'after\n', 'utf8');
    fs.writeFileSync(path.join(rootDir, 'new.txt'), 'new\n', 'utf8');
    assert.equal(runGit(['add', '-A']).status, 0);
    assert.equal(runGit(['commit', '-m', 'release: v0.1.7']).status, 0);
    assert.equal(runGit(['tag', 'v0.1.7']).status, 0);

    restorePrePublishState(commandRunner, baseCommit, '0.1.7');

    assert.equal(runGit(['rev-parse', 'HEAD']).stdout.trim(), baseCommit);
    assert.notEqual(runGit(['show-ref', '--verify', '--quiet', 'refs/tags/v0.1.7']).status, 0);
    assert.equal(fs.readFileSync(path.join(rootDir, 'tracked.txt'), 'utf8'), 'after\n');
    assert.equal(fs.readFileSync(path.join(rootDir, 'new.txt'), 'utf8'), 'new\n');
    const status = runGit(['status', '--short']).stdout;
    assert.match(status, / M tracked\.txt/u);
    assert.match(status, /\?\? new\.txt/u);
  } finally {
    fs.rmSync(rootDir, { force: true, recursive: true });
  }
});

test('remote release metadata must preserve notes before a draft can be published', () => {
  const notes = '# CodexBridge Weixin Admin v0.1.7\r\n\r\n更新内容\r\n';
  assert.doesNotThrow(() => validateRemoteReleaseMetadata({
    body: '# CodexBridge Weixin Admin v0.1.7\n\n更新内容',
    isDraft: true,
    isPrerelease: false,
    tagName: 'v0.1.7',
  }, {
    expectedDraft: true,
    notes,
    version: '0.1.7',
  }));
  assert.throws(() => validateRemoteReleaseMetadata({
    body: '????',
    isDraft: true,
    isPrerelease: false,
    tagName: 'v0.1.7',
  }, {
    expectedDraft: true,
    notes,
    version: '0.1.7',
  }), /body does not match/u);
  assert.throws(() => validateRemoteReleaseMetadata({
    body: notes,
    isDraft: false,
    isPrerelease: false,
    tagName: 'v0.1.7',
  }, {
    expectedDraft: true,
    notes,
    version: '0.1.7',
  }), /draft state/u);
});

test('release metadata helpers compare versions and parse generated latest.yml', () => {
  assert.equal(compareReleaseVersions('0.1.6', '0.1.7'), -1);
  assert.equal(compareReleaseVersions('1.2.3', '1.2.3'), 0);
  assert.equal(compareReleaseVersions('2.0.0', '1.99.99'), 1);

  assert.deepEqual(parseLatestYml([
    'version: 0.1.7',
    'files:',
    '  - url: CodexBridge-Weixin-Admin-Setup-0.1.7.exe',
    '    sha512: abc123==',
    '    size: 123456',
    'path: CodexBridge-Weixin-Admin-Setup-0.1.7.exe',
    'sha512: abc123==',
    "releaseDate: '2026-07-16T00:00:00.000Z'",
  ].join('\n')), {
    path: 'CodexBridge-Weixin-Admin-Setup-0.1.7.exe',
    sha512: 'abc123==',
    size: 123456,
    version: '0.1.7',
  });
  assert.throws(() => parseLatestYml('version: 0.1.7\npath: setup.exe\n'), /missing required metadata/u);
});

test('buildNpmInvocation runs the npm CLI through Node on Windows without a shell', () => {
  assert.deepEqual(buildNpmInvocation(['run', 'verify:release'], {
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    npmExecPath: 'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
    platform: 'win32',
  }), {
    args: [
      'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js',
      'run',
      'verify:release',
    ],
    command: 'C:\\Program Files\\nodejs\\node.exe',
  });
  assert.deepEqual(buildNpmInvocation(['run', 'verify:release'], {
    execPath: '/usr/bin/node',
    npmExecPath: '',
    platform: 'linux',
  }), {
    args: ['run', 'verify:release'],
    command: 'npm',
  });
  assert.throws(
    () => buildNpmInvocation(['run', 'verify:release'], {
      execPath: 'node.exe',
      npmExecPath: '',
      platform: 'win32',
    }),
    /run this command through npm run release/u,
  );
});

function releaseStepRecorder(
  calls: string[],
  mode: 'publish' | 'resume' = 'publish',
): Record<string, (...args: any[]) => Promise<void>> {
  const dependencies: Record<string, (...args: any[]) => Promise<void>> = {};
  for (const step of buildReleaseSteps({ mode })) {
    dependencies[step] = async () => { calls.push(step); };
  }
  dependencies['cleanup-local-release'] = async () => { calls.push('cleanup-local-release'); };
  dependencies['record-recovery'] = async () => { calls.push('record-recovery'); };
  dependencies['clear-recovery'] = async () => { calls.push('clear-recovery'); };
  return dependencies;
}
