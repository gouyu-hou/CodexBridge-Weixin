import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  artifactPaths,
  buildReleaseSteps,
  findSensitiveAdditions,
  findSensitiveText,
  findUnsafeReleasePaths,
  normalizeReleaseNotes,
  parseReleaseArgs,
  validateReleaseNotes,
} from './release_contract.mjs';
import { isPathInside, runPackagedSmoke } from './smoke_packaged.mjs';
import {
  createRecoveryState,
  readRecoveryState,
  updateRecoveryState,
  writeRecoveryStateAtomically,
} from './release_recovery.mjs';

const GITHUB_REPOSITORY = 'gouyu-hou/CodexBridge-Weixin';
const RELEASE_REMOTE = 'gouyu';
const RELEASE_BRANCH = 'main';

export const releaseHelpText = `CodexBridge Weixin release automation

Usage:
  npm run release -- --version <x.y.z> --dry-run [--notes-file <path>]
  npm run release -- --version <x.y.z> --publish [--notes-file <path>]
  npm run release -- --version <x.y.z> --resume [--notes-file <path>]

Modes:
  --dry-run  Update the local version, verify, package, smoke-test, and audit.
             Never stage, commit, tag, push, or create a GitHub Release.
  --publish  Run the same gates, then commit, tag, push only to gouyu, create
             a Draft Release, verify notes/assets, and then publish it.
  --resume   Continue a recorded post-push release phase without creating
             another commit, tag, or remote reference.

Release notes default to docs/releases/v<version>.md, must be valid UTF-8,
must not be ignored by Git, and are scanned for sensitive content.
`;

/**
 * @param {{ mode: 'dry-run' | 'publish' | 'resume', notesFile: string, version: string }} options
 * @param {Record<string, any>} dependencies
 */
export async function runRelease(options, dependencies = createReleaseDependencies()) {
  const steps = buildReleaseSteps(options);
  let commitCreated = false;
  let pushAttempted = false;
  let refsPushed = false;
  let currentStep = '';
  try {
    for (const step of steps) {
      currentStep = step;
      if (step === 'push-refs-atomic') {
        pushAttempted = true;
      }
      const handler = dependencies[step];
      if (typeof handler !== 'function') {
        throw new Error(`release dependency is missing step: ${step}`);
      }
      dependencies.log?.(`==> ${step}`);
      await handler(options);
      if (step === 'commit') {
        commitCreated = true;
      } else if (step === 'push-refs-atomic') {
        refsPushed = true;
      }
    }
    if (options.mode === 'publish') {
      await dependencies['clear-recovery']?.(options);
    }
  } catch (error) {
    if (refsPushed && typeof dependencies['record-recovery'] === 'function') {
      try {
        await dependencies['record-recovery'](options, currentStep);
      } catch {
        dependencies.log?.('warning: failed to record the post-push recovery state');
      }
    } else if (
      pushAttempted
      && typeof dependencies['resolve-push-failure'] === 'function'
    ) {
      try {
        const outcome = await dependencies['resolve-push-failure'](options);
        if (outcome === 'retained' && typeof dependencies['record-recovery'] === 'function') {
          await dependencies['record-recovery'](options, currentStep);
        }
      } catch {
        dependencies.log?.('warning: unable to resolve the atomic push outcome; recovery state was retained');
      }
    } else if (commitCreated && typeof dependencies['cleanup-local-release'] === 'function') {
      try {
        await dependencies['cleanup-local-release'](options);
      } catch {
        dependencies.log?.('warning: failed to restore the local pre-publish state');
      }
    }
    throw error;
  }
}

export function buildPublicationCommands({
  version,
  notesFile,
  artifacts = artifactPaths(version),
  missingAssets = [],
}) {
  const tag = `v${version}`;
  const proxyFreeGit = ['-c', 'http.proxy=', '-c', 'https.proxy='];
  return {
    createRelease: {
      command: 'gh',
      args: [
        'release',
        'create',
        tag,
        artifacts.installer,
        artifacts.blockmap,
        artifacts.latestYml,
        '--repo',
        GITHUB_REPOSITORY,
        '--verify-tag',
        '--title',
        tag,
        '--notes-file',
        notesFile,
        '--draft',
      ],
    },
    publishRelease: {
      command: 'gh',
      args: [
        'release',
        'edit',
        tag,
        '--repo',
        GITHUB_REPOSITORY,
        '--draft=false',
      ],
    },
    pushRefsAtomic: {
      command: 'git',
      args: [...proxyFreeGit, 'push', '--atomic', RELEASE_REMOTE, RELEASE_BRANCH, tag],
    },
    uploadReleaseAssets: {
      command: 'gh',
      args: [
        'release',
        'upload',
        tag,
        ...missingAssets,
        '--repo',
        GITHUB_REPOSITORY,
      ],
    },
  };
}

export function buildNpmInvocation(args, {
  platform = process.platform,
  execPath = process.execPath,
  npmExecPath = process.env.npm_execpath || '',
} = {}) {
  if (platform !== 'win32') {
    return { command: 'npm', args: [...args] };
  }
  if (!npmExecPath) {
    throw new Error('npm CLI path is unavailable; run this command through npm run release');
  }
  return { command: execPath, args: [npmExecPath, ...args] };
}

