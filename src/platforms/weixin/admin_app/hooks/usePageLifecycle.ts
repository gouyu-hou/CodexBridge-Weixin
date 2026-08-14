import { useEffect, useRef } from 'react';
import type { AdminApi } from '../api/adminApi';

function createPageId() {
  return globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function usePageLifecycle(api: AdminApi) {
  const pageId = useRef(createPageId());

  useEffect(() => {
    const shutdownOnClose = new URLSearchParams(window.location.search).get('shutdownOnClose') !== '0';
    if (!shutdownOnClose) return undefined;

    let closed = false;
    void api.heartbeat(pageId.current).catch(() => undefined);
    const timer = window.setInterval(() => {
      void api.heartbeat(pageId.current).catch(() => undefined);
    }, 5_000);

    const close = () => {
      if (closed) return;
      closed = true;
      window.clearInterval(timer);
      void api.closePage(pageId.current, 'admin-page-closed').catch(() => undefined);
      void api.shutdownService('admin-page-closed').catch(() => undefined);
    };
    window.addEventListener('pagehide', close);
    window.addEventListener('beforeunload', close);
    window.addEventListener('unload', close);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pagehide', close);
      window.removeEventListener('beforeunload', close);
      window.removeEventListener('unload', close);
    };
  }, [api]);
}
