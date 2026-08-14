import { useCallback, useEffect, useRef, useState } from 'react';

export function useAsyncResource<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const dataRef = useRef<T | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const hasData = dataRef.current !== null;
    setError(null);
    setLoading(!hasData);
    setRefreshing(hasData);
    try {
      const nextData = await loader();
      if (requestId.current !== id) return undefined;
      dataRef.current = nextData;
      setData(nextData);
      return nextData;
    } catch (value) {
      if (requestId.current === id) {
        setError(value instanceof Error ? value : new Error(String(value)));
      }
      return undefined;
    } finally {
      if (requestId.current === id) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [loader]);

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  return { data, error, loading, refresh, refreshing };
}
