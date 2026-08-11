// ============================================================================
// Central Supabase configuration.
// Loaded via CDN in every page (see <script src="https://unpkg.com/@supabase/supabase-js@2"></script>)
// Only the PUBLIC anon key belongs here. Never put the service_role key
// in frontend code.
// ============================================================================

// TODO: replace with your project's values (Project Settings -> API)
const SUPABASE_URL = 'https://gjygbdyzdmvohjbfgnbo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdqeWdiZHl6ZG12b2hqYmZnbmJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYzMzY2NzksImV4cCI6MjEwMTkxMjY3OX0.nq_UpAPAe-5mIFbW7_HrvYv2g2RwBs72pYkLX43lp1c';
console.log(SUPABASE_ANON_KEY);

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

// Default app timezone (used for date-only display helpers in utils.js)
const APP_TIMEZONE = 'Asia/Kolkata';
