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

## Status: reviewed against Apple's docs, still not compiled

The first draft of `WorkoutKitBridge.swift` was written from memory of the
WWDC23 announcement, and several calls in it were wrong. Every WorkoutKit
symbol has since been checked against Apple's published declarations for
iOS 17, and the file corrected:

| Was | Is | Why |
|---|---|---|
| `SpeedRangeAlert(range:metric:)` | `SpeedRangeAlert(target:metric:)` | the parameter is `target:` |
| `PowerRangeAlert(range:metric:)` | `PowerRangeAlert(target:metric:)` | same |
| `try await …schedule(plan, at: Date())` | `await …schedule(plan, at: DateComponents)` | `schedule(_:at:)` takes `DateComponents` and doesn't throw |
| one `IntervalBlock` per segment | warm-up and cool-down in `CustomWorkout`'s own slots, the rest one block | matches how the Watch shows a workout, and how "Send to Garmin" already tags those segments |
| range built straight from low/high | bounds sorted first | a reversed `ClosedRange` traps at runtime |
| no support checks | `WorkoutScheduler.isSupported`, `CustomWorkout.supportsActivity`, `supportsAlert` | a device with no paired Watch, or an alert the activity won't take, now fails with a readable message instead of silently |

`WorkoutStep(goal:alert:)`, `IntervalBlock(steps:iterations:)`,
`IntervalStep(_:step:)`, `WorkoutGoal.time(_:_:)`, `WorkoutPlan(.custom(_:))`
and `CustomWorkout(activity:location:displayName:warmup:blocks:cooldown:)`
were checked too and were already right.

**None of this has been through a Swift compiler.** There's no macOS
toolchain in the environment this was written in — the sources pass a
balanced-delimiter check and the API signatures match Apple's docs, and
that's as far as verification goes. Expect to fix something on the first
build; paste the exact error text back and it's a quick fix.

## Setup — the parts that need your Mac

Everything below needs macOS with Xcode 16 or newer, an iPhone, and a Watch
paired to it. None of it can be done from a browser.

1. **Open the project.** `apple-watch-companion/TrainingDashboardWatch.xcodeproj`
   — double-click it. The target is already configured: iOS 17 deployment
   target, SwiftUI app, sources picked up from `Sources/TrainingDashboardWatch/`
   via an Xcode 16 synchronized folder, so there's no file-by-file setup.

   The `.xcodeproj` was hand-written without a Mac to test it on. If Xcode
   refuses to open it, delete it and regenerate:
   `brew install xcodegen && cd apple-watch-companion && xcodegen generate`
   — `project.yml` in this folder describes the same target.

2. **Set your signing team.** Select the project → the
   `TrainingDashboardWatch` target → Signing & Capabilities → Team. A free
   personal Apple ID is enough for a device you own; you'll just have to
   reinstall every 7 days. Change `PRODUCT_BUNDLE_IDENTIFIER`
   (currently `com.trainingdashboard.companion`) if Xcode says the id is
   already taken.

3. **Build and run on your iPhone, not the Simulator.** Watch pairing and
   WorkoutKit scheduling need real hardware.

4. **Sign in** with your Training Dashboard email and password — the same
   ones as the web app. The server URL defaults to the Render deployment and
   is editable on the sign-in screen and in Settings.

5. **Allow the scheduling prompt** the first time you tap "Send to Apple
   Watch". That's `WorkoutKitBridge.requestAuthorizationIfNeeded()` asking.

   WorkoutKit's own authorization is what that prompt is; Apple's docs don't
   list a HealthKit entitlement as a requirement, so the target ships without
   the HealthKit capability to keep free-team signing simple. If the prompt
   never appears or authorization comes back denied, add it: target →
   Signing & Capabilities → `+ Capability` → HealthKit. The two Health usage
   descriptions are already set as build settings, so nothing else is needed.

## What it does

- **Today tab** — fetches `GET /api/training-plan/today`. If today's a
  run, shows a "Send to Apple Watch" button; if it's a bike day, points you
  back to the dashboard's Garmin button instead; if it's a rest day, says so.
- **Library tab** — fetches `GET /api/workout-library`, filtered to run
  workouts, each with its own "Send to Apple Watch" button — for sending
  something other than today's plan.
- **Send to Apple Watch** — converts the workout's segments into a
  WorkoutKit `CustomWorkout` (a `.time` goal per segment and a pace-range
  alert computed from your threshold pace — the same fraction-of-threshold
  maths `server/src/lib/garminWorkoutPush.ts` uses for Garmin), then
  schedules it for right now via `WorkoutScheduler`. It shows up in the
  Watch's own Workout app, ready to start.

  Segments with no `intensityFraction` get no alert and are marked as
  recovery, matching what the Garmin path does with them.

## Files

| File | What it does |
|---|---|
| `TrainingDashboardWatch.xcodeproj` | The Xcode project — open this |
| `project.yml` | XcodeGen spec, to regenerate the project if it won't open |
| `TrainingDashboardWatchApp.swift` | App entry point |
| `AppState.swift` | Holds login state, server URL, hands out an `APIClient` |
| `KeychainStore.swift` | Stores the JWT in the Keychain (not UserDefaults) |
| `APIClient.swift` | Talks to the same Express API the web dashboard uses |
| `Models.swift` | Codable DTOs mirroring `client/src/api/types.ts` |
| `WorkoutKitBridge.swift` | Segments → `CustomWorkout` → scheduled on Watch |
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
