import Foundation
import HealthKit
import WorkoutKit

// Verified against Apple's published WorkoutKit reference (developer.apple.com/
// documentation/workoutkit — the real declaration pages, not just the WWDC23
// session) rather than from memory: every initializer and case name below is
// checked against the framework's actual signatures, including the two that
// turned out wrong on the first pass — SpeedRangeAlert/PowerRangeAlert take
// `target:`, not `range:`, and WorkoutScheduler.schedule(_:at:) takes
// DateComponents and doesn't throw, not a plain Date. Still unverified: this
// was checked against the docs, not compiled in Xcode, since there's no Mac
// in this sandbox — if something still doesn't compile, it's likely a version
// difference between the current docs and whatever WorkoutKit version Xcode
// resolves; paste the exact compiler error back and it's a quick fix.

enum WorkoutKitBridgeError: LocalizedError {
    case notAuthorized
    case emptyWorkout

    var errorDescription: String? {
        switch self {
        case .notAuthorized: return "This app isn't authorized to schedule workouts yet — allow it in the prompt, or in Settings > Health."
        case .emptyWorkout: return "This workout has no segments to send."
        }
    }
}

enum WorkoutKitBridge {
    /// Call once (e.g. on app launch, or before the first send) so the
    /// Watch-scheduling permission prompt happens before the user taps Send.
    static func requestAuthorizationIfNeeded() async throws {
        let status = await WorkoutScheduler.shared.authorizationState
        if status != .authorized {
            let granted = await WorkoutScheduler.shared.requestAuthorization()
            guard granted == .authorized else { throw WorkoutKitBridgeError.notAuthorized }
        }
    }

    /// Builds a WorkoutKit CustomWorkout from our segment list and schedules
    /// it onto the paired Apple Watch's stock Workout app, ready to start now.
    static func sendToWatch(_ workout: RunnableWorkout, thresholds: ThresholdSettingsDTO) async throws {
        guard !workout.segments.isEmpty else { throw WorkoutKitBridgeError.emptyWorkout }
        try await requestAuthorizationIfNeeded()

        let activity: HKWorkoutActivityType = workout.discipline == .run ? .running : .cycling
        let blocks = workout.segments.map { segment in
            IntervalBlock(steps: [IntervalStep(.work, step: buildStep(for: segment, discipline: workout.discipline, thresholds: thresholds))], iterations: 1)
        }

        let customWorkout = CustomWorkout(
            activity: activity,
            location: .outdoor,
            displayName: workout.name,
            blocks: blocks
        )

        let plan = WorkoutPlan(.custom(customWorkout))
        // "Now" so it lands in the Watch's scheduled list ready to pick up
        // immediately rather than waiting on a specific calendar day.
        // schedule(_:at:) takes DateComponents, not a Date, and doesn't throw.
        let now = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second], from: Date())
        await WorkoutScheduler.shared.schedule(plan, at: now)
    }

    private static func buildStep(
        for segment: WorkoutSegmentDTO,
        discipline: PlannedDiscipline,
        thresholds: ThresholdSettingsDTO
    ) -> WorkoutStep {
        let goal = WorkoutGoal.time(segment.durationSec, .seconds)

        guard let low = segment.intensityLow ?? segment.intensityFraction,
              let high = segment.intensityHigh ?? segment.intensityFraction else {
            return WorkoutStep(goal: goal)
        }

        switch discipline {
        case .run:
            guard thresholds.thresholdSpeedMps > 0 else { return WorkoutStep(goal: goal) }
            let minSpeed = Measurement(value: low * thresholds.thresholdSpeedMps, unit: UnitSpeed.metersPerSecond)
            let maxSpeed = Measurement(value: high * thresholds.thresholdSpeedMps, unit: UnitSpeed.metersPerSecond)
            return WorkoutStep(goal: goal, alert: SpeedRangeAlert(target: minSpeed...maxSpeed, metric: .current))
        case .bike:
            guard thresholds.ftpWatts > 0 else { return WorkoutStep(goal: goal) }
            let minPower = Measurement(value: low * thresholds.ftpWatts, unit: UnitPower.watts)
            let maxPower = Measurement(value: high * thresholds.ftpWatts, unit: UnitPower.watts)
            return WorkoutStep(goal: goal, alert: PowerRangeAlert(target: minPower...maxPower, metric: .current))
        }
    }
}
