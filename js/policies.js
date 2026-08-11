// ============================================================================
// policies.js — Policies list page + policy create/edit form + schedule
// generation trigger.
// ============================================================================

const FREQUENCY_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-Yearly', yearly: 'Yearly' };
const POLICY_STATUSES = ['active', 'lapsed', 'matured', 'cancelled', 'inactive'];

const POLICIES_PAGE_SIZE = 20;
let policiesPageState = { page: 0, search: '', status: '' };

async function initPoliciesPage() {
  const content = initAppShell('policies');
  content.innerHTML = `
    <div class="section-header">
      <h2>Policies</h2>
      <button class="btn btn-primary" id="add-policy-btn">+ Add Policy</button>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-row">
          <input type="text" class="form-control" id="pol-search" placeholder="Search policy number…" style="width:220px">
          <select class="form-control" id="pol-status" style="width:auto">
            <option value="">All Statuses</option>
            ${POLICY_STATUSES.map(s => `<option value="${s}">${POLICY_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Policy #</th><th>Customer</th><th>Plan</th><th class="num">Premium</th><th>Frequency</th><th>Next Due</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="policies-tbody"></tbody>
        </table>
      </div>
      <div class="record-cards" id="policies-cards"></div>
      <div class="pagination">
        <span id="policies-page-info" class="text-muted"></span>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="policies-prev">Previous</button>
          <button class="btn btn-secondary btn-sm" id="policies-next">Next</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('add-policy-btn').addEventListener('click', () => openPolicyFormModal(null, null, loadPoliciesTable));
  document.getElementById('pol-search').addEventListener('input', debounce((e) => {
    policiesPageState.search = e.target.value.trim(); policiesPageState.page = 0; loadPoliciesTable();
  }, 300));
  document.getElementById('pol-status').addEventListener('change', (e) => {
    policiesPageState.status = e.target.value; policiesPageState.page = 0; loadPoliciesTable();
  });
  document.getElementById('policies-prev').addEventListener('click', () => { if (policiesPageState.page > 0) { policiesPageState.page--; loadPoliciesTable(); } });
  document.getElementById('policies-next').addEventListener('click', () => { policiesPageState.page++; loadPoliciesTable(); });

  await loadPoliciesTable();
}

async function loadPoliciesTable() {
  const tbody = document.getElementById('policies-tbody');
  const cardsWrap = document.getElementById('policies-cards');
  tbody.innerHTML = `<tr><td colspan="8"><div class="page-loading"><span class="spinner"></span> Loading…</div></td></tr>`;

  let query = supabaseClient.from('policies').select('*, customers(full_name)', { count: 'exact' });
  if (policiesPageState.search) query = query.ilike('policy_number', `%${policiesPageState.search}%`);
  if (policiesPageState.status) query = query.eq('status', policiesPageState.status);

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(policiesPageState.page * POLICIES_PAGE_SIZE, policiesPageState.page * POLICIES_PAGE_SIZE + POLICIES_PAGE_SIZE - 1);

  if (error) { tbody.innerHTML = `<tr><td colspan="8" class="text-danger">${friendlyError(error)}</td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state">No policies found.</div></td></tr>`;
    cardsWrap.innerHTML = '';
  } else {
    tbody.innerHTML = data.map(p => `
      <tr>
        <td>${escapeHtml(p.policy_number)}</td>
        <td><a href="customer-details.html?id=${p.customer_id}">${escapeHtml(p.customers?.full_name || '')}</a></td>
        <td>${escapeHtml(p.plan_name)}</td>
        <td class="num">${formatINR(p.premium_amount)}</td>
        <td>${FREQUENCY_LABELS[p.payment_frequency]}</td>
        <td>${formatDate(p.next_due_date)}</td>
        <td>${policyStatusBadgeHtml(p.status)}</td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm edit-pol-btn" data-id="${p.id}">Edit</button>
            <button class="btn btn-ghost btn-sm text-danger delete-pol-btn" data-id="${p.id}" data-number="${escapeHtml(p.policy_number)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
    cardsWrap.innerHTML = data.map(p => `
      <div class="record-card">
        <div class="flex-between"><strong>${escapeHtml(p.policy_number)}</strong>${policyStatusBadgeHtml(p.status)}</div>
        <div class="record-card-row"><span class="rc-label">Customer</span><span>${escapeHtml(p.customers?.full_name || '')}</span></div>
        <div class="record-card-row"><span class="rc-label">Plan</span><span>${escapeHtml(p.plan_name)}</span></div>
        <div class="record-card-row"><span class="rc-label">Premium</span><span>${formatINR(p.premium_amount)}</span></div>
        <div class="record-card-row"><span class="rc-label">Next Due</span><span>${formatDate(p.next_due_date)}</span></div>
        <div class="record-card-actions">
          <button class="btn btn-secondary btn-sm edit-pol-btn" data-id="${p.id}">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger delete-pol-btn" data-id="${p.id}" data-number="${escapeHtml(p.policy_number)}">Delete</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('.edit-pol-btn').forEach(btn => btn.addEventListener('click', async () => {
      const { data: pol } = await supabaseClient.from('policies').select('*, customers(full_name)').eq('id', btn.dataset.id).single();
      openPolicyFormModal(pol, pol.customers, loadPoliciesTable);
    }));
    document.querySelectorAll('.delete-pol-btn').forEach(btn => btn.addEventListener('click', () => deletePolicy(btn.dataset.id, btn.dataset.number, loadPoliciesTable)));
  }

  document.getElementById('policies-page-info').textContent = `Page ${policiesPageState.page + 1} · ${count || 0} total`;
}

