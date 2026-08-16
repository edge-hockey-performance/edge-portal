(() => {
  'use strict';

  const MAX_ATTEMPTS = 80;
  const RETRY_DELAY_MS = 250;
  let attempts = 0;
  let timer = null;
  let inFlight = false;

  const activeProfile = () => {
    try {
      return typeof currentProfile !== 'undefined' ? currentProfile : null;
    } catch (_) {
      return null;
    }
  };

  const reconcileMembership = async () => {
    const profile = activeProfile();
    const dashboardAnchor = document.querySelector('#psub-dashboard .dash-status-grid');
    if (!profile?.id || !dashboardAnchor) return;
    if (document.getElementById('player-membership-card')) return;
    if (typeof loadPlayerDashboard !== 'function' || inFlight) return;

    inFlight = true;
    try {
      await loadPlayerDashboard();
    } finally {
      inFlight = false;
    }
  };

  const tick = async () => {
    if (attempts >= MAX_ATTEMPTS) return;
    attempts += 1;

    try {
      await reconcileMembership();
    } catch (error) {
      console.warn('[EDGE] restored-session membership reconciliation retry:', error?.message);
    }

    timer = window.setTimeout(tick, RETRY_DELAY_MS);
  };

  const start = () => {
    if (timer) window.clearTimeout(timer);
    attempts = 0;
    timer = window.setTimeout(tick, 0);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted || !document.getElementById('player-membership-card')) start();
  });
})();
