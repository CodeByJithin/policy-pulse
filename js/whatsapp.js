// ============================================================================
// whatsapp.js — WhatsApp click-to-chat reminders. NO WhatsApp Business API
// is used anywhere. The agent must manually send the message inside
// WhatsApp and manually confirm it was sent back in this app.
// ============================================================================

const REMINDER_TYPE_LABELS = {
  PREMIUM_7_DAYS: 'Premium Due in 7 Days',
  PREMIUM_TOMORROW: 'Premium Due Tomorrow',
  PREMIUM_TODAY: 'Premium Due Today',
  PREMIUM_OVERDUE: 'Overdue Premium',
  PAYMENT_CONFIRMATION: 'Payment Confirmation'
};

const MESSAGE_TEMPLATES = {
  PREMIUM_7_DAYS: `Hello {customer_name},

This is a reminder that your policy premium of ₹{amount} is due on {due_date}.

Please make the payment before the due date.

Please contact me if you need any assistance.

Thank you.`,
  PREMIUM_TOMORROW: `Hello {customer_name},

Just a reminder that your policy premium of ₹{amount} is due tomorrow, {due_date}.

Please complete the payment before the due date.

Thank you.`,
  PREMIUM_TODAY: `Hello {customer_name},

This is a reminder that your policy premium of ₹{amount} is due today.

Please complete the payment at your convenience.

Please contact me if you need any assistance.

Thank you.`,
  PREMIUM_OVERDUE: `Hello {customer_name},

This is a reminder regarding your policy premium of ₹{amount}, which was due on {due_date}.

Please contact me if you need any assistance regarding the payment.

Thank you.`,
  PAYMENT_CONFIRMATION: `Hello {customer_name},

Thank you for making your policy premium payment of ₹{amount}.

Your payment has been recorded successfully.

Thank you.`
};

// Picks the most relevant template for a schedule's current status.
function suggestedReminderType(schedule) {
  const status = computeDisplayStatus(schedule);
  if (status === 'overdue') return 'PREMIUM_OVERDUE';
  if (status === 'due_today') return 'PREMIUM_TODAY';
  const due = parseDateOnly(schedule.due_date);
  const diff = daysBetween(todayDateOnly(), due);
  if (diff === 1) return 'PREMIUM_TOMORROW';
  return 'PREMIUM_7_DAYS';
}

function generateReminderMessage(type, schedule, extra = {}) {
  const template = MESSAGE_TEMPLATES[type];
  if (!template) throw new Error('Unknown reminder template: ' + type);
  const customerName = extra.customer_name || schedule.customers?.full_name || 'Customer';
  const policyNumber = extra.policy_number || schedule.policies?.policy_number || '';
  return template
    .replaceAll('{customer_name}', customerName)
    .replaceAll('{amount}', Number(schedule.amount).toLocaleString('en-IN'))
    .replaceAll('{due_date}', formatDate(schedule.due_date))
    .replaceAll('{policy_number}', policyNumber);
}

