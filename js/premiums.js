// ============================================================================
// premiums.js — schedule generation + Premium Collection page.
// ============================================================================

const FREQ_MONTHS = { monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };

function addMonths(dateStr, months) {
  const d = parseDateOnly(dateStr);
  const result = new Date(d.getFullYear(), d.getMonth() + months, d.getDate());
  return toDateInputValue(result);
}

// Builds the list of {due_date, amount} installments for a policy, starting
// from start_date, for the requested horizon (in months). Does not touch
// the database — see insertPremiumSchedule for that.
function buildScheduleInstallments(startDate, amount, frequency, horizonMonths) {
  const step = FREQ_MONTHS[frequency];
  if (!step) throw new Error('Unknown payment frequency');
  const installments = [];
  let cursor = startDate;
  let monthsElapsed = 0;
  while (monthsElapsed <= horizonMonths) {
    installments.push({ due_date: cursor, amount });
    cursor = addMonths(cursor, step);
    monthsElapsed += step;
  }
  return installments;
}

// Inserts schedule rows for a policy, skipping any due_date that already
// exists for that policy (relies on the unique(policy_id, due_date)
// constraint as the source of truth, but also pre-filters to avoid noisy
// duplicate-key errors).
async function generatePremiumSchedule(policy, horizonMonths) {
  const installments = buildScheduleInstallments(
    policy.policy_start_date, policy.premium_amount, policy.payment_frequency, horizonMonths
  );

  const { data: existing, error: existingErr } = await supabaseClient
    .from('premium_schedules')
    .select('due_date')
    .eq('policy_id', policy.id);
  if (existingErr) throw existingErr;
  const existingDates = new Set((existing || []).map(r => r.due_date));

  const rows = installments
    .filter(i => !existingDates.has(i.due_date))
    .map(i => ({
      policy_id: policy.id,
      customer_id: policy.customer_id,
      agent_id: policy.agent_id,
      due_date: i.due_date,
      amount: i.amount,
      status: 'upcoming'
    }));

  if (rows.length === 0) return { inserted: 0 };

  const { error } = await supabaseClient.from('premium_schedules').insert(rows);
  if (error) throw error;
  return { inserted: rows.length };
}

/* ------------------------- Premium Collection page ------------------------- */

const PREMIUM_PAGE_SIZE = 20;
let premiumPageState = { page: 0, filters: {} };

async function initPremiumsPage() {
  const content = initAppShell('premiums');
  content.innerHTML = `
    <div class="section-header">
      <h2>Premium Collection</h2>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-row">
          <select class="form-control" id="f-status" style="width:auto">
            <option value="">All Statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="due_soon">Due Soon</option>
            <option value="due_today">Due Today</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
            <option value="promise_to_pay">Promise to Pay</option>
          </select>
          <select class="form-control" id="f-month" style="width:auto"></select>
          <input type="text" class="form-control" id="f-customer" placeholder="Customer name" style="width:180px">
          ${isManager() ? '<select class="form-control" id="f-agent" style="width:auto"><option value="">All Agents</option></select>' : ''}
          <button class="btn btn-secondary btn-sm" id="f-apply">Apply Filters</button>
        </div>
        <div id="premium-count" class="text-muted" style="font-size:var(--fs-xs)"></div>
      </div>
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th>Customer</th><th>Policy</th><th class="num">Premium</th><th>Due Date</th><th>Status</th><th>Reminder</th><th>Action</th>
          </tr></thead>
          <tbody id="premium-tbody"></tbody>
        </table>
      </div>
      <div class="record-cards" id="premium-cards"></div>
      <div class="pagination">
        <span id="premium-page-info" class="text-muted"></span>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="premium-prev">Previous</button>
          <button class="btn btn-secondary btn-sm" id="premium-next">Next</button>
        </div>
      </div>
    </div>
  `;

  // month filter options: -3 to +6 months from now
  const monthSelect = document.getElementById('f-month');
  const now = new Date();
  monthSelect.innerHTML = `<option value="" selected>All Time</option>` + Array.from({ length: 10 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 3 + i, 1);
    const val = `${d.getFullYear()}-${d.getMonth()}`;
    return `<option value="${val}">${d.toLocaleString('default', { month: 'long' })} ${d.getFullYear()}</option>`;
  }).join('');
  premiumPageState.filters.month = monthSelect.value;

  if (isManager()) await populateAgentFilter(document.getElementById('f-agent'));

  document.getElementById('f-apply').addEventListener('click', () => {
    premiumPageState.page = 0;
    premiumPageState.filters = {
      status: document.getElementById('f-status').value,
      month: monthSelect.value,
      customer: document.getElementById('f-customer').value.trim(),
      agent: document.getElementById('f-agent')?.value || ''
    };
    loadPremiumTable();
  });
  document.getElementById('premium-prev').addEventListener('click', () => {
    if (premiumPageState.page > 0) { premiumPageState.page--; loadPremiumTable(); }
  });
  document.getElementById('premium-next').addEventListener('click', () => {
    premiumPageState.page++; loadPremiumTable();
  });

  premiumPageState.filters = { status: '', month: monthSelect.value, customer: '', agent: '' };
  await loadPremiumTable();
}

