// ============================================================================
// dashboard.js — Agent & Manager dashboards. All numbers are computed live
// from the database — nothing here is hard-coded.
// ============================================================================

async function initDashboardPage() {
  const content = initAppShell('dashboard');
  const profile = CURRENT_PROFILE;
  const now = new Date();
  const greeting = now.getHours() < 12 ? 'Good Morning' : now.getHours() < 17 ? 'Good Afternoon' : 'Good Evening';
  const dateLine = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  content.innerHTML = `
    <div class="flex-between welcome-block">
      <div>
        <h1>${greeting}, ${escapeHtml(profile.full_name.split(' ')[0])}</h1>
        <div class="date-line">${dateLine}</div>
      </div>
      <div class="month-selector">
        <select id="dash-month"></select>
      </div>
    </div>

    <div class="summary-grid" id="summary-cards">
      ${Array.from({ length: 7 }).map(() => `<div class="summary-card"><div class="skeleton" style="height:14px;width:60%"></div><div class="skeleton mt-3" style="height:26px;width:80%"></div></div>`).join('')}
    </div>

    <div class="card mt-6">
      <h3 class="mb-4">Today's Collection Actions</h3>
      <div class="stat-strip" id="today-stat-strip"></div>
      <div id="today-actions-list"><div class="page-loading"><span class="spinner"></span> Loading…</div></div>
    </div>

    <div class="dashboard-grid">
      <div class="card">
        <h3 class="mb-4">Today's Follow-ups</h3>
        <div id="today-followups"><div class="page-loading"><span class="spinner"></span> Loading…</div></div>
      </div>
      <div class="card">
        <h3 class="mb-4">Promise to Pay</h3>
        <div id="promise-to-pay-list"><div class="page-loading"><span class="spinner"></span> Loading…</div></div>
      </div>
    </div>

    ${isManager() ? `
    <div class="card mt-6">
      <h3 class="mb-4">Agent Performance This Month</h3>
      <div id="agent-performance"><div class="page-loading"><span class="spinner"></span> Loading…</div></div>
    </div>` : ''}
  `;

  // month selector
  const monthSelect = document.getElementById('dash-month');
  monthSelect.innerHTML = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return `<option value="${d.getFullYear()}-${d.getMonth()}" ${i === 0 ? 'selected' : ''}>${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}</option>`;
  }).join('');
  monthSelect.addEventListener('change', () => loadDashboardSummary(monthSelect.value));

  await Promise.all([
    loadDashboardSummary(monthSelect.value),
    loadTodaysActions(),
    loadTodaysFollowUps(),
    loadPromiseToPay(),
    isManager() ? loadAgentPerformance(monthSelect.value) : Promise.resolve()
  ]);
}

async function loadDashboardSummary(monthValue) {
  const [year, monthIdx] = monthValue.split('-').map(Number);
  const from = firstDayOfMonth(year, monthIdx);
  const to = lastDayOfMonth(year, monthIdx);

  const [{ data: activeCustomers }, { data: activePolicies }, { data: monthSchedules }, { data: monthPayments }, { data: overdueSchedules }] = await Promise.all([
    supabaseClient.from('customers').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabaseClient.from('policies').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabaseClient.from('premium_schedules').select('amount, status').gte('due_date', from).lte('due_date', to),
    supabaseClient.from('payments').select('amount').gte('payment_date', from).lte('payment_date', to),
    supabaseClient.from('premium_schedules').select('amount').lt('due_date', toDateInputValue(todayDateOnly())).neq('status', 'paid')
  ]);

  const custCountRes = await supabaseClient.from('customers').select('*', { count: 'exact', head: true }).eq('is_active', true);
  const polCountRes = await supabaseClient.from('policies').select('*', { count: 'exact', head: true }).eq('status', 'active');

  const expected = (monthSchedules || []).reduce((s, r) => s + Number(r.amount), 0);
  const collected = (monthPayments || []).reduce((s, r) => s + Number(r.amount), 0);
  const pending = Math.max(expected - collected, 0);
  const overdue = (overdueSchedules || []).reduce((s, r) => s + Number(r.amount), 0);
  const rate = expected > 0 ? Math.min((collected / expected) * 100, 100) : 0;

  const cards = [
    { label: 'Total Customers', value: custCountRes.count ?? 0, sub: 'Active customers' },
    { label: 'Active Policies', value: polCountRes.count ?? 0, sub: 'Currently active' },
    { label: 'Expected This Month', value: formatINR(expected), sub: '' },
    { label: 'Collected', value: formatINR(collected), sub: '', color: 'var(--color-success)' },
    { label: 'Pending', value: formatINR(pending), sub: '', color: 'var(--color-warning)' },
    { label: 'Overdue', value: formatINR(overdue), sub: 'All-time overdue', color: 'var(--color-danger)' },
    { label: 'Collection Rate', value: `${rate.toFixed(1)}%`, sub: '' }
  ];

  document.getElementById('summary-cards').innerHTML = cards.map(c => `
    <div class="summary-card">
      <div class="sc-label">${c.label}</div>
      <div class="sc-value" style="${c.color ? `color:${c.color}` : ''}">${c.value}</div>
      ${c.sub ? `<div class="sc-sub">${c.sub}</div>` : ''}
    </div>
  `).join('');
}

