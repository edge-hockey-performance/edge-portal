(() => {
  'use strict';

  const MAX_ATTEMPTS = 80;
  const RETRY_DELAY_MS = 250;
  let attempts = 0;
  let completed = false;
  let timer = null;

  const activeProfile = () => {
    try {
      return typeof currentProfile !== 'undefined' ? currentProfile : null;
    } catch (_) {
      return null;
    }
  };

  const reconcileMembership = async () => {
    if (completed) return true;

    const profile = activeProfile();
    const dashboardAnchor = document.querySelector('#psub-dashboard .dash-status-grid');
    if (!profile?.id || !dashboardAnchor) return false;

    if (document.getElementById('player-membership-card')) {
      completed = true;
      return true;
    }

    if (typeof loadPlayerDashboard !== 'function') return false;

    await loadPlayerDashboard();
    completed = Boolean(document.getElementById('player-membership-card'));
    return completed;
  };

  const tick = async () => {
    if (completed || attempts >= MAX_ATTEMPTS) return;
    attempts += 1;

    try {
      if (await reconcileMembership()) return;
    } catch (error) {
      console.warn('[EDGE] restored-session membership reconciliation retry:', error?.message);
    }

    timer = window.setTimeout(tick, RETRY_DELAY_MS);
  };

  const start = () => {
    if (timer) window.clearTimeout(timer);
    attempts = 0;
    completed = false;
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
