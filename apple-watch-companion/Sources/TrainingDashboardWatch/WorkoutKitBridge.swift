import Foundation
import HealthKit
import WorkoutKit

// Written from the WWDC23 "Meet WorkoutKit" session and Apple's WorkoutKit
// docs, without a Mac/Xcode available to compile-check it against the
// framework's real declarations. The overall shape (CustomWorkout made of
// IntervalBlocks of IntervalSteps, each WorkoutStep with a .time goal and an
// optional range alert, scheduled via WorkoutScheduler) is right, but if
// Xcode flags a specific case name or initializer here as wrong, it's almost
// certainly a narrow signature mismatch in this file, not a wrong approach —
// paste the exact compiler error back and it's a quick fix.

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
        try await WorkoutScheduler.shared.schedule(plan, at: Date())
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
            return WorkoutStep(goal: goal, alert: SpeedRangeAlert(range: minSpeed...maxSpeed, metric: .current))
        case .bike:
            guard thresholds.ftpWatts > 0 else { return WorkoutStep(goal: goal) }
            let minPower = Measurement(value: low * thresholds.ftpWatts, unit: UnitPower.watts)
            let maxPower = Measurement(value: high * thresholds.ftpWatts, unit: UnitPower.watts)
            return WorkoutStep(goal: goal, alert: PowerRangeAlert(range: minPower...maxPower, metric: .current))
        }
    }
}
