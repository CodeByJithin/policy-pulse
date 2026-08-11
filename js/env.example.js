// ============================================================================
// env.example.js — OPTIONAL template for injecting Supabase config without
// hard-coding values inside js/supabase.js.
//
// To use:
//   1. Copy this file to js/env.js
//   2. Fill in your real SUPABASE_URL / SUPABASE_ANON_KEY below
//   3. In every page's <head>, include it BEFORE js/supabase.js:
//        <script src="https://unpkg.com/@supabase/supabase-js@2"></script>
//        <script src="../js/env.js"></script>
//        <script src="../js/supabase.js"></script>
//   4. Add js/env.js to .gitignore so project-specific values aren't committed
//      (the anon key is safe to expose publicly, but this keeps per-deploy
//      config out of source control, e.g. for staging vs production).
// ============================================================================

window.__ENV__ = {
  SUPABASE_URL: 'https://YOUR-PROJECT-REF.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-PUBLIC-ANON-KEY',
  APP_TIMEZONE: 'Asia/Kolkata'
};
