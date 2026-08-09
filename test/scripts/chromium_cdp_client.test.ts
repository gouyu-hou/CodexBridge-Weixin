import assert from 'node:assert/strict';
import test from 'node:test';
import { WebSocketServer } from 'ws';

type CdpClient = {
  close: () => Promise<void>;
  evaluate: (expression: string) => Promise<unknown>;
};

async function createServer(
  onMessage: (socket: any, message: Record<string, any>) => void,
) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => server.once('listening', resolve));
  server.on('connection', (socket) => {
    socket.on('message', (data: Buffer) => {
      onMessage(socket, JSON.parse(data.toString('utf8')));
    });
  });
  const address = server.address();
  assert.equal(typeof address, 'object');
  return {
    endpointUrl: `ws://127.0.0.1:${address!.port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function loadClient(): Promise<{
  connectCdp: (options: { endpointUrl: string; timeoutMs: number }) => Promise<CdpClient>;
}> {
  return import('../../scripts/release/chromium-cdp-client.mjs');
}

test('CDP client routes out-of-order command results by request id', async () => {
  const { connectCdp } = await loadClient();
  const requests: Array<{ id: number; expression: string }> = [];
  const server = await createServer((socket, message) => {
    requests.push({ id: message.id, expression: message.params.expression });
    if (requests.length !== 2) return;
    for (const request of [...requests].reverse()) {
      socket.send(JSON.stringify({
        id: request.id,
        result: { result: { type: 'string', value: `${request.expression}-result` } },
      }));
    }
  });
  const client = await connectCdp({ endpointUrl: server.endpointUrl, timeoutMs: 1_000 });
  try {
    assert.deepEqual(
      await Promise.all([client.evaluate('first'), client.evaluate('second')]),
      ['first-result', 'second-result'],
    );
    assert.deepEqual(requests.map((request) => request.id), [1, 2]);
  } finally {
    await client.close();
    await server.close();
  }
});

test('CDP client propagates protocol errors', async () => {
  const { connectCdp } = await loadClient();
  const server = await createServer((socket, message) => {
    socket.send(JSON.stringify({ id: message.id, error: { message: 'evaluation denied' } }));
  });
  const client = await connectCdp({ endpointUrl: server.endpointUrl, timeoutMs: 1_000 });
  try {
    await assert.rejects(client.evaluate('blocked'), /evaluation denied/u);
  } finally {
    await client.close();
    await server.close();
  }
});

test('CDP client rejects pending commands when closed', async () => {
  const { connectCdp } = await loadClient();
  const server = await createServer(() => {});
  const client = await connectCdp({ endpointUrl: server.endpointUrl, timeoutMs: 1_000 });
  const pending = client.evaluate('pending');
  const rejection = assert.rejects(pending, /closed/u);
  await client.close();
  await rejection;
  await server.close();
});
