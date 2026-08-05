import Link from 'next/link';
import {
  MagnifyingGlassIcon,
  UsersIcon,
} from '@phosphor-icons/react/dist/ssr';
import { createClient } from '@/lib/supabase/server';
import {
  Badge,
  Card,
  EmptyState,
  STATUS_TONE,
  ScoreBar,
  formatDateTime,
  humanize,
} from '@/components/dashboard/primitives';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Leads' };

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'qualified', label: 'Qualified' },
  { id: 'booked', label: 'Booked' },
  { id: 'qualifying', label: 'In progress' },
  { id: 'disqualified', label: 'Disqualified' },
] as const;

/**
 * The lead list.
 *
 * Search and filter run as URL parameters rather than client state, so a
 * filtered view is a link someone can send to a colleague — and the query stays
 * in Postgres instead of shipping every lead to the browser to filter there.
 */
export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  const { q = '', filter = 'all' } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('leads')
    .select(
      'id, name, phone, email, address, monthly_bill, utility_provider, status, qualification_score, qualification_band, do_not_contact, created_at',
    );

  if (filter === 'qualified') query = query.gte('qualification_score', 50);
  else if (filter !== 'all') query = query.eq('status', filter);

  if (q.trim()) {
    // Escape the PostgREST `or` delimiters — an unescaped comma or parenthesis
    // in a search box would otherwise be parsed as more filter syntax.
    const term = q.trim().replace(/[,()]/g, ' ');
    query = query.or(
      `name.ilike.%${term}%,address.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,utility_provider.ilike.%${term}%`,
    );
  }

  const { data: leads } = await query
    .order('qualification_score', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100);

  const rows = leads ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-ink">Leads</h1>
        <p className="mt-1 text-[13.5px] text-ink-3">
          {rows.length === 100 ? 'Showing the first 100' : `${rows.length} lead${rows.length === 1 ? '' : 's'}`}
          , highest scoring first.
        </p>
      </header>

      {/* Plain GET form: no JavaScript needed, and the result is a shareable URL. */}
      <form className="flex flex-wrap items-center gap-3" action="/dashboard/leads">
        <div className="relative min-w-56 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Search name, address, phone, utility…"
            className="w-full rounded-full border border-line bg-surface py-2.5 pl-9 pr-4 text-[13.5px] shadow-sm transition-colors placeholder:text-ink-4 focus:border-accent focus:outline-none"
          />
        </div>
        <input type="hidden" name="filter" value={filter} />
        <button
          type="submit"
          className="rounded-full bg-ink px-5 py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-accent-deep"
        >
          Search
        </button>
      </form>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const params = new URLSearchParams();
          if (q) params.set('q', q);
          if (f.id !== 'all') params.set('filter', f.id);
          const href = `/dashboard/leads${params.toString() ? `?${params}` : ''}`;

          return (
            <Link
              key={f.id}
              href={href}
              className={`rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                active
                  ? 'border-accent-line bg-accent-wash text-accent-deep'
                  : 'border-line bg-surface text-ink-2 hover:border-line-strong'
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="size-6" />}
            title={q ? 'No leads match that search' : 'No leads yet'}
            copy={
              q
                ? 'Try a shorter term, or clear the filter above.'
                : 'A lead is created the moment a call starts. Run one from the call console.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left">
              <thead>
                <tr className="border-b border-line text-[11px] uppercase tracking-[0.09em] text-ink-3">
                  <th scope="col" className="px-5 py-3 font-medium">Lead</th>
                  <th scope="col" className="px-5 py-3 font-medium">Bill</th>
                  <th scope="col" className="px-5 py-3 font-medium">Utility</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                  <th scope="col" className="px-5 py-3 font-medium">Started</th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((lead) => (
                  <tr key={lead.id as string} className="group transition-colors hover:bg-sunk/70">
                    <td className="px-5 py-3">
                      <Link href={`/dashboard/leads/${lead.id as string}`} className="block">
                        <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink group-hover:text-accent-deep">
                          {lead.name ?? 'Unnamed lead'}
                          {lead.do_not_contact && <Badge tone="alert">DNC</Badge>}
                        </span>
                        <span className="mt-0.5 block truncate text-[12px] text-ink-3">
                          {lead.address ?? lead.phone ?? lead.email ?? 'No contact details yet'}
                        </span>
                      </Link>
                    </td>
                    <td className="tnum px-5 py-3 text-[13px]">
                      {lead.monthly_bill ? `$${lead.monthly_bill}` : '-'}
                    </td>
                    <td className="px-5 py-3 text-[13px] text-ink-2">
                      {lead.utility_provider ?? '-'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={STATUS_TONE[lead.status as string] ?? 'neutral'}>
                        {humanize(lead.status as string)}
                      </Badge>
                    </td>
                    <td className="px-5 py-3 text-[12.5px] text-ink-3">
                      {formatDateTime(lead.created_at as string)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <ScoreBar
                        score={(lead.qualification_score as number) ?? 0}
                        band={lead.qualification_band as string | null}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
