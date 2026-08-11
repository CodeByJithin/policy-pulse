-- ============================================================================
-- Premium Collection Tracker — Demo Seed Data
-- ============================================================================
-- PREREQUISITE: Create 4 real Supabase Auth users FIRST (Authentication ->
-- Users -> Add User, or your sign-up page) using these exact emails:
--
--   manager.demo@premiumtracker.test   (then set role='manager' after seeding)
--   agent1.demo@premiumtracker.test
--   agent2.demo@premiumtracker.test
--   agent3.demo@premiumtracker.test
--
-- The `handle_new_user()` trigger in schema.sql auto-creates a matching
-- `profiles` row for each as soon as the auth user is created (default
-- role = 'agent'). This script then looks those profiles up by email,
-- promotes the manager, links the 3 agents to them, and generates
-- realistic demo data. Safe to re-run: it clears prior demo rows for these
-- specific agents first.
-- ============================================================================

do $$
declare
  v_manager_id uuid;
  v_agent1_id uuid;
  v_agent2_id uuid;
  v_agent3_id uuid;
  v_agent_ids uuid[];
  v_customer_id uuid;
  v_policy_id uuid;
  v_agent_id uuid;
  v_names text[] := array[
    'Ramesh Iyer','Suresh Nair','Priya Menon','Anjali Pillai','Vijay Kumar',
    'Lakshmi Narayan','Arun Prakash','Deepa Krishnan','Karthik Subramanian','Meena Rajan',
    'Sanjay Varma','Divya Rao','Ravi Shankar','Sunitha Pillai','Manoj Nambiar',
    'Kavya Krishnan','Rajesh Panicker','Anitha George','Vinod Menon','Shalini Kutty'
  ];
  v_cities text[] := array['Kochi','Thrissur','Palakkad','Kozhikode','Kottayam','Ernakulam','Alappuzha','Malappuram'];
  v_plans text[] := array['SecureLife Gold','FamilyShield Plus','SmartSave Endowment','HealthGuard Premier','WealthBuilder ULIP','ChildFuture Plan'];
  i int;
  n_customers int;
  cust_name text;
  cust_mobile text;
  freq payment_frequency;
  months_to_generate int;
  start_date date;
  due date;
  amt numeric;
  k int;
  step interval;
  rnd numeric;
  new_policy_id uuid;
  new_customer_id uuid;