// Permanently deletes a policy and its premium schedules, payments, and
// WhatsApp reminder history (all cascade at the database level). Follow-ups
// tied to this policy are kept but unlinked from it.
async function deletePolicy(id, policyNumber, onDone) {
  if (!confirmAction(`Permanently delete policy ${policyNumber}? This also deletes all of its premium schedules, payments, and reminder history. This cannot be undone.`)) return;
  const { error } = await supabaseClient.from('policies').delete().eq('id', id);
  if (error) { showError(friendlyError(error, 'Could not delete this policy.')); return; }
  showSuccess('Policy deleted.');
  if (onDone) onDone();
}

// If `presetCustomer` is given (e.g. opened from the customer detail page),
// the customer picker is pre-filled and locked.
async function openPolicyFormModal(existing, presetCustomer, onSaved) {
  const isEdit = !!existing;

  let customerOptionsHtml = '<option value="">Loading customers…</option>';
  openModal(`
    <div class="modal-header"><h3>${isEdit ? 'Edit Policy' : 'Add Policy'}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <form id="policy-form">
        <div class="form-group">
          <label class="form-label">Customer <span class="req">*</span></label>
          <select class="form-control" id="p-customer" ${presetCustomer ? 'disabled' : ''} required>${customerOptionsHtml}</select>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Policy Number <span class="req">*</span></label>
            <input type="text" class="form-control" id="p-number" value="${escapeHtml(existing?.policy_number || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Plan Name <span class="req">*</span></label>
            <input type="text" class="form-control" id="p-plan" value="${escapeHtml(existing?.plan_name || '')}" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Premium Amount (₹) <span class="req">*</span></label>
            <input type="number" min="1" step="0.01" class="form-control" id="p-amount" value="${existing?.premium_amount || ''}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Payment Frequency <span class="req">*</span></label>
            <select class="form-control" id="p-frequency" required>
              ${Object.entries(FREQUENCY_LABELS).map(([k, l]) => `<option value="${k}" ${existing?.payment_frequency === k ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Policy Start Date <span class="req">*</span></label>
            <input type="date" class="form-control" id="p-start" value="${existing?.policy_start_date || toDateInputValue(todayDateOnly())}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Maturity Date</label>
            <input type="date" class="form-control" id="p-maturity" value="${existing?.maturity_date || ''}">
          </div>
        </div>
        ${isEdit ? `
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-control" id="p-status">
            ${POLICY_STATUSES.map(s => `<option value="${s}" ${existing.status === s ? 'selected' : ''}>${POLICY_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="p-notes" rows="2">${escapeHtml(existing?.notes || '')}</textarea>
        </div>
        ${!isEdit ? `
        <div class="form-group">
          <label class="form-label">Generate Premium Schedule For</label>
          <select class="form-control" id="p-horizon">
            <option value="6">Next 6 months</option>
            <option value="12" selected>Next 12 months</option>
            <option value="24">Next 24 months</option>
            <option value="36">Next 36 months</option>
          </select>
          <div class="form-hint">Future installments will be created automatically based on the frequency above. You can generate more later.</div>
        </div>` : ''}
      </form>
    </div>
    <div class="modal-footer">
      ${isEdit ? '<button class="btn btn-ghost text-danger" id="p-delete-btn" style="margin-right:auto">Delete Policy</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="p-save-btn">${isEdit ? 'Save Changes' : 'Create Policy'}</button>
    </div>
  `);

  if (isEdit) {
    document.getElementById('p-delete-btn').addEventListener('click', async () => {
      closeModal();
      await deletePolicy(existing.id, existing.policy_number, onSaved);
    });
  }

  // populate customer dropdown
  const customerSelect = document.getElementById('p-customer');
  if (presetCustomer) {
    customerSelect.innerHTML = `<option value="${presetCustomer.id}" selected>${escapeHtml(presetCustomer.full_name)}</option>`;
  } else {
    const { data: customers } = await supabaseClient.from('customers').select('id, full_name').eq('is_active', true).order('full_name');
    customerSelect.innerHTML = (customers || []).map(c => `<option value="${c.id}" ${existing?.customer_id === c.id ? 'selected' : ''}>${escapeHtml(c.full_name)}</option>`).join('');
  }

  document.getElementById('p-save-btn').addEventListener('click', async (e) => {
    const policyNumber = document.getElementById('p-number').value.trim();
    const planName = document.getElementById('p-plan').value.trim();
    const amount = parseFloat(document.getElementById('p-amount').value);
    const frequency = document.getElementById('p-frequency').value;
    const startDate = document.getElementById('p-start').value;
    const customerId = customerSelect.value;

    if (!customerId) { showError('Please select a customer.'); return; }
    if (!policyNumber) { showError('Policy number is required.'); return; }
    if (!amount || amount <= 0) { showError('Premium amount must be greater than zero.'); return; }
    if (!frequency) { showError('Payment frequency is required.'); return; }
    if (!startDate) { showError('Policy start date is required.'); return; }

    const payload = {
      customer_id: customerId,
      policy_number: policyNumber,
      plan_name: planName,
      premium_amount: amount,
      payment_frequency: frequency,
      policy_start_date: startDate,
      next_due_date: startDate,
      maturity_date: document.getElementById('p-maturity').value || null,
      notes: document.getElementById('p-notes').value.trim() || null
    };
    if (isEdit) payload.status = document.getElementById('p-status').value;
    else payload.agent_id = CURRENT_PROFILE.id;

    setButtonLoading(e.target, true, 'Saving…');
    try {
      let policyRow;
      if (isEdit) {
        const { data, error } = await supabaseClient.from('policies').update(payload).eq('id', existing.id).select().single();
        if (error) throw error;
        policyRow = data;
        showSuccess('Policy updated successfully.');
      } else {
        const { data, error } = await supabaseClient.from('policies').insert(payload).select().single();
        if (error) throw error;
        policyRow = data;
        showSuccess('Policy created successfully.');
        const horizon = parseInt(document.getElementById('p-horizon').value, 10);
        try {
          const { inserted } = await generatePremiumSchedule(policyRow, horizon);
          if (inserted > 0) showSuccess(`${inserted} premium installments generated.`);
        } catch (schedErr) {
          showError(friendlyError(schedErr, 'Policy was created, but the premium schedule could not be generated.'));
        }
      }
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      showError(friendlyError(err, err?.code === '23505' ? 'A policy with this number already exists.' : undefined));
      setButtonLoading(e.target, false);
    }
  });
}
