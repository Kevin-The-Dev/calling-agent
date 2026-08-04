-- 018 — Analytics views
-- security_invoker = on so the views inherit the caller's RLS rather than the
-- view owner's. Without it a view is a hole straight through the policies.

create or replace view v_call_funnel with (security_invoker = on) as
select
  date_trunc('day', started_at)                       as day,
  count(*)                                            as calls,
  count(*) filter (where outcome = 'booked')          as booked,
  count(*) filter (where outcome = 'disqualified')    as disqualified,
  count(*) filter (where outcome = 'not_interested')  as not_interested,
  round(avg(duration_seconds))                        as avg_duration_s,
  round(avg(qualification_score))                     as avg_score
from calls
where status = 'completed'
group by 1
order by 1 desc;

create or replace view v_stage_dropoff with (security_invoker = on) as
select stage, count(*) as reached
from calls
group by stage;

create or replace view v_top_objections with (security_invoker = on) as
select
  objection_id,
  objection_class,
  count(*)                          as hits,
  count(*) filter (where resolved)  as resolved
from objection_events
group by 1, 2
order by hits desc;
