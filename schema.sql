-- ============================================================================
-- Premium Collection Tracker — Database Schema
-- Run this in the Supabase SQL Editor (or via `supabase db push`) on a fresh
-- project. Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS guards.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- ENUM TYPES
-- ----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('agent', 'manager');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_frequency as enum ('monthly', 'quarterly', 'half_yearly', 'yearly');
exception when duplicate_object then null; end $$;

do $$ begin
  create type policy_status as enum ('active', 'lapsed', 'matured', 'cancelled', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type premium_status as enum ('upcoming', 'due_soon', 'due_today', 'overdue', 'paid', 'promise_to_pay');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment_mode as enum ('cash', 'upi', 'bank_transfer', 'cheque', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_type as enum ('PREMIUM_7_DAYS', 'PREMIUM_TOMORROW', 'PREMIUM_TODAY', 'PREMIUM_OVERDUE', 'PAYMENT_CONFIRMATION');
exception when duplicate_object then null; end $$;

do $$ begin
  create type reminder_status as enum ('opened', 'marked_sent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_type as enum ('payment_followup', 'customer_call', 'payment_promise', 'document_followup', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type followup_status as enum ('pending', 'completed', 'rescheduled');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key default uuid_generate_v4(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  full_name text not null,
  mobile text,
  email text,
  role user_role not null default 'agent',
  manager_id uuid references profiles(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- customers
-- ----------------------------------------------------------------------------
create table if not exists customers (
  id uuid primary key default uuid_generate_v4(),
  agent_id uuid not null references profiles(id) on delete cascade,
  full_name text not null,
  mobile text not null,
  alternate_mobile text,
  email text,
  date_of_birth date,
  address text,
  city text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- policies
-- ----------------------------------------------------------------------------
create table if not exists policies (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id) on delete cascade,
  agent_id uuid not null references profiles(id) on delete cascade,
  policy_number text not null,
  plan_name text not null,
  premium_amount numeric(12,2) not null check (premium_amount > 0),
  payment_frequency payment_frequency not null,
  policy_start_date date not null,
  next_due_date date not null,
  maturity_date date,
  status policy_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agent_id, policy_number)
);

-- ----------------------------------------------------------------------------
-- premium_schedules
-- ----------------------------------------------------------------------------
create table if not exists premium_schedules (
  id uuid primary key default uuid_generate_v4(),
  policy_id uuid not null references policies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  agent_id uuid not null references profiles(id) on delete cascade,
  due_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  status premium_status not null default 'upcoming',
  paid_date date,
  payment_id uuid,
  promise_date date,
  promise_notes text,
  reminder_status reminder_status,
  last_reminder_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (policy_id, due_date)
);

-- ----------------------------------------------------------------------------
-- payments
-- ----------------------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default uuid_generate_v4(),
  premium_schedule_id uuid not null references premium_schedules(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  agent_id uuid not null references profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  payment_date date not null,
  payment_mode payment_mode not null,
  reference_number text,
  notes text,
  created_at timestamptz not null default now()
);

alter table premium_schedules
  add constraint premium_schedules_payment_id_fkey
  foreign key (payment_id) references payments(id) on delete set null;

-- ----------------------------------------------------------------------------
-- whatsapp_reminders
-- ----------------------------------------------------------------------------
create table if not exists whatsapp_reminders (
  id uuid primary key default uuid_generate_v4(),
  premium_schedule_id uuid not null references premium_schedules(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  policy_id uuid not null references policies(id) on delete cascade,
  agent_id uuid not null references profiles(id) on delete cascade,
  reminder_type reminder_type not null,
  message text not null,
  opened_at timestamptz,
  marked_sent_at timestamptz,
  status reminder_status not null default 'opened',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- follow_ups
-- ----------------------------------------------------------------------------
create table if not exists follow_ups (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id) on delete cascade,
  policy_id uuid references policies(id) on delete set null,
  premium_schedule_id uuid references premium_schedules(id) on delete set null,
  agent_id uuid not null references profiles(id) on delete cascade,
  follow_up_date date not null,
  follow_up_type followup_type not null,
  notes text,
  status followup_status not null default 'pending',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- INDEXES
-- ----------------------------------------------------------------------------
create index if not exists idx_customers_mobile on customers(mobile);
create index if not exists idx_customers_agent_id on customers(agent_id);
create index if not exists idx_policies_policy_number on policies(policy_number);
create index if not exists idx_policies_customer_id on policies(customer_id);
create index if not exists idx_policies_agent_id on policies(agent_id);
create index if not exists idx_premium_schedules_due_date on premium_schedules(due_date);
create index if not exists idx_premium_schedules_status on premium_schedules(status);
create index if not exists idx_premium_schedules_agent_id on premium_schedules(agent_id);
create index if not exists idx_premium_schedules_policy_id on premium_schedules(policy_id);
create index if not exists idx_payments_payment_date on payments(payment_date);
create index if not exists idx_payments_agent_id on payments(agent_id);
create index if not exists idx_whatsapp_reminders_created_at on whatsapp_reminders(created_at);
create index if not exists idx_followups_agent_id on follow_ups(agent_id);
create index if not exists idx_followups_date on follow_ups(follow_up_date);
create index if not exists idx_profiles_manager_id on profiles(manager_id);
create index if not exists idx_profiles_auth_user_id on profiles(auth_user_id);

-- ----------------------------------------------------------------------------
-- updated_at trigger helper
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_profiles_updated_at on profiles;
create trigger trg_profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at before update on customers
  for each row execute function set_updated_at();

drop trigger if exists trg_policies_updated_at on policies;
create trigger trg_policies_updated_at before update on policies
  for each row execute function set_updated_at();

drop trigger if exists trg_premium_schedules_updated_at on premium_schedules;
create trigger trg_premium_schedules_updated_at before update on premium_schedules
  for each row execute function set_updated_at();

drop trigger if exists trg_followups_updated_at on follow_ups;
create trigger trg_followups_updated_at before update on follow_ups
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- Auto-create profile row when a new auth user signs up
-- (defaults new users to 'agent' — promote to 'manager' manually in the table)
-- ----------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (auth_user_id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email,
    'agent'
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

alter table profiles enable row level security;
alter table customers enable row level security;
alter table policies enable row level security;
alter table premium_schedules enable row level security;
alter table payments enable row level security;
alter table whatsapp_reminders enable row level security;
alter table follow_ups enable row level security;

-- Helper: current user's profile id
create or replace function current_profile_id()
returns uuid as $$
  select id from profiles where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- Helper: is the current user a manager?
create or replace function is_manager()
returns boolean as $$
  select role = 'manager' from profiles where auth_user_id = auth.uid();
$$ language sql stable security definer;

-- Helper: does the given agent_id report to the current manager (or is self)?
create or replace function is_own_or_managed(target_agent_id uuid)
returns boolean as $$
  select target_agent_id = current_profile_id()
     or exists (
        select 1 from profiles p
        where p.id = target_agent_id
          and p.manager_id = current_profile_id()
     );
$$ language sql stable security definer;

-- ----------------- profiles -----------------
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select
  using (
    auth_user_id = auth.uid()
    or manager_id = current_profile_id()
    or is_manager() -- managers can browse agents to build their team view
  );

drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update
  using (auth_user_id = auth.uid());

drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self on profiles for insert
  with check (auth_user_id = auth.uid());

-- ----------------- customers -----------------
drop policy if exists customers_select on customers;
create policy customers_select on customers for select
  using (is_own_or_managed(agent_id));

drop policy if exists customers_insert on customers;
create policy customers_insert on customers for insert
  with check (agent_id = current_profile_id());

drop policy if exists customers_update on customers;
create policy customers_update on customers for update
  using (agent_id = current_profile_id());

drop policy if exists customers_delete on customers;
create policy customers_delete on customers for delete
  using (agent_id = current_profile_id());

-- ----------------- policies -----------------
drop policy if exists policies_select on policies;
create policy policies_select on policies for select
  using (is_own_or_managed(agent_id));

drop policy if exists policies_insert on policies;
create policy policies_insert on policies for insert
  with check (agent_id = current_profile_id());

drop policy if exists policies_update on policies;
create policy policies_update on policies for update
  using (agent_id = current_profile_id());

drop policy if exists policies_delete on policies;
create policy policies_delete on policies for delete
  using (agent_id = current_profile_id());

-- ----------------- premium_schedules -----------------
drop policy if exists premium_schedules_select on premium_schedules;
create policy premium_schedules_select on premium_schedules for select
  using (is_own_or_managed(agent_id));

drop policy if exists premium_schedules_insert on premium_schedules;
create policy premium_schedules_insert on premium_schedules for insert
  with check (agent_id = current_profile_id());

drop policy if exists premium_schedules_update on premium_schedules;
create policy premium_schedules_update on premium_schedules for update
  using (agent_id = current_profile_id());

drop policy if exists premium_schedules_delete on premium_schedules;
create policy premium_schedules_delete on premium_schedules for delete
  using (agent_id = current_profile_id());

-- ----------------- payments -----------------
drop policy if exists payments_select on payments;
create policy payments_select on payments for select
  using (is_own_or_managed(agent_id));

drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert
  with check (agent_id = current_profile_id());

drop policy if exists payments_update on payments;
create policy payments_update on payments for update
  using (agent_id = current_profile_id());

drop policy if exists payments_delete on payments;
create policy payments_delete on payments for delete
  using (agent_id = current_profile_id());

-- ----------------- whatsapp_reminders -----------------
drop policy if exists reminders_select on whatsapp_reminders;
create policy reminders_select on whatsapp_reminders for select
  using (is_own_or_managed(agent_id));

drop policy if exists reminders_insert on whatsapp_reminders;
create policy reminders_insert on whatsapp_reminders for insert
  with check (agent_id = current_profile_id());

drop policy if exists reminders_update on whatsapp_reminders;
create policy reminders_update on whatsapp_reminders for update
  using (agent_id = current_profile_id());

-- ----------------- follow_ups -----------------
drop policy if exists followups_select on follow_ups;
create policy followups_select on follow_ups for select
  using (is_own_or_managed(agent_id));

drop policy if exists followups_insert on follow_ups;
create policy followups_insert on follow_ups for insert
  with check (agent_id = current_profile_id());

drop policy if exists followups_update on follow_ups;
create policy followups_update on follow_ups for update
  using (agent_id = current_profile_id());

drop policy if exists followups_delete on follow_ups;
create policy followups_delete on follow_ups for delete
  using (agent_id = current_profile_id());

-- ============================================================================
-- End of schema.sql
-- ============================================================================
