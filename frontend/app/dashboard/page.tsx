import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const BAND_COLOR: Record<string, string> = {
  hot: 'var(--color-bad)',
  warm: 'var(--color-warn)',
  cold: 'var(--color-ink-soft)',
  unqualified: 'var(--color-line)',
};

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-line)] p-4">
      <p className="text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

/**
 * Dashboard home: pipeline stats plus the lead list.
 *
 * Every query below runs as the signed-in admin, so RLS decides what comes
 * back — this page has no elevated access of its own.
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const [{ data: leads }, { count: totalCalls }, { count: bookedCount }, { data: objections }] =
    await Promise.all([
      supabase
        .from('leads')
        .select('id, name, phone, address, monthly_bill, utility_provider, status, qualification_score, qualification_band, created_at')
        .order('qualification_score', { ascending: false })
        .limit(50),
      supabase.from('calls').select('*', { count: 'exact', head: true }),
      supabase
        .from('calls')
        .select('*', { count: 'exact', head: true })
        .eq('outcome', 'booked'),
      supabase.from('v_top_objections').select('*').limit(5),
    ]);

  const rows = leads ?? [];
  const qualified = rows.filter((l) => (l.qualification_score ?? 0) >= 50).length;
  const bookingRate =
    totalCalls && totalCalls > 0 ? `${Math.round(((bookedCount ?? 0) / totalCalls) * 100)}%` : '—';

  return (
    <div className="space-y-8">
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Leads" value={rows.length} />
        <Stat label="Calls" value={totalCalls ?? 0} />
        <Stat label="Qualified" value={qualified} />
        <Stat label="Booking rate" value={bookingRate} />
      </section>

      {objections && objections.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold">Most common objections</h2>
          <ul className="flex flex-wrap gap-2">
            {objections.map((o) => (
              <li
                key={String(o.objection_id)}
                className="rounded-full border border-[var(--color-line)] px-3 py-1 text-xs"
              >
                {String(o.objection_id)} · {String(o.hits)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Leads</h2>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-[var(--color-line)] p-8 text-center text-sm text-[var(--color-ink-soft)]">
            No leads yet. They appear here as soon as the first call runs.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--color-line)]">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-[var(--color-line)] text-xs uppercase tracking-wide text-[var(--color-ink-soft)]">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Bill</th>
                  <th className="px-4 py-3 font-medium">Utility</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((lead) => (
                  <tr key={lead.id} className="border-b border-[var(--color-line)] last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/leads/${lead.id}`} className="underline">
                        {lead.name ?? 'Unnamed'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-[var(--color-ink-soft)]">
                      {lead.address ?? '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums">
                      {lead.monthly_bill ? `$${lead.monthly_bill}` : '—'}
                    </td>
                    <td className="px-4 py-3">{lead.utility_provider ?? '—'}</td>
                    <td className="px-4 py-3">{lead.status}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className="inline-flex items-center gap-2 tabular-nums"
                        title={lead.qualification_band ?? ''}
                      >
                        <span
                          aria-hidden="true"
                          className="inline-block h-2 w-2 rounded-full"
                          style={{
                            background:
                              BAND_COLOR[lead.qualification_band ?? 'unqualified'] ??
                              'var(--color-line)',
                          }}
                        />
                        {lead.qualification_score ?? 0}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
