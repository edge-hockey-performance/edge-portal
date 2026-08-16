(() => {
  'use strict';

  const MOBILE_QUERY = window.matchMedia('(max-width: 700px)');
  let lastFocusedElement = null;

  const ensureStyles = () => {
    if (document.getElementById('edge-mobile-ux-style')) return;
    const style = document.createElement('style');
    style.id = 'edge-mobile-ux-style';
    style.textContent = `
      .edge-more-sheet,.edge-more-backdrop{display:none}
      @media(max-width:700px){
        html{scroll-padding-top:72px}
        body{padding-bottom:calc(72px + env(safe-area-inset-bottom,0px))}
        .topnav{min-height:58px;padding:0 12px;gap:6px}
        .topnav-logo img{height:30px}
        .topnav-logo small{font-size:7px;letter-spacing:.2em}
        .topnav-user{gap:6px}
        .topnav-user>a{display:none}
        .topnav-user .nav-btn.logout{display:none}
        .user-avatar{width:36px;height:36px;cursor:pointer}
        .player-context-bar{position:sticky;top:58px;z-index:45;padding:8px 12px;gap:8px;background:rgba(10,10,10,.97)}
        .player-context-label{font-size:9px;letter-spacing:.09em}
        .player-context-select{min-height:42px;font-size:16px;padding:8px 34px 8px 10px}
        .page{padding:18px 14px 24px}
        .page-header{margin-bottom:24px;padding-bottom:0}
        .page-eyebrow{font-size:10px;letter-spacing:.16em}
        .page-title{font-size:clamp(27px,9vw,34px);line-height:.98}
        .page-sub{font-size:13px;line-height:1.5;margin-top:8px;max-width:36rem}
        .section{margin-bottom:24px}
        .section-header{margin-bottom:12px}
        .section-title{font-size:15px}
        .card.card-body{padding:18px}
        .dash-status-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px}
        .dash-status-card{min-width:0;padding:14px 12px}
        .dash-status-card-label{font-size:9px;letter-spacing:.08em;line-height:1.25}
        .dash-status-card-value{font-size:21px;line-height:1.05;margin-top:7px}
        .dash-status-card-sub{font-size:10px;line-height:1.35;margin-top:5px}
        #psub-dashboard .section .grid-2{grid-template-columns:1fr!important;gap:10px}
        #psub-dashboard .mobile-redundant-action{display:none!important}
        .btn{min-height:46px;font-size:13px;padding:11px 14px;touch-action:manipulation}
        .btn.btn-sm{min-height:42px}
        input,select,textarea{font-size:16px!important;min-height:46px}
        textarea{min-height:108px}
        label{line-height:1.35}
        .profile-item{padding:11px 0;gap:14px}
        .profile-key{font-size:10px}
        .profile-val{font-size:13px;text-align:right;overflow-wrap:anywhere}
        .mobile-bottom-nav{height:calc(66px + env(safe-area-inset-bottom,0px));overflow:visible;padding:0 8px env(safe-area-inset-bottom,0px);justify-content:space-around}
        .mobile-nav-btn{flex:1 1 25%;min-width:0;max-width:110px;min-height:58px;font-size:9px;gap:4px;padding:5px 4px}
        .mobile-nav-icon{font-size:19px}
        .mobile-nav-btn.edge-mobile-hidden{display:none!important}
        .edge-more-backdrop{position:fixed;inset:0;z-index:290;background:rgba(0,0,0,.58);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
        .edge-more-backdrop.open{display:block}
        .edge-more-sheet{position:fixed;left:0;right:0;bottom:0;z-index:300;display:block;transform:translateY(105%);transition:transform .22s ease;background:linear-gradient(180deg,#17191e,#0c0d10);border:1px solid rgba(255,255,255,.12);border-bottom:0;border-radius:18px 18px 0 0;padding:10px 14px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -22px 60px rgba(0,0,0,.55);visibility:hidden}
        .edge-more-sheet.open{transform:translateY(0);visibility:visible}
        .edge-more-handle{width:42px;height:4px;border-radius:99px;background:rgba(255,255,255,.22);margin:2px auto 14px}
        .edge-more-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .edge-more-title{font-family:var(--fh);font-size:20px;font-style:italic;font-weight:900;text-transform:uppercase;color:#fff}
        .edge-more-close{width:42px;height:42px;border:1px solid var(--border);border-radius:50%;background:rgba(255,255,255,.04);color:#fff;font-size:20px;cursor:pointer}
        .edge-more-list{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        .edge-more-action{min-height:62px;display:flex;align-items:center;gap:11px;text-align:left;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,.035);color:#fff;padding:12px;font:inherit;cursor:pointer}
        .edge-more-action:active{background:rgba(184,212,232,.1)}
        .edge-more-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:rgba(184,212,232,.08);font-size:16px;flex:0 0 auto}
        .edge-more-label{font-family:var(--fh);font-size:13px;font-style:italic;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
        .edge-more-action.edge-more-wide{grid-column:1/-1}
        .edge-more-action.edge-more-danger{color:#ff9c9c;border-color:rgba(240,82,82,.2)}
        body.edge-more-open{overflow:hidden}
      }
      @media(max-width:370px){
        .page{padding-left:11px;padding-right:11px}
        .dash-status-card{padding:12px 10px}
        .dash-status-card-value{font-size:19px}
        .edge-more-list{grid-template-columns:1fr}
        .edge-more-action.edge-more-wide{grid-column:auto}
      }
      @media(prefers-reduced-motion:reduce){
        .edge-more-sheet{transition:none}
      }
    `;
    document.head.appendChild(style);
  };

  const buildMoreSheet = () => {
    if (document.getElementById('edge-more-sheet')) return;
    const backdrop = document.createElement('div');
    backdrop.className = 'edge-more-backdrop';
    backdrop.id = 'edge-more-backdrop';
    backdrop.setAttribute('aria-hidden', 'true');

    const sheet = document.createElement('section');
    sheet.className = 'edge-more-sheet';
    sheet.id = 'edge-more-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'edge-more-title');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.innerHTML = `
      <div class="edge-more-handle" aria-hidden="true"></div>
      <div class="edge-more-head">
        <div class="edge-more-title" id="edge-more-title">More</div>
        <button class="edge-more-close" type="button" aria-label="Close menu">×</button>
      </div>
      <div class="edge-more-list">
        <button class="edge-more-action" type="button" data-edge-destination="conditionlog"><span class="edge-more-icon">💬</span><span class="edge-more-label">Feedback</span></button>
        <button class="edge-more-action" type="button" data-edge-destination="profile"><span class="edge-more-icon">◉</span><span class="edge-more-label">Profile</span></button>
        <button class="edge-more-action" type="button" data-edge-destination="membership"><span class="edge-more-icon">◇</span><span class="edge-more-label">Membership</span></button>
        <a class="edge-more-action" href="https://edgehockeyperformance.com" target="_blank" rel="noopener"><span class="edge-more-icon">↗</span><span class="edge-more-label">EDGE Site</span></a>
        <button class="edge-more-action edge-more-wide edge-more-danger" type="button" data-edge-signout><span class="edge-more-icon">↪</span><span class="edge-more-label">Sign Out</span></button>
      </div>`;
    document.body.append(backdrop, sheet);

    backdrop.addEventListener('click', closeMoreSheet);
    sheet.querySelector('.edge-more-close')?.addEventListener('click', closeMoreSheet);
    sheet.querySelectorAll('[data-edge-destination]').forEach((button) => {
      button.addEventListener('click', () => {
        const destination = button.getAttribute('data-edge-destination');
        closeMoreSheet();
        if (destination) window.playerNav?.(destination);
      });
    });
    sheet.querySelector('[data-edge-signout]')?.addEventListener('click', () => {
      closeMoreSheet();
      window.logout?.();
    });
  };

  const openMoreSheet = () => {
    if (!MOBILE_QUERY.matches) return;
    lastFocusedElement = document.activeElement;
    const sheet = document.getElementById('edge-more-sheet');
    const backdrop = document.getElementById('edge-more-backdrop');
    sheet?.classList.add('open');
    backdrop?.classList.add('open');
    sheet?.setAttribute('aria-hidden', 'false');
    document.body.classList.add('edge-more-open');
    document.getElementById('mnav-more')?.classList.add('active');
    sheet?.querySelector('.edge-more-close')?.focus();
  };

  function closeMoreSheet() {
    const sheet = document.getElementById('edge-more-sheet');
    const backdrop = document.getElementById('edge-more-backdrop');
    sheet?.classList.remove('open');
    backdrop?.classList.remove('open');
    sheet?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('edge-more-open');
    if (lastFocusedElement instanceof HTMLElement) lastFocusedElement.focus();
  }

  const configureMobileNav = () => {
    const nav = document.getElementById('mobile-player-nav');
    if (!nav) return;
    ['mnav-conditionlog', 'mnav-profile'].forEach((id) => document.getElementById(id)?.classList.add('edge-mobile-hidden'));
    nav.querySelector('a[href*="edgehockeyperformance.com"]')?.classList.add('edge-mobile-hidden');

    const dashboard = document.getElementById('mnav-dashboard');
    if (dashboard) dashboard.querySelector('span:last-child').textContent = 'Home';

    let more = document.getElementById('mnav-more');
    if (!more) {
      more = document.createElement('button');
      more.className = 'mobile-nav-btn';
      more.id = 'mnav-more';
      more.type = 'button';
      more.setAttribute('aria-haspopup', 'dialog');
      more.setAttribute('aria-controls', 'edge-more-sheet');
      more.innerHTML = '<span class="mobile-nav-icon">•••</span><span>More</span>';
      more.addEventListener('click', openMoreSheet);
      nav.appendChild(more);
    }
  };

  const optimizeQuickActions = () => {
    const grid = document.querySelector('#psub-dashboard .section .grid-2');
    if (!grid) return;
    grid.querySelectorAll('button').forEach((button) => {
      const label = button.textContent.trim().toLowerCase();
      if (label.includes('blade history') || label.includes('ice time') || label === 'my profile') {
        button.classList.add('mobile-redundant-action');
      }
    });
  };

  const enhanceTopBar = () => {
    const avatar = document.getElementById('player-avatar-nav');
    if (!avatar || avatar.dataset.edgeMoreTrigger) return;
    avatar.dataset.edgeMoreTrigger = 'true';
    avatar.setAttribute('role', 'button');
    avatar.setAttribute('tabindex', '0');
    avatar.setAttribute('aria-label', 'Open account menu');
    avatar.addEventListener('click', openMoreSheet);
    avatar.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMoreSheet();
      }
    });
  };

  const wrapNavigation = () => {
    const original = window.playerNav;
    if (typeof original !== 'function' || original.__edgeMobileUx) return;
    const mobilePlayerNav = (sub, ...args) => {
      closeMoreSheet();
      const result = original(sub, ...args);
      const more = document.getElementById('mnav-more');
      const grouped = ['conditionlog', 'profile', 'membership'].includes(sub);
      more?.classList.toggle('active', grouped);
      if (!grouped) more?.classList.remove('active');
      return result;
    };
    mobilePlayerNav.__edgeMobileUx = true;
    window.playerNav = mobilePlayerNav;
  };

  const handleKeyboard = (event) => {
    const sheet = document.getElementById('edge-more-sheet');
    if (!sheet?.classList.contains('open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeMoreSheet();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...sheet.querySelectorAll('button,a[href]')].filter((element) => !element.hasAttribute('disabled'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const install = () => {
    ensureStyles();
    buildMoreSheet();
    configureMobileNav();
    optimizeQuickActions();
    enhanceTopBar();
    wrapNavigation();
    document.addEventListener('keydown', handleKeyboard);
    const dashboard = document.getElementById('psub-dashboard');
    if (dashboard) {
      new MutationObserver(() => optimizeQuickActions()).observe(dashboard, { childList: true, subtree: true });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(install, 20), { once: true });
  } else {
    setTimeout(install, 20);
  }
})();
