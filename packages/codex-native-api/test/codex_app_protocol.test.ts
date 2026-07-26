import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatConfigKeyPath,
  normalizeFeatureList,
  normalizeNullableString,
  normalizeOptionalBoolean,
  normalizeProtocolTimestamp,
  normalizeStringList,
  normalizeTurnStatusKey,
} from '../src/codex_app_protocol.js';

test('protocol string and boolean normalization preserves current client behavior', () => {
  assert.equal(normalizeNullableString('  value  '), 'value');
  assert.equal(normalizeNullableString('   '), null);
  assert.equal(normalizeNullableString(null), null);
  assert.deepEqual(normalizeStringList([' one ', '', null, 2]), ['one', '2']);
  assert.deepEqual(normalizeStringList('one'), []);
  assert.equal(normalizeOptionalBoolean(true), true);
  assert.equal(normalizeOptionalBoolean(false), false);
  assert.equal(normalizeOptionalBoolean(1), null);
});

test('formatConfigKeyPath quotes and escapes non-identifier segments', () => {
  assert.equal(formatConfigKeyPath(['features', 'fast_mode']), 'features.fast_mode');
  assert.equal(
    formatConfigKeyPath(['profiles', 'a.b', 'say"hello', 'c\\d']),
    'profiles."a.b"."say\\"hello"."c\\\\d"',
  );
});

test('normalizeFeatureList trims and stably deduplicates feature names', () => {
  assert.deepEqual(
    normalizeFeatureList([' fast ', '', 'fast', 'apps', ' fast ']),
    ['fast', 'apps'],
  );
});

test('normalizeProtocolTimestamp accepts seconds and milliseconds', () => {
  assert.equal(normalizeProtocolTimestamp(null), 0);
  assert.equal(normalizeProtocolTimestamp(-1), 0);
  assert.equal(normalizeProtocolTimestamp(1_700_000_000), 1_700_000_000_000);
  assert.equal(normalizeProtocolTimestamp(1_700_000_000_000), 1_700_000_000_000);
});

test('normalizeTurnStatusKey ignores separators and casing', () => {
  assert.equal(normalizeTurnStatusKey(' In_Progress '), 'inprogress');
  assert.equal(normalizeTurnStatusKey('TURN-COMPLETED'), 'turncompleted');
  assert.equal(normalizeTurnStatusKey(null), '');
});
