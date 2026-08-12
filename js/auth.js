// ============================================================================
// auth.js — Supabase Auth session handling, profile loading, route guarding.
// ============================================================================

let CURRENT_SESSION = null;
let CURRENT_PROFILE = null; // row from `profiles` table for the logged-in user

const PUBLIC_PAGES = ['login.html', 'reset-password.html'];

function currentPageName() {
  const path = window.location.pathname;
  return path.substring(path.lastIndexOf('/') + 1) || 'index.html';
}

// Resolves the correct relative path to a page, whether we're currently
// inside /pages/ or at the project root (index.html).
//
// index.html lives at the project root; every other page (login.html,
// dashboard.html, etc.) lives inside /pages/ alongside the current page,
// so from within /pages/ those need NO "../" prefix.
function pageUrl(name) {
  const inPagesDir = window.location.pathname.includes('/pages/');
  if (name === 'index.html') {
    return inPagesDir ? '../index.html' : 'index.html';
  }
  return inPagesDir ? name : `pages/${name}`;
}

async function fetchProfile(authUserId) {
  const { data, error } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('auth_user_id', authUserId)
    .single();
  if (error) {
    console.error('Failed to load profile', error);
    return null;
  }
  return data;
}

// Call at the top of every protected page. Redirects to login if not
// authenticated, otherwise resolves with { session, profile }.
async function requireAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    window.location.href = pageUrl('login.html');
    return null;
  }
  CURRENT_SESSION = session;
  CURRENT_PROFILE = await fetchProfile(session.user.id);
  if (!CURRENT_PROFILE) {
    showError('Could not load your profile. Please contact your administrator.');
    return null;
  }
  if (!CURRENT_PROFILE.is_active) {
    await supabaseClient.auth.signOut();
    window.location.href = pageUrl('login.html');
    return null;
  }
  return { session: CURRENT_SESSION, profile: CURRENT_PROFILE };
}

function isManager() {
  return CURRENT_PROFILE?.role === 'manager';
}

async function loginWithPassword(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

async function logout() {
  await supabaseClient.auth.signOut();
  window.location.href = pageUrl('login.html');
}

async function sendPasswordReset(email) {
  const redirectTo = window.location.origin + window.location.pathname.replace(/login\.html$/, 'reset-password.html');
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
}

async function updatePassword(newPassword) {
  const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
  if (error) throw error;
}