# Premium Collection Tracker

A production-ready web app for insurance agents to manage customers, policies,
premium schedules, payment collection, follow-ups, and WhatsApp reminders —
built with plain HTML/CSS/JavaScript on the frontend and Supabase
(PostgreSQL + Auth + Row Level Security) on the backend. No React/Angular/Vue.

---

## 1. Project Structure

```
/premium-tracker
  /css
    variables.css      design tokens (colors, spacing, type)
    global.css          reset + base layout
    components.css       sidebar, topbar, cards, tables, modals, badges, forms
    dashboard.css       dashboard-specific layout
    responsive.css       mobile breakpoints (tables -> cards, sidebar -> drawer)
  /js
    supabase.js         central Supabase client config (URL + anon key)
    utils.js            dates, currency, phone cleaning, toasts, modals, status logic
    auth.js              session handling, route guarding, login/logout
    app.js                sidebar/topbar shell, global search
    dashboard.js         dashboard calculations & rendering
    customers.js          customer list + detail + form
    policies.js            policy list + form + schedule-generation trigger
    premiums.js            schedule generation logic + Premium Collection page
    payments.js             Mark Paid modal + Payments history page + CSV export
    whatsapp.js              click-to-chat + message templates + reminder history
    followups.js             follow-up create/complete/reschedule
    reports.js                monthly/daily/agent/overdue/reminder reports
    env.example.js          optional runtime config template (see below)
  /pages
    login.html, reset-password.html
    dashboard.html, customers.html, customer-details.html, policies.html,
    premiums.html, payments.html, reminders.html, reports.html, settings.html
  index.html               redirects to login or dashboard based on session
  schema.sql                full Postgres schema + RLS policies
  seed.sql                   demo data generator
  README.md
```

Every page loads the same shared script bundle (`utils.js`, `auth.js`,
`app.js`, and each feature module) — this keeps the code organized into
logical files while avoiding a fragile per-page dependency list.

---

## 2. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the contents of `schema.sql` once. It creates
   all tables, enums, indexes, an `updated_at` trigger, a trigger that
   auto-creates a `profiles` row for every new `auth.users` signup, and all
   Row Level Security policies.
3. In **Project Settings → API**, copy your **Project URL** and **anon
   public key**.
4. Open `js/supabase.js` and replace:
   ```js
   const SUPABASE_URL = '...';
   const SUPABASE_ANON_KEY = '...';
   ```
   with your real values — **or** use the optional `env.js` approach
   described in `js/env.example.js` if you prefer to keep config outside
   the committed JS file (useful for staging vs. production deploys).

   ⚠️ Only ever use the **anon/public** key in frontend code. Never put the
   `service_role` key in any HTML/JS file.

### Creating your first users

New sign-ups default to the `agent` role. To create your team:

- Go to **Authentication → Users → Add User** and create each agent/manager
  with an email + password (or point people to a sign-up flow you build on
  top of `supabaseClient.auth.signUp`).
- The `handle_new_user()` trigger automatically inserts a matching
  `profiles` row with `role = 'agent'`.
- To make someone a manager, open **Table Editor → profiles** and set their
  `role` to `manager`. To assign agents to that manager, set the agent's
  `manager_id` to the manager's `profiles.id`.

### Demo data

`seed.sql` generates 3 agents' worth of realistic Indian demo data (20
customers, ~30 policies, multiple premium schedules in various states, paid
payments, WhatsApp reminder history, and follow-ups) under one manager.
Read the header comment in `seed.sql` — it requires 4 specific demo auth
users to exist first (create them via **Authentication → Users**), then
run the script in the SQL Editor.

---

## 3. Row Level Security — how it works

RLS is enforced entirely in Postgres (`schema.sql`), not just in the
frontend:

- **Agents** can only `SELECT`/`INSERT`/`UPDATE`/`DELETE` rows where
  `agent_id` matches their own `profiles.id`.
- **Managers** can `SELECT` rows belonging to any agent whose
  `profiles.manager_id` equals the manager's own `profiles.id` (their
  team), in addition to their own rows.
- Managers can never see another manager's team — the policies match
  strictly on `manager_id`, not on role alone.
- Two SQL helper functions, `current_profile_id()` and
  `is_own_or_managed(agent_id)`, centralize this logic so every table's
  policies stay consistent.

Because RLS runs at the database layer, even if frontend code were modified
or bypassed, a user still could not read or write another team's data.

---

## 4. Local Development

This is a static site — no build step required.

