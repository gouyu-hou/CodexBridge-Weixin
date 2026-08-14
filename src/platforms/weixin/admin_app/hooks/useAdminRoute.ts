import { useCallback, useEffect, useRef, useState } from 'react';
import { parseAdminRoute, type AdminRouteId } from '../routes/adminRoutes';

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => unknown;
};

export function useAdminRoute() {
  const [route, setRoute] = useState<AdminRouteId>(() => parseAdminRoute(window.location.hash));
  const navigationSequence = useRef(0);

  useEffect(() => {
    const handleHashChange = () => setRoute(parseAdminRoute(window.location.hash));
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  const navigate = useCallback((nextRoute: AdminRouteId) => {
    const sequence = ++navigationSequence.current;
    setRoute(nextRoute);

    const commitHash = () => {
      if (sequence !== navigationSequence.current) return;
      const nextHash = `#${nextRoute}`;
      if (window.location.hash !== nextHash) window.location.hash = nextHash;
    };
    const transitionDocument = document as ViewTransitionDocument;
    if (typeof transitionDocument.startViewTransition === 'function') {
      transitionDocument.startViewTransition(commitHash);
    } else {
      commitHash();
    }
  }, []);

  return { navigate, route };
}