begin
  select id into v_manager_id from profiles where email = 'manager.demo@premiumtracker.test';
  select id into v_agent1_id from profiles where email = 'agent1.demo@premiumtracker.test';
  select id into v_agent2_id from profiles where email = 'agent2.demo@premiumtracker.test';
  select id into v_agent3_id from profiles where email = 'agent3.demo@premiumtracker.test';

  if v_manager_id is null or v_agent1_id is null or v_agent2_id is null or v_agent3_id is null then
    raise exception 'Create the 4 demo auth users first (see header comment), then re-run seed.sql';
  end if;

  -- Promote manager & link agents
  update profiles set role = 'manager', full_name = 'Anitha Balakrishnan' where id = v_manager_id;
  update profiles set role = 'agent', manager_id = v_manager_id, full_name = 'Rahul Menon' where id = v_agent1_id;
  update profiles set role = 'agent', manager_id = v_manager_id, full_name = 'Sneha Thomas' where id = v_agent2_id;
  update profiles set role = 'agent', manager_id = v_manager_id, full_name = 'Arjun Nair' where id = v_agent3_id;

  v_agent_ids := array[v_agent1_id, v_agent2_id, v_agent3_id];

  -- Clear old demo data for these agents (idempotent re-run)
  delete from follow_ups where agent_id = any(v_agent_ids);
  delete from whatsapp_reminders where agent_id = any(v_agent_ids);
  delete from payments where agent_id = any(v_agent_ids);
  delete from premium_schedules where agent_id = any(v_agent_ids);
  delete from policies where agent_id = any(v_agent_ids);
  delete from customers where agent_id = any(v_agent_ids);

  n_customers := array_length(v_names, 1);

  for i in 1..n_customers loop
    cust_name := v_names[i];
    cust_mobile := '9' || (700000000 + (i * 137 % 99999999))::text;
    v_agent_id := v_agent_ids[1 + (i % 3)];

    insert into customers (agent_id, full_name, mobile, email, city, address, notes, is_active)
    values (
      v_agent_id, cust_name, cust_mobile,
      lower(replace(cust_name, ' ', '.')) || '@example.com',
      v_cities[1 + (i % array_length(v_cities,1))],
      i || ' MG Road, ' || v_cities[1 + (i % array_length(v_cities,1))],
      case when i % 5 = 0 then 'Prefers evening calls' else null end,
      true
    )
    returning id into new_customer_id;

    -- Each customer gets 1 or 2 policies (~30 policies across 20 customers)
    for k in 1..(case when i <= 10 then 2 else 1 end) loop
      freq := (array['monthly','quarterly','half_yearly','yearly']::payment_frequency[])[1 + ((i+k) % 4)];
      amt := (array[2500,5000,7500,10000,12000,15000,18000,25000])[1 + ((i*k) % 8)];
      start_date := date '2026-01-10' + ((i % 6) || ' months')::interval;

      insert into policies (
        customer_id, agent_id, policy_number, plan_name, premium_amount,
        payment_frequency, policy_start_date, next_due_date, maturity_date, status
      ) values (
        new_customer_id, v_agent_id,
        'POL' || to_char(start_date, 'YYYY') || '-' || lpad((i*10+k)::text, 5, '0'),
        v_plans[1 + ((i+k) % array_length(v_plans,1))],
        amt, freq, start_date, start_date,
        start_date + interval '15 years',
        'active'
      ) returning id into new_policy_id;

      -- generate schedule installments: 3 in the past (some paid/overdue), 4 in the future
      step := case freq
        when 'monthly' then interval '1 month'
        when 'quarterly' then interval '3 months'
        when 'half_yearly' then interval '6 months'
        else interval '1 year'
      end;

      for k in -3..4 loop
        due := start_date + (k * step);
        rnd := random();
        insert into premium_schedules (
          policy_id, customer_id, agent_id, due_date, amount, status, paid_date, promise_date, promise_notes
        ) values (
          new_policy_id, new_customer_id, v_agent_id, due, amt,
          case
            when due < current_date and rnd < 0.6 then 'paid'
            when due < current_date and rnd < 0.8 then 'overdue'
            when due < current_date then 'promise_to_pay'
            else 'upcoming'
          end,
          case when due < current_date and rnd < 0.6 then due + (floor(random()*3))::int else null end,
          case when due < current_date and rnd >= 0.8 then current_date + interval '5 days' else null end,
          case when due < current_date and rnd >= 0.8 then 'Customer promised to pay after salary credit' else null end
        )
        on conflict (policy_id, due_date) do nothing;
      end loop;
    end loop;
  end loop;

  -- Record a payment row for every schedule marked paid, and link it back
  insert into payments (premium_schedule_id, policy_id, customer_id, agent_id, amount, payment_date, payment_mode, reference_number)
  select ps.id, ps.policy_id, ps.customer_id, ps.agent_id, ps.amount, ps.paid_date,
         (array['cash','upi','bank_transfer','cheque']::payment_mode[])[1 + (floor(random()*4))::int],
         'REF' || lpad((floor(random()*999999))::text, 6, '0')
  from premium_schedules ps
  where ps.status = 'paid' and ps.agent_id = any(v_agent_ids);

  update premium_schedules ps
  set payment_id = p.id
  from payments p
  where p.premium_schedule_id = ps.id and ps.status = 'paid';

  -- WhatsApp reminder history for overdue / promise-to-pay schedules
  insert into whatsapp_reminders (premium_schedule_id, customer_id, policy_id, agent_id, reminder_type, message, opened_at, marked_sent_at, status)
  select ps.id, ps.customer_id, ps.policy_id, ps.agent_id,
         case when ps.status = 'overdue' then 'PREMIUM_OVERDUE'::reminder_type else 'PREMIUM_7_DAYS'::reminder_type end,
         'Hello, this is a reminder that your policy premium is due. Please contact your agent for assistance.',
         now() - interval '2 days', now() - interval '2 days' + interval '3 minutes', 'marked_sent'
  from premium_schedules ps
  where ps.status in ('overdue', 'promise_to_pay') and ps.agent_id = any(v_agent_ids);

  update premium_schedules ps
  set last_reminder_at = now() - interval '2 days'
  where ps.status in ('overdue', 'promise_to_pay') and ps.agent_id = any(v_agent_ids);

  -- Follow-ups: a handful due today / this week for overdue & promise-to-pay premiums
  insert into follow_ups (customer_id, policy_id, premium_schedule_id, agent_id, follow_up_date, follow_up_type, notes, status)
  select ps.customer_id, ps.policy_id, ps.id, ps.agent_id,
         case when random() < 0.5 then current_date else current_date + ((floor(random()*5)+1) || ' days')::interval end,
         case when ps.status = 'promise_to_pay' then 'payment_promise'::followup_type else 'payment_followup'::followup_type end,
         case when ps.status = 'promise_to_pay' then 'Customer promised payment, confirm before due date' else 'Call to remind about overdue premium' end,
         'pending'
  from premium_schedules ps
  where ps.status in ('overdue', 'promise_to_pay') and ps.agent_id = any(v_agent_ids)
  limit 15;

end $$;

-- Quick sanity check counts
select 'customers' as table_name, count(*) from customers
union all select 'policies', count(*) from policies
union all select 'premium_schedules', count(*) from premium_schedules
union all select 'payments', count(*) from payments
union all select 'whatsapp_reminders', count(*) from whatsapp_reminders
union all select 'follow_ups', count(*) from follow_ups;
