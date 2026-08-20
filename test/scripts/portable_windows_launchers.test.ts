import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../..');

function readLauncher(name: string) {
  return fs.readFileSync(path.join(repositoryRoot, name), 'utf8');
}

const launchers = [
  ['start-weixin-login.cmd', readLauncher('start-weixin-login.cmd')],
  ['start-weixin-serve.cmd', readLauncher('start-weixin-serve.cmd')],
] as const;

test('Windows launchers do not embed machine-specific paths', () => {
  for (const [name, content] of launchers) {
    assert.doesNotMatch(content, /cully/iu, name);
    assert.doesNotMatch(content, /C:\\Users\\/iu, name);
    assert.doesNotMatch(content, /set\s+"CODEX_REAL_BIN=/iu, name);
  }
});

test('Windows launchers preserve overrides and resolve a portable cwd', () => {
  for (const [name, content] of launchers) {
    assert.match(
      content,
      /if not defined CODEX_APP_SERVER_TRANSPORT set "CODEX_APP_SERVER_TRANSPORT=stdio"/iu,
      name,
    );
    assert.match(
      content,
      /if not defined CODEXBRIDGE_LOCALE set "CODEXBRIDGE_LOCALE=zh-CN"/iu,
      name,
    );
    assert.match(
      content,
      /if not defined CODEXBRIDGE_DEFAULT_CWD if defined USERPROFILE if exist "%USERPROFILE%\\Documents\\" set "CODEXBRIDGE_DEFAULT_CWD=%USERPROFILE%\\Documents"/iu,
      name,
    );
    assert.match(
      content,
      /if not defined CODEXBRIDGE_DEFAULT_CWD set "CODEXBRIDGE_DEFAULT_CWD=%CD%"/iu,
      name,
    );
  }

  assert.match(launchers[0][1], /npm run weixin:login -- --timeout-sec 480/iu);
  assert.match(
    launchers[1][1],
    /npm run weixin:serve -- --cwd "%CODEXBRIDGE_DEFAULT_CWD%"/iu,
  );
});
