import { useNavigate } from 'react-router-dom';

const VIEWS = [
  { key: 'week', label: 'Week', to: '/plan' },
  { key: 'month', label: 'Month', to: '/plan/calendar?view=month' },
  { key: 'year', label: 'Year', to: '/plan/calendar?view=year' },
] as const;

export type PlanView = (typeof VIEWS)[number]['key'];

/**
 * Week / Month / Year, on both the Plan tab and the calendar, so the calendar
 * is somewhere you switch to rather than somewhere you have to go and find.
 */
export default function PlanViewSwitch({ active }: { active: PlanView }) {
  const navigate = useNavigate();

  return (
    <div className="gd-view-switch" role="tablist" aria-label="Plan view">
      {VIEWS.map((view) => (
        <button
          key={view.key}
          type="button"
          role="tab"
          aria-selected={view.key === active}
          className={`gd-view-tab${view.key === active ? ' gd-on' : ''}`}
          onClick={() => navigate(view.to)}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
