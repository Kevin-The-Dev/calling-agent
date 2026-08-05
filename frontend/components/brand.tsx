import Link from 'next/link';

/**
 * Brand mark.
 *
 * A sun whose rays are unequal — the short/long rhythm of a voice waveform.
 * The two ideas the product joins are solar and speech, so the mark is both
 * rather than a panel with a phone stuck next to it.
 */
export function LogoMark({ className = 'size-7' }: { className?: string }) {
  // Ray lengths, clockwise from noon. Irregular on purpose: an even sunburst
  // reads as clip art, an uneven one reads as sound.
  const rays = [7, 4, 6, 3, 7, 4.5, 6.5, 3.5, 7, 4, 6, 3.5];

  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Home">
      <circle cx="20" cy="20" r="7.5" fill="var(--color-accent)" />
      <circle cx="20" cy="20" r="11.5" fill="none" stroke="var(--color-accent)" strokeWidth="1" opacity="0.35" />
      {rays.map((length, i) => {
        const angle = (360 / rays.length) * i;
        return (
          <rect
            key={i}
            x={19.15}
            y={20 - 14 - length}
            width={1.7}
            height={length}
            rx={0.85}
            fill="var(--color-ink)"
            transform={`rotate(${angle} 20 20)`}
          />
        );
      })}
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-tight">
        Solar<span className="text-accent">setter</span>
      </span>
    </span>
  );
}

/**
 * The wordmark as a link home.
 *
 * A logo that does nothing when clicked is the one navigation convention every
 * visitor already knows, so this is the default form — the bare `Wordmark` is
 * for the rare place that is already home.
 */
export function WordmarkLink({
  href = '/',
  className = '',
}: {
  href?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="Solarsetter, home"
      className={`inline-flex rounded-lg transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${className}`}
    >
      <Wordmark />
    </Link>
  );
}
