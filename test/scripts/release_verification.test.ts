import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('release verification covers the root project and every packaged workspace', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const command = packageJson.scripts?.['verify:release'] ?? '';
  const requiredScripts = [
    'typecheck',
    'typecheck:js',
    'test',
    'build',
    'codex-gateway:check-boundary',
    'codex-gateway:typecheck',
    'codex-gateway:test',
    'codex-gateway:build',
    'codex-provider-relay:check-boundary',
    'codex-provider-relay:typecheck',
    'codex-provider-relay:test',
    'codex-provider-relay:build',
    'codex-native-api:check-boundary',
    'codex-native-api:typecheck',
    'codex-native-api:test',
    'codex-native-api:build',
    'mission-control:check-boundary',
    'mission-control:typecheck',
    'mission-control:test',
    'mission-control:build',
  ];

  assert.ok(command, 'verify:release script must exist');
  for (const script of requiredScripts) {
    assert.match(command, new RegExp(`npm run ${escapeRegExp(script)}(?:\\s|$)`, 'u'));
  }
  assert.match(command, /git diff --check/u);
});

test('release automation is exposed through the canonical npm command', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };

  assert.equal(
    packageJson.scripts?.release,
    'node scripts/release/release.mjs',
  );
});

test('release JavaScript is covered by the JavaScript typecheck project', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.checkjs.json'), 'utf8'),
  ) as { include?: string[] };

  assert.ok(config.include?.includes('scripts/release/*.mjs'));
});

test('lightweight update security is part of release typechecking and key handling is documented', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'tsconfig.checkjs.json'), 'utf8'),
  ) as { include?: string[] };
  const releaseDocs = fs.readFileSync(
    path.join(process.cwd(), 'docs', 'RELEASE_PROCESS.md'),
    'utf8',
  );
  const keyDocsPath = path.join(process.cwd(), 'assets', 'update', 'README.md');

  assert.ok(
    config.include?.includes('scripts/electron/lightweight-update-security.cjs'),
  );
  assert.ok(
    config.include?.includes('scripts/electron/lightweight-update-history.cjs'),
  );
  assert.match(releaseDocs, /CODEXBRIDGE_LIGHTWEIGHT_SIGNING_PRIVATE_KEY_FILE/u);
  assert.match(releaseDocs, /CODEXBRIDGE_LIGHTWEIGHT_BASE_APP_VERSION/u);
  assert.match(releaseDocs, /CODEXBRIDGE_LIGHTWEIGHT_UPDATE_PUBLIC_KEYS/u);
  assert.match(releaseDocs, /history\.json/u);
  assert.match(releaseDocs, /openssl genpkey -algorithm ED25519/u);
  assert.match(releaseDocs, /私钥[^。\n]*(?:不得|不能|禁止)[^。\n]*Git/u);
  assert.match(releaseDocs, /无效签名|未签名/u);
  assert.match(releaseDocs, /完整安装包/u);
  assert.ok(fs.existsSync(keyDocsPath));
  assert.match(fs.readFileSync(keyDocsPath, 'utf8'), /public key|公钥/iu);
});

test('CI runs the complete validation gate and Windows package smoke without publishing', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );

  assert.match(workflow, /npm ci/u);
  assert.match(workflow, /^\s*uses:\s*actions\/checkout@v7\s*$/mu);
  assert.doesNotMatch(workflow, /^\s*uses:\s*actions\/checkout@(?!v7\s*$)\S+\s*$/mu);
  assert.match(workflow, /^\s*uses:\s*actions\/setup-node@v7\s*$/mu);
  assert.doesNotMatch(workflow, /^\s*uses:\s*actions\/setup-node@(?!v7\s*$)\S+\s*$/mu);
  assert.match(workflow, /npm run verify:release/u);
  assert.match(workflow, /runner\.os\s*==\s*['"]Windows['"]/u);
  assert.match(workflow, /npm run weixin:electron:dist/u);
  assert.match(workflow, /node scripts\/release\/smoke_packaged\.mjs/u);
  assert.match(workflow, /timeout-minutes:\s*45/u);
  assert.doesNotMatch(workflow, /--publish|git push|gh release (?:create|edit)/u);
});

test('Electron build scripts keep CI packaging separate from GitHub publishing', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const distCommand = packageJson.scripts?.['weixin:electron:dist'] ?? '';
  const publishCommand = packageJson.scripts?.['weixin:electron:publish'] ?? '';

  assert.match(distCommand, /--publish never/u);
  assert.match(publishCommand, /--publish always/u);
});

test('CI audits production dependencies against the official npm advisory service', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  const auditCommand = packageJson.scripts?.['audit:prod'] ?? '';

  assert.match(auditCommand, /npm audit --omit=dev --audit-level=high/u);
  assert.match(auditCommand, /--registry=https:\/\/registry\.npmjs\.org/u);
  assert.match(workflow, /npm run audit:prod/u);
});

test('the retired Web console stays outside the active product and release surface', () => {
  const workflow = fs.readFileSync(
    path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
    'utf8',
  );
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  ) as { scripts?: Record<string, string> };
  const dependabot = fs.readFileSync(
    path.join(process.cwd(), '.github', 'dependabot.yml'),
    'utf8',
  );
  const releaseDocs = fs.readFileSync(
    path.join(process.cwd(), 'docs', 'RELEASE_PROCESS.md'),
    'utf8',
  );

  assert.equal(fs.existsSync(path.join(process.cwd(), 'apps', 'web')), false);
  assert.deepEqual(
    Object.keys(rootPackage.scripts ?? {}).filter((name) => name.startsWith('web:')),
    [],
  );
  assert.doesNotMatch(rootPackage.scripts?.['verify:release'] ?? '', /web:verify/u);
  assert.doesNotMatch(workflow, /apps\/web|Web console/iu);
  assert.doesNotMatch(dependabot, /\/apps\/web|deps\(web\)/u);
  assert.doesNotMatch(releaseDocs, /apps\/web|Web 控制台|web:verify/iu);
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
