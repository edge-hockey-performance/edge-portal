/* Staff-only roster presentation. No Supabase writes or access changes.
 * Owner-confirmed September 18, 2026: hide these ten reviewed record IDs.
 * Jenna (May) and Mike Mersch remain on identity hold and are NOT listed.
 * Restore a player by removing their ID below and redeploying; staff can
 * inspect every hidden profile immediately with Show hidden profiles.
 */
(function () {
  'use strict';
  if (window.__edgeStaffRosterVisibility) return;
  const hiddenIds = new Set([
    '039d98ea-736a-4918-b950-91959a8f8e7f',
    'd31f2712-38c8-4754-9f3a-39d67ed9d835',
    '5b3426bb-cb12-4eba-891d-b7c2463f2806',
    '57fb807a-adc4-471c-9acb-ab497d0a0780',
    'e73dc8b1-fcc5-407f-bf34-bb95e6a4ccd3',
    '67ee195f-dce0-4ab6-b060-72a826f98303',
    'de933bb5-d862-4f6e-9be8-fa902cfe5be0',
    '9d85b04b-d6f2-43cd-9493-892134380b2c',
    '5b530572-6211-4450-9eb2-0e20a24429ee',
    'b25ecf3a-3f55-46b4-90fe-9a7c1db07bf3'
  ]);
  const isHidden = (player) => hiddenIds.has(player.id);
  const countEl = document.getElementById('apf-count');
  if (!countEl || typeof filterAdminPlayers !== 'function' ||
      typeof initServiceSession !== 'function' || typeof renderPlayerRow !== 'function') {
    console.warn('[EDGE] Staff roster visibility not installed: expected portal hooks missing.');
    return;
  }

  const label = document.createElement('label');
  label.id = 'edge-hidden-roster-control';
  label.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted);margin:0 0 12px;cursor:pointer;';
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'apf-show-hidden';
  checkbox.style.cssText = 'width:16px;height:16px;accent-color:var(--chrome-c);';
  label.append(checkbox, document.createTextNode('Show hidden profiles'));
  countEl.before(label);

  const originalFilter = filterAdminPlayers;
  filterAdminPlayers = function () {
    const completeRoster = allPlayersCache;
    const hiddenCount = completeRoster.filter(isHidden).length;
    if (!checkbox.checked) allPlayersCache = completeRoster.filter(p => !isHidden(p));
    try {
      originalFilter.apply(this, arguments);
      if (hiddenCount) countEl.textContent += checkbox.checked
        ? ` · Including ${hiddenCount} hidden profile${hiddenCount === 1 ? '' : 's'}`
        : ` · ${hiddenCount} hidden profile${hiddenCount === 1 ? '' : 's'}`;
    } finally {
      allPlayersCache = completeRoster;
    }
  };
  checkbox.addEventListener('change', () => filterAdminPlayers());

  const originalRow = renderPlayerRow;
  renderPlayerRow = function (player) {
    const row = originalRow.apply(this, arguments);
    return isHidden(player) ? row.replace('</strong>', '</strong> <span class="badge badge-yellow">Hidden</span>') : row;
  };

  if (typeof clearApf === 'function') {
    const originalClear = clearApf;
    clearApf = function () {
      checkbox.checked = false;
      return originalClear.apply(this, arguments);
    };
  }

  // Prune both the service list AND selection state: hidden profiles must
  // never be silently included in a bulk sharpening/service submission.
  const originalInit = initServiceSession;
  initServiceSession = async function () {
    const result = await originalInit.apply(this, arguments);
    svcAllPlayers = svcAllPlayers.filter(p => !isHidden(p));
    for (const id of hiddenIds) delete svcSelected[id];
    svcVisible = svcVisible.filter(p => !isHidden(p));
    filterServicePlayers();
    return result;
  };

  if (typeof loadAdminPlayerDropdown === 'function') {
    const originalDropdown = loadAdminPlayerDropdown;
    loadAdminPlayerDropdown = async function () {
      const result = await originalDropdown.apply(this, arguments);
      const dropdown = document.getElementById('admin-steel-player');
      if (dropdown) Array.from(dropdown.options).forEach(option => {
        if (hiddenIds.has(option.value)) option.remove();
      });
      return result;
    };
  }

  window.__edgeStaffRosterVisibility = '20260918-roster-1';
  if (allPlayersCache.length) filterAdminPlayers();
})();
