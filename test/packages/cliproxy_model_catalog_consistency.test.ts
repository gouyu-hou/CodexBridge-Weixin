import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLIPROXY_COMPAT_MODEL_CATALOG as gatewayCatalog,
  buildCliproxyModelCapabilitiesForEntry as buildGatewayCapabilities,
} from '../../packages/codex-gateway/src/index.js';
import {
  CLIPROXY_COMPAT_MODEL_CATALOG as relayCatalog,
  buildCliproxyModelCapabilitiesForEntry as buildRelayCapabilities,
} from '../../packages/codex-provider-relay/src/index.js';

test('Gateway and Provider Relay keep the Cliproxy model catalog in sync', () => {
  assert.deepEqual(relayCatalog, gatewayCatalog);

  for (const entry of gatewayCatalog) {
    assert.deepEqual(
      buildRelayCapabilities(entry),
      buildGatewayCapabilities(entry),
      `capabilities drifted for ${entry.category}/${entry.id}`,
    );
  }
});