// Opens WhatsApp click-to-chat. Never marks anything as sent —
// that only happens when the agent explicitly confirms in-app.
//
// On mobile, we navigate the current tab (location.href) rather than
// opening a new one. window.open('_blank') creates a separate browsing
// context that can't reliably complete the wa.me -> whatsapp:// app
// handoff on iOS/Android — it's what causes the blank "Done" screen some
// mobile browsers show instead of actually switching to WhatsApp. On
// desktop we keep window.open so WhatsApp Web opens in a new tab and the
// agent doesn't lose their place in the app.
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function openWhatsApp(phone, message) {
  const cleaned = cleanPhoneForWhatsApp(phone);
  if (!isValidPhoneForWhatsApp(cleaned)) {
    showError('This customer\u2019s phone number looks invalid. Please update it before sending a reminder.');
    return false;
  }
  const url = `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
  if (isMobileDevice()) {
    window.location.href = url;
  } else {
    window.open(url, '_blank');
  }
  return true;
}

/* --------------------------- Send Reminder modal --------------------------- */

async function openWhatsAppReminderModal(scheduleId, onDone) {
  const { data: schedule, error } = await supabaseClient
    .from('premium_schedules')
    .select('*, policies(policy_number), customers(full_name, mobile)')
    .eq('id', scheduleId).single();
  if (error) { showError(friendlyError(error)); return; }

  const status = computeDisplayStatus(schedule);
  const defaultType = suggestedReminderType(schedule);
  const lastReminderLine = schedule.last_reminder_at
    ? `Last reminder: <strong>${formatDateTime(schedule.last_reminder_at)}</strong>`
    : 'Last reminder: none yet';
  const recentWarning = schedule.last_reminder_at && (Date.now() - new Date(schedule.last_reminder_at).getTime()) < 1000 * 60 * 60 * 24
    ? `<div class="warning-banner">⚠️ This customer was already reminded recently. You can still continue if required.</div>`
    : '';

  openModal(`
    <div class="modal-header"><h3>Send WhatsApp Reminder</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="info-grid mb-4">
        <div><div class="ig-label">Customer</div><div class="ig-value">${escapeHtml(schedule.customers?.full_name)}</div></div>
        <div><div class="ig-label">Policy</div><div class="ig-value">${escapeHtml(schedule.policies?.policy_number)}</div></div>
        <div><div class="ig-label">Amount</div><div class="ig-value">${formatINR(schedule.amount)}</div></div>
        <div><div class="ig-label">Due Date</div><div class="ig-value">${formatDate(schedule.due_date)}</div></div>
        <div><div class="ig-label">Status</div><div class="ig-value">${statusBadgeHtml(status)}</div></div>
      </div>
      <p class="text-muted mb-3" style="font-size:var(--fs-xs)">${lastReminderLine}</p>
      ${recentWarning}
      <div class="form-group">
        <label class="form-label">Message Template</label>
        <select class="form-control" id="wa-template">
          ${Object.entries(REMINDER_TYPE_LABELS).map(([key, label]) => `<option value="${key}" ${key === defaultType ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">Message Preview <span class="text-muted" style="font-weight:400">(editable)</span></label>
        <textarea class="form-control" id="wa-message" rows="8"></textarea>
      </div>
    </div>
    <div class="modal-footer" id="wa-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-whatsapp" id="wa-open-btn">Open WhatsApp</button>
    </div>
  `, { size: 'lg' });

  const textarea = document.getElementById('wa-message');
  const templateSelect = document.getElementById('wa-template');
  const refreshMessage = () => { textarea.value = generateReminderMessage(templateSelect.value, schedule); };
  refreshMessage();
  templateSelect.addEventListener('change', refreshMessage);

  document.getElementById('wa-open-btn').addEventListener('click', () => {
    const opened = openWhatsApp(schedule.customers?.mobile, textarea.value);
    if (!opened) return;
    renderDidYouSendStep(schedule, templateSelect.value, textarea.value, onDone);
  });
}

/* ------------------------------ Reminders page ------------------------------ */

const REMINDERS_PAGE_SIZE = 25;
let remindersPageState = { page: 0 };

async function initRemindersPage() {
  const content = initAppShell('reminders');
  content.innerHTML = `
    <div class="section-header"><h2>WhatsApp Reminders</h2></div>
    <div class="warning-banner">This app uses WhatsApp click-to-chat only — there is no WhatsApp Business API integration. Messages are only recorded here after you manually confirm you sent them in WhatsApp.</div>
    <div class="table-wrap">
      <div class="data-table-scroll" style="overflow-x:auto">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Customer</th><th>Policy</th><th>Reminder Type</th><th>Status</th></tr></thead>
          <tbody id="reminders-tbody"></tbody>
        </table>
      </div>
      <div class="record-cards" id="reminders-cards"></div>
      <div class="pagination">
        <span id="reminders-page-info" class="text-muted"></span>
        <div class="flex-gap">
          <button class="btn btn-secondary btn-sm" id="reminders-prev">Previous</button>
          <button class="btn btn-secondary btn-sm" id="reminders-next">Next</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('reminders-prev').addEventListener('click', () => { if (remindersPageState.page > 0) { remindersPageState.page--; loadRemindersTable(); } });
  document.getElementById('reminders-next').addEventListener('click', () => { remindersPageState.page++; loadRemindersTable(); });
  await loadRemindersTable();
}

async function loadRemindersTable() {
  const tbody = document.getElementById('reminders-tbody');
  const cardsWrap = document.getElementById('reminders-cards');
  tbody.innerHTML = `<tr><td colspan="5"><div class="page-loading"><span class="spinner"></span> Loading…</div></td></tr>`;

  const { data, error, count } = await supabaseClient
    .from('whatsapp_reminders')
    .select('*, customers(full_name), policies(policy_number)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(remindersPageState.page * REMINDERS_PAGE_SIZE, remindersPageState.page * REMINDERS_PAGE_SIZE + REMINDERS_PAGE_SIZE - 1);

  if (error) { tbody.innerHTML = `<tr><td colspan="5" class="text-danger">${friendlyError(error)}</td></tr>`; return; }

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state">No reminders sent yet.</div></td></tr>`;
    cardsWrap.innerHTML = '';
  } else {
    tbody.innerHTML = data.map(r => `
      <tr>
        <td>${formatDateTime(r.created_at)}</td>
        <td>${escapeHtml(r.customers?.full_name || '')}</td>
        <td>${escapeHtml(r.policies?.policy_number || '')}</td>
        <td>${REMINDER_TYPE_LABELS[r.reminder_type] || r.reminder_type}</td>
        <td>${r.status === 'marked_sent' ? '<span class="badge badge-marked_sent">Marked as Sent</span>' : '<span class="badge badge-opened">Opened</span>'}</td>
      </tr>
    `).join('');
    cardsWrap.innerHTML = data.map(r => `
      <div class="record-card">
        <div class="flex-between"><strong>${escapeHtml(r.customers?.full_name || '')}</strong>${r.status === 'marked_sent' ? '<span class="badge badge-marked_sent">Marked as Sent</span>' : '<span class="badge badge-opened">Opened</span>'}</div>
        <div class="record-card-row"><span class="rc-label">Policy</span><span>${escapeHtml(r.policies?.policy_number || '')}</span></div>
        <div class="record-card-row"><span class="rc-label">Type</span><span>${REMINDER_TYPE_LABELS[r.reminder_type] || r.reminder_type}</span></div>
        <div class="record-card-row"><span class="rc-label">Date</span><span>${formatDateTime(r.created_at)}</span></div>
      </div>
    `).join('');
  }
  document.getElementById('reminders-page-info').textContent = `Page ${remindersPageState.page + 1} · ${count || 0} total`;
}

