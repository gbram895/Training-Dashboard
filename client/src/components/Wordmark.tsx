export default function Wordmark({ className }: { className?: string }) {
  return (
    <span className={`wordmark${className ? ` ${className}` : ''}`}>
      grad
      <span className="wordmark-i">
        {'ı' /* dotless i - the cadence line stands in for the dot */}
        <svg className="wordmark-i-icon" viewBox="0 0 24 12" aria-hidden="true">
          <polyline
            points="1,11 6,3 10,8 14,1 18,5 22,2"
            fill="none"
            stroke="url(#wordmarkGradient)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="1" cy="11" r="1.6" fill="#4fb6e8" />
          <circle cx="22" cy="2" r="1.6" fill="#4fd8a0" />
          <defs>
            <linearGradient id="wordmarkGradient" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#4fb6e8" />
              <stop offset="1" stopColor="#4fd8a0" />
            </linearGradient>
          </defs>
        </svg>
      </span>
      ent
    </span>
  );
}
