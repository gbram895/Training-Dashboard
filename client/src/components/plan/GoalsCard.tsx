import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api/client';
import type { GoalKind, TargetPriority, TrainingTarget, TrainingTargets } from '../../api/types';

/**
 * What each tier actually does to the calendar, in the athlete's terms rather
 * than the coaching vocabulary. This is the whole answer to "what happens when
 * two goals want the same fortnight", so it's spelled out in the picker itself
 * rather than hidden behind a help link.
 */
const PRIORITY_INFO: Record<TargetPriority, { label: string; blurb: string }> = {
  A: { label: 'Peak for it', blurb: 'The year builds toward it, with a full taper and a week easy afterwards.' },
  B: { label: 'Want to go well', blurb: 'A few easy days before, a couple after. The build carries on around it.' },
  C: { label: 'Train through it', blurb: "It's on the calendar, but the week around it doesn't change." },
};

const PRIORITY_ORDER: TargetPriority[] = ['A', 'B', 'C'];

/**
 * What kind of event it is, which is a different question from how much it
 * matters. Priority decides how much of the calendar moves for a goal; this
 * decides what the sessions in the run-up actually are. Grouped by discipline
 * and labelled with real events rather than coaching vocabulary, because "what
 * are you doing" is easier to answer than "what energy system does it tax".
 */
const BIKE_KINDS: { value: GoalKind; label: string }[] = [
  { value: 'LONG_RIDE', label: 'Long ride — gran fondo, century, a big day out' },
  { value: 'HILLY_RIDE', label: 'Hilly ride — a long day with serious climbing' },
  { value: 'RACE_RIDE', label: 'Bunch race or criterium' },
  { value: 'TIME_TRIAL', label: 'Time trial' },
  { value: 'GRAVEL_MTB', label: 'Gravel or mountain bike race' },
];

const RUN_KINDS: { value: GoalKind; label: string }[] = [
  { value: 'RUN_SHORT', label: '5k or 10k' },
  { value: 'RUN_LONG', label: 'Half or full marathon' },
  { value: 'TRAIL_ULTRA', label: 'Ultra or trail race' },
];

const KIND_GROUPS: { sport: string; kinds: { value: GoalKind; label: string }[] }[] = [
  { sport: 'Bike', kinds: BIKE_KINDS },
  { sport: 'Run', kinds: RUN_KINDS },
  { sport: 'Both', kinds: [{ value: 'MULTISPORT', label: 'Triathlon or duathlon' }] },
];

/**
 * What a multisport goal is assumed to be until its legs are set — roughly a
 * middle-distance triathlon, matching the server's own fallback.
 */
const DEFAULT_BIKE_LEG: GoalKind = 'LONG_RIDE';
const DEFAULT_RUN_LEG: GoalKind = 'RUN_LONG';

const KIND_LABEL: Record<GoalKind, string> = {
  GENERAL: 'No particular event',
  LONG_RIDE: 'Long ride',
  HILLY_RIDE: 'Hilly ride',
  RACE_RIDE: 'Bunch race',
  TIME_TRIAL: 'Time trial',
  GRAVEL_MTB: 'Gravel / MTB',
  RUN_SHORT: '5k / 10k',
  RUN_LONG: 'Half / marathon',
  TRAIL_ULTRA: 'Ultra / trail',
  MULTISPORT: 'Triathlon',
};

/** What picking each kind changes about the plan, said before they pick it. */
const KIND_EFFECT: Record<GoalKind, string> = {
  GENERAL: 'Sessions are picked on your fitness and recovery alone, with no event to train for.',
  LONG_RIDE: 'Long steady rides, with your biggest day of the week kept for going long.',
  HILLY_RIDE: 'Sustained climbing efforts on top of a long endurance base.',
  RACE_RIDE: 'Short, sharp intervals well above threshold — the surges a bunch race is won on.',
  TIME_TRIAL: 'Threshold work above everything else: holding one hard effort for a long time.',
  GRAVEL_MTB: 'Long days broken up by hard efforts, the way an off-road race actually goes.',
  RUN_SHORT: 'Fast intervals and threshold running, with the volume kept modest.',
  RUN_LONG: 'Long runs and sustained tempo, building toward holding one pace a long way.',
  TRAIL_ULTRA: 'Time on your feet above everything else, with intensity kept low.',
  MULTISPORT: 'Say what each leg is below, and each one is trained on its own terms, taking turns through the week.',
};

/** A multisport goal reads as its two legs, since that is what it trains as. */
function describeKind(target: TrainingTarget): string {
  if (target.kind !== 'MULTISPORT') return KIND_LABEL[target.kind];
  const bike = KIND_LABEL[target.bikeKind ?? DEFAULT_BIKE_LEG];
  const run = KIND_LABEL[target.runKind ?? DEFAULT_RUN_LEG];
  return `${KIND_LABEL.MULTISPORT} (${bike} + ${run})`;
}

function daysUntil(iso: string): number {
  const target = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getTime();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today.getTime()) / 86_400_000);
}

function formatDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function countdown(days: number): string {
  if (days === 0) return 'today';
  if (days < 0) return 'done';
  if (days < 21) return `${days} day${days === 1 ? '' : 's'} to go`;
  return `${Math.round(days / 7)} weeks`;
}

interface Draft {
  id: string | null;
  name: string;
  date: string;
  priority: TargetPriority;
  kind: GoalKind;
  bikeKind: GoalKind;
  runKind: GoalKind;
  rampPerWeek: string;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  date: '',
  priority: 'A',
  kind: 'GENERAL',
  bikeKind: DEFAULT_BIKE_LEG,
  runKind: DEFAULT_RUN_LEG,
  rampPerWeek: '4',
};

/**
 * Every event the athlete is building toward, over however long they want to
 * plan for.
 *
 * With none, the plan only ever reacts — it holds you at the fitness you
 * already have and makes days easier when you're tired. With several, the plan
 * periodises them together: it builds toward the one marked "peak for it" while
 * still tapering into, and recovering from, everything else on the list.
 */
export default function GoalsCard({ onChanged }: { onChanged: () => void }) {
  const [data, setData] = useState<TrainingTargets | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);

  function load() {
    apiFetch<TrainingTargets>('/training-plan/targets')
      .then((d) => {
        setData(d);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }

  useEffect(load, []);

  function startAdd() {
    setError(null);
    setDraft({ ...EMPTY_DRAFT, priority: data?.targets.length ? 'B' : 'A' });
  }

  function startEdit(target: TrainingTarget) {
    setError(null);
    setDraft({
      id: target.id,
      name: target.name,
      date: target.date.slice(0, 10),
      priority: target.priority,
      kind: target.kind ?? 'GENERAL',
      bikeKind: target.bikeKind ?? DEFAULT_BIKE_LEG,
      runKind: target.runKind ?? DEFAULT_RUN_LEG,
      rampPerWeek: String(target.rampPerWeek),
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    const body = JSON.stringify({
      name: draft.name,
      date: draft.date,
      priority: draft.priority,
      kind: draft.kind,
      // Only meaningful on a multisport goal; the API clears them otherwise.
      bikeKind: draft.kind === 'MULTISPORT' ? draft.bikeKind : null,
      runKind: draft.kind === 'MULTISPORT' ? draft.runKind : null,
      rampPerWeek: Number(draft.rampPerWeek),
    });
    try {
      await apiFetch(draft.id ? `/training-plan/targets/${draft.id}` : '/training-plan/targets', {
        method: draft.id ? 'PUT' : 'POST',
        body,
      });
      setDraft(null);
      load();
      onChanged();
    } catch {
      setError('Could not save that. Check the date is in the future.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(target: TrainingTarget) {
    if (!confirm(`Remove ${target.name}? The rest of your plan rebuilds around what's left.`)) return;
    await apiFetch(`/training-plan/targets/${target.id}`, { method: 'DELETE' });
    setDraft(null);
    load();
    onChanged();
  }

  if (!loaded) return null;

  const targets = data?.targets ?? [];
  const upcoming = targets.filter((t) => daysUntil(t.date) >= 0);
  const past = targets.filter((t) => daysUntil(t.date) < 0);

  if (draft) {
    return (
      <div className="gd-target-card">
        <form onSubmit={save}>
          <div className="gd-sec-title">
            <span className="gd-flag" />
            <h4>{draft.id ? 'Edit goal' : 'Add a goal'}</h4>
          </div>
          <label className="gd-target-field">
            <span>What is it?</span>
            <input
              className="gd-set-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Gravel race, 100k, first half marathon…"
              maxLength={80}
              required
            />
          </label>
          <label className="gd-target-field">
            <span>When?</span>
            <input
              className="gd-set-input"
              type="date"
              value={draft.date}
              onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              required
            />
          </label>
          <label className="gd-target-field">
            <span>What kind of event?</span>
            <select
              className="gd-set-input"
              value={draft.kind}
              onChange={(e) => setDraft({ ...draft, kind: e.target.value as GoalKind })}
            >
              <option value="GENERAL">No particular event — just keep me fit</option>
              {KIND_GROUPS.map((group) => (
                <optgroup key={group.sport} label={group.sport}>
                  {group.kinds.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="gd-set-note">{KIND_EFFECT[draft.kind]}</span>
          </label>
          {/* A sprint duathlon and a long-course triathlon are both
              "multisport" and share almost no training, so each leg says what
              it actually is and trains to its own demands. */}
          {draft.kind === 'MULTISPORT' && (
            <>
              <label className="gd-target-field">
                <span>The bike leg</span>
                <select
                  className="gd-set-input"
                  value={draft.bikeKind}
                  onChange={(e) => setDraft({ ...draft, bikeKind: e.target.value as GoalKind })}
                >
                  {BIKE_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gd-target-field">
                <span>The run leg</span>
                <select
                  className="gd-set-input"
                  value={draft.runKind}
                  onChange={(e) => setDraft({ ...draft, runKind: e.target.value as GoalKind })}
                >
                  {RUN_KINDS.map((k) => (
                    <option key={k.value} value={k.value}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <span className="gd-set-note">
                  Each leg is trained on its own terms: {KIND_LABEL[draft.bikeKind].toLowerCase()} sessions on the bike,{' '}
                  {KIND_LABEL[draft.runKind].toLowerCase()} sessions running, taking turns through the week.
                </span>
              </label>
            </>
          )}
          <div className="gd-target-field">
            <span>How much does it matter?</span>
            <div className="gd-priority-picker">
              {PRIORITY_ORDER.map((p) => (
                <button
                  type="button"
                  key={p}
                  className={`gd-priority-opt${draft.priority === p ? ' gd-selected' : ''}`}
                  onClick={() => setDraft({ ...draft, priority: p })}
                >
                  <span className={`gd-priority-tag gd-priority-${p.toLowerCase()}`}>{p}</span>
                  <span className="gd-priority-label">{PRIORITY_INFO[p].label}</span>
                  <span className="gd-priority-blurb">{PRIORITY_INFO[p].blurb}</span>
                </button>
              ))}
            </div>
          </div>
          {draft.priority === 'A' && (
            <label className="gd-target-field">
              <span>How hard to build</span>
              <select
                className="gd-set-input"
                value={draft.rampPerWeek}
                onChange={(e) => setDraft({ ...draft, rampPerWeek: e.target.value })}
              >
                <option value="2">Gently</option>
                <option value="4">Steady</option>
                <option value="6">Aggressively</option>
              </select>
            </label>
          )}
          {error && <p className="gd-cal-error">{error}</p>}
          <div className="form-actions">
            <button type="submit" className="gd-set-save" disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save' : 'Add goal'}
            </button>
            <button type="button" className="gd-why-btn" onClick={() => setDraft(null)}>
              Cancel
            </button>
            {draft.id && (
              <button
                type="button"
                className="gd-why-btn gd-set-danger"
                onClick={() => {
                  const t = targets.find((x) => x.id === draft.id);
                  if (t) remove(t);
                }}
              >
                Remove
              </button>
            )}
          </div>
        </form>
      </div>
    );
  }

  if (upcoming.length === 0) {
    return (
      <div className="gd-target-card">
        <div className="gd-sec-title">
          <span className="gd-flag" />
          <h4>Train toward something</h4>
        </div>
        <p className="gd-set-note">
          Add everything you're aiming at this year — a big one, the club races along the way, all of it. The plan
          builds toward the one you care most about while still tapering into and recovering from the rest. Without
          any, it just keeps you where you are.
        </p>
        <div className="form-actions">
          <button type="button" className="gd-set-save" onClick={startAdd}>
            Add a goal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="gd-target-card">
      <div className="gd-sec-title">
        <span className="gd-flag" />
        <h4>Your goals</h4>
      </div>

      <ul className="gd-goal-list">
        {upcoming.map((t) => {
          const days = daysUntil(t.date);
          return (
            <li key={t.id}>
              <button type="button" className="gd-goal-row" onClick={() => startEdit(t)}>
                <span className={`gd-priority-tag gd-priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                <span className="gd-goal-main">
                  <span className="gd-goal-name">{t.name}</span>
                  <span className="gd-goal-when">
                    {formatDate(t.date)} · {countdown(days)}
                    {t.kind && t.kind !== 'GENERAL' ? ` · ${describeKind(t)}` : ''}
                  </span>
                </span>
                {data?.anchorId === t.id && <span className="gd-goal-anchor">main goal</span>}
              </button>
            </li>
          );
        })}
      </ul>

      {data?.conflicts.map((warning) => (
        <p key={warning} className="gd-goal-conflict">
          {warning}
        </p>
      ))}

      {past.length > 0 && (
        <div className="gd-goal-past">
          <button type="button" className="gd-why-btn" onClick={() => setShowPast((v) => !v)}>
            {showPast ? 'Hide' : 'Show'} {past.length} goal{past.length === 1 ? '' : 's'} already behind you
          </button>
          {/* Past goals no longer shape the plan, but they shouldn't pile up
              with no way to clear them either. Removable, not editable — the
              API won't take a date that has already passed. */}
          {showPast && (
            <ul className="gd-goal-list">
              {past.map((t) => (
                <li key={t.id}>
                  <div className="gd-goal-row gd-goal-row-static">
                    <span className={`gd-priority-tag gd-priority-${t.priority.toLowerCase()}`}>{t.priority}</span>
                    <span className="gd-goal-main">
                      <span className="gd-goal-name">{t.name}</span>
                      <span className="gd-goal-when">{formatDate(t.date)}</span>
                    </span>
                    <button
                      type="button"
                      className="gd-goal-remove"
                      onClick={() => remove(t)}
                      aria-label={`Remove ${t.name}`}
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="gd-target-actions">
        <button type="button" className="gd-why-btn" onClick={startAdd}>
          Add a goal
        </button>
      </div>
    </div>
  );
}
