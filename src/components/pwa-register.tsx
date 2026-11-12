'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker, which is what makes the app installable.
 *
 * Only in production. In development the worker would sit between the page
 * and the dev server and serve build output that has since changed.
 *
 * Registration is deliberately unhandled on failure: the worker adds an
 * offline fallback and nothing else, so a browser that refuses it — private
 * mode, a policy, an unsupported engine — should carry on silently rather
 * than show the user an error about a feature they did not ask for.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // After load, so registration never competes with the first render for
    // bandwidth on a slow connection.
    const register = () => {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