function renderDidYouSendStep(schedule, reminderType, message, onDone) {
  const footer = document.getElementById('wa-footer');
  const body = document.querySelector('.modal-body');
  if (!footer || !body) return;

  const banner = document.createElement('div');
  banner.className = 'warning-banner';
  banner.innerHTML = `<strong>Did you send this message in WhatsApp?</strong>`;
  body.appendChild(banner);

  footer.innerHTML = `
    <button class="btn btn-secondary" id="wa-cancel-sent">Cancel</button>
    <button class="btn btn-success" id="wa-mark-sent">Mark as Sent</button>
  `;

  document.getElementById('wa-cancel-sent').addEventListener('click', closeModal);
  document.getElementById('wa-mark-sent').addEventListener('click', async (e) => {
    setButtonLoading(e.target, true, 'Saving…');
    try {
      const now = new Date().toISOString();
      const { error } = await supabaseClient.from('whatsapp_reminders').insert({
        premium_schedule_id: schedule.id,
        customer_id: schedule.customer_id,
        policy_id: schedule.policy_id,
        agent_id: schedule.agent_id,
        reminder_type: reminderType,
        message,
        opened_at: now,
        marked_sent_at: now,
        status: 'marked_sent'
      });
      if (error) throw error;

      await supabaseClient.from('premium_schedules')
        .update({ last_reminder_at: now, reminder_status: 'marked_sent' })
        .eq('id', schedule.id);

      showSuccess('Reminder marked as sent.');
      closeModal();
      if (typeof onDone === 'function') onDone();
    } catch (err) {
      showError(friendlyError(err));
      setButtonLoading(e.target, false);
    }
  });
}
