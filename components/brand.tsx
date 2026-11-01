// The Nearer mark and wordmark. Static SVGs in /public/brand (no JS cost); the wordmark is a CSS mask so it
// takes the text colour. Used outside the app and at thresholds only: never inside the window or the rooms.

const WORDMARK_RATIO = 2323 / 420;

/** The five-petal mark. Decorative: the name is next to it or on the page. */
export function Mark({ size = 28, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mark.svg" alt="" width={size} height={size} className={className} style={{ width: size, height: size }} />;
}

/** The word "Nearer", drawn; width in px. Colour follows the text colour. */
export function Wordmark({ width = 84, className = "" }: { width?: number; className?: string }) {
  const m = "url(/brand/wordmark.svg) center / contain no-repeat";
  return (
    <span
      role="img"
      aria-label="Nearer"
      className={`inline-block bg-current ${className}`}
      style={{ width, height: Math.round(width / WORDMARK_RATIO), WebkitMask: m, mask: m }}
    />
  );
}

/** Mark beside the wordmark, one line. */
export function Lockup({ mark = 28, word = 84, className = "" }: { mark?: number; word?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Mark size={mark} />
      <Wordmark width={word} />
    </span>
  );
}
