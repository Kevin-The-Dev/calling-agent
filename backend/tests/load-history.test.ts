/**
 * A long call must keep its ending. The transcript read used to keep the first
 * forty rows, so a booked call lost its closing recap and was recorded as
 * "held", and an instance resuming the call mid-way saw only its opening.
 */
import { describe, expect, it, vi } from 'vitest';

/** Forty-six rows, as a 23-exchange call writes them. */
const ROWS = Array.from({ length: 46 }, (_, i) => ({
  turn_index: i,
  speaker: i % 2 === 0 ? 'prospect' : 'agent',
  content: i === 41 ? 'So just to recap — nothing out of pocket.' : `turn ${i}`,
  stage: i >= 39 ? 'closing' : 'qualification',
}));

/** Just enough of the Supabase query builder to honour order + limit. */
vi.mock('../src/services/supabase.js', () => ({
  getServiceClient: () => {
    let ascending = true;
    let limit = Infinity;
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: (_: string, opts: { ascending: boolean }) => {
        ascending = opts.ascending;
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      then: (resolve: (v: { data: typeof ROWS }) => void) => {
        const sorted = [...ROWS].sort((a, b) =>
          ascending ? a.turn_index - b.turn_index : b.turn_index - a.turn_index,
        );
        resolve({ data: sorted.slice(0, limit) });
      },
    };
    return { from: () => builder };
  },
}));

const { loadHistory, recapFlagsFrom } = await import('../src/services/calls.js');

describe('loadHistory', () => {
  const env = {} as Parameters<typeof loadHistory>[0];

  it('returns the whole call, oldest first, ending at the latest turn', async () => {
    const history = await loadHistory(env, 'call-1');
    expect(history).toHaveLength(46);
    expect(history[0]?.content).toBe('turn 0');
    expect(history.at(-1)?.content).toBe('turn 45');
  });

  it('keeps the most recent turns, not the first ones, when capped', async () => {
    const history = await loadHistory(env, 'call-1', 10);
    expect(history.map((t) => t.content)).toEqual(
      ROWS.slice(-10).map((r) => r.content),
    );
  });

  it('lets the booking check see a recap that comes after turn forty', async () => {
    const flags = recapFlagsFrom(await loadHistory(env, 'call-1'));
    expect(flags.recap_details_given).toBe(true);
    expect(flags.reminded_no_cost).toBe(true);
  });
});

describe('recapFlagsFrom', () => {
  const closing = (content: string) => [{ speaker: 'agent' as const, content, stage: 'closing' as const }];

  it.each([
    'Make sure you and Priya are both there.',
    'Have you and Priya both there so you can decide together.',
    'Just make sure all the decision makers are present.',
    'Make sure everyone who decides is home.',
  ])('hears the decision-maker reminder in "%s"', (line) => {
    expect(recapFlagsFrom(closing(line)).reminded_decision_makers).toBe(true);
  });

  it('does not invent the reminder from an unrelated line', () => {
    expect(recapFlagsFrom(closing('Michael will call before heading over.')).reminded_decision_makers).toBe(false);
  });
});

describe('recapFlagsFrom — recap details', () => {
  const closing = (content: string) => [{ speaker: 'agent' as const, content, stage: 'closing' as const }];

  it('counts a close that restates the address, however it is introduced', () => {
    const line = "So just to make sure we're all set — Michael will be at 123 Maple Street on Tuesday at 2 PM.";
    expect(recapFlagsFrom(closing(line), '123 Maple Street, San Jose').recap_details_given).toBe(true);
  });

  it('does not count a goodbye that restates nothing', () => {
    expect(recapFlagsFrom(closing('Thanks Kevin, take care.'), '123 Maple Street').recap_details_given).toBe(false);
  });
});

describe('recapFlagsFrom — a short call', () => {
  it('counts the recap stored under "ended", where a short call keeps it', () => {
    const history = [
      {
        speaker: 'agent' as const,
        stage: 'ended' as const,
        content:
          "Michael will be at 123 Maple Street on Tuesday at 2. He'll call before heading over. Have your latest PG&E bill handy, and if there's anyone else who helps make decisions, have them there too. Nothing out of pocket.",
      },
    ];
    expect(Object.values(recapFlagsFrom(history, '123 Maple Street')).every(Boolean)).toBe(true);
  });
});
