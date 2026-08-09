function assertLoopbackWebSocketUrl(value) {
  const parsed = new URL(value);
  if ((parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:')
    || (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost')) {
    throw new Error('CDP endpoint must use a loopback WebSocket URL');
  }
  return parsed.toString();
}

export async function connectCdp({ endpointUrl, timeoutMs = 5_000 }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1) {
    throw new Error('CDP timeoutMs must be a positive number');
  }
  const socket = new WebSocket(assertLoopbackWebSocketUrl(endpointUrl));
  await waitForSocketOpen(socket, timeoutMs);

  let closed = false;
  let nextId = 1;
  const pending = new Map();

  const rejectPending = (error) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!Number.isInteger(message.id)) {
      return;
    }
    const request = pending.get(message.id);
    if (!request) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(new Error(message.error.message || `CDP command ${request.method} failed`));
      return;
    }
    request.resolve(message.result);
  });
  socket.addEventListener('error', () => {
    rejectPending(new Error('CDP WebSocket failed'));
  });
  socket.addEventListener('close', () => {
    closed = true;
    rejectPending(new Error('CDP connection closed'));
  });

  const command = (method, params = {}) => {
    if (closed || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('CDP connection is closed'));
    }
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { method, reject, resolve, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  return {
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      rejectPending(new Error('CDP connection closed'));
      const closedPromise = new Promise((resolve) => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          resolve();
        };
        socket.addEventListener('close', finish, { once: true });
        timer = setTimeout(finish, Math.min(timeoutMs, 1_000));
      });
      socket.close();
      await closedPromise;
    },
    async evaluate(expression) {
      const response = await command('Runtime.evaluate', {
        awaitPromise: true,
        expression,
        returnByValue: true,
      });
      if (response?.exceptionDetails) {
        const detail = response.exceptionDetails.exception?.description
          || response.exceptionDetails.text
          || 'CDP evaluation failed';
        throw new Error(detail);
      }
      return response?.result?.value;
    },
    send(method, params = {}) {
      return command(method, params);
    },
  };
}

function waitForSocketOpen(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error(`CDP connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
      socket.removeEventListener('close', onClose);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('CDP WebSocket failed to connect'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('CDP WebSocket closed before connecting'));
    };
    socket.addEventListener('open', onOpen, { once: true });
    socket.addEventListener('error', onError, { once: true });
    socket.addEventListener('close', onClose, { once: true });
  });
}