async function loadTodaysActions() {
  const today = toDateInputValue(todayDateOnly());
  const next7 = toDateInputValue(new Date(todayDateOnly().getTime() + 7 * 86400000));

  const [{ data: dueToday }, { data: overdue }, { data: due7 }, { data: pendingReminders }] = await Promise.all([
    supabaseClient.from('premium_schedules').select('*, customers(full_name, mobile), policies(policy_number)').eq('due_date', today).neq('status', 'paid'),
    supabaseClient.from('premium_schedules').select('amount').lt('due_date', today).neq('status', 'paid'),
    supabaseClient.from('premium_schedules').select('amount').gt('due_date', today).lte('due_date', next7).neq('status', 'paid'),
    supabaseClient.from('premium_schedules').select('id', { count: 'exact', head: true }).lte('due_date', next7).neq('status', 'paid').is('reminder_status', null)
  ]);

  const overdueSum = (overdue || []).reduce((s, r) => s + Number(r.amount), 0);
  const due7Sum = (due7 || []).reduce((s, r) => s + Number(r.amount), 0);
  const dueTodaySum = (dueToday || []).reduce((s, r) => s + Number(r.amount), 0);

  document.getElementById('today-stat-strip').innerHTML = `
    <div class="stat-pill"><div class="sp-count">${(dueToday || []).length}</div><div class="sp-amount">${formatINR(dueTodaySum)}</div><div class="sp-label">Due Today</div></div>
    <div class="stat-pill"><div class="sp-count">${(overdue || []).length}</div><div class="sp-amount">${formatINR(overdueSum)}</div><div class="sp-label">Overdue</div></div>
    <div class="stat-pill"><div class="sp-count">${(due7 || []).length}</div><div class="sp-amount">${formatINR(due7Sum)}</div><div class="sp-label">Due Within 7 Days</div></div>
    <div class="stat-pill"><div class="sp-count">${pendingReminders?.length ?? 0}</div><div class="sp-amount">&nbsp;</div><div class="sp-label">Reminders Pending</div></div>
  `;

  const listEl = document.getElementById('today-actions-list');
  if (!dueToday || dueToday.length === 0) {
    listEl.innerHTML = `<div class="empty-state">No premiums due today 🎉</div>`;
    return;
  }
  listEl.innerHTML = `<div class="action-list">${dueToday.map(r => `
    <div class="action-list-item">
      <div class="ali-main">
        <div class="ali-title">${escapeHtml(r.customers?.full_name || '')} — ${formatINR(r.amount)}</div>
        <div class="ali-sub">${escapeHtml(r.policies?.policy_number || '')} · Due ${formatDate(r.due_date)}</div>
      </div>
      <div class="ali-actions">
        <button class="btn btn-whatsapp btn-sm act-wa" data-id="${r.id}">WhatsApp</button>
        <button class="btn btn-success btn-sm act-paid" data-id="${r.id}">Mark Paid</button>
      </div>
    </div>
  `).join('')}</div>`;

  listEl.querySelectorAll('.act-wa').forEach(btn => btn.addEventListener('click', () => openWhatsAppReminderModal(btn.dataset.id, initDashboardPage)));
  listEl.querySelectorAll('.act-paid').forEach(btn => btn.addEventListener('click', () => openMarkPaidModal(btn.dataset.id, initDashboardPage)));
}

