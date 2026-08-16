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

  const finalizePlayerDashboard = async () => {
    let profile = null;
    try {
      profile = typeof currentProfile !== 'undefined' ? currentProfile : null;
    } catch (_) {
      profile = null;
    }

    const dashboardAnchor = document.querySelector('#psub-dashboard .dash-status-grid');
    if (!profile?.id || !dashboardAnchor || typeof loadPlayerDashboard !== 'function') return;

    // membership-portal.js wraps loadPlayerDashboard. Invoking the wrapped loader
    // after routeToProfile settles guarantees membership renders after the base
    // dashboard has completed its final DOM replacement on sign-in and refresh.
    await loadPlayerDashboard();
  };

  window.routeToProfile = function deferRouteToProfile(user, ...args) {
    const userId = user?.id || 'unknown';
    if (pendingUserId === userId) return Promise.resolve();
    pendingUserId = userId;

    // Supabase auth callbacks must return before issuing additional Supabase RPCs.
    // Defer portal context loading to the next task so signInWithPassword can settle.
    setTimeout(() => {
      Promise.resolve(originalRouteToProfile.call(this, user, ...args))
        .then(() => finalizePlayerDashboard())
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
