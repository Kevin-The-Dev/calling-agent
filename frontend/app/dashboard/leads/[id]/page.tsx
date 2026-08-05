import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeftIcon,
  CalendarCheckIcon,
  CurrencyCircleDollarIcon,
  FileTextIcon,
  HouseIcon,
  PhoneCallIcon,
  ProhibitIcon,
  QuotesIcon,
  UserIcon,
  WaveformIcon,
} from '@phosphor-icons/react/dist/ssr';
import { createClient } from '@/lib/supabase/server';
import { RecordingPlayer } from '@/components/dashboard/recording-player';
import { PlaybackProvider } from '@/components/dashboard/playback-context';
import {
  CallTranscript,
  type TranscriptTurn,
} from '@/components/dashboard/call-transcript';
import {
  Badge,
  Card,
  CardHead,
  EmptyState,
  OUTCOME_TONE,
  STATUS_TONE,
  ScoreBar,
  formatDateTime,
  formatDuration,
  humanize,
} from '@/components/dashboard/primitives';

export const dynamic = 'force-dynamic';

/**
 * How long a playback link stays valid.
 *
 * Long enough to read the transcript and listen twice, short enough that a URL
 * copied out of devtools stops working the same afternoon. These are recordings
 * of people saying their address, so this is a bearer token, not a file path.
 */
const PLAYBACK_URL_TTL_SECONDS = 3600;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from('leads').select('name').eq('id', id).maybeSingle();
  return { title: (data?.name as string | null) ?? 'Lead' };
}

/**
 * Customer profile: the full lead object, its calls, the recording, and the
 * transcript.
 *
 * The agent's audio cannot be recorded under decision D8 — browser speech
 * synthesis is not capturable — so the transcript is the only complete record
 * of what the agent said. It is the primary artifact on this page, and the
 * recording sits beside it rather than above it.
 */
