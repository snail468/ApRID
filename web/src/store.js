import { useState, useEffect, useCallback, useRef } from 'react';

// Tiny SWR-style cache so switching sidebar pages is instant: a page renders its
// last-known data synchronously from the module-level cache, then revalidates in
// the background. First visit still fetches; every visit after is "即点即开".

const cache = new Map();

export function getCached(key) { return cache.get(key); }
export function setCached(key, data) { cache.set(key, data); }
export function invalidate(prefix = '') {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
}

export function useCachedResource(key, fetcher) {
  const [data, setData] = useState(() => cache.get(key));
  const [loading, setLoading] = useState(() => !cache.has(key));
  const [error, setError] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      cache.set(key, d);
      setData(d);
      setError(null);
      return d;
    } catch (e) {
      setError(e);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    setData(cache.get(key));
    setLoading(!cache.has(key));
    refresh().catch(() => {});
  }, [key, refresh]);

  const mutate = useCallback((d) => { cache.set(key, d); setData(d); }, [key]);
  return { data, loading, error, refresh, mutate };
}

// Warm caches right after login so the first click into any page is instant too.
export function prefetch(pairs) {
  for (const [key, fetcher] of pairs) {
    if (cache.has(key)) continue;
    Promise.resolve().then(fetcher).then((d) => cache.set(key, d)).catch(() => {});
  }
}
