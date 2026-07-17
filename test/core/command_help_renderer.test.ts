import assert from 'node:assert/strict';
import test from 'node:test';
import {
  freezeCommandHelp,
  renderCommandCatalog,
  renderCommandHelp,
} from '../../src/core/command_help_renderer.js';
import { createI18n } from '../../src/i18n/index.js';

const i18n = createI18n('en');

test('command help renderer freezes specs and renders catalog and detail views', () => {
  const spec = freezeCommandHelp({
    name: 'status',
    aliases: ['where'],
    summary: 'show status',
    usage: ['/status'],
    examples: ['/status'],
    notes: ['details are available'],
  });

  assert.equal(Object.isFrozen(spec), true);
  assert.equal(Object.isFrozen(spec.aliases), true);
  assert.match(renderCommandHelp(spec, i18n), /status/u);
  assert.match(renderCommandCatalog(i18n, ['status'], { status: spec }), /status/u);
});