async function populateAgentFilter(selectEl) {
  if (!selectEl) return;
  const { data } = await supabaseClient.from('profiles').select('id, full_name').eq('role', 'agent');
  (data || []).forEach(a => {
    const opt = document.createElement('option');
    opt.value = a.id; opt.textContent = a.full_name;
    selectEl.appendChild(opt);
  });
}

async function loadPremiumTable() {
  const tbody = document.getElementById('premium-tbody');
  const cardsWrap = document.getElementById('premium-cards');
  tbody.innerHTML = `<tr><td colspan="7"><div class="page-loading"><span class="spinner"></span> Loading…</div></td></tr>`;

  let query = supabaseClient
    .from('premium_schedules')
    .select('id, due_date, amount, status, promise_date, last_reminder_at, policy_id, customer_id, agent_id, policies(policy_number), customers(full_name, mobile)', { count: 'exact' });

  const f = premiumPageState.filters;
  if (f.month) {
    const [y, m] = f.month.split('-').map(Number);
    query = query.gte('due_date', firstDayOfMonth(y, m)).lte('due_date', lastDayOfMonth(y, m));
  }
  if (f.agent) query = query.eq('agent_id', f.agent);
  if (f.customer) query = query.ilike('customers.full_name', `%${f.customer}%`);

  query = query.order('due_date', { ascending: true })
    .range(premiumPageState.page * PREMIUM_PAGE_SIZE, premiumPageState.page * PREMIUM_PAGE_SIZE + PREMIUM_PAGE_SIZE - 1);

  const { data, error, count } = await query;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-danger">${friendlyError(error)}</td></tr>`;
    return;
  }

  let rows = data || [];
  if (f.status) rows = rows.filter(r => computeDisplayStatus(r) === f.status);

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state">No premiums found for these filters. 🎉</div></td></tr>`;
    cardsWrap.innerHTML = '';
  } else {
    tbody.innerHTML = rows.map(rowToTr).join('');
    cardsWrap.innerHTML = rows.map(rowToCard).join('');
    wirePremiumRowActions();
  }

  document.getElementById('premium-count').textContent = `${count || rows.length} total`;
  document.getElementById('premium-page-info').textContent = `Page ${premiumPageState.page + 1}`;
}

function rowToTr(r) {
  const status = computeDisplayStatus(r);
  const reminderText = r.last_reminder_at ? formatDateTime(r.last_reminder_at) : 'Never';
  return `
    <tr data-id="${r.id}">
      <td>${escapeHtml(r.customers?.full_name || '')}</td>
      <td>${escapeHtml(r.policies?.policy_number || '')}</td>
      <td class="num">${formatINR(r.amount)}</td>
      <td>${formatDate(r.due_date)}</td>
      <td>${statusBadgeHtml(status)}</td>
      <td class="text-muted" style="font-size:var(--fs-xs)">${reminderText}</td>
      <td>
        <div class="flex-gap">
          <button class="btn btn-ghost btn-sm act-view" data-id="${r.id}">View</button>
          ${status !== 'paid' ? `<button class="btn btn-whatsapp btn-sm act-wa" data-id="${r.id}">WhatsApp</button>
          <button class="btn btn-success btn-sm act-paid" data-id="${r.id}">Mark Paid</button>` : ''}
          <button class="btn btn-ghost btn-sm text-danger act-delete" data-id="${r.id}">Delete</button>
        </div>
      </td>
    </tr>
  `;
}

function rowToCard(r) {
  const status = computeDisplayStatus(r);
  return `
    <div class="record-card" data-id="${r.id}">
      <div class="flex-between"><strong>${escapeHtml(r.customers?.full_name || '')}</strong>${statusBadgeHtml(status)}</div>
      <div class="record-card-row"><span class="rc-label">Policy</span><span>${escapeHtml(r.policies?.policy_number || '')}</span></div>
      <div class="record-card-row"><span class="rc-label">Premium</span><span>${formatINR(r.amount)}</span></div>
      <div class="record-card-row"><span class="rc-label">Due Date</span><span>${formatDate(r.due_date)}</span></div>
      <div class="record-card-row"><span class="rc-label">Last Reminder</span><span>${r.last_reminder_at ? formatDateTime(r.last_reminder_at) : 'Never'}</span></div>
      <div class="record-card-actions">
        <button class="btn btn-ghost btn-sm act-view" data-id="${r.id}">View</button>
        ${status !== 'paid' ? `<button class="btn btn-whatsapp btn-sm act-wa" data-id="${r.id}">WhatsApp</button>
        <button class="btn btn-success btn-sm act-paid" data-id="${r.id}">Mark Paid</button>` : ''}
        <button class="btn btn-ghost btn-sm text-danger act-delete" data-id="${r.id}">Delete</button>
      </div>
    </div>
  `;
}

