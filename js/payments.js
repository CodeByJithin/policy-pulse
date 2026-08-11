// ============================================================================
// payments.js — Mark Paid modal + Payments (history) page.
// ============================================================================

const PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'cheque', 'other'];
const PAYMENT_MODE_LABELS = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', cheque: 'Cheque', other: 'Other' };

async function openMarkPaidModal(scheduleId, onDone) {
  const { data: schedule, error } = await supabaseClient
    .from('premium_schedules')
    .select('*, policies(policy_number), customers(full_name, mobile)')
    .eq('id', scheduleId).single();
  if (error) { showError(friendlyError(error)); return; }

  openModal(`
    <div class="modal-header"><h3>Mark as Paid</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="info-grid mb-4">
        <div><div class="ig-label">Customer</div><div class="ig-value">${escapeHtml(schedule.customers?.full_name)}</div></div>
        <div><div class="ig-label">Policy</div><div class="ig-value">${escapeHtml(schedule.policies?.policy_number)}</div></div>
      </div>
      <form id="mark-paid-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Premium Amount <span class="req">*</span></label>
            <input type="number" min="1" step="0.01" class="form-control" id="mp-amount" value="${schedule.amount}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Date <span class="req">*</span></label>
            <input type="date" class="form-control" id="mp-date" value="${toDateInputValue(todayDateOnly())}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Payment Mode <span class="req">*</span></label>
            <select class="form-control" id="mp-mode" required>
              ${PAYMENT_MODES.map(m => `<option value="${m}">${PAYMENT_MODE_LABELS[m]}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">Reference Number</label>
            <input type="text" class="form-control" id="mp-ref" placeholder="Transaction / cheque no.">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="mp-notes" rows="2"></textarea>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-success" id="mp-save-btn">Save Payment</button>
    </div>
  `);

  document.getElementById('mp-save-btn').addEventListener('click', async (e) => {
    const amount = parseFloat(document.getElementById('mp-amount').value);
    const paymentDate = document.getElementById('mp-date').value;
    const mode = document.getElementById('mp-mode').value;
    const ref = document.getElementById('mp-ref').value.trim();
    const notes = document.getElementById('mp-notes').value.trim();

    if (!amount || amount <= 0) { showError('Payment amount must be greater than zero.'); return; }
    if (!paymentDate) { showError('Payment date is required.'); return; }

    setButtonLoading(e.target, true, 'Saving…');
    try {
      const { data: payment, error: payErr } = await supabaseClient.from('payments').insert({
        premium_schedule_id: schedule.id,
        policy_id: schedule.policy_id,
        customer_id: schedule.customer_id,
        agent_id: schedule.agent_id,
        amount, payment_date: paymentDate, payment_mode: mode,
        reference_number: ref || null, notes: notes || null
      }).select().single();
      if (payErr) throw payErr;

      const { error: schedErr } = await supabaseClient.from('premium_schedules').update({
        status: 'paid', paid_date: paymentDate, payment_id: payment.id
      }).eq('id', schedule.id);
      if (schedErr) throw schedErr;

      showSuccess('Premium marked as paid.');
      closeModal();
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      showError(friendlyError(err, 'Could not record this payment.'));
      setButtonLoading(e.target, false);
    }
  });
}

/* ------------------------------ Payments page ------------------------------ */

const PAYMENTS_PAGE_SIZE = 25;
let paymentsPageState = { page: 0, filters: {} };

async function initPaymentsPage() {
  const content = initAppShell('payments');
  content.innerHTML = `
    <div class="section-header">
      <h2>Payments</h2>
      <button class="btn btn-secondary" id="export-csv-btn">Export CSV</button>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-row">
          <input type="date" class="form-control" id="pf-from" style="width:auto">
          <input type="date" class="form-control" id="pf-to" style="width:auto">
          <select class="form-control" id="pf-mode" style="width:auto">
            <option value="">All Modes</option>
            ${PAYMENT_MODES.map(m => `<option value="${m}">${PAYMENT_MODE_LABELS[m]}</option>`).join('')}
          </select>
          <input type="text" class="form-control" id="pf-customer" placeholder="Customer name" style="width:180px">
          ${isManager() ? '<select class="form-control" id="pf-agent" style="width:auto"><option value="">All Agents</option></select>' : ''}
          <button class="btn btn-secondary btn-sm" id="pf-apply">Apply Filters</button>
        </div>
      </div>
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th>Customer</th><th>Policy</th><th class="num">Premium</th><th>Due Date</th><th>Paid Date</th><th>Mode</th><th>Reference</th>${isManager() ? '<th>Agent</th>' : ''}<th>Action</th>
          </tr></thead>
          <tbody id="payments-tbody"></tbody>
        </table>
      </div>
      <div class="record-cards" id="payments-cards"></div>
      <div class="pagination">
        <span id="payments-page-info" class="text-muted"></span>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="payments-prev">Previous</button>
          <button class="btn btn-secondary btn-sm" id="payments-next">Next</button>
        </div>
      </div>
    </div>
  `;

  if (isManager()) await populateAgentFilter(document.getElementById('pf-agent'));

  document.getElementById('pf-apply').addEventListener('click', () => {
    paymentsPageState.page = 0;
    paymentsPageState.filters = {
      from: document.getElementById('pf-from').value,
      to: document.getElementById('pf-to').value,
      mode: document.getElementById('pf-mode').value,
      customer: document.getElementById('pf-customer').value.trim(),
      agent: document.getElementById('pf-agent')?.value || ''
    };
    loadPaymentsTable();
  });
  document.getElementById('payments-prev').addEventListener('click', () => { if (paymentsPageState.page > 0) { paymentsPageState.page--; loadPaymentsTable(); } });
  document.getElementById('payments-next').addEventListener('click', () => { paymentsPageState.page++; loadPaymentsTable(); });
  document.getElementById('export-csv-btn').addEventListener('click', exportPaymentsCsv);

  paymentsPageState.filters = {};
  await loadPaymentsTable();
}

function buildPaymentsQuery() {
  let query = supabaseClient
    .from('payments')
    .select('id, amount, payment_date, payment_mode, reference_number, customer_id, policy_id, agent_id, premium_schedule_id, customers(full_name), policies(policy_number), profiles(full_name), premium_schedules!payments_premium_schedule_id_fkey(due_date)', { count: 'exact' });

  const f = paymentsPageState.filters;
  if (f.from) query = query.gte('payment_date', f.from);
  if (f.to) query = query.lte('payment_date', f.to);
  if (f.mode) query = query.eq('payment_mode', f.mode);
  if (f.agent) query = query.eq('agent_id', f.agent);
  if (f.customer) query = query.ilike('customers.full_name', `%${f.customer}%`);
  return query.order('payment_date', { ascending: false });
}

async function loadPaymentsTable() {
  const tbody = document.getElementById('payments-tbody');
  const cardsWrap = document.getElementById('payments-cards');
  tbody.innerHTML = `<tr><td colspan="9"><div class="page-loading"><span class="spinner"></span> Loading…</div></td></tr>`;

  const { data, error, count } = await buildPaymentsQuery()
    .range(paymentsPageState.page * PAYMENTS_PAGE_SIZE, paymentsPageState.page * PAYMENTS_PAGE_SIZE + PAYMENTS_PAGE_SIZE - 1);

  if (error) { tbody.innerHTML = `<tr><td colspan="9" class="text-danger">${friendlyError(error)}</td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state">No payments recorded for this period.</div></td></tr>`;
    cardsWrap.innerHTML = '';
  } else {
    tbody.innerHTML = data.map(p => `
      <tr>
        <td>${escapeHtml(p.customers?.full_name || '')}</td>
        <td>${escapeHtml(p.policies?.policy_number || '')}</td>
        <td class="num">${formatINR(p.amount)}</td>
        <td>${formatDate(p.premium_schedules?.due_date)}</td>
        <td>${formatDate(p.payment_date)}</td>
        <td>${PAYMENT_MODE_LABELS[p.payment_mode] || p.payment_mode}</td>
        <td>${escapeHtml(p.reference_number || '—')}</td>
        ${isManager() ? `<td>${escapeHtml(p.profiles?.full_name || '')}</td>` : ''}
        <td><button class="btn btn-ghost btn-sm text-danger delete-payment-btn" data-id="${p.id}">Delete</button></td>
      </tr>
    `).join('');
    cardsWrap.innerHTML = data.map(p => `
      <div class="record-card">
        <div class="flex-between"><strong>${escapeHtml(p.customers?.full_name || '')}</strong><span>${formatINR(p.amount)}</span></div>
        <div class="record-card-row"><span class="rc-label">Policy</span><span>${escapeHtml(p.policies?.policy_number || '')}</span></div>
        <div class="record-card-row"><span class="rc-label">Paid Date</span><span>${formatDate(p.payment_date)}</span></div>
        <div class="record-card-row"><span class="rc-label">Mode</span><span>${PAYMENT_MODE_LABELS[p.payment_mode]}</span></div>
        <div class="record-card-row"><span class="rc-label">Reference</span><span>${escapeHtml(p.reference_number || '—')}</span></div>
        <div class="record-card-actions"><button class="btn btn-ghost btn-sm text-danger delete-payment-btn" data-id="${p.id}">Delete</button></div>
      </div>
    `).join('');
    document.querySelectorAll('.delete-payment-btn').forEach(btn => btn.addEventListener('click', () => deletePayment(btn.dataset.id, loadPaymentsTable)));
  }

  document.getElementById('payments-page-info').textContent = `Page ${paymentsPageState.page + 1} · ${count || 0} total`;
}

