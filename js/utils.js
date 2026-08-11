// ============================================================================
// utils.js — shared helpers used across every page.
// ============================================================================

/* ---------------------------- Date helpers ---------------------------- */

// Parses a Postgres 'YYYY-MM-DD' date string as a local calendar date
// (avoids UTC-shift bugs where new Date('2026-08-10') can render as Aug 9
// in timezones behind UTC).
function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function todayDateOnly() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// Formats a date-only string/Date as DD-MMM-YYYY, e.g. 10-Aug-2026
function formatDate(input) {
  if (!input) return '—';
  const date = typeof input === 'string' ? parseDateOnly(input) : input;
  if (!date || isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[date.getMonth()]}-${date.getFullYear()}`;
}

// Formats a timestamptz ISO string as DD-MMM-YYYY, hh:mm AM/PM
function formatDateTime(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  const dd = String(date.getDate()).padStart(2, '0');
  let h = date.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[date.getMonth()]}-${date.getFullYear()}, ${h}:${min} ${ampm}`;
}

function daysBetween(a, b) {
  const MS = 1000 * 60 * 60 * 24;
  return Math.round((b.getTime() - a.getTime()) / MS);
}

function firstDayOfMonth(year, monthIndex) {
  return toDateInputValue(new Date(year, monthIndex, 1));
}
function lastDayOfMonth(year, monthIndex) {
  return toDateInputValue(new Date(year, monthIndex + 1, 0));
}

/* --------------------------- Currency helpers --------------------------- */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0
});

function formatINR(amount) {
  const n = Number(amount);
  if (isNaN(n)) return '₹0';
  return inrFormatter.format(n);
}

/* --------------------------- Status helpers --------------------------- */

// Computes the *display* status for a premium schedule row dynamically.
// Never overwrites a 'paid' or 'promise_to_pay' status stored in the DB.
function computeDisplayStatus(schedule) {
  if (schedule.status === 'paid') return 'paid';
  if (schedule.status === 'promise_to_pay') return 'promise_to_pay';

  const due = parseDateOnly(schedule.due_date);
  const today = todayDateOnly();
  const diff = daysBetween(today, due); // positive = future, negative = past

  if (diff === 0) return 'due_today';
  if (diff < 0) return 'overdue';
  if (diff <= 7) return 'due_soon';
  return 'upcoming';
}

const STATUS_LABELS = {
  paid: 'Paid',
  due_soon: 'Due Soon',
  due_today: 'Due Today',
  overdue: 'Overdue',
  upcoming: 'Upcoming',
  promise_to_pay: 'Promise to Pay'
};

function statusBadgeHtml(statusKey) {
  const label = STATUS_LABELS[statusKey] || statusKey;
  return `<span class="badge badge-${statusKey}"><span class="badge-dot"></span>${label}</span>`;
}

const POLICY_STATUS_LABELS = {
  active: 'Active', lapsed: 'Lapsed', matured: 'Matured', cancelled: 'Cancelled', inactive: 'Inactive'
};
function policyStatusBadgeHtml(statusKey) {
  return `<span class="badge badge-${statusKey}">${POLICY_STATUS_LABELS[statusKey] || statusKey}</span>`;
}

/* ---------------------------- Phone helpers ---------------------------- */

// Cleans a raw phone number input and prefixes the country code (default
// India +91) if missing, returning digits-only string suitable for wa.me.
function cleanPhoneForWhatsApp(rawPhone, countryCode = '91') {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/[^\d]/g, '');
  // strip leading 0
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) {
    digits = countryCode + digits;
  } else if (digits.startsWith('0' + countryCode)) {
    digits = digits.slice(1);
  }
  return digits;
}

function isValidPhoneForWhatsApp(cleaned) {
  return !!cleaned && /^\d{11,15}$/.test(cleaned);
}

/* ------------------------------ Debounce ------------------------------ */

function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ------------------------------- Toasts -------------------------------- */

function ensureToastContainer() {
  let el = document.querySelector('.toast-container');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast-container';
    document.body.appendChild(el);
  }
  return el;
}

function showToast(message, type = 'info', duration = 3500) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

function showSuccess(msg) { showToast(msg, 'success'); }
function showError(msg) { showToast(msg, 'error'); }

// Converts raw Supabase/Postgres errors into a friendly message; never
// exposes raw DB error text to the end user.
function friendlyError(err, fallback = 'Something went wrong. Please try again.') {
  console.error('[App error]', err);
  if (!navigator.onLine) return 'You appear to be offline. Please check your internet connection.';
  if (!err) return fallback;
  const code = err.code || '';
  if (code === '23505') return 'This record already exists (duplicate value).';
  if (code === '23503') return 'This action references a record that no longer exists.';
  if (code === '42501' || code === 'PGRST301') return 'You are not authorized to perform this action.';
  if (err.message && /Failed to fetch|NetworkError/i.test(err.message)) return 'Network error. Please check your connection and try again.';
  return fallback;
}

/* ------------------------------- Modals -------------------------------- */

function openModal(innerHtml, { size = '' } = {}) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'active-modal-overlay';
  overlay.innerHTML = `<div class="modal ${size === 'lg' ? 'modal-lg' : ''}">${innerHtml}</div>`;
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal();
  });
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  return overlay;
}

function closeModal() {
  const existing = document.getElementById('active-modal-overlay');
  if (existing) existing.remove();
  document.body.style.overflow = '';
}

function confirmAction(message) {
  return window.confirm(message);
}

/* ------------------------------ Misc utils ------------------------------ */

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setButtonLoading(btn, loading, loadingText = 'Please wait…') {
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${loadingText}`;
  } else {
    btn.disabled = false;
    if (btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
  }
}

function qs(params) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') usp.set(k, v);
  });
  return usp.toString();
}

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}
