import Foundation
import HealthKit
import WorkoutKit

// Every WorkoutKit symbol below was checked against Apple's published
// declarations for iOS 17 (the release that introduced the framework):
//
//   CustomWorkout.init(activity:location:displayName:warmup:blocks:cooldown:)
//   IntervalBlock.init(steps:iterations:)
//   IntervalStep.init(_:step:)            // .work / .recovery
//   WorkoutStep.init(goal:alert:)         // both parameters default
//   WorkoutGoal.time(_ value: Double, _ unit: UnitDuration)
//   SpeedRangeAlert.init(target:metric:)  // ClosedRange<Measurement<UnitSpeed>>
//   PowerRangeAlert.init(target:metric:)  // ClosedRange<Measurement<UnitPower>>
//   WorkoutPlan.init(_:id:)               // .custom(CustomWorkout)
//   WorkoutScheduler.shared.schedule(_:at:) async -> Void, taking DateComponents
//
// It still hasn't been run through a compiler — see the README.

enum WorkoutKitBridgeError: LocalizedError {
    case unsupportedDevice
    case notAuthorized
    case emptyWorkout
    case unsupportedActivity

    var errorDescription: String? {
        switch self {
        case .unsupportedDevice:
            return "This device can't schedule workouts onto an Apple Watch."
        case .notAuthorized:
            return "This app isn't allowed to schedule workouts yet — allow it when prompted, or in Settings."
        case .emptyWorkout:
            return "This workout has no segments to send."
        case .unsupportedActivity:
            return "Apple Watch doesn't accept custom workouts for this activity."
        }
    }
}

enum WorkoutKitBridge {
    /// Call before the first send so the Watch-scheduling permission prompt
    /// happens ahead of the tap, not in the middle of it.
    static func requestAuthorizationIfNeeded() async throws {
        guard WorkoutScheduler.isSupported else { throw WorkoutKitBridgeError.unsupportedDevice }
        if await WorkoutScheduler.shared.authorizationState == .authorized { return }
        guard await WorkoutScheduler.shared.requestAuthorization() == .authorized else {
            throw WorkoutKitBridgeError.notAuthorized
        }
    }

    /// Builds a WorkoutKit `CustomWorkout` from our segment list and schedules
    /// it onto the paired Apple Watch's stock Workout app, ready to start now.
    static func sendToWatch(_ workout: RunnableWorkout, thresholds: ThresholdSettingsDTO) async throws {
        guard !workout.segments.isEmpty else { throw WorkoutKitBridgeError.emptyWorkout }
        try await requestAuthorizationIfNeeded()

        let activity: HKWorkoutActivityType = workout.discipline == .run ? .running : .cycling
        let location: HKWorkoutSessionLocationType = .outdoor
        guard CustomWorkout.supportsActivity(activity) else { throw WorkoutKitBridgeError.unsupportedActivity }

        // Garmin's export tags a leading warm-up and a trailing cool-down by
        // role; WorkoutKit has dedicated slots for exactly those two, so map
        // them across and leave the rest as the interval body.
        var body = workout.segments
        var warmup: WorkoutStep?
        var cooldown: WorkoutStep?

        if body.count > 1, body.first?.role == .warmup {
            warmup = step(for: body.removeFirst(), discipline: workout.discipline, thresholds: thresholds, location: location, activity: activity)
        }
        if body.count > 1, body.last?.role == .cooldown {
            cooldown = step(for: body.removeLast(), discipline: workout.discipline, thresholds: thresholds, location: location, activity: activity)
        }

        let steps = body.map { segment in
            IntervalStep(
                segment.intensityFraction == nil ? .recovery : .work,
                step: step(for: segment, discipline: workout.discipline, thresholds: thresholds, location: location, activity: activity)
            )
        }

        let customWorkout = CustomWorkout(
            activity: activity,
            location: location,
            displayName: workout.name,
            warmup: warmup,
            blocks: steps.isEmpty ? [] : [IntervalBlock(steps: steps, iterations: 1)],
            cooldown: cooldown
        )

        // `schedule(_:at:)` takes DateComponents, not a Date. "Now" puts it at
        // the top of the Watch's scheduled list, ready to pick up immediately
        // rather than waiting on a specific calendar day.
        let now = Calendar.current.dateComponents(in: .current, from: Date())
        await WorkoutScheduler.shared.schedule(WorkoutPlan(.custom(customWorkout)), at: now)
    }

    private static func step(
        for segment: WorkoutSegmentDTO,
        discipline: PlannedDiscipline,
        thresholds: ThresholdSettingsDTO,
        location: HKWorkoutSessionLocationType,
        activity: HKWorkoutActivityType
    ) -> WorkoutStep {
        let goal = WorkoutGoal.time(max(1, segment.durationSec), .seconds)
        guard let alert = rangeAlert(for: segment, discipline: discipline, thresholds: thresholds),
              CustomWorkout.supportsAlert(alert, activity: activity, location: location) else {
            return WorkoutStep(goal: goal)
        }
        return WorkoutStep(goal: goal, alert: alert)
    }

    /// Same fraction-of-threshold maths the server already uses for the
    /// dashboard's "Send to Garmin" button (see server/src/lib/garminWorkoutPush.ts),
    /// so a segment targets the same pace or power on either device.
    private static func rangeAlert(
        for segment: WorkoutSegmentDTO,
        discipline: PlannedDiscipline,
        thresholds: ThresholdSettingsDTO
    ) -> (any WorkoutAlert)? {
        guard let fraction = segment.intensityFraction else { return nil }
        // A source file can tag a band the wrong way round; a ClosedRange whose
        // lower bound is above its upper one traps at runtime, so sort them.
        let bounds = [segment.intensityLow ?? fraction, segment.intensityHigh ?? fraction].sorted()

        switch discipline {
        case .run:
            let speed = thresholds.thresholdSpeedMps
            guard speed > 0 else { return nil }
            let slowest = Measurement(value: bounds[0] * speed, unit: UnitSpeed.metersPerSecond)
            let fastest = Measurement(value: bounds[1] * speed, unit: UnitSpeed.metersPerSecond)
            return SpeedRangeAlert(target: slowest...fastest, metric: .current)
        case .bike:
            let ftp = thresholds.ftpWatts
            guard ftp > 0 else { return nil }
            let easiest = Measurement(value: bounds[0] * ftp, unit: UnitPower.watts)
            let hardest = Measurement(value: bounds[1] * ftp, unit: UnitPower.watts)
            return PowerRangeAlert(target: easiest...hardest, metric: .current)
        }
    }
}