export function compareReleaseVersions(left, right) {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] < rightParts[index]) return -1;
    if (leftParts[index] > rightParts[index]) return 1;
  }
  return 0;
}

export function parseLatestYml(text) {
  const version = matchMetadata(text, /^version:\s*(\S+)\s*$/mu);
  const filePath = matchMetadata(text, /^path:\s*(\S+)\s*$/mu);
  const sha512 = matchMetadata(text, /^sha512:\s*(\S+)\s*$/mu);
  const sizeText = matchMetadata(text, /^\s{4}size:\s*(\d+)\s*$/mu);
  if (!version || !filePath || !sha512 || !sizeText) {
    throw new Error('latest.yml is missing required metadata');
  }
  const size = Number.parseInt(sizeText, 10);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error('latest.yml contains an invalid installer size');
  }
  return { path: filePath, sha512, size, version };
}

export function compareRemoteReleaseAssets(remoteAssets, localAssets) {
  const remoteByName = new Map();
  const localNames = new Set(localAssets.map((asset) => asset.name));
  for (const asset of Array.isArray(remoteAssets) ? remoteAssets : []) {
    const name = String(asset?.name ?? '');
    if (!name || remoteByName.has(name)) {
      throw new Error('GitHub Release contains duplicate or unnamed assets');
    }
    if (!localNames.has(name)) {
      throw new Error(`GitHub Release contains an unexpected asset: ${name}`);
    }
    remoteByName.set(name, asset);
  }
  const missing = [];
  for (const localAsset of localAssets) {
    const remoteAsset = remoteByName.get(localAsset.name);
    if (!remoteAsset) {
      missing.push(localAsset);
      continue;
    }
    if (
      remoteAsset.state !== 'uploaded'
      || Number(remoteAsset.size) !== localAsset.size
      || remoteAsset.digest !== `sha256:${localAsset.sha256}`
    ) {
      throw new Error(`GitHub Release asset mismatch: ${localAsset.name}`);
    }
  }
  return missing;
}

export function assertRemoteReleaseAssetsComplete(remoteAssets, localAssets) {
  const missing = compareRemoteReleaseAssets(remoteAssets, localAssets);
  if (missing.length) {
    throw new Error(
      `GitHub Release is missing recorded release asset: ${missing.map((asset) => asset.name).join(', ')}`,
    );
  }
  return true;
}

export function assertRemoteRefsMatch(remoteRefs, expectedCommit, version) {
  const getRef = (name) => remoteRefs instanceof Map ? remoteRefs.get(name) : remoteRefs?.[name];
  if (
    getRef('refs/heads/main') !== expectedCommit
    || getRef(`refs/tags/v${version}`) !== expectedCommit
  ) {
    throw new Error('remote refs do not match the recorded release commit');
  }
}

