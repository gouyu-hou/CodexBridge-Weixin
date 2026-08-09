import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as packagedSmoke from '../../scripts/release/smoke_packaged.mjs';

const require = createRequire(import.meta.url);

type RuntimeLayout = {
  appRoot: string;
  builtInRuntimeRoot: string;
  dependencyRoot: string;
};

type RuntimeLayoutModule = {
  resolveElectronRuntimeLayout: (input: {
    appRoot: string;
    isPackaged: boolean;
    resourcesPath: string;
  }) => RuntimeLayout;
};

type RuntimeStageModule = {
  collectProductionPackagePaths: (packageLock: {
    packages?: Record<string, { dev?: boolean }>;
  }) => string[];
  shouldCopyRuntimePath: (relativePath: string) => boolean;
};

type PackagedSmokeModule = typeof packagedSmoke & {
  assertPackagedRuntimeBoundary: (rootDir: string) => void;
  fetchPackagedAdminAssets?: (
    fetchFn: typeof fetch,
    baseUrl: string,
  ) => Promise<{ scriptStatus: number; styleStatus: number } | null>;
};

test('release and Electron staging rebuild and check Weixin admin browser assets', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.match(
    packageJson.scripts?.['verify:release'] || '',
    /^npm run weixin:admin:build && npm run weixin:admin:typecheck && npm run typecheck/u,
  );
  assert.equal(
    packageJson.scripts?.['weixin:electron:prepare-runtime'],
    'npm run weixin:admin:build && node scripts/electron/prepare-windows-runtime.cjs',
  );
});

test('Electron build stores the staged service runtime outside ASAR', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as {
    build?: {
      asar?: boolean;
      files?: string[];
      extraResources?: Array<{ from?: string; to?: string }>;
    };
  };

  assert.equal(packageJson.build?.asar, true);
  for (const excludedRuntimeDependency of [
    '!node_modules/@openai/codex-win32-x64/**/*',
    '!node_modules/@esbuild/win32-x64/**/*',
    '!node_modules/ffmpeg-static/**/*',
    '!node_modules/ffprobe-static/**/*',
  ]) {
    assert.ok(packageJson.build?.files?.includes(excludedRuntimeDependency));
  }
  assert.ok(packageJson.build?.extraResources?.some((entry) => (
    entry.from === 'build/runtime/app' && entry.to === 'runtime-app'
  )));
});

test('Electron runtime layout separates packaged sources and dependencies', () => {
  const { resolveElectronRuntimeLayout } = require(
    '../../scripts/electron/runtime-layout.cjs',
  ) as RuntimeLayoutModule;
  const appRoot = path.resolve('release/win-unpacked/resources/app.asar');
  const resourcesPath = path.dirname(appRoot);

  assert.deepEqual(resolveElectronRuntimeLayout({
    appRoot,
    isPackaged: true,
    resourcesPath,
  }), {
    appRoot,
    builtInRuntimeRoot: path.join(resourcesPath, 'runtime-app'),
    dependencyRoot: path.join(resourcesPath, 'runtime-app'),
  });
});

test('runtime staging keeps only package paths inside node_modules', () => {
  const { collectProductionPackagePaths } = require(
    '../../scripts/electron/runtime-stage.cjs',
  ) as RuntimeStageModule;
  assert.deepEqual(collectProductionPackagePaths({
    packages: {
      '': {},
      'node_modules/zod': {},
      'node_modules/typescript': { dev: true },
      'node_modules/parent/node_modules/child': {},
      '../outside/package': {},
    },
  }), [
    path.join('node_modules', 'parent', 'node_modules', 'child'),
    path.join('node_modules', 'zod'),
  ]);
});

test('runtime staging excludes incompatible native package variants', () => {
  const { shouldCopyRuntimePath } = require(
    '../../scripts/electron/runtime-stage.cjs',
  ) as RuntimeStageModule;

  assert.equal(shouldCopyRuntimePath('node_modules/@openai/codex-win32-x64/bin.exe'), true);
  assert.equal(shouldCopyRuntimePath('node_modules/@openai/codex-linux-x64/bin'), false);
  assert.equal(shouldCopyRuntimePath('node_modules/@esbuild/win32-x64/esbuild.exe'), true);
  assert.equal(shouldCopyRuntimePath('node_modules/@esbuild/darwin-arm64/bin/esbuild'), false);
  assert.equal(shouldCopyRuntimePath('node_modules/fsevents/fsevents.js'), false);
  assert.equal(shouldCopyRuntimePath('node_modules/ffprobe-static/bin/linux/x64/ffprobe'), false);
  assert.equal(shouldCopyRuntimePath('node_modules/ffprobe-static/bin/win32/x64/ffprobe.exe'), true);
});

test('Electron runtime layout preserves the repository roots in development', () => {
  const { resolveElectronRuntimeLayout } = require(
    '../../scripts/electron/runtime-layout.cjs',
  ) as RuntimeLayoutModule;
  const appRoot = path.resolve('.');

  assert.deepEqual(resolveElectronRuntimeLayout({
    appRoot,
    isPackaged: false,
    resourcesPath: path.resolve('release/win-unpacked/resources'),
  }), {
    appRoot,
    builtInRuntimeRoot: appRoot,
    dependencyRoot: appRoot,
  });
});

