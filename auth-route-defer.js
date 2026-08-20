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
  let passwordRecoveryPending = window.location.hash.includes('type=recovery') ||
    window.location.search.includes('type=recovery');

  const showPasswordRecovery = () => {
    try {
      if (typeof window.showView === 'function') window.showView('view-login');
      if (typeof window.hideSessionLoader === 'function') window.hideSessionLoader();
      ['player-login-panel', 'admin-login-panel'].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
      });
      const resetPanel = document.getElementById('reset-password-panel');
      if (resetPanel) resetPanel.style.display = '';
    } catch (error) {
      console.error('[EDGE] password recovery view failed:', error);
    }
  };

  if (passwordRecoveryPending) setTimeout(showPasswordRecovery, 0);

  if (window.sb?.auth?.onAuthStateChange) {
    window.sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        passwordRecoveryPending = true;
        showPasswordRecovery();
      } else if (event === 'USER_UPDATED' && passwordRecoveryPending) {
        passwordRecoveryPending = false;
      }
    });
  }

  window.routeToProfile = function deferRouteToProfile(user, ...args) {
    if (passwordRecoveryPending) {
      showPasswordRecovery();
      return Promise.resolve();
    }

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
