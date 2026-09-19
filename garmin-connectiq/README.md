# Training Dashboard — Garmin Connect IQ companion

Sends today's planned ride straight to a Garmin Edge bike computer, launched
as a native structured workout — the same on-device experience (target power
arrows, auto-advancing steps, alerts) as a workout built in Garmin Connect
itself — without ever logging into a Garmin account from this app or the
server.

## Why this exists as a separate app, and why it's not the same as "Send to Garmin"

The dashboard already has a "Send to Garmin" button that pushes a workout
into your Garmin Connect account, so it syncs to your bike computer next
time it connects. That depends on scraping Garmin's account login (there's
no public API for it), which Garmin's own bot protection can rate-limit or
block — see the commit history on `garminAuth.ts`/`garminWorkoutPush.ts` for
that whole saga.

This app is the alternative that sidesteps that entirely: Connect IQ (the
SDK for building apps that run *on* a Garmin device) is free and self-serve
to register for — no partner approval needed, unlike Garmin's account-level
Training API. It can't construct or launch a structured workout on its own
(confirmed against a published reference — see below), but it *can* download
a `.fit` workout file from any URL and hand the parsed result straight to the
device's own native workout runner. So the architecture is: this app fetches
a `.fit` file from our own server (same JWT-authenticated API the web
dashboard and Apple Watch app use), and the device's system software does
the rest.

## The evidence behind this design

I don't have the Connect IQ SDK in this environment, so none of this Monkey C
has been compiled. But the *approach* — not just the general idea — is
verified against two things, not guesswork:

1. **The server-side `.fit` file it downloads is confirmed correct.** It's
   built with Garmin's own official FIT SDK (`@garmin/fitsdk`'s `Encoder`,
   already a dependency here for parsing library `.fit` files) and I
   round-tripped the output back through that same SDK's `Decoder` — durations,
   watts targets, and pace targets all come back exactly right. See
   `server/src/lib/garminFitWorkout.ts`.
2. **The download-and-launch flow on the device side is a proven pattern**,
   not an assumption: [TrainAsONE/trainasone-connectiq](https://github.com/TrainAsONE/trainasone-connectiq)
   is a real, published Connect IQ app that does exactly this — downloads a
   `.fit` workout from its own training-plan server via
   `Communications.makeWebRequest` with
   `responseType => Communications.HTTP_RESPONSE_CONTENT_TYPE_FIT`, then
   calls `.toIntent()` / `System.exitTo()` to hand it to the native workout
   runner. That's the exact mechanism `WorkoutDownloader.mc` here uses.
   Separately, [werkkrew/ciq-hiit-tracker](https://github.com/werkkrew/ciq-hiit-tracker)'s
   own notes confirm the *reason* this app can't just construct a workout
   object directly: "Connect IQ apps won't get access to things like
   structured workouts... via the sport settings."

**If the Connect IQ type checker or compiler flags something in
`WorkoutDownloader.mc` specifically**, that's the one file where an exact
method/property name could be slightly off from memory — paste the error
back and it's a quick fix. Everything else (the view, delegate, settings,
API client) is ordinary Monkey C and should build clean.

## Setup

1. Install the [Connect IQ SDK Manager](https://developer.garmin.com/connect-iq/sdk/)
   and the [Monkey C VS Code extension](https://marketplace.visualstudio.com/items?itemName=garmin.monkey-c),
   or use Eclipse if you already have that workflow. Register a (free)
   Connect IQ developer key through the SDK Manager — this is self-serve,
   no approval wait, unlike the account-level Training API.
2. In VS Code: **Monkey C: New Project**. Pick:
   - Project type: **Widget**
   - Device: your actual Edge model (e.g. Edge 840, 540, 1040)
3. The wizard creates `manifest.xml`, `source/`, `resources/` for you with a
   real application id. Copy this folder's contents into that project,
   **replacing** the wizard's placeholder `source/*.mc` and `resources/*`
   files but **keeping its generated `manifest.xml`** — then edit that
   generated manifest to add:
   ```xml
   <iq:permissions>
       <iq:uses-permission id="Communications"/>
       <iq:uses-permission id="PersistedContent"/>
   </iq:permissions>
   ```
   and set `entry="TrainingDashboardApp"` on the `<iq:application>` tag.
   (This repo's own `manifest.xml` is a template showing what the result
   should look like — see the comment at its top for why it isn't used
   directly.)
4. Open `source/ApiClient.mc` and replace the `TOKEN` constant with the
   token from the web dashboard's **Settings > API access** card. Change
   `BASE_URL` too if you're not using the default Render deployment.

   **Why this is hardcoded instead of a Garmin Connect Mobile setting**:
   Garmin Connect Mobile only shows a settings screen for apps published to
   the official Connect IQ Store — confirmed against multiple reports on
   Garmin's own developer forum that a sideloaded app's settings.xml are
   silently ignored no matter how correctly they're built. Since this app
   is never going through the Store, there's no phone-based settings screen
   to use — edit the source and rebuild instead, same as changing any other
   constant.
5. Build and run in the Connect IQ Simulator first to catch compile errors —
   but `PersistedContent`/`System.exitTo()` behavior is unreliable in the
   simulator, so final verification needs a real device.
6. Sideload to your Edge over USB (VS Code's "Monkey C: Run" with a device
   target, or manually copy the built `.prg` into `GARMIN/APPS/`).
7. On the Edge: open the widget, press **SELECT**. It fetches today's ride
   and launches it natively. Requires the Edge to have connectivity — either
   its own WiFi, or Bluetooth to a phone running Garmin Connect Mobile with
   internet (the same pairing your activity sync already depends on).
8. If you ever need to change the token (e.g. it's rotated), edit the
   constant and rebuild — there's no other way to update it on a sideloaded
   app.

## Scope

Bike-only, today's-workout-only, matching what this app is for (a bike
computer) and the original ask (send *cycling* workouts to the bike
computer — runs go to the Apple Watch companion instead). If you also want
to browse the run/bike library and pick something other than today's plan
here, the server already supports it —
`GET /api/workout-library?format=fit&path=<url-encoded path>` returns the
same kind of `.fit` bytes for any bike workout in the library — `ApiClient.mc`
would just need a second method calling that instead of `/training-plan/today`.

## Files

| File | What it does |
|---|---|
| `manifest.xml` | Template — see setup step 3 for why it isn't used as-is |
| `resources/strings/strings.xml` | App name |
| `source/TrainingDashboardApp.mc` | App entry point |
| `source/TrainingDashboardView.mc` | Status text view |
| `source/TrainingDashboardDelegate.mc` | Wires the SELECT button to the download flow |
| `source/ApiClient.mc` | The authenticated `makeWebRequest` call — edit its BASE_URL/TOKEN constants |
| `source/WorkoutDownloader.mc` | FIT response → `PersistedContent.Workout` → `System.exitTo()` |

## Keeping this in sync with the server

If `server/src/lib/garminFitWorkout.ts`'s output shape changes, nothing here
needs to change — this app just requests a `.fit` file and hands it to the
system, it never parses the bytes itself.