test('Electron main keeps UI assets in ASAR and passes external service roots explicitly', () => {
  const mainSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'electron', 'weixin-admin-main.cjs'),
    'utf8',
  );

  assert.match(mainSource, /resolveElectronRuntimeLayout/u);
  assert.match(mainSource, /iconPath\s*=\s*path\.join\(APP_ROOT,/u);
  assert.match(mainSource, /preloadPath\s*=\s*path\.join\(APP_ROOT,/u);
  assert.match(mainSource, /['"]--base-root-dir['"],\s*BUILTIN_RUNTIME_ROOT/u);
  assert.match(mainSource, /['"]--dependency-root-dir['"],\s*DEPENDENCY_ROOT/u);
  assert.match(mainSource, /path\.join\(DEPENDENCY_ROOT,\s*['"]node_modules['"]\)/u);
});

test('service runner resolves tsx and NODE_PATH from the explicit dependency root', () => {
  const runnerSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'service', 'run-weixin-service.mjs'),
    'utf8',
  );

  assert.match(runnerSource, /const dependencyRootDir\s*=\s*path\.resolve/u);
  assert.match(runnerSource, /args\.dependencyRootDir/u);
  assert.match(
    runnerSource,
    /path\.join\(dependencyRootDir,\s*['"]node_modules['"],\s*['"]tsx['"],\s*['"]dist['"],\s*['"]loader\.mjs['"]\)/u,
  );
  assert.match(runnerSource, /CODEXBRIDGE_DEPENDENCY_ROOT/u);
});

test('packaged smoke preflight reports incomplete ASAR runtime boundaries', () => {
  const { assertPackagedRuntimeBoundary } = packagedSmoke as PackagedSmokeModule;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codexbridge-asar-boundary-'));
  try {
    assert.throws(
      () => assertPackagedRuntimeBoundary(tempRoot),
      /app\.asar/u,
    );

    const resourcesDir = path.join(tempRoot, 'release', 'win-unpacked', 'resources');
    const expectedFiles = [
      'app.asar',
      path.join('runtime', 'node', 'node.exe'),
      path.join('runtime-app', 'scripts', 'service', 'run-weixin-service.mjs'),
      path.join('runtime-app', 'src', 'cli.ts'),
      path.join('runtime-app', 'node_modules', 'tsx', 'dist', 'loader.mjs'),
    ];
    for (const relativePath of expectedFiles) {
      const target = path.join(resourcesDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'test', 'utf8');
    }

    assert.throws(
      () => assertPackagedRuntimeBoundary(tempRoot),
      /weixin admin asset|admin\.css|admin\.js/iu,
    );

    for (const relativePath of [
      path.join('runtime-app', 'assets', 'weixin-admin', 'admin.css'),
      path.join('runtime-app', 'assets', 'weixin-admin', 'admin.js'),
    ]) {
      const target = path.join(resourcesDir, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'test', 'utf8');
    }

    assert.doesNotThrow(() => assertPackagedRuntimeBoundary(tempRoot));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('packaged smoke launches Electron in app mode even under Node-mode shells', () => {
  const smokeSource = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'release', 'smoke_packaged.mjs'),
    'utf8',
  );

  assert.match(smokeSource, /ELECTRON_RUN_AS_NODE:\s*_electronRunAsNode/u);
  assert.match(smokeSource, /NODE_OPTIONS:\s*_nodeOptions/u);
  assert.match(smokeSource, /\.\.\.inheritedEnv/u);
  assert.doesNotMatch(smokeSource, /\.\.\.process\.env/u);
});

test('packaged smoke loads and validates both Weixin admin assets', async () => {
  const { fetchPackagedAdminAssets } = packagedSmoke as PackagedSmokeModule;
  assert.equal(typeof fetchPackagedAdminAssets, 'function');

  const requestedUrls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith('/admin/admin.css')) {
      return new Response('.provider-usage-toolbar {}', {
        headers: { 'content-type': 'text/css; charset=utf-8' },
      });
    }
    return new Response('function loadProviderUsage() {}', {
      headers: { 'content-type': 'text/javascript; charset=utf-8' },
    });
  }) as typeof fetch;

  assert.deepEqual(
    await fetchPackagedAdminAssets!(fetchFn, 'http://127.0.0.1:19291'),
    { scriptStatus: 200, styleStatus: 200 },
  );
  assert.deepEqual(requestedUrls, [
    'http://127.0.0.1:19291/admin/admin.css',
    'http://127.0.0.1:19291/admin/admin.js',
  ]);

  const invalidFetch = (async () => new Response('wrong body', {
    headers: { 'content-type': 'text/plain' },
  })) as typeof fetch;
  assert.equal(
    await fetchPackagedAdminAssets!(invalidFetch, 'http://127.0.0.1:19291'),
    null,
  );
});

test('Electron runtime boundary scripts are covered by JavaScript typechecking', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.checkjs.json'), 'utf8'),
  ) as { include?: string[] };
  for (const script of [
    'scripts/electron/runtime-layout.cjs',
    'scripts/electron/runtime-stage.cjs',
    'scripts/electron/prepare-windows-runtime.cjs',
    'scripts/service/run-weixin-service.mjs',
  ]) {
    assert.ok(config.include?.includes(script), script);
  }
});
