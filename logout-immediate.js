(() => {
  'use strict';

  if (window.__edgeImmediateLogoutInstalled) return;
  window.__edgeImmediateLogoutInstalled = true;

  const clearLocalSession = () => {
    try {
      localStorage.removeItem('sb-nklofasekcyvolptseii-auth-token');
      sessionStorage.removeItem('sb-nklofasekcyvolptseii-auth-token');
    } catch (error) {
      console.warn('[EDGE] local auth cleanup failed:', error?.message);
    }
  };

  const showLoginImmediately = () => {
    try { _intentionalLogout = true; } catch (_) { /* optional portal global */ }

    document.querySelectorAll('.nav-btn.logout').forEach((button) => {
      button.disabled = true;
      button.textContent = 'Signing Out…';
    });

    clearLocalSession();

    try {
      currentUser = null;
      currentProfile = null;
      authorizedPlayers = [];
      isPortalStaff = false;
      showView('view-login');
    } catch (error) {
      console.warn('[EDGE] immediate logout view switch failed:', error?.message);
      window.location.reload();
    }

    try {
      Promise.resolve(sb.auth.signOut({ scope: 'local' }))
        .catch((error) => console.warn('[EDGE] background sign out failed:', error?.message))
        .finally(() => {
          try { _intentionalLogout = false; } catch (_) { /* optional portal global */ }
        });
    } catch (error) {
      console.warn('[EDGE] background sign out could not start:', error?.message);
      try { _intentionalLogout = false; } catch (_) { /* optional portal global */ }
    }
  };

  // Capture the click before the button's inline onclick handler can start the
  // network-blocking legacy logout function.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('.nav-btn.logout')
      : null;
    if (!target) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    showLoginImmediately();
  }, true);
})();
