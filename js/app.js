// ============================================================================
// app.js — renders the shared sidebar/topbar shell and wires up navigation,
// global search, and the user menu. Call initAppShell('dashboard') from
// each page after requireAuth() succeeds.
// ============================================================================

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', page: 'dashboard.html', icon: 'M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V10.5Z' },
  { key: 'customers', label: 'Customers', page: 'customers.html', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0' },
  { key: 'policies', label: 'Policies', page: 'policies.html', icon: 'M7 3h8l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm7 8H9m6 4H9' },
  { key: 'premiums', label: 'Premium Collection', page: 'premiums.html', icon: 'M4 6h16M4 12h16M4 18h10' },
  { key: 'payments', label: 'Payments', page: 'payments.html', icon: 'M3 7h18v10H3zM3 10h18' },
  { key: 'reminders', label: 'WhatsApp Reminders', page: 'reminders.html', icon: 'M12 3a9 9 0 1 0 5.3 16.3L21 20l-1.3-3.6A9 9 0 0 0 12 3Z' },
  { key: 'reports', label: 'Reports', page: 'reports.html', icon: 'M4 20V10m6 10V4m6 16v-7' },
  { key: 'settings', label: 'Settings', page: 'settings.html', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8-3a8 8 0 0 0-.15-1.5l2-1.5-2-3.4-2.3.9a8 8 0 0 0-2.6-1.5L14.5 3h-5l-.45 2.5a8 8 0 0 0-2.6 1.5l-2.3-.9-2 3.4 2 1.5A8 8 0 0 0 4 12c0 .5.05 1 .15 1.5l-2 1.5 2 3.4 2.3-.9c.77.65 1.65 1.16 2.6 1.5L9.5 21h5l.45-2.5a8 8 0 0 0 2.6-1.5l2.3.9 2-3.4-2-1.5c.1-.5.15-1 .15-1.5Z' }
];

function iconSvg(path) {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path.split('M').filter(Boolean).map(p => `<path d="M${p}"/>`).join('')}</svg>`;
}

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase();
}

function initAppShell(activeKey) {
  const profile = CURRENT_PROFILE;
  const role = profile?.role === 'manager' ? 'Manager' : 'Agent';

  const navHtml = NAV_ITEMS.map(item => `
    <a class="nav-item ${item.key === activeKey ? 'active' : ''}" href="${item.page}">
      ${iconSvg(item.icon)}<span>${item.label}</span>
    </a>
  `).join('');

  const shell = document.createElement('div');
  shell.className = 'app-shell';
  shell.innerHTML = `
    <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
    <aside class="sidebar" id="app-sidebar">
      <div class="sidebar-brand"><span class="logo-dot"></span> Policy Pulse</div>
      <nav class="sidebar-nav">${navHtml}</nav>
      <div class="sidebar-footer text-muted">${role} workspace</div>
    </aside>
    <div class="main-content">
      <header class="topbar">
        <div class="flex-gap">
          <button class="mobile-menu-btn btn btn-icon btn-ghost" id="mobile-menu-btn" aria-label="Menu">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
          </button>
          <div class="search-box">
            <span class="search-icon">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            </span>
            <input type="text" id="global-search" placeholder="Search customer, mobile, policy number…" autocomplete="off">
            <div class="search-results hidden" id="global-search-results"></div>
          </div>
        </div>
        <div class="user-chip" id="user-menu-trigger">
          <div class="avatar">${initials(profile?.full_name)}</div>
          <div>
            <div style="font-size:var(--fs-sm);font-weight:600;">${escapeHtml(profile?.full_name || '')}</div>
            <div style="font-size:var(--fs-xs);color:var(--color-text-muted);">${role}</div>
          </div>
        </div>
      </header>
      <main class="page-body" id="page-content"></main>
    </div>
  `;
  document.body.prepend(shell);

  // mobile menu toggle
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  document.getElementById('mobile-menu-btn').addEventListener('click', () => {
    sidebar.classList.add('open');
    backdrop.classList.add('open');
  });
  backdrop.addEventListener('click', () => {
    sidebar.classList.remove('open');
    backdrop.classList.remove('open');
  });

  // user menu -> simple click = logout confirm (kept minimal, no extra dropdown lib)
  document.getElementById('user-menu-trigger').addEventListener('click', () => {
    openModal(`
      <div class="modal-header"><h3>${escapeHtml(profile?.full_name || '')}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
      <div class="modal-body">
        <p class="text-secondary">${escapeHtml(profile?.email || '')}</p>
        <p class="text-muted mt-2" style="font-size:var(--fs-xs)">Role: ${role}</p>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="closeModal()">Close</button>
        <button class="btn btn-danger" id="logout-btn">Log Out</button>
      </div>
    `);
    document.getElementById('logout-btn').addEventListener('click', logout);
  });

  // global search
  const searchInput = document.getElementById('global-search');
  const searchResults = document.getElementById('global-search-results');
  const runSearch = debounce(async (term) => {
    if (!term || term.trim().length < 2) {
      searchResults.classList.add('hidden');
      searchResults.innerHTML = '';
      return;
    }
    const results = await globalSearch(term.trim());
    renderSearchResults(results);
  }, 300);
  searchInput.addEventListener('input', (e) => runSearch(e.target.value));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      searchResults.classList.add('hidden');
    }
  });

  function renderSearchResults(results) {
    if (!results.length) {
      searchResults.innerHTML = `<div class="search-result-item text-muted">No matches found.</div>`;
      searchResults.classList.remove('hidden');
      return;
    }
    searchResults.innerHTML = results.map(r => `
      <div class="search-result-item" data-href="${r.href}">
        <div class="sr-title">${escapeHtml(r.title)}</div>
        <div class="sr-sub">${escapeHtml(r.subtitle)}</div>
      </div>
    `).join('');
    searchResults.classList.remove('hidden');
    searchResults.querySelectorAll('.search-result-item[data-href]').forEach(el => {
      el.addEventListener('click', () => { window.location.href = el.dataset.href; });
    });
  }

  return document.getElementById('page-content');
}

// Searches customers (name/mobile) and policies (policy_number), respecting
// RLS automatically (agents only see their own, managers see their team's).
async function globalSearch(term) {
  const results = [];
  const [custRes, polRes] = await Promise.all([
    supabaseClient
      .from('customers')
      .select('id, full_name, mobile')
      .or(`full_name.ilike.%${term}%,mobile.ilike.%${term}%`)
      .limit(6),
    supabaseClient
      .from('policies')
      .select('id, policy_number, plan_name, customer_id, customers(full_name)')
      .ilike('policy_number', `%${term}%`)
      .limit(6)
  ]);

  (custRes.data || []).forEach(c => {
    results.push({ title: c.full_name, subtitle: c.mobile, href: `customer-details.html?id=${c.id}` });
  });
  (polRes.data || []).forEach(p => {
    results.push({ title: p.policy_number, subtitle: `${p.plan_name} — ${p.customers?.full_name || ''}`, href: `customer-details.html?id=${p.customer_id}` });
  });
  return results;
}