// Permanently deletes a payment record. Because deleting the payment also
// clears the premium_schedules.payment_id link (ON DELETE SET NULL), the
// linked installment is reset to 'upcoming' so its Paid/Overdue/Due status
// goes back to being calculated automatically from its due date, rather
// than being stuck showing "Paid" for a payment that no longer exists.
async function deletePayment(id, onDone) {
  if (!confirmAction('Delete this payment record? The related premium installment will be marked unpaid again. This cannot be undone.')) return;
  const { data: payment, error: fetchErr } = await supabaseClient.from('payments').select('premium_schedule_id').eq('id', id).single();
  if (fetchErr) { showError(friendlyError(fetchErr)); return; }

  const { error } = await supabaseClient.from('payments').delete().eq('id', id);
  if (error) { showError(friendlyError(error, 'Could not delete this payment.')); return; }

  if (payment?.premium_schedule_id) {
    const { error: schedErr } = await supabaseClient.from('premium_schedules')
      .update({ status: 'upcoming', paid_date: null, payment_id: null })
      .eq('id', payment.premium_schedule_id);
    if (schedErr) console.error('Payment deleted, but failed to reset premium schedule status', schedErr);
  }

  showSuccess('Payment deleted.');
  if (onDone) onDone();
}

async function exportPaymentsCsv() {
  const { data, error } = await buildPaymentsQuery().limit(5000);
  if (error) { showError(friendlyError(error)); return; }
  if (!data || data.length === 0) { showError('No payments to export.'); return; }

  const headers = ['Customer', 'Policy', 'Premium', 'Due Date', 'Paid Date', 'Payment Mode', 'Reference Number', 'Agent'];
  const rows = data.map(p => [
    p.customers?.full_name || '', p.policies?.policy_number || '', p.amount,
    p.premium_schedules?.due_date || '', p.payment_date, PAYMENT_MODE_LABELS[p.payment_mode] || p.payment_mode,
    p.reference_number || '', p.profiles?.full_name || ''
  ]);
  const csv = [headers, ...rows]
    .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payments-export-${toDateInputValue(todayDateOnly())}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