export function createReleaseDependencies({
  rootDir = process.cwd(),
  commandRunner = createCommandRunner(rootDir),
  environment = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
} = {}) {
  const resolvedRoot = path.resolve(rootDir);
  let localArtifactState = null;
  let githubEnvironment = null;
  let releaseNotes = '';
  let releaseBaseCommit = '';
  let recoveryState = null;
  let recoveryPath = '';
  let resumeAlreadyPublic = false;

  const dependencies = {
    log,
    preflight: async (options) => {
      assertWindowsReleaseHost();
      assertRepositoryRoot(resolvedRoot);
      assertNoRecoveryState(commandRunner, resolvedRoot);
      releaseNotes = assertReleaseNotes(
        commandRunner,
        resolvedRoot,
        options.notesFile,
        options.version,
      );
      assertBranchAndRemote(commandRunner);
      assertNoUnmergedPaths(commandRunner);
      assertTagAbsent(commandRunner, options.version);
      auditWorkingTree({ commandRunner, rootDir: resolvedRoot, stagedOnly: false });
      if (options.mode === 'publish') {
        assertGitPushReady(commandRunner, options.version);
        githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
        assertGitHubPublicationReady(commandRunner, githubEnvironment, options.version);
      }
    },
    'preflight-resume': async (options) => {
      assertWindowsReleaseHost();
      assertRepositoryRoot(resolvedRoot);
      recoveryPath = recoveryStatePath(commandRunner, resolvedRoot);
      recoveryState = readRecoveryState(recoveryPath, options.version);
      releaseNotes = assertReleaseNotes(
        commandRunner,
        resolvedRoot,
        options.notesFile,
        options.version,
      );
      if (repositoryRelativePath(resolvedRoot, options.notesFile) !== recoveryState.notesFile) {
        throw new Error('resume notes path does not match the recorded release state');
      }
      assertBranchAndRemote(commandRunner);
      assertNoUnmergedPaths(commandRunner);
      const status = commandRunner('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
      if (status) {
        throw new Error('resume requires a clean local worktree');
      }
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      assertGitHubCredentialsReady(commandRunner, githubEnvironment);
    },
    'verify-resume-local': async (options) => {
      const state = requireRecoveryState(recoveryState);
      const head = commandRunner('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim();
      if (head !== state.commit) {
        throw new Error('local HEAD does not match the recorded release commit');
      }
      const tag = commandRunner('git', ['rev-parse', `refs/tags/${state.tag}`], {
        allowExitCodes: [0, 1],
        capture: true,
      });
      if (tag.status !== 0 || tag.stdout.trim() !== state.commit) {
        throw new Error('local release Tag does not match the recorded release commit');
      }
      localArtifactState = verifyLocalArtifacts(resolvedRoot, options.version);
      assertArtifactManifestMatches(localArtifactState, state);
    },
    'verify-resume-remote': async (options) => {
      const state = requireRecoveryState(recoveryState);
      const refs = readRemoteReleaseRefs(commandRunner, options.version);
      assertRemoteRefsMatch(Object.fromEntries(refs), state.commit, options.version);
    },
    'reconcile-release-remote': async (options) => {
      const state = requireRecoveryState(recoveryState);
      if (!localArtifactState) {
        throw new Error('resume artifacts were not verified');
      }
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      const snapshot = readRemoteReleaseSnapshot(commandRunner, githubEnvironment, options.version);
      if (!snapshot) {
        const command = buildPublicationCommands({
          ...options,
          notesFile: state.notesFile,
        }).createRelease;
        commandRunner(command.command, command.args, { env: githubEnvironment });
        recoveryState = updateRecoveryState(recoveryPath, state, { phase: 'draft-created' });
        return;
      }
      validateRemoteReleaseMetadata(snapshot, {
        expectedDraft: snapshot.isDraft,
        notes: releaseNotes,
        version: options.version,
      });
      if (!snapshot.isDraft) {
        assertRemoteReleaseAssetsComplete(snapshot.assets, localArtifactState.assets);
        resumeAlreadyPublic = true;
        return;
      }
      const missing = compareRemoteReleaseAssets(snapshot.assets, localArtifactState.assets);
      if (missing.length > 0) {
        const missingPaths = missing.map((asset) => artifactPathForName(localArtifactState, asset.name));
        const command = buildPublicationCommands({
          ...options,
          missingAssets: missingPaths,
        }).uploadReleaseAssets;
        commandRunner(command.command, command.args, { env: githubEnvironment });
      }
      recoveryState = updateRecoveryState(recoveryPath, state, { phase: 'draft-created' });
    },
    'align-version': async (options) => {
      alignVersion({ commandRunner, rootDir: resolvedRoot, version: options.version });
    },
    'verify-release': async () => {
      runNpm(commandRunner, ['run', 'verify:release']);
    },
    'build-distribution': async () => {
      runNpm(commandRunner, ['run', 'weixin:electron:dist']);
    },
    'verify-artifacts': async (options) => {
      localArtifactState = verifyLocalArtifacts(resolvedRoot, options.version);
    },
    'smoke-packaged': async () => {
      const result = await runPackagedSmoke({ rootDir: resolvedRoot });
      if (result.stateStatus !== 200 || result.pageStatus !== 200 || !result.selfStopped) {
        throw new Error('packaged smoke did not complete every required lifecycle check');
      }
    },
    'audit-source': async () => {
      auditWorkingTree({ commandRunner, rootDir: resolvedRoot, stagedOnly: false });
    },
    stage: async () => {
      commandRunner('git', ['add', '-A']);
    },
    'audit-staged': async () => {
      auditWorkingTree({ commandRunner, rootDir: resolvedRoot, stagedOnly: true });
      const unstaged = commandRunner('git', ['diff', '--name-only', '-z'], { capture: true }).stdout;
      const untracked = commandRunner('git', ['ls-files', '--others', '--exclude-standard', '-z'], { capture: true }).stdout;
      if (splitNull(untracked).length || splitNull(unstaged).length) {
        throw new Error('publish requires every reviewed source change to be staged');
      }
    },
    commit: async (options) => {
      releaseBaseCommit = commandRunner('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim();
      commandRunner('git', ['commit', '-m', `release: v${options.version}`]);
    },
    tag: async (options) => {
      commandRunner('git', ['tag', `v${options.version}`]);
    },
    'write-push-pending': async (options) => {
      if (!localArtifactState) {
        throw new Error('release artifacts must be verified before recovery state creation');
      }
      recoveryState = createRecoveryState({
        version: options.version,
        tag: `v${options.version}`,
        branch: RELEASE_BRANCH,
        remote: RELEASE_REMOTE,
        commit: commandRunner('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim(),
        notesFile: repositoryRelativePath(resolvedRoot, options.notesFile),
        phase: 'push-pending',
        artifacts: localArtifactState.assets,
        latestYmlSha256: localArtifactState.latestYmlSha256,
      });
      recoveryPath ||= recoveryStatePath(commandRunner, resolvedRoot);
      writeRecoveryStateAtomically(recoveryPath, recoveryState);
    },
    'cleanup-local-release': async (options) => {
      restorePrePublishState(commandRunner, releaseBaseCommit, options.version);
      if (recoveryPath) {
        clearRecoveryState(commandRunner, resolvedRoot);
        recoveryState = null;
        recoveryPath = '';
      }
    },
    'mark-refs-pushed': async () => {
      recoveryState = updateRecoveryState(recoveryPath, recoveryState, { phase: 'refs-pushed' });
    },
    'push-refs-atomic': async (options) => {
      const command = buildPublicationCommands(options).pushRefsAtomic;
      commandRunner(command.command, command.args);
    },
    'resolve-push-failure': async (options) => {
      const state = recoveryState ?? readRecoveryState(recoveryPath, options.version);
      const remoteRefs = readRemoteReleaseRefs(commandRunner, options.version);
      const branchCommit = remoteRefs.get(`refs/heads/${RELEASE_BRANCH}`) ?? '';
      const tagCommit = remoteRefs.get(`refs/tags/v${options.version}`) ?? '';
      if (!branchCommit && !tagCommit) {
        restorePrePublishState(commandRunner, releaseBaseCommit, options.version);
        clearRecoveryState(commandRunner, resolvedRoot);
        recoveryState = null;
        return 'cleaned';
      }
      if (branchCommit === state.commit && tagCommit === state.commit) {
        return 'retained';
      }
      throw new Error('atomic push left an uncertain remote reference state; manual recovery is required');
    },
    'create-release-remote': async (options) => {
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      const command = buildPublicationCommands(options).createRelease;
      commandRunner(command.command, command.args, { env: githubEnvironment });
    },
    'mark-draft-created': async () => {
      recoveryState = updateRecoveryState(recoveryPath, recoveryState, { phase: 'draft-created' });
    },
    'verify-draft-remote': async (options) => {
      if (resumeAlreadyPublic) {
        return;
      }
      localArtifactState ??= verifyLocalArtifacts(resolvedRoot, options.version);
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      await verifyDraftRelease({
        commandRunner,
        githubEnvironment,
        localArtifactState,
        releaseNotes,
        rootDir: resolvedRoot,
        version: options.version,
      });
    },
    'mark-draft-verified': async () => {
      recoveryState = updateRecoveryState(recoveryPath, recoveryState, { phase: 'draft-verified' });
    },
    'publish-release-remote': async (options) => {
      if (resumeAlreadyPublic) {
        return;
      }
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      const command = buildPublicationCommands(options).publishRelease;
      commandRunner(command.command, command.args, { env: githubEnvironment });
    },
    'verify-final-remote': async (options) => {
      githubEnvironment ??= resolveGitHubEnvironment(commandRunner, environment);
      verifyFinalRelease({
        commandRunner,
        githubEnvironment,
        releaseNotes,
        version: options.version,
      });
    },
    'record-recovery': async (options, failedStep) => {
      recoveryState ??= readRecoveryState(recoveryPath, options.version);
      log(`recovery state retained after ${failedStep}; resume with --version ${options.version} --resume`);
    },
    'clear-recovery': async () => {
      clearRecoveryState(commandRunner, resolvedRoot);
      recoveryState = null;
      recoveryPath = '';
    },
  };
  return dependencies;
}

function assertWindowsReleaseHost() {
  if (process.platform !== 'win32') {
    throw new Error('CodexBridge Weixin release packaging currently requires Windows');
  }
}

function assertRepositoryRoot(rootDir) {
  for (const fileName of ['package.json', 'package-lock.json']) {
    if (!fs.existsSync(path.join(rootDir, fileName))) {
      throw new Error(`release command must run from the repository root (${fileName} missing)`);
    }
  }
}

function assertReleaseNotes(commandRunner, rootDir, notesFile, version) {
  const resolvedNotes = path.resolve(rootDir, notesFile);
  if (!isPathInside(rootDir, resolvedNotes)) {
    throw new Error('release notes must be stored inside the repository');
  }
  let notes;
  try {
    notes = fs.readFileSync(resolvedNotes, 'utf8');
  } catch {
    throw new Error(`release notes file does not exist: ${notesFile}`);
  }
  validateReleaseNotes(notes, version);
  const ignored = commandRunner('git', ['check-ignore', '--quiet', '--', notesFile], {
    allowExitCodes: [0, 1],
    capture: true,
  });
  if (ignored.status === 0) {
    throw new Error('release notes must not be excluded by Git ignore rules');
  }
  const findings = findSensitiveText(notes, notesFile.replaceAll('\\', '/'));
  if (findings.length) {
    const locations = findings.map((finding) => `${finding.category}:${finding.file}`);
    throw new Error(`release notes contain sensitive content: ${locations.join(', ')}`);
  }
  return notes;
}

function assertBranchAndRemote(commandRunner) {
  const branch = commandRunner('git', ['branch', '--show-current'], { capture: true }).stdout.trim();
  if (branch !== RELEASE_BRANCH) {
    throw new Error(`release must run on ${RELEASE_BRANCH}; current branch is ${branch || '(detached)'}`);
  }
  const fetchUrls = splitLines(commandRunner('git', [
    'remote',
    'get-url',
    '--all',
    RELEASE_REMOTE,
  ], { capture: true }).stdout);
  const pushUrls = splitLines(commandRunner('git', [
    'remote',
    'get-url',
    '--push',
    '--all',
    RELEASE_REMOTE,
  ], { capture: true }).stdout);
  assertReleaseRemoteConfiguration(fetchUrls, pushUrls);
}

export function assertReleaseRemoteConfiguration(fetchUrls, pushUrls) {
  if (fetchUrls.length !== 1) {
    throw new Error(`remote ${RELEASE_REMOTE} must have exactly one fetch URL`);
  }
  if (pushUrls.length !== 1) {
    throw new Error(`remote ${RELEASE_REMOTE} must have exactly one push URL`);
  }
  if (!isExpectedReleaseRemote(fetchUrls[0])) {
    throw new Error(`remote ${RELEASE_REMOTE} fetch URL does not point to ${GITHUB_REPOSITORY}`);
  }
  if (!isExpectedReleaseRemote(pushUrls[0])) {
    throw new Error(`remote ${RELEASE_REMOTE} push URL does not point to ${GITHUB_REPOSITORY}`);
  }
}

export function assertGitPushReady(commandRunner, version) {
  const tag = `v${version}`;
  commandRunner('git', [
    '-c',
    'http.proxy=',
    '-c',
    'https.proxy=',
    'push',
    '--dry-run',
    '--porcelain',
    '--atomic',
    RELEASE_REMOTE,
    `HEAD:refs/heads/${RELEASE_BRANCH}`,
    `HEAD:refs/tags/${tag}`,
  ]);
}

export function isExpectedReleaseRemote(remoteUrl) {
  const value = String(remoteUrl).trim();
  const scpMatch = /^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/iu.exec(value);
  if (scpMatch) {
    return scpMatch[1].toLowerCase() === GITHUB_REPOSITORY.toLowerCase();
  }
  try {
    const url = new URL(value);
    const repositoryPath = url.pathname.replace(/^\//u, '').replace(/\.git$/iu, '');
    return url.hostname.toLowerCase() === 'github.com'
      && repositoryPath.toLowerCase() === GITHUB_REPOSITORY.toLowerCase();
  } catch {
    return false;
  }
}

function assertNoUnmergedPaths(commandRunner) {
  const unmerged = commandRunner('git', ['diff', '--name-only', '--diff-filter=U'], { capture: true }).stdout.trim();
  if (unmerged) {
    throw new Error('release cannot continue while merge conflicts exist');
  }
}

function assertTagAbsent(commandRunner, version) {
  const tag = `v${version}`;
  const local = commandRunner('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    allowExitCodes: [0, 1],
    capture: true,
  });
  if (local.status === 0) {
    throw new Error(`local tag already exists: ${tag}`);
  }
  const remote = commandRunner('git', [
    '-c', 'http.proxy=',
    '-c', 'https.proxy=',
    'ls-remote',
    '--tags',
    RELEASE_REMOTE,
    `refs/tags/${tag}`,
  ], { capture: true }).stdout.trim();
  if (remote) {
    throw new Error(`remote tag already exists: ${tag}`);
  }
}

function readRemoteReleaseRefs(commandRunner, version) {
  const refs = commandRunner('git', [
    '-c', 'http.proxy=',
    '-c', 'https.proxy=',
    'ls-remote',
    RELEASE_REMOTE,
    `refs/heads/${RELEASE_BRANCH}`,
    `refs/tags/v${version}`,
  ], { capture: true }).stdout;
  return new Map(
    refs.trim().split(/\r?\n/u).filter(Boolean).map((line) => line.split(/\s+/u).reverse()),
  );
}

function repositoryRelativePath(rootDir, filePath) {
  const resolved = path.resolve(rootDir, filePath);
  if (!isPathInside(rootDir, resolved)) {
    throw new Error('release notes must be inside the repository');
  }
  const relative = path.relative(rootDir, resolved).replaceAll('\\', '/');
  if (!relative || relative.startsWith('../') || /^[A-Za-z]:/u.test(relative)) {
    throw new Error('release notes path could not be normalized');
  }
  return relative;
}

function alignVersion({ commandRunner, rootDir, version }) {
  const packageJsonPath = path.join(rootDir, 'package.json');
  const currentVersion = readJson(packageJsonPath).version;
  const comparison = compareReleaseVersions(currentVersion, version);
  if (comparison > 0) {
    throw new Error(`target version ${version} is lower than current version ${currentVersion}`);
  }
  if (comparison < 0) {
    runNpm(commandRunner, ['version', version, '--no-git-tag-version']);
  }
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(path.join(rootDir, 'package-lock.json'));
  if (
    packageJson.version !== version
    || packageLock.version !== version
    || packageLock.packages?.['']?.version !== version
  ) {
    throw new Error('package.json and package-lock.json release versions are not aligned');
  }
}

export function restorePrePublishState(commandRunner, releaseBaseCommit, version) {
  if (!releaseBaseCommit) {
    throw new Error('release base commit was not recorded');
  }
  const head = commandRunner('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim();
  const parent = commandRunner('git', ['rev-parse', 'HEAD^'], { capture: true }).stdout.trim();
  const subject = commandRunner('git', ['show', '-s', '--format=%s', 'HEAD'], {
    capture: true,
  }).stdout.trim();
  if (parent !== releaseBaseCommit || subject !== `release: v${version}`) {
    throw new Error('refusing to reset a commit that was not created by this release run');
  }

  const tag = `v${version}`;
  const tagResult = commandRunner('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], {
    allowExitCodes: [0, 1],
    capture: true,
  });
  if (tagResult.status === 0) {
    const taggedCommit = commandRunner('git', ['rev-parse', tag], { capture: true }).stdout.trim();
    if (taggedCommit !== head) {
      throw new Error(`refusing to delete ${tag} because it does not point to the release commit`);
    }
    commandRunner('git', ['tag', '-d', tag]);
  }
  commandRunner('git', ['reset', '--mixed', releaseBaseCommit]);
}

function verifyLocalArtifacts(rootDir, version) {
  const relativePaths = artifactPaths(version);
  const resolvedPaths = Object.fromEntries(
    Object.entries(relativePaths).map(([key, value]) => [key, path.resolve(rootDir, value)]),
  );
  for (const [key, filePath] of Object.entries(resolvedPaths)) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`release artifact is missing: ${key}`);
    }
  }
  const installerStat = fs.statSync(resolvedPaths.installer);
  const blockmapStat = fs.statSync(resolvedPaths.blockmap);
  const latestStat = fs.statSync(resolvedPaths.latestYml);
  if (!installerStat.isFile() || !blockmapStat.isFile() || !latestStat.isFile()) {
    throw new Error('release artifacts must be regular files');
  }

  const latest = parseLatestYml(fs.readFileSync(resolvedPaths.latestYml, 'utf8'));
  const installerName = path.basename(resolvedPaths.installer);
  if (latest.version !== version || latest.path !== installerName || latest.size !== installerStat.size) {
    throw new Error('latest.yml version, path, or installer size does not match the release artifact');
  }
  const installerSha512 = hashFile(resolvedPaths.installer, 'sha512', 'base64');
  if (latest.sha512 !== installerSha512) {
    throw new Error('latest.yml SHA-512 does not match the installer');
  }

  return {
    assets: [
      assetState(installerName, resolvedPaths.installer, installerStat.size),
      assetState(path.basename(resolvedPaths.blockmap), resolvedPaths.blockmap, blockmapStat.size),
      assetState(path.basename(resolvedPaths.latestYml), resolvedPaths.latestYml, latestStat.size),
    ],
    latestYmlSha256: hashFile(resolvedPaths.latestYml, 'sha256', 'hex'),
    paths: relativePaths,
  };
}

function assetState(name, filePath, size) {
  return { name, filePath, sha256: hashFile(filePath, 'sha256', 'hex'), size };
}

function requireRecoveryState(state) {
  if (!state) {
    throw new Error('release recovery state is not loaded');
  }
  return state;
}

function assertArtifactManifestMatches(localArtifactState, state) {
  if (localArtifactState.latestYmlSha256 !== state.latestYmlSha256) {
    throw new Error('local latest.yml does not match the recorded release state');
  }
  const localByName = new Map(localArtifactState.assets.map((asset) => [asset.name, asset]));
  for (const expected of state.artifacts) {
    const actual = localByName.get(expected.name);
    if (!actual || actual.size !== expected.size || actual.sha256 !== expected.sha256) {
      throw new Error(`local release asset does not match the recorded state: ${expected.name}`);
    }
  }
}

function artifactPathForName(localArtifactState, name) {
  const pathEntry = Object.values(localArtifactState.paths).find((value) => path.basename(value) === name);
  if (!pathEntry) {
    throw new Error(`release asset path is unavailable: ${name}`);
  }
  return pathEntry;
}

function auditWorkingTree({ commandRunner, rootDir, stagedOnly }) {
  const pathOutputs = stagedOnly
    ? [commandRunner('git', ['diff', '--cached', '--name-only', '-z'], { capture: true }).stdout]
    : [
        commandRunner('git', ['diff', '--name-only', '-z'], { capture: true }).stdout,
        commandRunner('git', ['diff', '--cached', '--name-only', '-z'], { capture: true }).stdout,
        commandRunner('git', ['ls-files', '--others', '--exclude-standard', '-z'], { capture: true }).stdout,
      ];
  const changedPaths = [...new Set(pathOutputs.flatMap(splitNull))];
  if (!changedPaths.length) {
    throw new Error('release has no source changes to publish');
  }
  const unsafePaths = findUnsafeReleasePaths(changedPaths);
  if (unsafePaths.length) {
    throw new Error(`release contains forbidden paths: ${unsafePaths.join(', ')}`);
  }

  const diffParts = [];
  if (!stagedOnly) {
    diffParts.push(commandRunner('git', ['diff', '--unified=0', '--no-color'], { capture: true }).stdout);
  }
  diffParts.push(commandRunner('git', ['diff', '--cached', '--unified=0', '--no-color'], { capture: true }).stdout);
  if (!stagedOnly) {
    const untracked = splitNull(
      commandRunner('git', ['ls-files', '--others', '--exclude-standard', '-z'], { capture: true }).stdout,
    );
    for (const relativePath of untracked) {
      const filePath = path.resolve(rootDir, relativePath);
      if (!isPathInside(rootDir, filePath) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        continue;
      }
      const content = readSmallTextFile(filePath);
      if (content !== null) {
        diffParts.push(`+++ b/${relativePath.replaceAll('\\', '/')}\n${content.split(/\r?\n/u).map((line) => `+${line}`).join('\n')}`);
      }
    }
  }
  const findings = findSensitiveAdditions(diffParts.join('\n'));
  if (findings.length) {
    const locations = findings.map((finding) => `${finding.category}:${finding.file}`);
    throw new Error(`release contains sensitive additions: ${locations.join(', ')}`);
  }

  commandRunner('git', stagedOnly ? ['diff', '--cached', '--check'] : ['diff', '--check']);
  if (!stagedOnly) {
    commandRunner('git', ['diff', '--cached', '--check']);
  }
}

export function assertGitHubPublicationReady(commandRunner, githubEnvironment, version) {
  assertGitHubCredentialsReady(commandRunner, githubEnvironment);
  const existingTag = commandRunner('gh', [
    'api',
    'graphql',
    '-f',
    'query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){tagName}}}',
    '-f',
    'owner=gouyu-hou',
    '-f',
    'name=CodexBridge-Weixin',
    '-f',
    `tag=v${version}`,
    '--jq',
    '.data.repository.release.tagName // ""',
  ], { capture: true, env: githubEnvironment }).stdout.trim();
  if (existingTag) {
    throw new Error(`GitHub Release already exists: v${version}`);
  }
}

export function assertGitHubCredentialsReady(commandRunner, githubEnvironment) {
  const identity = commandRunner('gh', ['api', 'user', '--jq', '.login'], {
    capture: true,
    env: githubEnvironment,
  }).stdout.trim();
  if (!identity) {
    throw new Error('GitHub credentials did not return an authenticated user');
  }
  const permission = commandRunner('gh', [
    'api',
    `repos/${GITHUB_REPOSITORY}`,
    '--jq',
    '.permissions.push',
  ], { capture: true, env: githubEnvironment }).stdout.trim();
  if (permission !== 'true') {
    throw new Error(`GitHub credentials cannot publish ${GITHUB_REPOSITORY}`);
  }
}

function resolveGitHubEnvironment(commandRunner, environment) {
  const inherited = { ...environment };
  if (inherited.GH_TOKEN || inherited.GITHUB_TOKEN) {
    return inherited;
  }
  const credential = commandRunner('git', ['credential', 'fill'], {
    capture: true,
    input: 'protocol=https\nhost=github.com\n\n',
  }).stdout;
  const tokenLine = credential.split(/\r?\n/u).find((line) => line.startsWith('password='));
  if (!tokenLine) {
    return inherited;
  }
  return { ...inherited, GH_TOKEN: tokenLine.slice('password='.length) };
}

function readRemoteReleaseSnapshot(commandRunner, githubEnvironment, version) {
  const presence = commandRunner('gh', [
    'api',
    'graphql',
    '-f',
    'query=query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){release(tagName:$tag){tagName}}}',
    '-f',
    'owner=gouyu-hou',
    '-f',
    'name=CodexBridge-Weixin',
    '-f',
    `tag=v${version}`,
    '--jq',
    '.data.repository.release.tagName // ""',
  ], { capture: true, env: githubEnvironment }).stdout.trim();
  if (!presence) {
    return null;
  }
  const result = commandRunner('gh', [
    'release',
    'view',
    `v${version}`,
    '--repo',
    GITHUB_REPOSITORY,
    '--json',
    'tagName,isDraft,isPrerelease,url,assets,body',
  ], { capture: true, env: githubEnvironment });
  return JSON.parse(result.stdout);
}

async function verifyDraftRelease({
  commandRunner,
  githubEnvironment,
  localArtifactState,
  releaseNotes,
  rootDir,
  version,
}) {
  const expectedCommit = commandRunner('git', ['rev-parse', 'HEAD'], { capture: true }).stdout.trim();
  const refs = commandRunner('git', [
    '-c', 'http.proxy=',
    '-c', 'https.proxy=',
    'ls-remote',
    RELEASE_REMOTE,
    `refs/heads/${RELEASE_BRANCH}`,
    `refs/tags/v${version}`,
  ], { capture: true }).stdout;
  const remoteRefs = new Map(
    refs.trim().split(/\r?\n/u).filter(Boolean).map((line) => line.split(/\s+/u).reverse()),
  );
  if (
    remoteRefs.get(`refs/heads/${RELEASE_BRANCH}`) !== expectedCommit
    || remoteRefs.get(`refs/tags/v${version}`) !== expectedCommit
  ) {
    throw new Error('remote main or release tag does not match the local release commit');
  }

  const releaseResult = commandRunner('gh', [
    'release',
    'view',
    `v${version}`,
    '--repo',
    GITHUB_REPOSITORY,
    '--json',
    'tagName,isDraft,isPrerelease,url,assets,body',
  ], { capture: true, env: githubEnvironment });
  const release = JSON.parse(releaseResult.stdout);
  validateRemoteReleaseMetadata(release, {
    expectedDraft: true,
    notes: releaseNotes,
    version,
  });
  if (!Array.isArray(release.assets) || release.assets.length !== localArtifactState.assets.length) {
    throw new Error('GitHub draft asset count does not match the local release');
  }
  for (const localAsset of localArtifactState.assets) {
    const remoteAssets = release.assets.filter((asset) => asset.name === localAsset.name);
    if (
      remoteAssets.length !== 1
      || remoteAssets[0].state !== 'uploaded'
      || remoteAssets[0].size !== localAsset.size
      || remoteAssets[0].digest !== `sha256:${localAsset.sha256}`
    ) {
      throw new Error(`GitHub Release asset verification failed: ${localAsset.name}`);
    }
  }

  const tempRoot = path.resolve(os.tmpdir());
  const downloadDir = await fsp.mkdtemp(path.join(tempRoot, 'codexbridge-release-verify-'));
  try {
    if (!isPathInside(tempRoot, downloadDir)) {
      throw new Error('remote verification directory escaped the system temp root');
    }
    commandRunner('gh', [
      'release',
      'download',
      `v${version}`,
      '--repo',
      GITHUB_REPOSITORY,
      '--pattern',
      'latest.yml',
      '--dir',
      downloadDir,
    ], { env: githubEnvironment });
    const downloadedLatest = path.join(downloadDir, 'latest.yml');
    if (hashFile(downloadedLatest, 'sha256', 'hex') !== localArtifactState.latestYmlSha256) {
      throw new Error('downloaded latest.yml does not match the local update metadata');
    }
  } finally {
    if (!isPathInside(tempRoot, downloadDir)) {
      throw new Error('refusing to remove remote verification data outside the system temp root');
    }
    await fsp.rm(downloadDir, { recursive: true, force: true });
  }

  const status = commandRunner('git', ['status', '--porcelain'], { capture: true }).stdout.trim();
  if (status) {
    throw new Error('local worktree is not clean before draft publication');
  }
  return { releaseUrl: release.url };
}

function verifyFinalRelease({
  commandRunner,
  githubEnvironment,
  releaseNotes,
  version,
}) {
  const result = commandRunner('gh', [
    'release',
    'view',
    `v${version}`,
    '--repo',
    GITHUB_REPOSITORY,
    '--json',
    'tagName,isDraft,isPrerelease,url,body',
  ], { capture: true, env: githubEnvironment });
  const release = JSON.parse(result.stdout);
  validateRemoteReleaseMetadata(release, {
    expectedDraft: false,
    notes: releaseNotes,
    version,
  });
  return { releaseUrl: release.url };
}

export function validateRemoteReleaseMetadata(release, {
  expectedDraft,
  notes,
  version,
}) {
  if (
    release?.tagName !== `v${version}`
    || release?.isPrerelease !== false
  ) {
    throw new Error('GitHub Release metadata does not match the target release');
  }
  if (release.isDraft !== expectedDraft) {
    throw new Error('GitHub Release draft state does not match the expected publication stage');
  }
  if (normalizeReleaseNotes(release.body) !== normalizeReleaseNotes(notes)) {
    throw new Error('GitHub Release body does not match the local UTF-8 release notes');
  }
}

function clearRecoveryState(commandRunner, rootDir) {
  const filePath = recoveryStatePath(commandRunner, rootDir);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

export function assertNoRecoveryState(commandRunner, rootDir) {
  const filePath = recoveryStatePath(commandRunner, rootDir);
  if (fs.existsSync(filePath)) {
    throw new Error(
      'unresolved release recovery state exists; inspect and remove it before a new release',
    );
  }
}

function recoveryStatePath(commandRunner, rootDir) {
  const gitDirOutput = commandRunner('git', ['rev-parse', '--git-dir'], { capture: true }).stdout.trim();
  const gitDir = path.resolve(rootDir, gitDirOutput);
  const filePath = path.join(gitDir, 'codexbridge-release-recovery.json');
  if (!isPathInside(gitDir, filePath)) {
    throw new Error('release recovery state escaped the Git metadata directory');
  }
  return filePath;
}

function createCommandRunner(rootDir) {
  /**
   * @param {string} command
   * @param {string[]} args
   * @param {{
   *   allowExitCodes?: number[],
   *   capture?: boolean,
   *   env?: NodeJS.ProcessEnv,
   *   input?: string,
   * }} [options]
   */
  return (command, args, options = {}) => {
    const {
      allowExitCodes = [0],
      capture = false,
      env = process.env,
      input,
    } = options;
    const result = spawnSync(command, args, {
      cwd: rootDir,
      encoding: 'utf8',
      env,
      input,
      maxBuffer: 64 * 1024 * 1024,
      stdio: capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    });
    if (result.error) {
      const errorCode = 'code' in result.error ? result.error.code : result.error.message;
      throw new Error(`failed to start release command: ${command} (${errorCode})`);
    }
    const status = typeof result.status === 'number' ? result.status : 1;
    if (!allowExitCodes.includes(status)) {
      throw new Error(`release command failed: ${command} (exit ${status})`);
    }
    return {
      status,
      stderr: capture ? result.stderr || '' : '',
      stdout: capture ? result.stdout || '' : '',
    };
  };
}

function parseVersionParts(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error(`invalid release version: ${version}`);
  }
  return version.split('.').map((part) => Number.parseInt(part, 10));
}

function matchMetadata(text, pattern) {
  return pattern.exec(String(text))?.[1] ?? '';
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readSmallTextFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) {
    return null;
  }
  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }
  return buffer.toString('utf8');
}

function splitNull(value) {
  return String(value).split('\0').filter(Boolean);
}

function splitLines(value) {
  return String(value).split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function hashFile(filePath, algorithm, encoding) {
  return createHash(algorithm).update(fs.readFileSync(filePath)).digest(encoding);
}

function runNpm(commandRunner, args) {
  const invocation = buildNpmInvocation(args);
  return commandRunner(invocation.command, invocation.args);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    const options = parseReleaseArgs(process.argv.slice(2));
    if (!('mode' in options)) {
      process.stdout.write(releaseHelpText);
    } else {
      await runRelease(options);
      process.stdout.write(
        options.mode === 'dry-run'
          ? `Release dry-run v${options.version} completed without publication.\n`
          : `Release v${options.version} published and verified.\n`,
      );
    }
  } catch (error) {
    process.stderr.write(`Release failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
