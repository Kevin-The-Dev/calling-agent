import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function Field({ label, value }: { label: string; value: unknown }) {
  const display =
    value === null || value === undefined || value === '' ? '—' : String(value);
  return (
    <div className="border-b border-[var(--color-line)] py-2 last:border-0">
      <dt className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">{label}</dt>
      <dd className="mt-0.5 text-sm">{display}</dd>
    </div>
  );
}

/**
 * Customer profile: the full lead object, its calls, and the transcript.
 *
 * Under decision D8 the agent's audio cannot be recorded, so the transcript is
 * the complete record of what the agent said — it is the primary artifact here,
 * not a supplement to a recording.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) notFound();

  const [{ data: calls }, { data: appointments }] = await Promise.all([
    supabase
      .from('calls')
      .select('id, started_at, ended_at, duration_seconds, outcome, stage, summary, turn_count')
      .eq('lead_id', id)
      .order('started_at', { ascending: false }),
    supabase.from('appointments').select('*').eq('lead_id', id),
  ]);

  const latestCall = calls?.[0];
  const { data: turns } = latestCall
    ? await supabase
        .from('transcript_turns')
        .select('turn_index, speaker, content, stage, latency_ms')
        .eq('call_id', latestCall.id)
        .order('turn_index', { ascending: true })
    : { data: null };

  return (
    <div className="space-y-8">
      <div>
        <Link href="/dashboard" className="text-sm underline">
          ← All leads
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{lead.name ?? 'Unnamed lead'}</h1>
        <p className="text-sm text-[var(--color-ink-soft)]">
          Score {lead.qualification_score} · {lead.qualification_band} · {lead.status}
          {lead.do_not_contact && ' · DO NOT CONTACT'}
        </p>
      </div>

      {lead.summary && (
        <section className="rounded-xl border border-[var(--color-line)] p-4">
          <h2 className="mb-2 text-sm font-semibold">Summary</h2>
          <p className="text-sm leading-relaxed">{lead.summary}</p>
        </section>
      )}

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold">Contact</h2>
          <dl className="rounded-xl border border-[var(--color-line)] px-4">
            <Field label="Phone" value={lead.phone} />
            <Field label="Email" value={lead.email} />
            <Field label="Address" value={lead.address} />
            <Field label="Timezone" value={lead.timezone} />
          </dl>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold">Qualification</h2>
          <dl className="rounded-xl border border-[var(--color-line)] px-4">
            <Field label="Homeowner" value={lead.homeowner_confirmed} />
            <Field label="Home type" value={lead.home_type} />
            <Field label="Owns roof" value={lead.owns_roof} />
            <Field label="Monthly bill" value={lead.monthly_bill ? `$${lead.monthly_bill}` : null} />
            <Field label="Utility" value={lead.utility_provider} />
            <Field label="Credit band" value={lead.credit_score_band} />
            <Field label="Shading" value={lead.shading} />
            <Field label="Buying intent" value={lead.buying_intent} />
            <Field
              label="Decision makers"
              value={
                Array.isArray(lead.decision_makers) && lead.decision_makers.length > 0
                  ? (lead.decision_makers as { name?: string }[]).map((d) => d.name).join(', ')
                  : null
              }
            />
            <Field label="Disqualified" value={lead.disqualified_reason} />
          </dl>
        </section>
      </div>

      {appointments && appointments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Appointment</h2>
          {appointments.map((a) => (
            <dl key={a.id} className="rounded-xl border border-[var(--color-line)] px-4">
              <Field label="When" value={new Date(a.scheduled_at).toLocaleString()} />
              <Field label="Type" value={a.appointment_type} />
              <Field label="Consultant" value={a.consultant_name} />
              <Field label="Status" value={a.status} />
              <Field label="Decision makers present" value={a.decision_makers_present} />
            </dl>
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold">
          Calls {calls?.length ? `(${calls.length})` : ''}
        </h2>
        {!calls || calls.length === 0 ? (
          <p className="text-sm text-[var(--color-ink-soft)]">No calls recorded.</p>
        ) : (
          <ul className="space-y-2">
            {calls.map((c) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--color-line)] p-3 text-sm"
              >
                <span>{new Date(c.started_at).toLocaleString()}</span>
                <span className="text-[var(--color-ink-soft)]">
                  {c.duration_seconds ? `${c.duration_seconds}s` : 'in progress'}
                </span>
                <span className="text-[var(--color-ink-soft)]">{c.turn_count} turns</span>
                <span className="ml-auto font-medium">{c.outcome ?? c.stage}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {turns && turns.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">Transcript — most recent call</h2>
          <div className="space-y-3 rounded-xl border border-[var(--color-line)] p-4">
            {turns.map((t) => (
              <div key={t.turn_index}>
                <p className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                  {t.speaker === 'agent' ? 'Agent' : 'Prospect'} · {t.stage}
                  {t.latency_ms ? ` · ${t.latency_ms}ms` : ''}
                </p>
                <p className="text-sm leading-relaxed">{t.content}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
