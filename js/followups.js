// ============================================================================
// followups.js — Follow-up creation, completion, and reschedule.
// ============================================================================

const FOLLOWUP_TYPES = ['payment_followup', 'customer_call', 'payment_promise', 'document_followup', 'other'];
const FOLLOWUP_TYPE_LABELS = {
  payment_followup: 'Payment Follow-up',
  customer_call: 'Customer Call',
  payment_promise: 'Payment Promise',
  document_followup: 'Document Follow-up',
  other: 'Other'
};

function openFollowUpFormModal(schedule, onDone) {
  openModal(`
    <div class="modal-header"><h3>Add Follow-up</h3><button class="modal-close" onclick="closeModal()">&times;</button></div>
    <div class="modal-body">
      <form id="followup-form">
        <div class="form-group">
          <label class="form-label">Follow-up Date <span class="req">*</span></label>
          <input type="date" class="form-control" id="fu-date" value="${toDateInputValue(todayDateOnly())}" required>
        </div>
        <div class="form-group">
          <label class="form-label">Type <span class="req">*</span></label>
          <select class="form-control" id="fu-type">
            ${FOLLOWUP_TYPES.map(t => `<option value="${t}">${FOLLOWUP_TYPE_LABELS[t]}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Notes</label>
          <textarea class="form-control" id="fu-notes" rows="3" placeholder="e.g. Customer will pay after salary credit"></textarea>
        </div>
      </form>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fu-save-btn">Save Follow-up</button>
    </div>
  `);

  document.getElementById('fu-save-btn').addEventListener('click', async (e) => {
    const date = document.getElementById('fu-date').value;
    if (!date) { showError('Follow-up date is required.'); return; }
    setButtonLoading(e.target, true, 'Saving…');
    try {
      const { error } = await supabaseClient.from('follow_ups').insert({
        customer_id: schedule.customer_id,
        policy_id: schedule.policy_id || null,
        premium_schedule_id: schedule.id || null,
        agent_id: schedule.agent_id || CURRENT_PROFILE.id,
        follow_up_date: date,
        follow_up_type: document.getElementById('fu-type').value,
        notes: document.getElementById('fu-notes').value.trim() || null,
        status: 'pending'
      });
      if (error) throw error;
      showSuccess('Follow-up added successfully.');
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
