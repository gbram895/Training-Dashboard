/**
 * The app's line icons, drawn on one 24px grid with one stroke weight so they
 * sit together the way a system symbol set does. They replace the emoji that
 * used to stand in for icons, which rendered in a different style (and a
 * different size) on every platform. Sized in em, so an icon takes the font
 * size of the text it sits beside, and coloured with currentColor.
 */

const PATHS = {
  ride: (
    <>
      <circle cx="5.5" cy="16.5" r="3.5" />
      <circle cx="18.5" cy="16.5" r="3.5" />
      <path d="M5.5 16.5 9 9.5h6l3.5 7M9 9.5l3.5 7h-7M15 9.5 14 6.5h2.5M7.5 6.5h3" />
    </>
  ),
  run: (
    <>
      <circle cx="14" cy="4.5" r="2" />
      <path d="M12.5 8.5 11 14M12.5 9 9 11M12.5 9l3 2.5 2.5-1M11 14l3 3-.5 4M11 14l-2 3.5-3 .5" />
    </>
  ),
  walk: (
    <>
      <circle cx="12" cy="4.5" r="2" />
      <path d="M12 8v6M12 9l-2.5 3M12 9l2.5 3M12 14l-2 6.5M12 14l2.5 6.5" />
    </>
  ),
  swim: (
    <>
      <circle cx="16.5" cy="7" r="2" />
      <path d="M4 12l4-3 4 2.5 2.5-1.5" />
      <path d="M3 16c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1M3 20c1.5 0 1.5 1 3 1s1.5-1 3-1 1.5 1 3 1 1.5-1 3-1 1.5 1 3 1 1.5-1 3-1" />
    </>
  ),
  strength: <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  badminton: (
    <>
      <circle cx="7" cy="17" r="3" />
      <path d="M9.2 14.8 15 4l5 5-10.8 5.8M12 9.5l2.5 2.5M14 6l3 3" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5" />
      <path d="M9 10.5 6.5 3h3.5l2 4.5 2-4.5h3.5L15 10.5" />
    </>
  ),
  rest: <path d="M19.5 14.5A8 8 0 1 1 9.5 4.5a6.5 6.5 0 0 0 10 10z" />,
  pin: <path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6zM12 14v7" />,
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  wind: <path d="M3 8h10.5A2.5 2.5 0 1 0 11 5.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h7.5a2 2 0 1 1-2 2" />,
  gauge: <path d="M4 17a8 8 0 1 1 16 0M12 17l3.5-4.5" />,
  flame: (
    <path d="M12 3c.8 3.4 5 5.4 5 10a5 5 0 0 1-10 0c0-2.4 1.3-4 2.4-5 .3 1.5 1 2.4 2 3 .1-3 .6-5.5.6-8z" />
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  clipboard: (
    <>
      <rect x="5" y="4.5" width="14" height="16.5" rx="2" />
      <path d="M9 4.5V3h6v1.5M9 10h6M9 14h6M9 18h3" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export default function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`gd-icon${className ? ` ${className}` : ''}`}
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
