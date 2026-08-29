const BLUE = '#4fb6e8';
const GREEN = '#4fd8a0';

function Dot({ cx, cy, color }: { cx: number; cy: number; color: string }) {
  return <circle cx={cx} cy={cy} r={1.8} fill={color} />;
}

export function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 19 L9 11 L13 15 L21 5"
        stroke={BLUE}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Dot cx={3} cy={19} color={GREEN} />
      <Dot cx={21} cy={5} color={BLUE} />
    </svg>
  );
}

export function PlanIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x={4} y={6} width={16} height={14} rx={3} stroke={BLUE} strokeWidth="2" />
      <path d="M9 2 L9 6 M15 2 L15 6" stroke={BLUE} strokeWidth="2" strokeLinecap="round" />
      <Dot cx={9} cy={14} color={BLUE} />
      <Dot cx={13} cy={17} color={BLUE} />
      <Dot cx={16} cy={13} color={GREEN} />
    </svg>
  );
}

export function WorkoutsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 19 C 6 19, 8 12, 11 12 L14 17 L16 10 L20 6"
        stroke={BLUE}
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Dot cx={3} cy={19} color={GREEN} />
      <Dot cx={20} cy={6} color={BLUE} />
    </svg>
  );
}

export function GoalsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx={11} cy={13} r={7} stroke={BLUE} strokeWidth="1.8" />
      <circle cx={11} cy={13} r={4} stroke={BLUE} strokeWidth="1.8" />
      <circle cx={11} cy={13} r={1.4} fill={BLUE} />
      <path d="M15 9 L19.5 4.5 M16 4 L19.5 4.5 L19.5 8" stroke={GREEN} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx={12} cy={12} r={4.2} stroke={BLUE} strokeWidth="2" />
      <path
        d="M7 7 L9 9 M17 7 L15 9 M7 17 L9 15 M17 17 L15 15"
        stroke={BLUE}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
