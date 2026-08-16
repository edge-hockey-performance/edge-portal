(() => {
  'use strict';

  if (window.__edgeDeferredAuthRoutingInstalled) return;
  if (typeof window.routeToProfile !== 'function') {
    console.warn('[EDGE] routeToProfile was unavailable for auth routing optimization.');
    return;
  }

  window.__edgeDeferredAuthRoutingInstalled = true;
  const originalRouteToProfile = window.routeToProfile;
  let pendingUserId = null;

  window.routeToProfile = function deferRouteToProfile(user, ...args) {
    const userId = user?.id || 'unknown';
    if (pendingUserId === userId) return Promise.resolve();
    pendingUserId = userId;

    // Supabase auth callbacks must return before issuing additional Supabase RPCs.
    // Defer portal context loading to the next task so signInWithPassword can settle.
    setTimeout(() => {
      Promise.resolve(originalRouteToProfile.call(this, user, ...args))
        .catch((error) => {
          console.error('[EDGE] deferred profile routing failed:', error);
          try {
            const errEl = document.getElementById('login-error');
            if (errEl) {
              errEl.textContent = 'Login succeeded, but the portal profile could not load. Please refresh.';
              errEl.classList.add('show');
            }
          } catch (_) { /* UI may no longer be on login view */ }
        })
        .finally(() => {
          if (pendingUserId === userId) pendingUserId = null;
        });
    }, 0);

    return Promise.resolve();
  };

  const guardLogin = (functionName) => {
    const original = window[functionName];
    if (typeof original !== 'function' || original.__edgeLoginGuard) return;
    let inFlight = false;

    const guarded = async function guardedLogin(...args) {
      if (inFlight) return;
      inFlight = true;
      try {
        return await original.apply(this, args);
      } finally {
        inFlight = false;
      }
    };

    guarded.__edgeLoginGuard = true;
    window[functionName] = guarded;
  };

  guardLogin('doPlayerLogin');
  guardLogin('doAdminLogin');
})();
