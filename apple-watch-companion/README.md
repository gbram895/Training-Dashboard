# Training Dashboard — Apple Watch companion

Sends a run workout from the Training Dashboard to your Apple Watch as a
structured workout, using Apple's WorkoutKit — the same framework
third-party training apps (Nike Run Club, etc.) use to push workouts onto
the stock Watch Workout app. No watch app of your own is needed; a
plain iOS app is enough, WorkoutKit schedules directly onto the paired Watch.

## Why this exists as a separate app

There's no public API that lets a website push a workout onto an Apple
Watch — that only works from an app installed on the phone, using
WorkoutKit. That's the whole reason this is a native app instead of a
button on the web dashboard (compare: the dashboard's "Send to Garmin"
button works from the browser, because Garmin Connect has an account-level
API; Apple doesn't expose an equivalent).

## Important: this was written without a Mac/Xcode to compile it against

I don't have a macOS/Xcode toolchain in this sandbox, so none of this Swift
has been compiled. The architecture and control flow are solid — API calls,
auth, SwiftUI navigation are all ordinary Swift/Foundation and should just
work. The one file that's genuinely uncertain is `WorkoutKitBridge.swift`:
it's written from memory of WorkoutKit's WWDC23 announcement and docs, and
Apple's exact case/initializer names (e.g. whether it's
`WorkoutGoal.time(_:_:)` taking a unit case, or something slightly
different) could be off in small ways.

**If Xcode shows errors in `WorkoutKitBridge.swift`, that's expected on the
first build** — paste me the exact error text and I'll fix the signature.
Everything else should build clean.

## Setup

1. Open Xcode → File → New → Project → iOS → App.
   - Interface: SwiftUI. Language: Swift.
   - Product name: `TrainingDashboardWatch` (or whatever you like).
   - **Minimum deployment target: iOS 17.0** (WorkoutKit requires it).
2. Delete the template's default `ContentView.swift` and `*App.swift`,
   then drag every file from `Sources/TrainingDashboardWatch/` in this
   folder into the Xcode project (check "Copy items if needed").
3. **Add capabilities** — select the project → target → Signing & Capabilities → `+ Capability`:
   - **HealthKit** (WorkoutKit is layered on HealthKit's authorization and
     needs this enabled even though the app never reads health data directly).
4. **Add Info.plist entries** (target → Info tab → `+`):
   - `Privacy - Health Share Usage Description` → e.g. "Used to schedule your planned workouts on your Apple Watch."
   - `Privacy - Health Update Usage Description` → same idea.
5. Set your Apple ID / team under Signing & Capabilities so it can install
   to your own iPhone (a free personal-team signing certificate is enough
   for a device you own — no paid Apple Developer account required, though
   you'll need to re-install every 7 days on a free account, or pay for the
   $99/yr program for a year-long signature).
6. Build and run on your iPhone (not the Simulator — Watch pairing and
   WorkoutKit scheduling need a real device paired to a real Watch).
7. On first launch, sign in with your Training Dashboard account (same
   email/password as the web app) and the server URL — defaults to your
   Render deployment, editable in Settings if you ever point it at a local
   dev server instead.
8. Grant the Health/Workout authorization prompt when it appears (this is
   what `WorkoutKitBridge.requestAuthorizationIfNeeded()` triggers on first send).

## What it does

- **Today tab** — fetches `GET /api/training-plan/today`. If today's a
  run, shows a "Send to Apple Watch" button; if it's a bike day, points you
  back to the dashboard's Garmin button instead; if it's a rest day, says so.
- **Library tab** — fetches `GET /api/workout-library`, filtered to run
  workouts, each with its own "Send to Apple Watch" button — for sending
  something other than today's plan.
- **Send to Apple Watch** — converts the workout's segments into a
  WorkoutKit `CustomWorkout` (one `IntervalBlock` per segment, a `.time`
  goal per segment, and a pace-range alert computed from your threshold
  pace — same fraction-of-threshold math the web dashboard already uses for
  Garmin), then schedules it for right now via `WorkoutScheduler`. It shows
  up in the Watch's own Workout app, ready to start.

## Files

| File | What it does |
|---|---|
| `TrainingDashboardWatchApp.swift` | App entry point |
| `AppState.swift` | Holds login state, server URL, hands out an `APIClient` |
| `KeychainStore.swift` | Stores the JWT in the Keychain (not UserDefaults) |
| `APIClient.swift` | Talks to the same Express API the web dashboard uses |
| `Models.swift` | Codable DTOs mirroring `client/src/api/types.ts` |
| `WorkoutKitBridge.swift` | Segments → `CustomWorkout` → scheduled on Watch (see caveat above) |
| `LoginView.swift` | Email/password + server URL sign-in |
| `TodayView.swift` | Today's planned workout |
| `RunLibraryView.swift` | Full run library |
| `SendToWatchButton.swift` | Shared send button + status used by both |
| `ContentView.swift` | Tab container + Settings/sign-out |

## Keeping this in sync with the server

If a server DTO shape changes (e.g. a new field on `PlannedDay`), update
`Models.swift` to match — it's a plain mirror of
`client/src/api/types.ts`, not generated, so the two can drift if one
changes without the other.
