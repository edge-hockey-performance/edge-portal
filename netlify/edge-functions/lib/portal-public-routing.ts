// Keep signed-out /register visits on the existing registration form.
// Applied by the same edge response transform that maintains portal copy.
// Explicit logout, signed-in routing, and PASSWORD_RECOVERY remain unchanged.
export const PUBLIC_AUTH_ROUTE_REPLACEMENTS = [
  [
    'function showView(id) {',
    `function showPublicAuthView() {
  const authParams = new URLSearchParams(window.location.search);
  const authHash = new URLSearchParams(window.location.hash.slice(1));
  const authCallback = authParams.has('code') || authHash.has('access_token') ||
    authParams.get('type') === 'recovery' || authHash.get('type') === 'recovery';
  const view = !authCallback && window.location.pathname === '/register'
    ? 'view-register' : 'view-login';
  showView(view);
}

function showView(id /* public auth routing installed */) {`,
  ],
  [
    "    else { showView('view-login'); }\n  });\n\n  // Auth state handler",
    "    else { showPublicAuthView(); }\n  });\n\n  // Auth state handler",
  ],
  [
    "      console.log('[EDGE] SIGNED_OUT confirmed — showing login');\n      currentUser = null; currentProfile = null; authorizedPlayers = []; isPortalStaff = false;\n      showView('view-login');",
    "      console.log('[EDGE] SIGNED_OUT confirmed — showing public auth view');\n      currentUser = null; currentProfile = null; authorizedPlayers = []; isPortalStaff = false;\n      showPublicAuthView();",
  ],
  [
    "          showView('view-login');\n          hideSessionLoader();\n        }\n        // else: keep loader visible",
    "          showPublicAuthView();\n          hideSessionLoader();\n        }\n        // else: keep loader visible",
  ],
  [
    "  // If no session key exists in localStorage, skip straight to login — no spinner needed.\n  const _hasStoredSession = !!localStorage.getItem('edge-portal-auth');\n  if (_hasStoredSession) {\n    showSessionLoader();\n  } else {\n    showView('view-login');\n  }",
    "  // Without a stored session, honor the requested public auth route.\n  const _hasStoredSession = !!localStorage.getItem('edge-portal-auth');\n  if (_hasStoredSession) {\n    showSessionLoader();\n  } else {\n    showPublicAuthView();\n  }",
  ],
  [
    "      console.warn('[EDGE] session loader timeout — forcing login view');\n      showView('view-login');",
    "      console.warn('[EDGE] session loader timeout — showing public auth view');\n      showPublicAuthView();",
  ],
] as const;
