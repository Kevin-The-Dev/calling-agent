import Link from 'next/link';
import {
  PhoneCallIcon,
  WaveformIcon,
} from '@phosphor-icons/react/dist/ssr';
import { createClient } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  EmptyState,
  OUTCOME_TONE,
  ScoreBar,
  formatDateTime,
  formatDuration,
  humanize,
} from '@/components/dashboard/primitives';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Calls' };

/**
 * The call log.
 *
 * Rows link to the *lead*, not to the call: a call on its own is a transcript
 * with no context, and every question someone has after reading one ("what did
 * we already know about them?") is answered on the lead page.
 */
export default async function CallsPage() {
  const supabase = await createClient();

  const { data: calls } = await supabase
    .from('calls')
    .select(
      'id, lead_id, started_at, ended_at, duration_seconds, outcome, stage, status, turn_count, qualification_score, summary, leads(name, address), recordings(id, duration_seconds)',
    )
    .order('started_at', { ascending: false })
    .limit(100);

  const rows = calls ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-ink">Calls</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">
          Every conversation, newest first. Open a lead to hear the recording and read the
          transcript.
        </p>
      </header>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<PhoneCallIcon className="size-6" />}
            title="No calls yet"
            copy="Start one from the call console and it appears here immediately."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((call) => {
              const leadEmbed = call.leads as unknown;
              const lead = (Array.isArray(leadEmbed) ? leadEmbed[0] : leadEmbed) as {
                name?: string | null;
                address?: string | null;
              } | null;

              const recordingEmbed = call.recordings as unknown;
              const recordings = (
                Array.isArray(recordingEmbed) ? recordingEmbed : recordingEmbed ? [recordingEmbed] : []
              ) as { id: string }[];

              const outcome = (call.outcome as string | null) ?? null;

              return (
                <li key={call.id as string}>
                  <Link
                    href={`/dashboard/leads/${call.lead_id as string}`}
                    className="block px-5 py-4 transition-colors hover:bg-sunk/70"
                  >
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 truncate text-[13.5px] font-medium text-ink">
                          {lead?.name ?? 'Unnamed lead'}
                          {recordings.length > 0 && (
                            <span
                              className="inline-flex items-center gap-1 text-[11.5px] font-normal text-accent-deep"
                              title="Recording available"
                            >
                              <WaveformIcon className="size-3.5" />
                              Recorded
                            </span>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] text-ink-3">
                          {formatDateTime(call.started_at as string)} ·{' '}
                          <span className="tnum">
                            {formatDuration(call.duration_seconds as number | null)}
                          </span>{' '}
                          · <span className="tnum">{call.turn_count as number}</span> turns
                          {lead?.address ? ` · ${lead.address}` : ''}
                        </p>
                      </div>

                      <ScoreBar score={(call.qualification_score as number) ?? 0} />

                      {call.status === 'active' ? (
                        <Badge tone="live">Live</Badge>
                      ) : (
                        <Badge tone={OUTCOME_TONE[outcome ?? ''] ?? 'neutral'}>
                          {humanize(outcome ?? (call.stage as string))}
                        </Badge>
                      )}
                    </div>

                    {call.summary && (
                      <p className="mt-2 line-clamp-2 max-w-3xl text-[12.5px] leading-relaxed text-ink-2">
                        {call.summary as string}
                      </p>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