```bash
cd premium-tracker
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. It will redirect to `pages/login.html` if
you're not signed in.

---

## 5. Deployment

Deploy the whole `premium-tracker` folder as a static site to any of:

- **Netlify**: drag-and-drop the folder in the Netlify dashboard, or connect
  the Git repo (no build command needed; publish directory = project root).
- **Vercel**: `vercel deploy` from the project root (framework preset:
  "Other" / static).
- **GitHub Pages**: push to a repo and enable Pages on the root or `/docs`
  branch.

Make sure `js/supabase.js` (or `js/env.js`) contains your **production**
Supabase URL/anon key before deploying, and that your Supabase project's
**Authentication → URL Configuration** allows your deployed domain as a
redirect URL (needed for password reset links).

---

## 6. WhatsApp Click-to-Chat — how it works

This app **does not** use the WhatsApp Business API. There is no automatic
sending, delivery confirmation, or read receipt of any kind.

The flow (`js/whatsapp.js`):

1. Agent clicks **Send WhatsApp Reminder** on a premium.
2. The app picks a suggested message template based on the premium's status
   and fills in the customer name, amount, due date, and policy number.
3. The agent can edit the message freely before sending.
4. Clicking **Open WhatsApp** calls `openWhatsApp(phone, message)`, which:
   - cleans the phone number (adds `+91` for 10-digit Indian numbers),
   - URL-encodes the message,
   - opens `https://wa.me/<phone>?text=<message>` in a new tab.
5. The agent manually reviews and sends the message **inside WhatsApp**.
6. Back in the app, the agent is asked **"Did you send this message?"** and
   must click **Mark as Sent** — only then is a `whatsapp_reminders` row
   created with `status = 'marked_sent'`.
7. If the agent closes the dialog without confirming, nothing is recorded.

The UI never displays "Delivered", "Read", or "Sent automatically" —
only "Opened" (dialog was shown) or "Marked as Sent" (agent confirmed).

If a customer was reminded within the last 24 hours, the reminder modal
shows a warning banner, but the agent can still proceed.

---

## 7. Automatic Status Calculation

Premium statuses (`Due Soon`, `Due Today`, `Overdue`, `Upcoming`) are never
stored as "the truth" and manually maintained — they're computed live in
`computeDisplayStatus()` (`js/utils.js`) by comparing `due_date` to today:

- `paid` / `promise_to_pay` in the database always win (never overwritten).
- due date == today → **Due Today**
- due date < today → **Overdue**
- due date within next 7 days → **Due Soon**
- otherwise → **Upcoming**

Dashboard totals (Expected, Collected, Pending, Overdue, Collection Rate)
are calculated the same way — always from live `premium_schedules` and
`payments` queries, never hard-coded.

---

## 8. Feature List (Implemented)

- Supabase Auth login, logout, session persistence, password reset
- Agent and Manager roles with full Row Level Security
- Responsive sidebar navigation with mobile drawer
- Dashboard: summary cards, Today's Collection Actions, Today's Follow-ups,
  Promise-to-Pay panel, Agent Performance table (manager view)
- Customers: list, search, filter, add/edit/archive, detail page with
  policies, premium summary, payment history, reminder history, follow-ups
- Policies: list, add/edit, automatic premium schedule generation
  (monthly/quarterly/half-yearly/yearly) with configurable horizon and
  duplicate-schedule prevention
- Premium Collection page: filter by month/status/customer/agent, Mark
  Paid, Send WhatsApp, View detail, per-row reminder history
- Payments: history table with filters, CSV export
- WhatsApp click-to-chat reminders with 5 editable templates, "did you
  send it" confirmation flow, duplicate-reminder warning, full history
- Follow-ups: create, complete, reschedule; Call/WhatsApp quick actions
- Promise to Pay tracking
- Reports: Monthly Collection, Daily Collection, Agent Collection
  (manager), Overdue Report, Reminder Report
- Global search (customer name/mobile, policy number) with debouncing
- Toast notifications, confirmation prompts for destructive actions,
  loading states, disabled buttons during submission, friendly error
  messages (raw DB errors never shown to users)
- Empty states across every list/table
- Indian currency formatting (₹ via `Intl.NumberFormat`) and DD-MMM-YYYY
  date formatting throughout
- Mobile-responsive tables (convert to stacked cards) and touch-friendly
  action buttons

## 9. Remaining Configuration (must be done manually)

- Add your real `SUPABASE_URL` / `SUPABASE_ANON_KEY` in `js/supabase.js`
  (or set up `js/env.js` per `js/env.example.js`).
- Run `schema.sql` in the Supabase SQL Editor.
- Create your agent/manager users in Supabase Auth and set roles/
  `manager_id` relationships in the `profiles` table.
- (Optional) Create the 4 demo auth users and run `seed.sql` for sample data.
- Set your production domain in Supabase **Authentication → URL
  Configuration** so password-reset emails redirect correctly.
- Review/customize the WhatsApp message templates in `js/whatsapp.js` to
  match your agency's tone.
- Decide on and configure a real logo/branding if desired (currently a
  simple text + dot mark).
