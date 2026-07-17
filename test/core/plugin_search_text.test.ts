import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildPluginSearchTokens,
  normalizePluginLookupToken,
  scorePluginTokenAgainstField,
} from '../../src/core/plugin_search_text.js';

test('plugin search text normalization expands aliases and tolerates fuzzy fields', () => {
  assert.equal(normalizePluginLookupToken(' Google_Drive / Docs '), 'google drive docs');
  assert.ok(buildPluginSearchTokens('todo', [['todo', 'task', 'checklist']]).includes('checklist'));
  assert.ok(scorePluginTokenAgainstField('repo', 'repository') > 0);
});