function wirePremiumRowActions() {
  document.querySelectorAll('.act-wa').forEach(btn => btn.addEventListener('click', () => openWhatsAppReminderModal(btn.dataset.id, loadPremiumTable)));
  document.querySelectorAll('.act-paid').forEach(btn => btn.addEventListener('click', () => openMarkPaidModal(btn.dataset.id, loadPremiumTable)));
  document.querySelectorAll('.act-view').forEach(btn => btn.addEventListener('click', () => openPremiumDetailModal(btn.dataset.id)));
  document.querySelectorAll('.act-delete').forEach(btn => btn.addEventListener('click', () => deletePremiumSchedule(btn.dataset.id, loadPremiumTable)));
}

// Permanently deletes a single premium installment. If it was already paid,
// warns clearly since the linked payment record is deleted too (cascade).
async function deletePremiumSchedule(id, onDone) {
  const { data: row } = await supabaseClient.from('premium_schedules').select('status, due_date, amount').eq('id', id).single();
  const paidWarning = row?.status === 'paid' ? ' This installment is marked PAID — deleting it will also delete its payment record.' : '';
  if (!confirmAction(`Delete this premium installment (${formatDate(row?.due_date)}, ${formatINR(row?.amount)})?${paidWarning} This cannot be undone.`)) return;
  const { error } = await supabaseClient.from('premium_schedules').delete().eq('id', id);
  if (error) { showError(friendlyError(error, 'Could not delete this premium installment.')); return; }
  showSuccess('Premium installment deleted.');
  if (onDone) onDone();
}

async function openPremiumDetailModal(scheduleId) {
  const { data: r, error } = await supabaseClient
    .from('premium_schedules')
    .select('*, policies(policy_number, plan_name), customers(full_name, mobile)')
    .eq('id', scheduleId).single();
  if (error) { showError(friendlyError(error)); return; }

  const { data: reminders } = await supabaseClient
    .from('whatsapp_reminders')
    .select('*')
    .eq('premium_schedule_id', scheduleId)
    .order('created_at', { ascending: false });

  const status = computeDisplayStatus(r);
  openModal(`
    <div class="modal-header"><h3>Premium Detail</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="info-grid mb-4">
        <div><div class="ig-label">Customer</div><div class="ig-value">${escapeHtml(r.customers?.full_name)}</div></div>
        <div><div class="ig-label">Policy</div><div class="ig-value">${escapeHtml(r.policies?.policy_number)}</div></div>
        <div><div class="ig-label">Amount</div><div class="ig-value">${formatINR(r.amount)}</div></div>
        <div><div class="ig-label">Due Date</div><div class="ig-value">${formatDate(r.due_date)}</div></div>
        <div><div class="ig-label">Status</div><div class="ig-value">${statusBadgeHtml(status)}</div></div>
        ${r.paid_date ? `<div><div class="ig-label">Paid Date</div><div class="ig-value">${formatDate(r.paid_date)}</div></div>` : ''}
        ${r.promise_date ? `<div><div class="ig-label">Promise Date</div><div class="ig-value">${formatDate(r.promise_date)}</div></div>` : ''}
      </div>
      <h4 class="mb-2">Reminder History</h4>
      ${(reminders && reminders.length) ? `
        <div class="action-list">
          ${reminders.map(rem => `
            <div class="action-list-item">
              <div class="ali-main">
                <div class="ali-title">${REMINDER_TYPE_LABELS[rem.reminder_type] || rem.reminder_type}</div>
                <div class="ali-sub">${formatDateTime(rem.created_at)}</div>
              </div>
              ${rem.status === 'marked_sent' ? '<span class="badge badge-marked_sent">Marked as Sent</span>' : '<span class="badge badge-opened">Opened</span>'}
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-state">No reminders sent yet.</div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost text-danger" id="premium-delete-btn" style="margin-right:auto">Delete</button>
      <button class="btn btn-secondary" onclick="closeModal()">Close</button>
    </div>
  `, { size: 'lg' });

  document.getElementById('premium-delete-btn').addEventListener('click', async () => {
    closeModal();
    await deletePremiumSchedule(scheduleId, () => { if (typeof loadPremiumTable === 'function' && document.getElementById('premium-tbody')) loadPremiumTable(); });
  });
}