async function loadTodaysFollowUps() {
  const today = toDateInputValue(todayDateOnly());
  const { data, error } = await supabaseClient
    .from('follow_ups')
    .select('*, customers(full_name, mobile)')
    .eq('follow_up_date', today)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const el = document.getElementById('today-followups');
  if (error) { el.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }
  if (!data || data.length === 0) { el.innerHTML = `<div class="empty-state">No follow-ups due today.</div>`; return; }

  el.innerHTML = `<div class="action-list">${data.map(f => `
    <div class="action-list-item">
      <div class="ali-main">
        <div class="ali-title">${escapeHtml(f.customers?.full_name || '')}</div>
        <div class="ali-sub">${FOLLOWUP_TYPE_LABELS[f.follow_up_type]}${f.notes ? ' · ' + escapeHtml(f.notes) : ''}</div>
      </div>
      <div class="ali-actions">
        <button class="btn btn-secondary btn-sm fu-call" data-phone="${escapeHtml(f.customers?.mobile || '')}">Call</button>
        <button class="btn btn-whatsapp btn-sm fu-wa" data-phone="${escapeHtml(f.customers?.mobile || '')}" data-name="${escapeHtml(f.customers?.full_name || '')}">WhatsApp</button>
        <button class="btn btn-success btn-sm fu-complete" data-id="${f.id}">Complete</button>
        <button class="btn btn-ghost btn-sm fu-reschedule" data-id="${f.id}">Reschedule</button>
      </div>
    </div>
  `).join('')}</div>`;

  el.querySelectorAll('.fu-call').forEach(btn => btn.addEventListener('click', () => { window.location.href = `tel:${btn.dataset.phone}`; }));
  el.querySelectorAll('.fu-wa').forEach(btn => btn.addEventListener('click', () => openWhatsApp(btn.dataset.phone, `Hello ${btn.dataset.name}, `)));
  el.querySelectorAll('.fu-complete').forEach(btn => btn.addEventListener('click', () => completeFollowUp(btn.dataset.id, loadTodaysFollowUps)));
  el.querySelectorAll('.fu-reschedule').forEach(btn => btn.addEventListener('click', () => openRescheduleFollowUpModal(btn.dataset.id, loadTodaysFollowUps)));
}

async function loadPromiseToPay() {
  const { data, error } = await supabaseClient
    .from('premium_schedules')
    .select('*, customers(full_name, mobile), policies(policy_number)')
    .eq('status', 'promise_to_pay')
    .order('promise_date', { ascending: true })
    .limit(10);

  const el = document.getElementById('promise-to-pay-list');
  if (error) { el.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }
  if (!data || data.length === 0) { el.innerHTML = `<div class="empty-state">No promise-to-pay entries.</div>`; return; }

  el.innerHTML = `<div class="action-list">${data.map(r => `
    <div class="action-list-item">
      <div class="ali-main">
        <div class="ali-title">${escapeHtml(r.customers?.full_name || '')} — ${formatINR(r.amount)}</div>
        <div class="ali-sub">Promised ${formatDate(r.promise_date)} · ${escapeHtml(r.policies?.policy_number || '')}</div>
      </div>
      <button class="btn btn-success btn-sm act-paid" data-id="${r.id}">Mark Paid</button>
    </div>
  `).join('')}</div>`;
  el.querySelectorAll('.act-paid').forEach(btn => btn.addEventListener('click', () => openMarkPaidModal(btn.dataset.id, initDashboardPage)));
}

async function loadAgentPerformance(monthValue) {
  const [year, monthIdx] = monthValue.split('-').map(Number);
  const from = firstDayOfMonth(year, monthIdx);
  const to = lastDayOfMonth(year, monthIdx);
  const el = document.getElementById('agent-performance');

  const { data: agents, error: agentErr } = await supabaseClient.from('profiles').select('id, full_name').eq('role', 'agent');
  if (agentErr) { el.innerHTML = `<div class="text-danger">${friendlyError(agentErr)}</div>`; return; }
  if (!agents || agents.length === 0) { el.innerHTML = `<div class="empty-state">No agents on your team yet.</div>`; return; }

  const rows = await Promise.all(agents.map(async (a) => {
    const [{ data: sched }, { data: pay }] = await Promise.all([
      supabaseClient.from('premium_schedules').select('amount').eq('agent_id', a.id).gte('due_date', from).lte('due_date', to),
      supabaseClient.from('payments').select('amount').eq('agent_id', a.id).gte('payment_date', from).lte('payment_date', to)
    ]);
    const expected = (sched || []).reduce((s, r) => s + Number(r.amount), 0);
    const collected = (pay || []).reduce((s, r) => s + Number(r.amount), 0);
    return { name: a.full_name, expected, collected, pending: Math.max(expected - collected, 0), rate: expected > 0 ? (collected / expected) * 100 : 0 };
  }));

  el.innerHTML = `
    <div class="data-table-scroll" style="overflow-x:auto">
      <table class="data-table">
        <thead><tr><th>Agent</th><th class="num">Expected</th><th class="num">Collected</th><th class="num">Pending</th><th class="num">Collection %</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr><td>${escapeHtml(r.name)}</td><td class="num">${formatINR(r.expected)}</td><td class="num">${formatINR(r.collected)}</td><td class="num">${formatINR(r.pending)}</td><td class="num">${r.rate.toFixed(1)}%</td></tr>`).join('')}
        </tbody>
      </table>
    </div>
  `;
}
