# Training Dashboard — iPhone Lock Screen widget

Today's planned session and its **workout profile**, on the Lock Screen —
using [Scriptable](https://scriptable.app), the same free app the Home
Screen widget uses. Companion to
[`TrainingDashboardWidget.js`](./TrainingDashboardWidget.js); neither
replaces the other, and both can be installed at once.

## What it shows

Three Lock Screen widget families, each built from the same fetch:

- **Rectangular** (the wide slot under the clock) — session name, then
  duration and zone, then the workout profile chart: one bar per segment,
  width by duration, height by intensity.
- **Circular** — discipline symbol, total duration, and a 7pt profile strip
  underneath. Enough to tell a flat endurance ride from a spiky interval
  session without unlocking.
- **Inline** (the line above the clock) — `🚴 4x8 Threshold · 1h 12m ·
  Threshold`.

Rest days show "Rest day" and the reason; days with no plan yet say so.

### Why the chart is greyscale

iOS renders Lock Screen accessory widgets monochrome — it desaturates
whatever you draw and applies its own vibrancy. The app's zone colours
(`--chart-z1..z5`) would all collapse to roughly the same grey, so intensity
is carried by **brightness** instead: a VO2max block is opaque white, a
recovery block a faint wash. Bar widths use the same `duration^0.75` scaling
as `WorkoutProfileChart.tsx`, so the shape matches the chart in the app.

## Setup

1. **If the Home Screen widget is already set up, there is no token to
   paste.** Both scripts read the same Keychain entry
   (`training-dashboard-widget-token`), and Scriptable shares the Keychain
   across scripts. Skip to step 3.
2. Otherwise: open the web app → **Settings → Widget** → **Generate widget
   token**, then run this script once (step 4) and paste it when asked.
   Treat it like a password.
3. In Scriptable, tap **+**, name the script (e.g. "Training Lock Screen"),
   delete the placeholder, and paste in
   [`TrainingDashboardLockScreen.js`](./TrainingDashboardLockScreen.js).
   - If your Render URL isn't `training-dashboard-peiv.onrender.com`, edit
     `APP_URL` at the top first.
4. Tap **Play (▶)** once to check it runs — it shows a rectangular preview.
5. Lock the phone, long-press the Lock Screen → **Customise** → tap the
   widget area under the clock (or the line above it for inline) → pick
   **Scriptable** → choose the size you want.
6. Tap the placed widget → under **Script**, select the script from step 3 →
   **When Interacting: Open URL** (tapping opens the web app).

## Data source

`GET /api/training-plan/today`, not `/api/widget/today` — the widget
endpoint is deliberately segment-free because a Home Screen tile has no room
for a profile. The widget token authenticates the same on both;
`requireAuth` doesn't distinguish it from a session token.

## Overnight gaps

Same caveat as the Home Screen widget: the server sleeps outside 7am–11pm
(see `server/src/index.ts`), and a cold start outlasts a WidgetKit refresh.
The script caches the last successful response and falls back to it, with
the timeout dropped to 15s since Lock Screen refreshes are on a tighter
leash. A cached response from a previous day swaps the discipline icon for a
clock glyph so you can tell it's stale; one from today is shown as-is.
