// ============================================================================
// followups.js — Follow-up create, edit, complete, reschedule, and delete.
// ============================================================================

const FOLLOWUP_TYPES = ['payment_followup', 'customer_call', 'payment_promise', 'document_followup', 'other'];
const FOLLOWUP_TYPE_LABELS = {
  payment_followup: 'Payment Follow-up',
  customer_call: 'Customer Call',
  payment_promise: 'Payment Promise',
  document_followup: 'Document Follow-up',
  other: 'Other'
};
const FOLLOWUP_STATUSES = ['pending', 'completed', 'rescheduled'];
const FOLLOWUP_STATUS_LABELS = { pending: 'Pending', completed: 'Completed', rescheduled: 'Rescheduled' };

// Opens the Add/Edit Follow-up form.
//
// To CREATE: pass a context object describing what the follow-up is tied
// to, e.g. { customer_id, policy_id, premium_schedule_id, agent_id,
// customer_name }. Only customer_id is required; policy_id and
// premium_schedule_id are optional (a follow-up can be general, or tied to
// a specific policy/premium installment).
//
// To EDIT: pass the existing follow_ups row itself (it already has
// customer_id/policy_id/etc, plus id, follow_up_date, follow_up_type,
// notes, and status) — the form pre-fills every field, including status.
function openFollowUpFormModal(context, onDone) {
  const isEdit = !!context.id;
  const customerLabel = context.customer_name ? ` for ${escapeHtml(context.customer_name)}` : '';

  openModal(`
    <div class="modal-header"><h3>${isEdit ? 'Edit Follow-up' : 'Add Follow-up'}${!isEdit ? customerLabel : ''}</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <form id="followup-form">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">Follow-up Date <span class="req">*</span></label>
            <input type="date" class="form-control" id="fu-date" value="${context.follow_up_date || toDateInputValue(todayDateOnly())}" required>
          </div>
          <div class="form-group">
            <label class="form-label">Type <span class="req">*</span></label>
            <select class="form-control" id="fu-type">
              ${FOLLOWUP_TYPES.map(t => `<option value="${t}" ${context.follow_up_type === t ? 'selected' : ''}>${FOLLOWUP_TYPE_LABELS[t]}</option>`).join('')}
            </select>
          </div>
        </div>
        ${isEdit ? `
        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-control" id="fu-status">
            ${FOLLOWUP_STATUSES.map(s => `<option value="${s}" ${context.status === s ? 'selected' : ''}>${FOLLOWUP_STATUS_LABELS[s]}</option>`).join('')}
          </select>
        </div>` : ''}
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="fu-notes" rows="3" placeholder="e.g. Customer will pay after salary credit">${escapeHtml(context.notes || '')}</textarea>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      ${isEdit ? '<button class="btn btn-ghost text-danger" id="fu-delete-btn" style="margin-right:auto">Delete</button>' : ''}
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fu-save-btn">${isEdit ? 'Save Changes' : 'Save Follow-up'}</button>
    </div>
  `);

  if (isEdit) {
    document.getElementById('fu-delete-btn').addEventListener('click', async () => {
      closeModal();
      await deleteFollowUp(context.id, onDone);
    });
  }

  document.getElementById('fu-save-btn').addEventListener('click', async (e) => {
    const date = document.getElementById('fu-date').value;
    if (!date) { showError('Follow-up date is required.'); return; }

    const payload = {
      follow_up_date: date,
      follow_up_type: document.getElementById('fu-type').value,
      notes: document.getElementById('fu-notes').value.trim() || null
    };

    setButtonLoading(e.target, true, 'Saving…');
    try {
      if (isEdit) {
        const newStatus = document.getElementById('fu-status').value;
        payload.status = newStatus;
        payload.completed_at = newStatus === 'completed' ? new Date().toISOString() : null;
        const { error } = await supabaseClient.from('follow_ups').update(payload).eq('id', context.id);
        if (error) throw error;
        showSuccess('Follow-up updated successfully.');
      } else {
        if (!context.customer_id) throw new Error('Missing customer for this follow-up.');
        payload.customer_id = context.customer_id;
        payload.policy_id = context.policy_id || null;
        payload.premium_schedule_id = context.premium_schedule_id || null;
        payload.agent_id = context.agent_id || CURRENT_PROFILE.id;
        payload.status = 'pending';
        const { error } = await supabaseClient.from('follow_ups').insert(payload);
        if (error) throw error;
        showSuccess('Follow-up added successfully.');
      }
      closeModal();
      if (onDone) onDone();
    } catch (err) {
      showError(friendlyError(err));
      setButtonLoading(e.target, false);
    }
  });
}

async function completeFollowUp(id, onDone) {
  const { error } = await supabaseClient.from('follow_ups')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) { showError(friendlyError(error)); return; }
  showSuccess('Follow-up completed.');
  if (onDone) onDone();
}

// Quick date-only reschedule (used by compact list views). For changing
// type/notes/status too, use openFollowUpFormModal(existingRow, onDone).
function openRescheduleFollowUpModal(id, onDone) {
  openModal(`
    <div class="modal-header"><h3>Reschedule Follow-up</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">New Follow-up Date <span class="req">*</span></label>
        <input type="date" class="form-control" id="fu-new-date" value="${toDateInputValue(todayDateOnly())}" min="${toDateInputValue(todayDateOnly())}" required>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fu-resched-btn">Save</button>
    </div>
  `);
  document.getElementById('fu-resched-btn').addEventListener('click', async (e) => {
    const newDate = document.getElementById('fu-new-date').value;
    if (!newDate) { showError('Please choose a date.'); return; }
    setButtonLoading(e.target, true, 'Saving…');
    const { error } = await supabaseClient.from('follow_ups').update({ follow_up_date: newDate, status: 'rescheduled' }).eq('id', id);
    if (error) { showError(friendlyError(error)); setButtonLoading(e.target, false); return; }
    showSuccess('Follow-up rescheduled.');
    closeModal();
    if (onDone) onDone();
  });
}

async function deleteFollowUp(id, onDone) {
  if (!confirmAction('Delete this follow-up? This cannot be undone.')) return;
  const { error } = await supabaseClient.from('follow_ups').delete().eq('id', id);
  if (error) { showError(friendlyError(error, 'Could not delete this follow-up.')); return; }
  showSuccess('Follow-up deleted.');
  if (onDone) onDone();
}
