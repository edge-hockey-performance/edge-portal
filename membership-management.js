(() => {
  'use strict';

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

  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00-06:00`);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
    }).format(date);
  };

  const formatWeek = (value) => {
    if (!value) return 'Current service week';
    const date = new Date(`${value}T12:00:00-06:00`);
    return `Week of ${new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
    }).format(date)}`;
  };

  const money = (cents, currency = 'USD') => {
    const amount = Number(cents);
    if (!Number.isFinite(amount)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: currency || 'USD', maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  const loadAccount = async (playerId) => {
    const { data, error } = await sb.rpc('membership_account_snapshot', {
      check_player: playerId,
      at_time: new Date().toISOString(),
    });
    if (error) throw error;
    return data || { status: 'inactive', payments: [], cancellation_eligible: false };
  };

  const statusBadge = (snapshot) => {
    const status = snapshot?.status || 'inactive';
    const colors = status === 'active'
      ? 'rgba(61,214,140,.14);color:var(--green);border-color:rgba(61,214,140,.28)'
      : status === 'grace'
        ? 'rgba(245,200,66,.12);color:var(--yellow);border-color:rgba(245,200,66,.28)'
        : 'rgba(240,82,82,.12);color:var(--red);border-color:rgba(240,82,82,.25)';
    const label = status === 'active' ? 'Active' : status === 'grace' ? 'Payment Grace' : 'Inactive';
    return `<span class="edge-account-badge" style="background:${colors}">${label}</span>`;
  };

  const accountMeta = (snapshot) => {
    const prepaid = snapshot?.purchase_type === 'season_upfront';
    const paidAmount = Number(snapshot?.latest_paid_amount_cents);
    const planName = snapshot?.plan_name || (snapshot?.plan_code === 'two_set'
      ? 'EDGE 2-Set Membership' : 'EDGE 1-Set Membership');
    const weeklyAmount = snapshot?.plan_price_cents != null
      ? money(snapshot.plan_price_cents, snapshot.currency)
      : (snapshot?.plan_code === 'two_set' ? '$19' : '$13');
    return {
      prepaid,
      planName,
      purchaseLabel: prepaid ? 'Prepay & Save' : 'Weekly Membership',
      rate: prepaid
        ? `${Number.isFinite(paidAmount) ? money(paidAmount, snapshot?.currency) : 'Season price'} / season`
        : `${weeklyAmount} / week`,
      billing: prepaid ? 'Pay per season' : 'Pay weekly',
    };
  };

  const accountRows = (snapshot) => {
    if (!snapshot || snapshot.status === 'inactive') {
      return [
        ['Plan', 'No active membership'],
        ['Weekly allowance', '0 sets available'],
        ['Status', statusBadge({ status: 'inactive' })],
      ];
    }
    const meta = accountMeta(snapshot);
    const rows = [
      ['Plan', escapeHtml(meta.purchaseLabel)],
      ['Membership', escapeHtml(meta.planName)],
      ['Rate', escapeHtml(meta.rate)],
      ['Billing', escapeHtml(meta.billing)],
      ['This week', `${Number(snapshot.remaining_sets || 0)} of ${Number(snapshot.weekly_set_allowance || 0)} sets remaining`],
      ['Service week', `${escapeHtml(formatWeek(snapshot.service_week_start))} · resets Monday at 6:00 AM CT`],
    ];
    if (meta.prepaid) {
      rows.push(['Season', `${escapeHtml(formatDate(snapshot.season_start))} – ${escapeHtml(formatDate(snapshot.season_end))}`]);
    } else {
      rows.push(['Season charges', `${Number(snapshot.successful_charge_count || 0)} of 26`]);
    }
    rows.push(['Status', statusBadge(snapshot)]);
    if (snapshot.status === 'grace' && snapshot.grace_ends_at) {
      rows.push(['Grace ends', escapeHtml(formatDateTime(snapshot.grace_ends_at))]);
    }
    return rows;
  };

  const rowsHtml = (snapshot) => accountRows(snapshot)
    .map(([key, value]) => `<div class="profile-item"><div class="profile-key">${escapeHtml(key)}</div><div class="profile-val">${value}</div></div>`)
    .join('');

  const paymentRowsHtml = (snapshot) => {
    const payments = Array.isArray(snapshot?.payments) ? snapshot.payments : [];
    if (!payments.length) return '<div style="font-size:13px;color:var(--muted);">No membership payments are available yet.</div>';
    return payments.map((payment) => {
      const net = Math.max(0, Number(payment.amount_cents || 0) - Number(payment.refunded_amount_cents || 0));
      const label = payment.outcome === 'recovered' ? 'Recovered' : payment.outcome === 'failed' ? 'Failed' : 'Paid';
      const orderNumber = String(payment.shopify_order_gid || '').split('/').pop();
      return `<div class="edge-account-payment-row">
        <div>
          <div style="font-size:14px;font-weight:700;color:#fff">${escapeHtml(label)} · ${escapeHtml(formatDateTime(payment.occurred_at))}</div>
          <div class="edge-account-payment-meta">${orderNumber ? `Shopify order ${escapeHtml(orderNumber)}` : 'Membership payment'}${payment.billing_cycle_index ? ` · Billing cycle ${Number(payment.billing_cycle_index)}` : ''}</div>
        </div>
        <div style="font-family:var(--font-head);font-size:20px;font-weight:800;color:var(--chrome-bright)">${escapeHtml(money(net, payment.currency))}</div>
      </div>`;
    }).join('');
  };

  const ensureStyles = () => {
    if (document.getElementById('edge-account-management-style')) return;
    const style = document.createElement('style');
    style.id = 'edge-account-management-style';
    style.textContent = `
      .edge-account-badge{display:inline-flex;align-items:center;border:1px solid;border-radius:999px;padding:4px 9px;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
      #player-membership-card{margin:22px 0 34px!important;padding:22px!important}
      .edge-account-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start}
      .edge-account-meter{height:7px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:18px 0 10px}
      .edge-account-meter>span{display:block;height:100%;background:var(--green);border-radius:inherit;transition:width .25s ease}
      .edge-account-allowance{display:flex;justify-content:space-between;gap:12px;font-size:12px;color:var(--muted)}
      .edge-account-stack{display:grid;gap:22px}
      .edge-account-summary{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(260px,.85fr);gap:22px}
      .edge-account-kicker{font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--green);margin-bottom:7px}
      .edge-account-plan{font-family:var(--font-head);font-size:30px;font-weight:800;font-style:italic;text-transform:uppercase;line-height:1;color:#fff}
      .edge-account-rate{font-family:var(--font-head);font-size:24px;font-weight:800;color:var(--chrome-bright);margin-top:12px}
      .edge-account-payment-list{display:grid;gap:10px;margin-top:16px}
      .edge-account-payment-row{display:grid;grid-template-columns:1fr auto;gap:14px;align-items:center;padding:14px 0;border-top:1px solid var(--border)}
      .edge-account-payment-row:first-child{border-top:0}
      .edge-account-payment-meta{font-size:12px;color:var(--muted);margin-top:4px}
      .edge-account-cancel{margin-top:18px;padding:16px;border:1px solid rgba(242,180,135,.25);border-radius:var(--radius);background:rgba(242,180,135,.05)}
      .edge-account-cancel-form{display:none;margin-top:14px}
      .edge-account-cancel-form.show{display:block}
      .edge-account-cancel-form textarea{width:100%;min-height:90px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:#fff;padding:10px;font:inherit;resize:vertical}
      .edge-account-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}
      .edge-account-message{min-height:18px;margin-top:10px;font-size:12px;color:var(--muted)}
      .edge-account-message.error{color:var(--red)}
      .edge-account-message.success{color:var(--green)}
      @media(max-width:760px){
        #player-membership-card{margin:18px 0 28px!important;padding:18px!important}
        .edge-account-head,.edge-account-allowance{align-items:flex-start;flex-direction:column}
        .edge-account-summary{grid-template-columns:1fr}
        .edge-account-plan{font-size:26px}
      }
    `;
    document.head.appendChild(style);
  };

  const renderProfileAndDashboard = async () => {
    if (!currentProfile?.id) return;
    const profileTarget = document.getElementById('profile-membership');
    try {
      const snapshot = await loadAccount(currentProfile.id);
      if (profileTarget) profileTarget.innerHTML = rowsHtml(snapshot);
      const dashboardGrid = document.querySelector('#psub-dashboard .dash-status-grid');
      if (!dashboardGrid) return;
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
      const meta = accountMeta(snapshot);
      card.innerHTML = `
        <div class="edge-account-head">
          <div><div class="section-title">${escapeHtml(meta.prepaid ? 'Season Membership' : 'Weekly Membership')}</div><div style="font-size:13px;color:var(--muted);margin-top:5px">${escapeHtml(meta.planName)} · ${escapeHtml(meta.rate)}</div></div>
          ${statusBadge(snapshot)}
        </div>
        <div class="edge-account-meter"><span style="width:${percentage}%"></span></div>
        <div class="edge-account-allowance"><span>${remaining} set${remaining === 1 ? '' : 's'} remaining</span><span>${escapeHtml(formatWeek(snapshot.service_week_start))}</span></div>
        ${meta.prepaid ? '<div style="margin-top:14px;color:var(--muted);font-size:12px">Paid in full for the season · no automatic renewal.</div>' : ''}
        ${snapshot.status === 'grace' ? `<div style="margin-top:12px;color:var(--yellow);font-size:12px">Payment grace ends ${escapeHtml(formatDateTime(snapshot.grace_ends_at))}.</div>` : ''}`;
    } catch (error) {
      console.error('[EDGE] membership account load failed:', error);
      if (profileTarget) profileTarget.innerHTML = '<div style="font-size:13px;color:var(--red)">Membership status is temporarily unavailable.</div>';
    }
  };

  const showCancelForm = () => {
    const form = document.getElementById('edge-account-cancel-form');
    form?.classList.add('show');
    document.getElementById('edge-account-cancel-open')?.setAttribute('aria-expanded', 'true');
    form?.querySelector('textarea')?.focus();
  };

  const hideCancelForm = () => {
    const form = document.getElementById('edge-account-cancel-form');
    form?.classList.remove('show');
    const button = document.getElementById('edge-account-cancel-open');
    button?.setAttribute('aria-expanded', 'false');
    button?.focus();
  };

  const submitCancelRequest = async (membershipId) => {
    const submit = document.getElementById('edge-account-cancel-submit');
    const message = document.getElementById('edge-account-cancel-message');
    const note = document.getElementById('edge-account-cancel-note')?.value || '';
    if (submit) submit.disabled = true;
    if (message) { message.className = 'edge-account-message'; message.textContent = 'Submitting cancellation request…'; }
    try {
      const { error } = await sb.rpc('request_membership_cancellation', {
        check_membership: membershipId,
        request_note: note,
      });
      if (error) throw error;
      await renderManagement();
    } catch (error) {
      console.error('[EDGE] cancellation request failed:', error);
      if (message) { message.className = 'edge-account-message error'; message.textContent = error?.message || 'The request could not be submitted.'; }
      if (submit) submit.disabled = false;
    }
  };

  const renderManagement = async () => {
    const target = document.getElementById('membership-management');
    if (!target || !currentProfile?.id) return;
    target.innerHTML = '<div class="card card-body"><div style="font-size:13px;color:var(--muted);">Loading membership details…</div></div>';
    try {
      const snapshot = await loadAccount(currentProfile.id);
      if (!snapshot || snapshot.status === 'inactive') {
        target.innerHTML = '<div class="card card-body"><div class="section-title">No active membership</div><div style="font-size:13px;color:var(--muted);margin-top:8px;">There is no current EDGE membership attached to this player.</div></div>';
        return;
      }
      const meta = accountMeta(snapshot);
      const pending = snapshot.pending_cancellation_request;
      let cancellation = '';
      if (meta.prepaid) {
        cancellation = `<div class="edge-account-cancel"><div style="font-weight:700;color:#fff">Paid in full</div><div style="font-size:13px;color:var(--muted);margin-top:6px;line-height:1.55">This prepaid season membership does not renew automatically, so no cancellation is required. Service remains available through ${escapeHtml(formatDate(snapshot.season_end))}.</div></div>`;
      } else if (pending) {
        cancellation = `<div class="edge-account-cancel"><div style="font-weight:700;color:var(--yellow)">Cancellation requested</div><div style="font-size:13px;color:var(--muted);margin-top:6px;line-height:1.55">Requested ${escapeHtml(formatDateTime(pending.requested_at))}. Your membership remains active until EDGE confirms the Shopify subscription has been cancelled.</div></div>`;
      } else if (snapshot.cancellation_eligible) {
        cancellation = `<div class="edge-account-cancel">
          <div style="font-weight:700;color:#fff">Need to cancel?</div>
          <div style="font-size:13px;color:var(--muted);margin-top:6px;line-height:1.55">Send a cancellation request to EDGE. This request does not stop Shopify billing until EDGE confirms completion.</div>
          <button class="btn btn-ghost btn-sm" id="edge-account-cancel-open" aria-controls="edge-account-cancel-form" aria-expanded="false" style="margin-top:12px">Request cancellation</button>
          <div class="edge-account-cancel-form" id="edge-account-cancel-form">
            <label for="edge-account-cancel-note" style="display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px">Optional note</label>
            <textarea id="edge-account-cancel-note" maxlength="1000" placeholder="Share anything EDGE should know about your request."></textarea>
            <div class="edge-account-actions"><button class="btn btn-chrome btn-sm" id="edge-account-cancel-submit">Submit request</button><button class="btn btn-ghost btn-sm" id="edge-account-cancel-keep">Keep membership</button></div>
            <div class="edge-account-message" id="edge-account-cancel-message" role="status" aria-live="polite"></div>
          </div>
        </div>`;
      }
      target.innerHTML = `<div class="edge-account-stack">
        <div class="edge-account-summary">
          <div class="card card-body"><div class="edge-account-kicker">${escapeHtml(meta.purchaseLabel)}</div><div class="edge-account-plan">${escapeHtml(meta.planName)}</div><div class="edge-account-rate">${escapeHtml(meta.rate)}</div><div style="font-size:13px;color:var(--muted);margin-top:6px">${escapeHtml(meta.billing)}</div><div style="margin-top:20px">${rowsHtml(snapshot)}</div></div>
          <div class="card card-body"><div class="section-header" style="margin-bottom:10px"><div class="section-title">Account Status</div>${statusBadge(snapshot)}</div><div style="font-size:13px;color:var(--muted);line-height:1.6">${meta.prepaid ? 'Your season is paid in full and will not renew automatically.' : 'Your weekly membership renews through Shopify until cancellation is completed or the seasonal charge cap is reached.'}</div>${cancellation}</div>
        </div>
        <div class="card card-body"><div class="section-header"><div><div class="section-title">Membership Payment History</div><div style="font-size:12px;color:var(--muted);margin-top:5px">Verified payments connected to this player’s EDGE membership.</div></div></div><div class="edge-account-payment-list">${paymentRowsHtml(snapshot)}</div></div>
      </div>`;
      document.getElementById('edge-account-cancel-open')?.addEventListener('click', showCancelForm);
      document.getElementById('edge-account-cancel-keep')?.addEventListener('click', hideCancelForm);
      document.getElementById('edge-account-cancel-submit')?.addEventListener('click', () => submitCancelRequest(snapshot.membership_id));
    } catch (error) {
      console.error('[EDGE] membership management load failed:', error);
      target.innerHTML = '<div class="card card-body"><div class="edge-account-message error">Membership details are temporarily unavailable.</div></div>';
    }
  };

  const installControls = () => {
    const profilePage = document.getElementById('psub-profile');
    if (profilePage && !document.getElementById('psub-membership')) {
      const page = document.createElement('div');
      page.className = 'page';
      page.id = 'psub-membership';
      page.style.display = 'none';
      page.innerHTML = '<div class="page-header"><div class="page-eyebrow">Membership Account</div><div class="page-title">Subscription <span class="chrome">Management</span></div><div class="page-sub">Review plan details, payment history, and cancellation status.</div></div><div id="membership-management" aria-live="polite"><div class="card card-body"><div style="font-size:13px;color:var(--muted);">Loading membership details…</div></div></div>';
      profilePage.insertAdjacentElement('beforebegin', page);
    }

    const originalPlayerNav = window.playerNav;
    if (typeof originalPlayerNav === 'function' && !originalPlayerNav.__edgeAccountNav) {
      const accountPlayerNav = (sub, ...args) => {
        const accountPage = document.getElementById('psub-membership');
        if (sub === 'membership') {
          document.querySelectorAll('#view-player .page[id^="psub-"]').forEach((page) => { page.style.display = page.id === 'psub-membership' ? '' : 'none'; });
          document.querySelectorAll('#view-player .nav-btn[id^="pnav-"]').forEach((button) => button.classList.remove('active'));
          document.querySelectorAll('#view-player [id^="mnav-"]').forEach((button) => button.classList.remove('active'));
          document.getElementById('pnav-membership')?.classList.add('active');
          window.scrollTo({ top: 0, behavior: 'smooth' });
          renderManagement();
          return;
        }
        if (accountPage) accountPage.style.display = 'none';
        return originalPlayerNav(sub, ...args);
      };
      accountPlayerNav.__edgeAccountNav = true;
      window.playerNav = accountPlayerNav;
    }

    const profileNav = document.getElementById('pnav-profile');
    if (profileNav && !document.getElementById('pnav-membership')) {
      const button = document.createElement('button');
      button.className = 'nav-btn';
      button.id = 'pnav-membership';
      button.textContent = 'Subscription Mgmt';
      button.addEventListener('click', () => window.playerNav?.('membership'));
      profileNav.insertAdjacentElement('beforebegin', button);
    }

    const quickGrid = document.querySelector('#psub-dashboard .section .grid-2');
    if (quickGrid && !document.getElementById('quick-membership-management')) {
      const button = document.createElement('button');
      button.className = 'btn btn-ghost';
      button.id = 'quick-membership-management';
      button.textContent = 'Subscription Mgmt';
      button.addEventListener('click', () => window.playerNav?.('membership'));
      quickGrid.appendChild(button);
    }

    const hollowSelect = document.getElementById('profile-hollow-select');
    if (hollowSelect) {
      let placeholder = hollowSelect.querySelector('option[value=""]');
      if (!placeholder) {
        placeholder = document.createElement('option');
        placeholder.value = '';
        hollowSelect.insertAdjacentElement('afterbegin', placeholder);
      }
      placeholder.textContent = 'Please Select';
      hollowSelect.value = '';
    }

    if (typeof window.saveHollow === 'function' && !window.saveHollow.__edgeAccountValidated) {
      const originalSaveHollow = window.saveHollow;
      const validatedSaveHollow = async (...args) => {
        if (!document.getElementById('profile-hollow-select')?.value) {
          const message = document.getElementById('hollow-saved');
          if (message) {
            message.textContent = 'Please select a hollow before saving.';
            message.classList.add('show');
            setTimeout(() => message.classList.remove('show'), 3000);
          }
          return;
        }
        return originalSaveHollow(...args);
      };
      validatedSaveHollow.__edgeAccountValidated = true;
      window.saveHollow = validatedSaveHollow;
    }

    const profilePreference = document.getElementById('edit-profile-pref');
    if (profilePreference?.options?.length) profilePreference.options[0].textContent = 'Please Select';

    if (typeof window.saveProfileEdits === 'function' && !window.saveProfileEdits.__edgeAccountNullable) {
      const originalSaveProfileEdits = window.saveProfileEdits;
      const nullableProfileSave = async (...args) => {
        const shouldClear = (document.getElementById('edit-profile-pref')?.value || '') === '' && Boolean(currentProfile?.profile_preference);
        const result = await originalSaveProfileEdits(...args);
        if (shouldClear && currentProfile?.id) {
          try {
            const { error } = await _dbFetch(sb.from('players').update({ profile_preference: null }).eq('id', currentProfile.id), 10000);
            if (error) throw error;
            currentProfile.profile_preference = null;
            await loadPlayerDashboard();
          } catch (error) {
            console.error('[EDGE] profile preference clear failed:', error);
          }
        }
        return result;
      };
      nullableProfileSave.__edgeAccountNullable = true;
      window.saveProfileEdits = nullableProfileSave;
    }

    const editPanel = document.getElementById('edit-profile-panel');
    const editButton = document.querySelector('#psub-profile button[onclick="toggleEditProfile()"]');
    if (editPanel && editButton && !editButton.dataset.edgeAccountScroll) {
      editPanel.tabIndex = -1;
      editButton.setAttribute('aria-controls', editPanel.id);
      editButton.setAttribute('aria-expanded', 'false');
      editButton.dataset.edgeAccountScroll = 'true';
      editButton.addEventListener('click', () => requestAnimationFrame(() => {
        const isOpen = getComputedStyle(editPanel).display !== 'none';
        editButton.setAttribute('aria-expanded', String(isOpen));
        if (isOpen) {
          editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
          editPanel.focus({ preventScroll: true });
        }
      }));
    }
  };

  const install = () => {
    ensureStyles();
    installControls();
    if (typeof window.loadPlayerDashboard === 'function' && !window.loadPlayerDashboard.__edgeAccountWrapped) {
      const originalLoadPlayerDashboard = window.loadPlayerDashboard;
      const accountLoadPlayerDashboard = async function (...args) {
        const result = await originalLoadPlayerDashboard.apply(this, args);
        await renderProfileAndDashboard();
        return result;
      };
      accountLoadPlayerDashboard.__edgeAccountWrapped = true;
      window.loadPlayerDashboard = accountLoadPlayerDashboard;
    }
    if (currentProfile?.id) renderProfileAndDashboard();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  } else {
    setTimeout(install, 0);
  }
})();
