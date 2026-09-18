// Applied by the existing HTML response transformer; no database writes.
export function getCatalogReplacements(): ReadonlyArray<readonly [string, string]> {
  return [
  [
    "<select id=\"edit-profile-pref\">\n                  <option value=\"\">Not specified</option>\n                  <option value=\"10ft Flat\">10ft Flat (stock — most common)</option>\n                  <option value=\"11ft Flat\">11ft Flat (slightly flatter)</option>\n                  <option value=\"9ft Flat\">9ft Flat (slightly more aggressive)</option>\n                  <option value=\"8ft Flat\">8ft Flat (aggressive)</option>\n                  <option value=\"Combo 10/12\">Combo 10/12 (forward pitch)</option>\n                  <option value=\"Combo 9/13\">Combo 9/13 (speed profile)</option>\n                  <option value=\"Custom\">Custom — see equipment notes</option>\n                  <option value=\"Let EDGE Decide\">Let EDGE Decide</option>\n                </select>",
    "<select id=\"edit-profile-pref\">\n<option value=\"\">Not specified</option>\n<option value=\"Polaris\">Polaris</option>\n<option value=\"Quad 4.1\">Quad 4.1</option>\n<option value=\"Quad 4.2\">Quad 4.2</option>\n<option value=\"Triple 3.1\">Triple 3.1</option>\n<option value=\"7′–13′ Duo\">7′–13′ Duo</option>\n<option value=\"9.5′–10.5′ Duo\">9.5′–10.5′ Duo</option>\n<option value=\"SCS 1\">SCS 1</option>\n<option value=\"SCS 2\">SCS 2</option>\n<option value=\"10ft Flat\">10′ Mono (stock / generic)</option>\n<option value=\"Custom\">Custom — see equipment notes</option>\n<option value=\"Let EDGE Decide\">Let EDGE Decide</option>\n</select>"
  ],
  [
    "<select id=\"aed-profile-pref\">\n                  <option value=\"\">Not specified</option>\n                  <option value=\"10ft Flat\">10ft Flat (stock)</option>\n                  <option value=\"11ft Flat\">11ft Flat (flatter)</option>\n                  <option value=\"9ft Flat\">9ft Flat (aggressive)</option>\n                  <option value=\"8ft Flat\">8ft Flat (very aggressive)</option>\n                  <option value=\"Combo 10/12\">Combo 10/12</option>\n                  <option value=\"Combo 9/13\">Combo 9/13</option>\n                  <option value=\"Custom\">Custom</option>\n                  <option value=\"Let EDGE Decide\">Let EDGE Decide</option>\n                </select>",
    "<select id=\"aed-profile-pref\">\n<option value=\"\">Not specified</option>\n<option value=\"Polaris\">Polaris</option>\n<option value=\"Quad 4.1\">Quad 4.1</option>\n<option value=\"Quad 4.2\">Quad 4.2</option>\n<option value=\"Triple 3.1\">Triple 3.1</option>\n<option value=\"7′–13′ Duo\">7′–13′ Duo</option>\n<option value=\"9.5′–10.5′ Duo\">9.5′–10.5′ Duo</option>\n<option value=\"SCS 1\">SCS 1</option>\n<option value=\"SCS 2\">SCS 2</option>\n<option value=\"10ft Flat\">10′ Mono (stock / generic)</option>\n<option value=\"Custom\">Custom — see equipment notes</option>\n<option value=\"Let EDGE Decide\">Let EDGE Decide</option>\n</select>"
  ],
  [
    "<select id=\"fpref-profile-select\" style=\"width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:#fff;padding:10px;font-size:14px;\">\n                  <option value=\"\">Select desired profile</option>\n                  <option value=\"10ft Flat\">10ft Flat (stock)</option>\n                  <option value=\"11ft Flat\">11ft Flat (flatter, more glide)</option>\n                  <option value=\"9ft Flat\">9ft Flat (more aggressive)</option>\n                  <option value=\"8ft Flat\">8ft Flat (very aggressive)</option>\n                  <option value=\"Combo 10/12\">Combo 10/12</option>\n                  <option value=\"Combo 9/13\">Combo 9/13</option>\n                  <option value=\"Custom\">Custom — I'll describe below</option>\n                  <option value=\"Let EDGE Decide\">Let EDGE decide</option>\n                </select>",
    "<select id=\"fpref-profile-select\" style=\"width:100%;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius);color:#fff;padding:10px;font-size:14px;\">\n<option value=\"\">Select desired profile</option>\n<option value=\"Polaris\">Polaris</option>\n<option value=\"Quad 4.1\">Quad 4.1</option>\n<option value=\"Quad 4.2\">Quad 4.2</option>\n<option value=\"Triple 3.1\">Triple 3.1</option>\n<option value=\"7′–13′ Duo\">7′–13′ Duo</option>\n<option value=\"9.5′–10.5′ Duo\">9.5′–10.5′ Duo</option>\n<option value=\"SCS 1\">SCS 1</option>\n<option value=\"SCS 2\">SCS 2</option>\n<option value=\"10ft Flat\">10′ Mono (stock / generic)</option>\n<option value=\"Custom\">Custom — I’ll describe below</option>\n<option value=\"Let EDGE Decide\">Let EDGE Decide</option>\n</select>"
  ],
  [
    "const ORG_TEAMS = {\n  'Mission': [\n    'Mite (8U)', 'Squirt Minor (10U)', 'Squirt Major (10U)',\n    'Peewee Minor (12U)', 'Peewee Major (12U)',\n    'Bantam Minor (14U)', 'Bantam Major (15U)',\n    'Midget Minor (16U)', 'Midget Major (18U)'\n  ],\n  'Reapers': [\n    'Mite (8U)', 'Squirt Minor (10U)', 'Squirt Major (10U)',\n    'Peewee Minor (12U)', 'Peewee Major (12U)',\n    'Bantam Minor (14U)', 'Bantam Major (15U)',\n    'Midget Minor (16U)', 'Midget Major (18U)'\n  ],\n  'St. Viator': ['Freshman', 'JV', 'Varsity'],\n  'Other': ['Independent / Not listed']\n};",
    "// Catalog-only compatibility: never rewrite a player's saved team or profile.\nfunction edgeSetCatalogValue(select, value) {\n  if (!select) return;\n  select.querySelectorAll('option[data-edge-legacy]').forEach(option => option.remove());\n  const saved = value == null ? '' : String(value);\n  if (saved && !Array.from(select.options).some(option => option.value === saved)) {\n    const option = new Option(saved + ' (previous value — review before changing)', saved);\n    option.dataset.edgeLegacy = 'true';\n    option.disabled = true;\n    select.add(option);\n  }\n  select.value = saved;\n}\n\nfunction edgeTeamForFilter(player) {\n  if (player.organization !== 'Reapers') return player.team;\n  // Only unambiguous label equivalents. The old Bantam labels had conflicting ages.\n  const aliases = {\n    'Peewee Major (12U)': 'Peewee Major 12U',\n    'Midget Minor (16U)': 'U16',\n    'Midget Major (18U)': 'U18'\n  };\n  return aliases[player.team] || player.team;\n}\n\nfunction edgeTeamReviewNotice(selectId, players, organization) {\n  const select = document.getElementById(selectId);\n  if (!select) return;\n  const id = selectId + '-legacy-notice';\n  let note = document.getElementById(id);\n  const count = organization === 'Reapers' ? players.filter(player =>\n    player.organization === 'Reapers' && player.team &&\n    !ORG_TEAMS.Reapers.includes(edgeTeamForFilter(player))\n  ).length : 0;\n  if (!note && count) {\n    note = document.createElement('div');\n    note.id = id;\n    note.style.cssText = 'font-size:11px;line-height:1.4;color:var(--muted);margin-top:6px;max-width:260px';\n    note.setAttribute('role', 'status');\n    select.insertAdjacentElement('afterend', note);\n  }\n  if (note) {\n    note.hidden = !count;\n    note.textContent = count ? count + ' player(s) have older team labels. View All Teams to review; no teams were reassigned.' : '';\n  }\n}\n\nconst ORG_TEAMS = {\n  'Mission': [\n    'Mite (8U)', 'Squirt Minor (10U)', 'Squirt Major (10U)',\n    'Peewee Minor (12U)', 'Peewee Major (12U)',\n    'Bantam Minor (14U)', 'Bantam Major (15U)',\n    'Midget Minor (16U)', 'Midget Major (18U)'\n  ],\n  'Reapers': [\n    'Peewee Major 12U', 'Bantam Minor 13U', 'Bantam Major 14U',\n    '15 Only', 'U16', 'U18'\n  ],\n  'St. Viator': ['Freshman', 'JV', 'Varsity'],\n  'Other': ['Independent / Not listed']\n};"
  ],
  [
    "if (teamSel && currentProfile.team) teamSel.value = currentProfile.team;",
    "edgeSetCatalogValue(teamSel, currentProfile.team);"
  ],
  [
    "if (ppEl)  ppEl.value  = currentProfile.profile_preference || '';",
    "edgeSetCatalogValue(ppEl, currentProfile.profile_preference);"
  ],
  [
    "if (teamSel && p.team) teamSel.value = p.team;",
    "edgeSetCatalogValue(teamSel, p.team);"
  ],
  [
    "setVal('aed-profile-pref', p.profile_preference);",
    "edgeSetCatalogValue(document.getElementById('aed-profile-pref'), p.profile_preference);"
  ],
  [
    "if (team && p.team         !== team) return false;",
    "if (team && edgeTeamForFilter(p) !== team) return false;"
  ],
  [
    "if (team   && p.team         !== team) return false;",
    "if (team && edgeTeamForFilter(p) !== team) return false;"
  ],
  [
    "const filtered = allPlayersCache.filter(p => {",
    "edgeTeamReviewNotice('apf-team', allPlayersCache, org);\n  const filtered = allPlayersCache.filter((p) => {"
  ],
  [
    "svcVisible = svcAllPlayers.filter(p => {",
    "edgeTeamReviewNotice('svc-team', svcAllPlayers, org);\n  svcVisible = svcAllPlayers.filter((p) => {"
  ]
];
}
