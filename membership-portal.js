(() => {
  'use strict';

  const PLAN_META = {
    one_set: { name: 'EDGE 1-Set Membership', rate: '$13 / week' },
    two_set: { name: 'EDGE 2-Set Membership', rate: '$19 / week' },
  };

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const formatDateTime = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric',
      year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(date);
  };

  const formatWeek = (value) => {
    if (!value) return 'Current service week';
    const date = new Date(`${value}T12:00:00-05:00`);
    return `Week of ${new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
    }).format(date)}`;
  };

  const entitlement = async (playerId) => {
    const { data, error } = await sb.rpc('membership_entitlement_snapshot', {
      check_player: playerId,
      at_time: new Date().toISOString(),
    });
    if (error) throw error;
    return data || { status: 'inactive', weekly_set_allowance: 0, used_sets: 0, remaining_sets: 0 };
  };

  const statusBadge = (snapshot) => {
    const status = snapshot.status || 'inactive';
    const colors = status === 'active'
      ? 'rgba(61,214,140,.14);color:var(--green);border-color:rgba(61,214,140,.28)'
      : status === 'grace'
        ? 'rgba(245,200,66,.12);color:var(--yellow);border-color:rgba(245,200,66,.28)'
        : 'rgba(240,82,82,.12);color:var(--red);border-color:rgba(240,82,82,.25)';
    const label = status === 'active' ? 'Active' : status === 'grace' ? 'Payment Grace' : 'Inactive';
    return `<span class="edge-membership-badge" style="background:${colors}">${label}</span>`;
  };

  const membershipRows = (snapshot) => {
    if (!snapshot || snapshot.status === 'inactive') {
      return [
        ['Plan', 'No active membership'],
        ['Weekly allowance', '0 sets available'],
        ['Status', statusBadge({ status: 'inactive' })],
      ];
    }
    const plan = PLAN_META[snapshot.plan_code] || { name: snapshot.plan_name || snapshot.plan_code || 'Membership', rate: '—' };
    const rows = [
      ['Plan', escapeHtml(plan.name)],
      ['Rate', escapeHtml(plan.rate)],
      ['This week', `${Number(snapshot.remaining_sets || 0)} of ${Number(snapshot.weekly_set_allowance || 0)} sets remaining`],
      ['Service week', `${escapeHtml(formatWeek(snapshot.service_week_start))} · resets Monday at 6:00 AM CT`],
      ['Season charges', `${Number(snapshot.successful_charge_count || 0)} of 26`],
      ['Status', statusBadge(snapshot)],
    ];
    if (snapshot.status === 'grace' && snapshot.grace_ends_at) {
      rows.push(['Grace ends', escapeHtml(formatDateTime(snapshot.grace_ends_at))]);
    }
    if (snapshot.billing_stop_required) {
      rows.push(['Billing', 'Charge cap reached · future billing must stop']);
    }
    return rows;
  };

  const rowsHtml = (snapshot) => membershipRows(snapshot)
    .map(([key, value]) => `<div class="profile-item"><div class="profile-key">${escapeHtml(key)}</div><div class="profile-val">${value}</div></div>`)
    .join('');

  const ensureStyle = () => {
    if (document.getElementById('edge-membership-style')) return;
    const style = document.createElement('style');
    style.id = 'edge-membership-style';
    style.textContent = `
      .edge-membership-badge{display:inline-flex;align-items:center;border:1px solid;border-radius:999px;padding:4px 9px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
      .edge-membership-card{margin-top:18px;border-color:rgba(61,214,140,.22)!important}
      .edge-membership-meter{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:12px 0 8px}
      .edge-membership-meter>span{display:block;height:100%;background:var(--green);border-radius:inherit;transition:width .25s ease}
      .edge-membership-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
      .edge-membership-message{min-height:18px;margin-top:10px;font-size:12px;color:var(--muted)}
      .edge-membership-message.error{color:var(--red)}
      .edge-membership-message.success{color:var(--green)}
    `;
    document.head.appendChild(style);
  };

  const renderPlayerMembership = async () => {
    if (!currentProfile?.id) return;
    const profileTarget = document.getElementById('profile-membership');
    const dashboardGrid = document.querySelector('#psub-dashboard .dash-status-grid');
    try {
      const snapshot = await entitlement(currentProfile.id);
      if (profileTarget) profileTarget.innerHTML = rowsHtml(snapshot);

      if (dashboardGrid) {
        let card = document.getElementById('player-membership-card');
        if (!card) {
          card = document.createElement('div');
          card.id = 'player-membership-card';
          card.className = 'card card-body edge-membership-card';
          dashboardGrid.insertAdjacentElement('afterend', card);
        }
        const allowance = Number(snapshot.weekly_set_allowance || 0);
        const remaining = Number(snapshot.remaining_sets || 0);
        const used = Number(snapshot.used_sets || 0);
        const percentage = allowance ? Math.min(100, Math.round((used / allowance) * 100)) : 0;
        const plan = PLAN_META[snapshot.plan_code] || { name: snapshot.plan_name || 'No active membership' };
        card.innerHTML = `
          <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
            <div><div class="section-title">Weekly Membership</div><div style="font-size:13px;color:var(--muted);margin-top:5px">${escapeHtml(plan.name)}</div></div>
            ${statusBadge(snapshot)}
          </div>
          <div class="edge-membership-meter"><span style="width:${percentage}%"></span></div>
          <div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted)">
            <span>${remaining} set${remaining === 1 ? '' : 's'} remaining</span>
            <span>${escapeHtml(formatWeek(snapshot.service_week_start))}</span>
          </div>
          ${snapshot.status === 'grace' ? `<div style="margin-top:12px;color:var(--yellow);font-size:12px">Payment grace ends ${escapeHtml(formatDateTime(snapshot.grace_ends_at))}.</div>` : ''}
        `;
      }
    } catch (error) {
      console.error('[EDGE] membership entitlement load failed:', error);
      if (profileTarget) profileTarget.innerHTML = '<div style="font-size:13px;color:var(--red)">Membership status is temporarily unavailable.</div>';
    }
  };

  const renderStaffMembership = async (playerId) => {
    const anchor = document.getElementById('admin-detail-stats');
    if (!anchor || !playerId) return;
    let card = document.getElementById('admin-membership-intake');
    if (!card) {
      card = document.createElement('div');
      card.id = 'admin-membership-intake';
      card.className = 'card card-body edge-membership-card';
      anchor.insertAdjacentElement('afterend', card);
    }
    card.innerHTML = '<div style="font-size:13px;color:var(--muted)">Loading membership entitlement…</div>';
    try {
      const snapshot = await entitlement(playerId);
      const active = snapshot.status === 'active' || snapshot.status === 'grace';
      const remaining = Number(snapshot.remaining_sets || 0);
      const allowance = Number(snapshot.weekly_set_allowance || 0);
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start">
          <div><div class="section-title">Membership Intake</div><div style="font-size:12px;color:var(--muted);margin-top:5px">Allowance is consumed when steel is marked Received.</div></div>
          ${statusBadge(snapshot)}
        </div>
        <div style="margin-top:14px">${rowsHtml(snapshot)}</div>
        <div class="edge-membership-actions">
          <button class="btn btn-chrome btn-sm" data-membership-set="1" ${!active || remaining < 1 ? 'disabled' : ''}>Receive Set 1</button>
          <button class="btn btn-ghost btn-sm" data-membership-set="2" ${!active || allowance < 2 || remaining < 1 ? 'disabled' : ''}>Receive Set 2</button>
        </div>
        <div class="edge-membership-message" id="membership-intake-message" role="status" aria-live="polite"></div>
      `;
      card.querySelectorAll('[data-membership-set]').forEach((button) => {
        button.addEventListener('click', () => receiveSet(playerId, Number(button.dataset.membershipSet), button));
      });
    } catch (error) {
      console.error('[EDGE] staff membership load failed:', error);
      card.innerHTML = '<div class="edge-membership-message error">Membership entitlement could not be loaded.</div>';
    }
  };

  const receiveSet = async (playerId, setNumber, button) => {
    const message = document.getElementById('membership-intake-message');
    const buttons = document.querySelectorAll('#admin-membership-intake [data-membership-set]');
    buttons.forEach((item) => { item.disabled = true; });
    if (message) { message.className = 'edge-membership-message'; message.textContent = `Marking Set ${setNumber} received…`; }
    try {
      const { error } = await sb.rpc('receive_membership_set', {
        check_player: playerId,
        set_number: setNumber,
        received_time: new Date().toISOString(),
      });
      if (error) throw error;
      if (message) { message.className = 'edge-membership-message success'; message.textContent = `Set ${setNumber} received. Weekly allowance updated.`; }
      await renderStaffMembership(playerId);
    } catch (error) {
      console.error('[EDGE] membership intake failed:', error);
      if (message) { message.className = 'edge-membership-message error'; message.textContent = error?.message || `Set ${setNumber} could not be received.`; }
      buttons.forEach((item) => { item.disabled = false; });
      if (button) button.focus();
    }
  };

  const installImmediateLogout = () => {
    if (typeof window.logout !== 'function' || window.logout.__edgeImmediateLogout) return;

    const immediateLogout = () => {
      try { _intentionalLogout = true; } catch (error) {
        console.warn('[EDGE] logout intent flag unavailable:', error?.message);
      }

      document.querySelectorAll('.nav-btn.logout').forEach((button) => {
        button.disabled = true;
        button.textContent = 'Signing Out…';
      });

      try {
        localStorage.removeItem('sb-nklofasekcyvolptseii-auth-token');
        sessionStorage.removeItem('sb-nklofasekcyvolptseii-auth-token');
      } catch (error) {
        console.warn('[EDGE] local auth cleanup failed:', error?.message);
      }

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
            try { _intentionalLogout = false; } catch (_) { /* global flag unavailable */ }
          });
      } catch (error) {
        console.warn('[EDGE] background sign out could not start:', error?.message);
        try { _intentionalLogout = false; } catch (_) { /* global flag unavailable */ }
      }
    };

    immediateLogout.__edgeImmediateLogout = true;
    window.logout = immediateLogout;
  };

  const installPlayerViewLifecycle = () => {
    const playerView = document.getElementById('view-player');
    if (!playerView || playerView.__edgeMembershipViewObserver) return;

    const renderWhenActive = () => {
      if (!playerView.classList.contains('active')) return;
      Promise.resolve(renderPlayerMembership())
        .catch((error) => console.error('[EDGE] active player membership render failed:', error));
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'class')) renderWhenActive();
    });
    observer.observe(playerView, { attributes: true, attributeFilter: ['class'] });
    playerView.__edgeMembershipViewObserver = observer;

    // Covers INITIAL_SESSION when the base DOMContentLoaded handler completed
    // routing before this extension installed.
    renderWhenActive();
  };

  const install = () => {
    if (window.__edgeMembershipPortalInstalled) return;
    window.__edgeMembershipPortalInstalled = true;
    ensureStyle();
    installImmediateLogout();
    installPlayerViewLifecycle();
    if (typeof loadPlayerDashboard === 'function') {
      const originalLoadPlayerDashboard = loadPlayerDashboard;
      loadPlayerDashboard = async function (...args) {
        const result = await originalLoadPlayerDashboard.apply(this, args);
        await renderPlayerMembership();
        return result;
      };
    }
    if (typeof openAdminPlayerDetail === 'function') {
      const originalOpenAdminPlayerDetail = openAdminPlayerDetail;
      openAdminPlayerDetail = async function (playerId, ...args) {
        const result = await originalOpenAdminPlayerDetail.call(this, playerId, ...args);
        await renderStaffMembership(playerId);
        return result;
      };
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
