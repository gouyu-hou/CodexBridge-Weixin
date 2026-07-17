import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COMMAND_ALIAS_DEFINITIONS,
  COMMAND_CANONICAL_NAME_MAP,
  COMMAND_HELP_ORDER,
} from '../../src/core/command_catalog.js';

test('command catalog keeps help order and canonical aliases in one module', () => {
  assert.equal(COMMAND_HELP_ORDER[0], 'helps');
  assert.ok(COMMAND_HELP_ORDER.includes('goal'));
  assert.equal(COMMAND_ALIAS_DEFINITIONS.helps[0], 'help');
  assert.equal(COMMAND_CANONICAL_NAME_MAP.get('help'), 'helps');
  assert.equal(COMMAND_CANONICAL_NAME_MAP.get('m'), 'model');
  assert.equal(COMMAND_CANONICAL_NAME_MAP.get('interrupt'), 'stop');
});
