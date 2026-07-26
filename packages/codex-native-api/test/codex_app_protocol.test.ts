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

test('parity: boxed primitives coerce through String/Number like current clients', () => {
  assert.equal(normalizeNullableString(new String('  boxed  ')), 'boxed');
  assert.equal(normalizeNullableString(new Number(42)), '42');
  assert.deepEqual(normalizeStringList([new String(' one '), new Number(2)]), ['one', '2']);
  assert.equal(normalizeOptionalBoolean(new Boolean(true)), null);
  assert.equal(normalizeProtocolTimestamp(new Number(1_700_000_000)), 1_700_000_000_000);
  assert.equal(normalizeTurnStatusKey(new String(' Turn_Done ')), 'turndone');
});

test('parity: whitespace-only inputs collapse to empty results everywhere', () => {
  assert.equal(normalizeNullableString('\t\n  '), null);
  assert.deepEqual(normalizeStringList(['   ', '\t', '\n']), []);
  assert.deepEqual(normalizeFeatureList(['   ', '\t\n']), []);
  assert.equal(normalizeTurnStatusKey('  \t '), '');
  assert.equal(formatConfigKeyPath(['  ']), '""');
});

test('parity: feature deduplication keeps first occurrence order with unicode names', () => {
  assert.deepEqual(
    normalizeFeatureList(['深度检索', ' 深度检索 ', 'apps', '深度检索', 42 as unknown as string]),
    ['深度检索', 'apps'],
  );
});

test('parity: timestamps below the seconds threshold scale to milliseconds', () => {
  assert.equal(normalizeProtocolTimestamp(0.5), 500);
  assert.equal(normalizeProtocolTimestamp(999.5), 999_500);
  assert.equal(normalizeProtocolTimestamp(9_999_999_999), 9_999_999_999_000);
  assert.equal(normalizeProtocolTimestamp(10_000_000_000), 10_000_000_000);
  assert.equal(normalizeProtocolTimestamp('1700000000'), 1_700_000_000_000);
  assert.equal(normalizeProtocolTimestamp(true), 1000);
  assert.equal(normalizeProtocolTimestamp(Number.NaN), 0);
  assert.equal(normalizeProtocolTimestamp(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeProtocolTimestamp('not-a-number'), 0);
});

test('parity: unicode and mixed config segments quote exactly like current clients', () => {
  assert.equal(formatConfigKeyPath(['模型', 'fast_mode']), '"模型".fast_mode');
  assert.equal(formatConfigKeyPath(['a b', 'c.d']), '"a b"."c.d"');
  assert.equal(formatConfigKeyPath([' padded ', 'ok_1']), 'padded.ok_1');
  assert.equal(formatConfigKeyPath([]), '');
});
