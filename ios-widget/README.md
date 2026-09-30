# Training Dashboard — iPhone Home Screen widget

A Home Screen tile shaped like the Dashboard's own hero card: the readiness
ring, today's suggested session (name, zone, duration), and the Sleep / HRV /
Fatigue row from underneath it — using
[Scriptable](https://apps.apple.com/app/scriptable/id1405459188) — a free,
well-established app that runs a JavaScript file as a widget. No native app,
Xcode, or Apple Developer account needed.

**Already have the widget installed from before?** The design changed —
open the script in Scriptable, select all, delete, and paste in the current
[`TrainingDashboardWidget.js`](./TrainingDashboardWidget.js) again. Your
saved token stays put; nothing else in setup needs repeating.

## What it shows

- A readiness ring (same 0-100 blend of HRV, sleep, and training load/TSB as
  the Dashboard's hero) with today's session name, discipline, duration, and
  zone next to it — or "Rest day" / "No plan yet" when there isn't one.
- Below that, the same three stats as the Dashboard's Sleep/HRV/Fatigue row,
  each with its own mini progress bar.
- **Medium** widget size gets the full layout above. **Small** drops the
  stats row and zone pill and just shows the ring + session name — there
  isn't room for both at that size.

## Why a third-party app instead of a "real" widget

iOS only lets a native Swift app register a Home Screen widget (WidgetKit) —
there's no API a website or PWA can use to add one directly, no matter how
the app is installed. Scriptable is the standard workaround: it's a real,
sandboxed iOS app that happens to let its widget's content come from a
script you write, so a personal project can get a widget without becoming
an Xcode project (compare `apple-watch-companion/`, which *did* need a real
native app because WorkoutKit has no such workaround).

## Setup

1. Install **Scriptable** from the App Store (free).
2. Open the Training Dashboard web app → **Settings → Widget** → tap
   **Generate widget token**. This copies a long-lived (1 year) token to
   your clipboard — you'll paste it in step 5. Treat it like a password:
   whoever has it can read and change your training data.
3. In Scriptable, tap **+** to create a new script. Name it whatever you
   like (e.g. "Training Dashboard").
4. Delete the placeholder code and paste in the contents of
   [`TrainingDashboardWidget.js`](./TrainingDashboardWidget.js) from this
   folder.
   - If your Render URL isn't `training-dashboard-peiv.onrender.com`, edit
     the `APP_URL` constant at the top of the script first.
5. Still inside Scriptable, tap the **Play (▶)** button to run the script
   once manually. It'll show an alert asking you to paste the widget
   token — paste the one from step 2 and tap **Save**. A preview of the
   widget appears once it fetches today's plan.
6. Go to your iPhone's Home Screen → touch and hold an empty area → **+**
   (top corner) → search for **Scriptable** → choose the **small** or
   **medium** widget size → add it.
7. Long-press the newly added widget → **Edit Widget** → under **Script**,
   pick the script you created in step 3 → set **When Interacting** to
   **Run Script**.

That's it — the widget refreshes roughly every 30 minutes (iOS decides the
exact timing; it doesn't guarantee widgets refresh on a strict schedule).
Tapping it opens the web app; tapping it while unconfigured or erroring
re-opens the setup prompt from step 5.

## A caveat worth knowing: overnight gaps

The server only stays awake 7am–11pm local time (see the "awake hours"
comment in `server/src/index.ts`) to save hosting/database costs — outside
that window Render is asleep and can take the better part of a minute to
wake back up, longer than a WidgetKit refresh will wait around for. The
script handles this by caching the last successful response and falling
back to it (labeled "Server is waking up…") instead of showing a bare
error, so the widget still shows *something* — just possibly a few hours
stale — if it happens to refresh overnight. It'll catch back up to live
data on the next refresh once the server's awake for the day.

## Rotating or revoking the token

The token from step 2 lasts a year. If it ever leaks, or you just want a
fresh one, generate a new one from **Settings → Widget** and re-run the
script manually (step 5) to overwrite the one saved in Scriptable's
Keychain — the old token keeps working until it expires (there's no
per-token revocation), so treat "leaked" as "rotate the server's
`JWT_SECRET`", which invalidates every token at once, widget included.
