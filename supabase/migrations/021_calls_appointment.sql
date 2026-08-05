-- 021 — The agreed slot, carried on the call
--
-- The appointment the prospect agrees to was previously held nowhere. The model
-- proposed a time, the prospect accepted, and by the closing recap there was
-- nothing to read it back from — so it invented a second, different time. A
-- call that agreed "Thursday the 6th at 2pm" recapped "Thursday the 5th between
-- 9 and 12", which is a no-show waiting to happen.
--
-- It lives on `calls` rather than only in `appointments` because it has to
-- survive a cache miss mid-call, several turns before the appointment row is
-- written at the end of the call.

alter table calls add column if not exists appointment_at       timestamptz;
alter table calls add column if not exists appointment_timezone text;

comment on column calls.appointment_at is
  'The slot the prospect agreed to, as understood during the call. The authoritative record is the appointments row written at close.';

create index if not exists calls_appointment_idx on calls(appointment_at)
  where appointment_at is not null;
