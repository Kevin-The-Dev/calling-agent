import Link from 'next/link';
import {
  ArrowRight,
  CalendarCheck,
  MessageSquareWarning,
  PhoneCall,
  Radio,
  TrendingUp,
  Users,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  OUTCOME_TONE,
  ScoreBar,
  StatTile,
  formatDateTime,
  formatDuration,
  humanize,
} from '@/components/dashboard/primitives';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Overview' };

/** Stages in the order the state machine walks them, for the drop-off chart. */
const STAGE_ORDER = [
  'opening',
  'rapport',
  'qualification',
  'need_discovery',
  'value_pitch',
  'objection_handling',
  'appointment',
  'confirmation',
  'closing',
  'ended',
  'disqualified',
];

/**
 * Dashboard overview.
 *
 * Answers the three questions someone opens this page with: is anything
 * happening right now, is the pipeline converting, and where are calls dying.
 *
 * Every query runs as the signed-in admin, so RLS decides what comes back —
 * this page has no elevated access of its own.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { count: totalCalls },
    { count: bookedCount },
    { count: totalLeads },
    { count: liveCalls },
    { data: recentCalls },
    { data: objections },
    { data: stages },
    { data: hotLeads },
  ] = await Promise.all([
    supabase.from('calls').select('*', { count: 'exact', head: true }),
    supabase.from('calls').select('*', { count: 'exact', head: true }).eq('outcome', 'booked'),
    supabase.from('leads').select('*', { count: 'exact', head: true }),
    supabase.from('calls').select('*', { count: 'exact', head: true }).eq('status', 'active'),
    supabase
      .from('calls')
      .select('id, lead_id, started_at, duration_seconds, outcome, stage, status, turn_count, qualification_score, leads(name)')
      .order('started_at', { ascending: false })
      .limit(8),
    supabase.from('v_top_objections').select('*').limit(6),
    supabase.from('v_stage_dropoff').select('*'),
    supabase
      .from('leads')
      .select('id, name, address, monthly_bill, utility_provider, qualification_score, qualification_band')
      .gte('qualification_score', 50)
      .order('qualification_score', { ascending: false })
      .limit(6),
  ]);

  const calls = totalCalls ?? 0;
  const booked = bookedCount ?? 0;
  const bookingRate = calls > 0 ? `${Math.round((booked / calls) * 100)}%` : '—';

  // Ordered by the state machine, not by count — the shape of where calls die
  // is the whole point, and sorting by size destroys it.
  const stageRows = STAGE_ORDER.map((stage) => ({
    stage,
    reached: Number((stages ?? []).find((s) => String(s.stage) === stage)?.reached ?? 0),
  })).filter((row) => row.reached > 0);
  const stageMax = Math.max(1, ...stageRows.map((r) => r.reached));

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-ink">
            Overview
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-3">
            Every call the assistant has run, and what came of it.
          </p>
        </div>

        {(liveCalls ?? 0) > 0 && (
          <Badge tone="live">
            <span className="relative grid size-1.5 place-items-center">
              <span className="absolute size-1.5 rounded-full bg-live" />
              <span className="absolute size-1.5 rounded-full bg-live animate-halo" />
            </span>
            {liveCalls} live now
          </Badge>
        )}
      </header>

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Calls"
          value={calls}
          hint={`${liveCalls ?? 0} active right now`}
          icon={<PhoneCall className="size-4" />}
        />
        <StatTile
          label="Leads"
          value={totalLeads ?? 0}
          hint="One per conversation started"
          icon={<Users className="size-4" />}
        />
        <StatTile
          label="Booked"
          value={booked}
          hint={`${bookingRate} of all calls`}
          icon={<CalendarCheck className="size-4" />}
          tone="pine"
        />
        <StatTile
          label="Booking rate"
          value={bookingRate}
          hint={calls > 0 ? `${booked} of ${calls} calls` : 'No calls yet'}
          icon={<TrendingUp className="size-4" />}
          tone="solar"
        />
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
        {/* ── Recent calls ───────────────────────────────────────────────── */}
        <Card>
          <CardHead
            title="Recent calls"
            icon={<Radio className="size-4 text-ink-3" />}
            action={
              <Link
                href="/dashboard/calls"
                className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-solar-deep"
              >
                All calls
                <ArrowRight className="size-3.5" />
              </Link>
            }
          />

          {!recentCalls || recentCalls.length === 0 ? (
            <EmptyState
              icon={<PhoneCall className="size-6" />}
              title="No calls yet"
              copy="Open the call console and start a conversation — it appears here the moment it begins."
            />
          ) : (
            <ul className="divide-y divide-line">
              {recentCalls.map((call) => {
                const embedded = call.leads as unknown;
                const lead = (Array.isArray(embedded) ? embedded[0] : embedded) as {
                  name?: string | null;
                } | null;
                const outcome = (call.outcome as string | null) ?? null;

                return (
                  <li key={call.id as string}>
                    <Link
                      href={`/dashboard/leads/${call.lead_id as string}`}
                      className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-sunk/70"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13.5px] font-medium text-ink">
                          {lead?.name ?? 'Unnamed lead'}
                        </p>
                        <p className="mt-0.5 text-[12px] text-ink-3">
                          {formatDateTime(call.started_at as string)} ·{' '}
                          <span className="tnum">{call.turn_count as number}</span> turns ·{' '}
                          <span className="tnum">
                            {formatDuration(call.duration_seconds as number | null)}
                          </span>
                        </p>
                      </div>

                      <div className="hidden sm:block">
                        <ScoreBar score={(call.qualification_score as number) ?? 0} />
                      </div>

                      {call.status === 'active' ? (
                        <Badge tone="live">Live</Badge>
                      ) : (
                        <Badge tone={OUTCOME_TONE[outcome ?? ''] ?? 'neutral'}>
                          {humanize(outcome ?? (call.stage as string))}
                        </Badge>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="space-y-6">
          {/* ── Stage drop-off ───────────────────────────────────────────── */}
          <Card>
            <CardHead title="Where calls end" icon={<TrendingUp className="size-4 text-ink-3" />} />

            {stageRows.length === 0 ? (
              <EmptyState
                title="Nothing to plot yet"
                copy="Once calls have run, this shows the stage each one reached."
              />
            ) : (
              <ul className="space-y-2.5 px-5 py-4">
                {stageRows.map(({ stage, reached }) => (
                  <li key={stage} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 truncate text-[12.5px] text-ink-2">
                      {humanize(stage)}
                    </span>
                    <span className="relative h-5 flex-1 overflow-hidden rounded-md bg-sunk">
                      <span
                        className="absolute inset-y-0 left-0 rounded-md bg-solar/70"
                        style={{ width: `${(reached / stageMax) * 100}%` }}
                      />
                    </span>
                    <span className="tnum w-8 shrink-0 text-right text-[12.5px] font-medium text-ink">
                      {reached}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Objections ───────────────────────────────────────────────── */}
          <Card>
            <CardHead
              title="Most common objections"
              icon={<MessageSquareWarning className="size-4 text-ink-3" />}
            />

            {!objections || objections.length === 0 ? (
              <EmptyState
                title="No objections logged"
                copy="Each time a prospect pushes back, the matched objection is recorded here."
              />
            ) : (
              <ul className="divide-y divide-line">
                {objections.map((o) => (
                  <li
                    key={String(o.objection_id)}
                    className="flex items-center justify-between gap-3 px-5 py-2.5"
                  >
                    <span className="truncate text-[13px] text-ink-2">
                      {humanize(String(o.objection_id).split('.').slice(1).join(' '))}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={String(o.objection_class) === 'early' ? 'neutral' : 'think'}>
                        {humanize(String(o.objection_class))}
                      </Badge>
                      <span className="tnum w-6 text-right text-[13px] font-medium">
                        {String(o.hits)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {/* ── Qualified leads ──────────────────────────────────────────────── */}
      <Card>
        <CardHead
          title="Qualified leads"
          icon={<Users className="size-4 text-ink-3" />}
          action={
            <Link
              href="/dashboard/leads"
              className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink-3 transition-colors hover:text-solar-deep"
            >
              All leads
              <ArrowRight className="size-3.5" />
            </Link>
          }
        />

        {!hotLeads || hotLeads.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6" />}
            title="Nothing qualified yet"
            copy="Leads scoring 50 or above appear here, highest first."
          />
        ) : (
          <ul className="divide-y divide-line">
            {hotLeads.map((lead) => (
              <li key={lead.id as string}>
                <Link
                  href={`/dashboard/leads/${lead.id as string}`}
                  className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-sunk/70"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">
                      {lead.name ?? 'Unnamed lead'}
                    </p>
                    <p className="mt-0.5 truncate text-[12px] text-ink-3">
                      {lead.address ?? 'No address'}
                      {lead.monthly_bill ? ` · $${lead.monthly_bill}/mo` : ''}
                      {lead.utility_provider ? ` · ${lead.utility_provider}` : ''}
                    </p>
                  </div>
                  <ScoreBar
                    score={lead.qualification_score ?? 0}
                    band={lead.qualification_band}
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
