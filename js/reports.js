// ============================================================================
// reports.js — Reports page with multiple report tabs.
// ============================================================================

async function initReportsPage() {
  const content = initAppShell('reports');
  content.innerHTML = `
    <div class="section-header"><h2>Reports</h2></div>
    <div class="tabs">
      <button class="tab-btn active" data-tab="monthly">Monthly Collection</button>
      <button class="tab-btn" data-tab="daily">Daily Collection</button>
      ${isManager() ? '<button class="tab-btn" data-tab="agent">Agent Collection</button>' : ''}
      <button class="tab-btn" data-tab="overdue">Overdue Report</button>
      <button class="tab-btn" data-tab="reminder">Reminder Report</button>
    </div>
    <div id="report-body"><div class="page-loading"><span class="spinner"></span> Loading…</div></div>
  `;

  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderReportTab(btn.dataset.tab);
  }));

  await renderReportTab('monthly');
}

async function renderReportTab(tab) {
  const body = document.getElementById('report-body');
  body.innerHTML = `<div class="page-loading"><span class="spinner"></span> Loading…</div>`;
  if (tab === 'monthly') return renderMonthlyReport(body);
  if (tab === 'daily') return renderDailyReport(body);
  if (tab === 'agent') return renderAgentReport(body);
  if (tab === 'overdue') return renderOverdueReport(body);
  if (tab === 'reminder') return renderReminderReport(body);
}

async function renderMonthlyReport(body) {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
  const rows = await Promise.all(months.map(async (d) => {
    const from = firstDayOfMonth(d.getFullYear(), d.getMonth());
    const to = lastDayOfMonth(d.getFullYear(), d.getMonth());
    const [{ data: sched }, { data: pay }] = await Promise.all([
      supabaseClient.from('premium_schedules').select('amount').gte('due_date', from).lte('due_date', to),
      supabaseClient.from('payments').select('amount').gte('payment_date', from).lte('payment_date', to)
    ]);
    const expected = (sched || []).reduce((s, r) => s + Number(r.amount), 0);
    const collected = (pay || []).reduce((s, r) => s + Number(r.amount), 0);
    return { label: `${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}`, expected, collected, pending: Math.max(expected - collected, 0), rate: expected > 0 ? (collected / expected) * 100 : 0 };
  }));
  body.innerHTML = reportTable(
    ['Month', 'Expected', 'Collected', 'Pending', 'Collection %'],
    rows.map(r => [r.label, formatINR(r.expected), formatINR(r.collected), formatINR(r.pending), r.rate.toFixed(1) + '%'])
  );
}

async function renderDailyReport(body) {
  const today = todayDateOnly();
  const from = new Date(today.getTime() - 13 * 86400000);
  const { data, error } = await supabaseClient.from('payments').select('amount, payment_date').gte('payment_date', toDateInputValue(from)).lte('payment_date', toDateInputValue(today));
  if (error) { body.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }

  const byDay = {};
  (data || []).forEach(p => { byDay[p.payment_date] = (byDay[p.payment_date] || 0) + Number(p.amount); });
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = toDateInputValue(new Date(from.getTime() + i * 86400000));
    rows.push([formatDate(d), formatINR(byDay[d] || 0)]);
  }
  body.innerHTML = reportTable(['Date', 'Collected'], rows.reverse());
}

async function renderAgentReport(body) {
  const now = new Date();
  const from = firstDayOfMonth(now.getFullYear(), now.getMonth());
  const to = lastDayOfMonth(now.getFullYear(), now.getMonth());
  const { data: agents, error } = await supabaseClient.from('profiles').select('id, full_name').eq('role', 'agent');
  if (error) { body.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }
  const rows = await Promise.all((agents || []).map(async (a) => {
    const [{ data: sched }, { data: pay }] = await Promise.all([
      supabaseClient.from('premium_schedules').select('amount').eq('agent_id', a.id).gte('due_date', from).lte('due_date', to),
      supabaseClient.from('payments').select('amount').eq('agent_id', a.id).gte('payment_date', from).lte('payment_date', to)
    ]);
    const expected = (sched || []).reduce((s, r) => s + Number(r.amount), 0);
    const collected = (pay || []).reduce((s, r) => s + Number(r.amount), 0);
    return [a.full_name, formatINR(expected), formatINR(collected), formatINR(Math.max(expected - collected, 0)), (expected > 0 ? (collected / expected) * 100 : 0).toFixed(1) + '%'];
  }));
  body.innerHTML = reportTable(['Agent', 'Expected', 'Collected', 'Pending', 'Collection %'], rows);
}

async function renderOverdueReport(body) {
  const today = toDateInputValue(todayDateOnly());
  const { data, error } = await supabaseClient
    .from('premium_schedules')
    .select('amount, due_date, last_reminder_at, customers(full_name), policies(policy_number)')
    .lt('due_date', today).neq('status', 'paid')
    .order('due_date', { ascending: true })
    .limit(200);
  if (error) { body.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }
  if (!data || data.length === 0) { body.innerHTML = `<div class="empty-state">No overdue premiums 🎉</div>`; return; }
  const rows = data.map(r => [
    r.customers?.full_name || '', r.policies?.policy_number || '', formatINR(r.amount), formatDate(r.due_date),
    daysBetween(parseDateOnly(r.due_date), todayDateOnly()) + ' days', r.last_reminder_at ? formatDateTime(r.last_reminder_at) : 'Never'
  ]);
  body.innerHTML = reportTable(['Customer', 'Policy', 'Amount', 'Due Date', 'Days Overdue', 'Last Reminder'], rows);
}

async function renderReminderReport(body) {
  const { data, error } = await supabaseClient
    .from('whatsapp_reminders')
    .select('created_at, reminder_type, status, customers(full_name), policies(policy_number)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) { body.innerHTML = `<div class="text-danger">${friendlyError(error)}</div>`; return; }
  if (!data || data.length === 0) { body.innerHTML = `<div class="empty-state">No reminders sent yet.</div>`; return; }
  const rows = data.map(r => [
    r.customers?.full_name || '', r.policies?.policy_number || '', formatDateTime(r.created_at),
    REMINDER_TYPE_LABELS[r.reminder_type] || r.reminder_type,
    r.status === 'marked_sent' ? 'Marked as Sent' : 'Opened'
  ]);
  body.innerHTML = reportTable(['Customer', 'Policy', 'Reminder Date', 'Reminder Type', 'Status'], rows);
}

function reportTable(headers, rows) {
  return `
    <div class="table-wrap">
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}