export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).maybeSingle();
  if (!lead) notFound();

  const [{ data: calls }, { data: appointments }] = await Promise.all([
    supabase
      .from('calls')
      .select('id, started_at, ended_at, duration_seconds, outcome, stage, status, summary, turn_count, qualification_score')
      .eq('lead_id', id)
      .order('started_at', { ascending: false }),
    supabase.from('appointments').select('*').eq('lead_id', id).order('scheduled_at'),
  ]);

  const latestCall = calls?.[0];

  const [{ data: turns }, { data: recordings }, { data: objectionEvents }] = latestCall
    ? await Promise.all([
        supabase
          .from('transcript_turns')
          .select('turn_index, speaker, content, stage, latency_ms, audio_start_ms, audio_end_ms')
          .eq('call_id', latestCall.id as string)
          .order('turn_index', { ascending: true }),
        supabase
          .from('recordings')
          .select('id, storage_path, mime_type, duration_seconds, size_bytes, channels, upload_status')
          .eq('call_id', latestCall.id as string)
          .eq('upload_status', 'complete'),
        supabase
          .from('objection_events')
          .select('objection_id, objection_class, quote, stage_at, resolved')
          .eq('call_id', latestCall.id as string),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  // Signed server-side so the private bucket is never exposed to the browser.
  const recording = recordings?.[0];
  const playbackUrl = recording
    ? (
        await supabase.storage
          .from('call-recordings')
          .createSignedUrl(recording.storage_path as string, PLAYBACK_URL_TTL_SECONDS)
      ).data?.signedUrl
    : null;

  const score = (lead.qualification_score as number) ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div>
        <Link
          href="/dashboard/leads"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink-3 transition-colors hover:text-accent-deep"
        >
          <ArrowLeftIcon className="size-3.5" />
          All leads
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3">
          <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-ink">
            {(lead.name as string | null) ?? 'Unnamed lead'}
          </h1>

          <Badge tone={STATUS_TONE[lead.status as string] ?? 'neutral'}>
            {humanize(lead.status as string)}
          </Badge>

          {lead.do_not_contact && (
            <Badge tone="alert">
              <ProhibitIcon className="size-3" />
              Do not contact
            </Badge>
          )}

          <span className="ml-auto">
            <ScoreBar score={score} band={lead.qualification_band as string | null} />
          </span>
        </div>
      </div>

      {lead.summary && (
        <Card className="border-accent-line bg-accent-wash/40">
          <div className="flex gap-3 p-5">
            <FileTextIcon className="mt-0.5 size-4 shrink-0 text-accent-deep" />
            <div>
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-accent-deep">
                Call summary
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-ink">{lead.summary as string}</p>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_1.15fr]">
        {/* ── Left: the record ───────────────────────────────────────────── */}
        <div className="space-y-6">
          <Card>
            <CardHead title="Contact" icon={<UserIcon className="size-4 text-ink-3" />} />
            <dl className="px-5 py-1">
              <Field label="Phone" value={lead.phone} />
              <Field label="Email" value={lead.email} />
              <Field label="Address" value={lead.address} />
              <Field label="Timezone" value={lead.timezone} />
            </dl>
          </Card>

          <Card>
            <CardHead title="The home" icon={<HouseIcon className="size-4 text-ink-3" />} />
            <dl className="px-5 py-1">
              <Field label="Homeowner" value={boolLabel(lead.homeowner_confirmed)} />
              <Field label="Home type" value={humanizeOrNull(lead.home_type)} />
              <Field label="Owns roof" value={boolLabel(lead.owns_roof)} />
              <Field label="Roof type" value={lead.roof_type} />
              <Field label="Shading" value={humanizeOrNull(lead.shading)} />
              <Field label="Already has solar" value={boolLabel(lead.already_has_solar)} />
            </dl>
          </Card>

          <Card>
            <CardHead title="Bill & qualification" icon={<CurrencyCircleDollarIcon className="size-4 text-ink-3" />} />
            <dl className="px-5 py-1">
              <Field
                label="Monthly bill"
                value={lead.monthly_bill ? `$${lead.monthly_bill}` : null}
                emphasis
              />
              <Field label="Utility provider" value={lead.utility_provider} />
              <Field label="Credit band" value={humanizeOrNull(lead.credit_score_band)} />
              <Field label="Buying intent" value={humanizeOrNull(lead.buying_intent)} />
              <Field
                label="Decision makers"
                value={
                  Array.isArray(lead.decision_makers) && lead.decision_makers.length > 0
                    ? (lead.decision_makers as { name?: string }[]).map((d) => d.name).join(', ')
                    : null
                }
              />
              <Field
                label="Pain points"
                value={
                  Array.isArray(lead.pain_points) && lead.pain_points.length > 0
                    ? (lead.pain_points as string[]).join('; ')
                    : null
                }
              />
              <Field label="Disqualified because" value={humanizeOrNull(lead.disqualified_reason)} />
            </dl>
          </Card>

          {appointments && appointments.length > 0 && (
            <Card className="border-booked/20">
              <CardHead title="Appointment" icon={<CalendarCheckIcon className="size-4 text-booked" />} />
              {appointments.map((a) => (
                <dl key={a.id as string} className="px-5 py-1">
                  <Field
                    label="When"
                    value={new Date(a.scheduled_at as string).toLocaleString()}
                    emphasis
                  />
                  <Field label="Type" value={humanizeOrNull(a.appointment_type)} />
                  <Field label="Address" value={a.address} />
                  <Field label="Consultant" value={a.consultant_name} />
                  <Field label="Status" value={humanizeOrNull(a.status)} />
                  <Field
                    label="Decision makers present"
                    value={boolLabel(a.decision_makers_present)}
                  />
                  <Field label="Confirmation number" value={a.confirmation_phone} />
                </dl>
              ))}
            </Card>
          )}
        </div>

        {/* ── Right: what happened ─────────────────────────────────────────
            The player and the transcript share a playback position: the audio
            carries only the prospect, so the transcript is where the agent's
            half of the call lives and the two are read together. */}
        <PlaybackProvider>
        <div className="space-y-6">
          <Card>
            <CardHead title="Recording" icon={<WaveformIcon className="size-4 text-ink-3" />} />
            <div className="p-5">
              {playbackUrl && recording ? (
                <RecordingPlayer
                  src={playbackUrl}
                  durationSeconds={recording.duration_seconds as number | null}
                  sizeBytes={recording.size_bytes as number | null}
                  channels={recording.channels as string}
                  downloadName={`call-${String(latestCall?.id ?? id).slice(0, 8)}.webm`}
                />
              ) : (
                <EmptyState
                  icon={<WaveformIcon className="size-6" />}
                  title="No recording for this call"
                  copy="Audio is uploaded when the call ends. A call abandoned by closing the tab may not have one."
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHead
              title={`Calls (${calls?.length ?? 0})`}
              icon={<PhoneCallIcon className="size-4 text-ink-3" />}
            />
            {!calls || calls.length === 0 ? (
              <EmptyState title="No calls" copy="This lead has no conversation history." />
            ) : (
              <ul className="divide-y divide-line">
                {calls.map((c) => (
                  <li
                    key={c.id as string}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3"
                  >
                    <span className="text-[13px] text-ink">
                      {formatDateTime(c.started_at as string)}
                    </span>
                    <span className="tnum text-[12.5px] text-ink-3">
                      {formatDuration(c.duration_seconds as number | null)}
                    </span>
                    <span className="tnum text-[12.5px] text-ink-3">
                      {c.turn_count as number} turns
                    </span>
                    <span className="ml-auto">
                      {c.status === 'active' ? (
                        <Badge tone="live">Live</Badge>
                      ) : (
                        <Badge tone={OUTCOME_TONE[(c.outcome as string) ?? ''] ?? 'neutral'}>
                          {humanize((c.outcome as string) ?? (c.stage as string))}
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {objectionEvents && objectionEvents.length > 0 && (
            <Card>
              <CardHead
                title="Objections raised"
                icon={<QuotesIcon className="size-4 text-ink-3" />}
              />
              <ul className="divide-y divide-line">
                {objectionEvents.map((o, i) => (
                  <li key={i} className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Badge tone={o.objection_class === 'early' ? 'neutral' : 'think'}>
                        {humanize(o.objection_class as string)}
                      </Badge>
                      <span className="text-[12.5px] text-ink-3">
                        at {humanize(o.stage_at as string)}
                      </span>
                    </div>
                    <p className="mt-2 border-l-2 border-line pl-3 text-[13px] italic leading-relaxed text-ink-2">
                      “{o.quote as string}”
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* ── Transcript ───────────────────────────────────────────────── */}
          <Card>
            <CardHead
              title="Transcript, most recent call"
              icon={<FileTextIcon className="size-4 text-ink-3" />}
              action={
                latestCall ? (
                  <span className="text-[12px] text-ink-3">
                    {formatDateTime(latestCall.started_at as string)}
                  </span>
                ) : undefined
              }
            />

            {!turns || turns.length === 0 ? (
              <EmptyState
                icon={<FileTextIcon className="size-6" />}
                title="No transcript"
                copy="Turns are written as the conversation happens. A call that never got a reply has none."
              />
            ) : (
              <CallTranscript turns={turns as unknown as TranscriptTurn[]} />
            )}
          </Card>
        </div>
        </PlaybackProvider>
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function Field({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: unknown;
  emphasis?: boolean;
}) {
  const empty = value === null || value === undefined || value === '';

  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-0">
      <dt className="shrink-0 text-[12.5px] text-ink-3">{label}</dt>
      <dd
        className={`text-right text-[13.5px] ${
          empty ? 'text-ink-4' : emphasis ? 'font-semibold text-ink' : 'text-ink'
        }`}
      >
        {empty ? '-' : String(value)}
      </dd>
    </div>
  );
}

/** `true` renders as "Yes", not as "true". */
function boolLabel(value: unknown): string | null {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return null;
}

/** Treats the schema's "unknown" enum member as genuinely unknown. */
function humanizeOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '' || value === 'unknown') return null;
  return humanize(String(value));
}
