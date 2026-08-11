// ============================================================================
// customers.js — Customers list page + Customer detail page.
// ============================================================================

const CUSTOMERS_PAGE_SIZE = 20;
let customersPageState = { page: 0, search: '', activeOnly: true };

async function initCustomersPage() {
  const content = initAppShell('customers');
  content.innerHTML = `
    <div class="section-header">
      <h2>Customers</h2>
      <button class="btn btn-primary" id="add-customer-btn">+ Add Customer</button>
    </div>
    <div class="table-wrap">
      <div class="table-toolbar">
        <div class="filter-row">
          <input type="text" class="form-control" id="cust-search" placeholder="Search name or mobile…" style="width:240px">
          <label class="flex-gap" style="font-size:var(--fs-sm)"><input type="checkbox" id="cust-active-only" checked> Active only</label>
        </div>
      </div>
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Name</th><th>Mobile</th><th>City</th><th>Policies</th><th>Status</th><th>Action</th></tr></thead>
          <tbody id="customers-tbody"></tbody>
        </table>
      </div>
      <div class="record-cards" id="customers-cards"></div>
      <div class="pagination">
        <span id="customers-page-info" class="text-muted"></span>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="customers-prev">Previous</button>
          <button class="btn btn-secondary btn-sm" id="customers-next">Next</button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('add-customer-btn').addEventListener('click', () => openCustomerFormModal(null, loadCustomersTable));
  document.getElementById('cust-search').addEventListener('input', debounce((e) => {
    customersPageState.search = e.target.value.trim();
    customersPageState.page = 0;
    loadCustomersTable();
  }, 300));
  document.getElementById('cust-active-only').addEventListener('change', (e) => {
    customersPageState.activeOnly = e.target.checked;
    customersPageState.page = 0;
    loadCustomersTable();
  });
  document.getElementById('customers-prev').addEventListener('click', () => { if (customersPageState.page > 0) { customersPageState.page--; loadCustomersTable(); } });
  document.getElementById('customers-next').addEventListener('click', () => { customersPageState.page++; loadCustomersTable(); });

  await loadCustomersTable();
}

async function loadCustomersTable() {
  const tbody = document.getElementById('customers-tbody');
  const cardsWrap = document.getElementById('customers-cards');
  tbody.innerHTML = `<tr><td colspan="6"><div class="page-loading"><span class="spinner"></span> Loading…</div></td></tr>`;

  let query = supabaseClient
    .from('customers')
    .select('id, full_name, mobile, city, is_active, policies(count)', { count: 'exact' });

  if (customersPageState.activeOnly) query = query.eq('is_active', true);
  if (customersPageState.search) query = query.or(`full_name.ilike.%${customersPageState.search}%,mobile.ilike.%${customersPageState.search}%`);

  const { data, error, count } = await query
    .order('full_name', { ascending: true })
    .range(customersPageState.page * CUSTOMERS_PAGE_SIZE, customersPageState.page * CUSTOMERS_PAGE_SIZE + CUSTOMERS_PAGE_SIZE - 1);

  if (error) { tbody.innerHTML = `<tr><td colspan="6" class="text-danger">${friendlyError(error)}</td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state">No customers found.</div></td></tr>`;
    cardsWrap.innerHTML = '';
  } else {
    tbody.innerHTML = data.map(c => `
      <tr>
        <td><a href="customer-details.html?id=${c.id}">${escapeHtml(c.full_name)}</a></td>
        <td>${escapeHtml(c.mobile)}</td>
        <td>${escapeHtml(c.city || '—')}</td>
        <td>${c.policies?.[0]?.count ?? 0}</td>
        <td><span class="badge ${c.is_active ? 'badge-active' : 'badge-inactive'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
        <td>
          <div class="flex-gap">
            <button class="btn btn-ghost btn-sm" onclick="window.location.href='customer-details.html?id=${c.id}'">View</button>
            <button class="btn btn-ghost btn-sm edit-cust-btn" data-id="${c.id}">Edit</button>
            <button class="btn btn-ghost btn-sm text-danger delete-cust-btn" data-id="${c.id}" data-name="${escapeHtml(c.full_name)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join('');
    cardsWrap.innerHTML = data.map(c => `
      <div class="record-card">
        <div class="flex-between"><strong>${escapeHtml(c.full_name)}</strong><span class="badge ${c.is_active ? 'badge-active' : 'badge-inactive'}">${c.is_active ? 'Active' : 'Inactive'}</span></div>
        <div class="record-card-row"><span class="rc-label">Mobile</span><span>${escapeHtml(c.mobile)}</span></div>
        <div class="record-card-row"><span class="rc-label">City</span><span>${escapeHtml(c.city || '—')}</span></div>
        <div class="record-card-row"><span class="rc-label">Policies</span><span>${c.policies?.[0]?.count ?? 0}</span></div>
        <div class="record-card-actions">
          <button class="btn btn-secondary btn-sm" onclick="window.location.href='customer-details.html?id=${c.id}'">View</button>
          <button class="btn btn-ghost btn-sm edit-cust-btn" data-id="${c.id}">Edit</button>
          <button class="btn btn-ghost btn-sm text-danger delete-cust-btn" data-id="${c.id}" data-name="${escapeHtml(c.full_name)}">Delete</button>
        </div>
      </div>
    `).join('');
    document.querySelectorAll('.edit-cust-btn').forEach(btn => btn.addEventListener('click', async () => {
      const { data: cust } = await supabaseClient.from('customers').select('*').eq('id', btn.dataset.id).single();
      openCustomerFormModal(cust, loadCustomersTable);
    }));
    document.querySelectorAll('.delete-cust-btn').forEach(btn => btn.addEventListener('click', () => deleteCustomer(btn.dataset.id, btn.dataset.name, loadCustomersTable)));
  }

  document.getElementById('customers-page-info').textContent = `Page ${customersPageState.page + 1} · ${count || 0} total`;
}

// Permanently deletes a customer and everything tied to them (policies,
// premium schedules, payments, reminders, follow-ups all cascade at the
// database level). This is different from "Archive" (soft delete, is_active
// = false) which is still available from the edit form.
async function deleteCustomer(id, name, onDone) {
  if (!confirmAction(`Permanently delete ${name}? This also deletes all of their policies, premium schedules, payments, and reminder/follow-up history. This cannot be undone.`)) return;
  const { error } = await supabaseClient.from('customers').delete().eq('id', id);
  if (error) { showError(friendlyError(error, 'Could not delete this customer.')); return; }
  showSuccess('Customer deleted.');
  if (onDone) onDone();
}

function openCustomerFormModal(existing, onSaved) {
  const isEdit = !!existing;
  openModal(`
    <div class="modal-header"><h3>${isEdit ? 'Edit Customer' : 'Add Customer'}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <form id="customer-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Full Name <span class="req">*</span></label>
            <input type="text" class="form-control" id="c-name" value="${escapeHtml(existing?.full_name || '')}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Mobile Number <span class="req">*</span></label>
            <input type="tel" class="form-control" id="c-mobile" value="${escapeHtml(existing?.mobile || '')}" placeholder="9876543210" required>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Alternate Mobile</label>
            <input type="tel" class="form-control" id="c-alt-mobile" value="${escapeHtml(existing?.alternate_mobile || '')}">
          </div>
          <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-control" id="c-email" value="${escapeHtml(existing?.email || '')}">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Date of Birth</label>
            <input type="date" class="form-control" id="c-dob" value="${existing?.date_of_birth || ''}">
          </div>
          <div class="form-group">
            <label class="form-label">City</label>
            <input type="text" class="form-control" id="c-city" value="${escapeHtml(existing?.city || '')}">
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Address</label>
          <textarea class="form-control" id="c-address" rows="2">${escapeHtml(existing?.address || '')}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="c-notes" rows="2">${escapeHtml(existing?.notes || '')}</textarea>
        </div>
        ${isEdit ? `<label class="flex-gap"><input type="checkbox" id="c-active" ${existing.is_active ? 'checked' : ''}> Active customer</label>` : ''}
      </form>
    </div>
    <div class="modal-footer">
      ${isEdit ? '<button class="btn btn-danger" id="c-delete-btn" style="margin-right:auto">Archive</button><button class="btn btn-ghost text-danger" id="c-hard-delete-btn">Delete Permanently</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="c-save-btn">${isEdit ? 'Save Changes' : 'Add Customer'}</button>
    </div>
  `);

  if (isEdit) {
    document.getElementById('c-delete-btn').addEventListener('click', async () => {
      if (!confirmAction(`Archive ${existing.full_name}? They will be hidden from active lists but their history is kept.`)) return;
      const { error } = await supabaseClient.from('customers').update({ is_active: false }).eq('id', existing.id);
      if (error) { showError(friendlyError(error)); return; }
      showSuccess('Customer archived.');
      closeModal();
      if (onSaved) onSaved();
    });
    document.getElementById('c-hard-delete-btn').addEventListener('click', async () => {
      closeModal();
      await deleteCustomer(existing.id, existing.full_name, onSaved);
    });
  }

  document.getElementById('c-save-btn').addEventListener('click', async (e) => {
    const name = document.getElementById('c-name').value.trim();
    const mobile = document.getElementById('c-mobile').value.trim();
    if (!name) { showError('Customer name is required.'); return; }
    if (!mobile) { showError('Mobile number is required.'); return; }

    const payload = {
      full_name: name,
      mobile,
      alternate_mobile: document.getElementById('c-alt-mobile').value.trim() || null,
      email: document.getElementById('c-email').value.trim() || null,
      date_of_birth: document.getElementById('c-dob').value || null,
      city: document.getElementById('c-city').value.trim() || null,
      address: document.getElementById('c-address').value.trim() || null,
      notes: document.getElementById('c-notes').value.trim() || null
    };
    if (isEdit) payload.is_active = document.getElementById('c-active').checked;
    else payload.agent_id = CURRENT_PROFILE.id;

    setButtonLoading(e.target, true, 'Saving…');
    try {
      if (isEdit) {
        const { error } = await supabaseClient.from('customers').update(payload).eq('id', existing.id);
        if (error) throw error;
        showSuccess('Customer updated successfully.');
      } else {
        const { error } = await supabaseClient.from('customers').insert(payload);
        if (error) throw error;
        showSuccess('Customer created successfully.');
      }
      closeModal();
      if (onSaved) onSaved();
    } catch (err) {
      showError(friendlyError(err));
      setButtonLoading(e.target, false);
    }
  });
}

/* ------------------------------ Detail page ------------------------------ */

async function initCustomerDetailsPage() {
  const content = initAppShell('customers');
  const customerId = getQueryParam('id');
  if (!customerId) { content.innerHTML = '<div class="empty-state">No customer specified.</div>'; return; }

  content.innerHTML = `<div class="page-loading"><span class="spinner"></span> Loading customer…</div>`;

  const { data: customer, error } = await supabaseClient.from('customers').select('*').eq('id', customerId).single();
  if (error || !customer) { content.innerHTML = `<div class="empty-state">Customer not found or you don\u2019t have access.</div>`; return; }

  const [{ data: policies }, { data: payments }, { data: reminders }, { data: followups }, { data: schedules }] = await Promise.all([
    supabaseClient.from('policies').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }),
    supabaseClient.from('payments').select('*, policies(policy_number)').eq('customer_id', customerId).order('payment_date', { ascending: false }).limit(10),
    supabaseClient.from('whatsapp_reminders').select('*').eq('customer_id', customerId).order('created_at', { ascending: false }).limit(10),
    supabaseClient.from('follow_ups').select('*').eq('customer_id', customerId).order('follow_up_date', { ascending: false }).limit(10),
    supabaseClient.from('premium_schedules').select('amount, status, due_date').eq('customer_id', customerId)
  ]);

  const year = new Date().getFullYear();
  const yearSchedules = (schedules || []).filter(s => parseDateOnly(s.due_date).getFullYear() === year);
  const expected = yearSchedules.reduce((sum, s) => sum + Number(s.amount), 0);
  const paid = yearSchedules.filter(s => s.status === 'paid').reduce((sum, s) => sum + Number(s.amount), 0);
  const overdue = yearSchedules.filter(s => computeDisplayStatus(s) === 'overdue').reduce((sum, s) => sum + Number(s.amount), 0);
  const pending = Math.max(expected - paid, 0);

  content.innerHTML = `
    <div class="section-header">
      <h2>${escapeHtml(customer.full_name)}</h2>
      <div class="flex-gap">
        <button class="btn btn-whatsapp" id="detail-call-wa">WhatsApp</button>
        <button class="btn btn-secondary" id="detail-edit-btn">Edit</button>
      </div>
    </div>

    <div class="card mb-6">
      <h4 class="mb-3">Customer Information</h4>
      <div class="info-grid">
        <div><div class="ig-label">Phone</div><div class="ig-value">${escapeHtml(customer.mobile)}</div></div>
        <div><div class="ig-label">Alternate Phone</div><div class="ig-value">${escapeHtml(customer.alternate_mobile || '—')}</div></div>
        <div><div class="ig-label">Email</div><div class="ig-value">${escapeHtml(customer.email || '—')}</div></div>
        <div><div class="ig-label">City</div><div class="ig-value">${escapeHtml(customer.city || '—')}</div></div>
        <div><div class="ig-label">Address</div><div class="ig-value">${escapeHtml(customer.address || '—')}</div></div>
        <div><div class="ig-label">Notes</div><div class="ig-value">${escapeHtml(customer.notes || '—')}</div></div>
      </div>
    </div>

    <div class="summary-grid mb-6">
      <div class="summary-card"><div class="sc-label">Expected This Year</div><div class="sc-value" style="font-size:var(--fs-lg)">${formatINR(expected)}</div></div>
      <div class="summary-card"><div class="sc-label">Paid This Year</div><div class="sc-value" style="font-size:var(--fs-lg);color:var(--color-success)">${formatINR(paid)}</div></div>
      <div class="summary-card"><div class="sc-label">Pending</div><div class="sc-value" style="font-size:var(--fs-lg);color:var(--color-warning)">${formatINR(pending)}</div></div>
      <div class="summary-card"><div class="sc-label">Overdue</div><div class="sc-value" style="font-size:var(--fs-lg);color:var(--color-danger)">${formatINR(overdue)}</div></div>
    </div>

    <div class="card mb-6">
      <div class="flex-between mb-3"><h4>Policies</h4><button class="btn btn-primary btn-sm" id="add-policy-from-cust">+ Add Policy</button></div>
      ${(policies && policies.length) ? `
        <div class="action-list">
          ${policies.map(p => `
            <div class="action-list-item">
              <div class="ali-main">
                <div class="ali-title">${escapeHtml(p.policy_number)} — ${escapeHtml(p.plan_name)}</div>
                <div class="ali-sub">${formatINR(p.premium_amount)} / ${p.payment_frequency.replace('_', '-')} · Next due ${formatDate(p.next_due_date)}</div>
              </div>
              ${policyStatusBadgeHtml(p.status)}
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-state">No policies yet for this customer.</div>'}
    </div>

    <div class="card mb-6">
      <h4 class="mb-3">Recent Payments</h4>
      ${(payments && payments.length) ? `
        <div class="action-list">
          ${payments.map(p => `
            <div class="action-list-item">
              <div class="ali-main"><div class="ali-title">${formatINR(p.amount)} — ${escapeHtml(p.policies?.policy_number || '')}</div>
              <div class="ali-sub">${formatDate(p.payment_date)} · ${PAYMENT_MODE_LABELS[p.payment_mode]}</div></div>
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-state">No payments recorded for this period.</div>'}
    </div>

    <div class="card mb-6">
      <h4 class="mb-3">Recent WhatsApp Reminders</h4>
      ${(reminders && reminders.length) ? `
        <div class="action-list">
          ${reminders.map(r => `
            <div class="action-list-item">
              <div class="ali-main"><div class="ali-title">${REMINDER_TYPE_LABELS[r.reminder_type] || r.reminder_type}</div>
              <div class="ali-sub">${formatDateTime(r.created_at)}</div></div>
              ${r.status === 'marked_sent' ? '<span class="badge badge-marked_sent">Marked as Sent</span>' : '<span class="badge badge-opened">Opened</span>'}
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-state">No reminders sent yet.</div>'}
    </div>

    <div class="card">
      <h4 class="mb-3">Follow-ups</h4>
      ${(followups && followups.length) ? `
        <div class="action-list">
          ${followups.map(f => `
            <div class="action-list-item">
              <div class="ali-main"><div class="ali-title">${escapeHtml(f.notes || FOLLOWUP_TYPE_LABELS[f.follow_up_type])}</div>
              <div class="ali-sub">${formatDate(f.follow_up_date)} · ${FOLLOWUP_TYPE_LABELS[f.follow_up_type]}</div></div>
              <span class="badge badge-${f.status === 'completed' ? 'active' : f.status === 'pending' ? 'due_today' : 'upcoming'}">${f.status}</span>
            </div>
          `).join('')}
        </div>
      ` : '<div class="empty-state">No follow-ups recorded.</div>'}
    </div>
  `;

  document.getElementById('detail-call-wa').addEventListener('click', () => {
    openWhatsApp(customer.mobile, `Hello ${customer.full_name}, `);
  });
  document.getElementById('detail-edit-btn').addEventListener('click', () => {
    openCustomerFormModal(customer, () => initCustomerDetailsPage());
  });
  document.getElementById('add-policy-from-cust').addEventListener('click', () => {
    openPolicyFormModal(null, customer, () => initCustomerDetailsPage());
  });
}
