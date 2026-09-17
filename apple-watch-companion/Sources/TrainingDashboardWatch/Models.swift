import Foundation

// Mirrors client/src/api/types.ts on the web dashboard — keep these two in sync
// if the server's JSON shape changes.

struct LoginResponse: Decodable {
    let token: String
    let user: UserSummary
}

struct UserSummary: Decodable {
    let id: String
    let email: String
    let name: String
}

enum PlannedDiscipline: String, Codable {
    case bike = "BIKE"
    case run = "RUN"
}

enum SegmentRole: String, Codable {
    case warmup
    case cooldown
}

struct WorkoutSegmentDTO: Codable {
    let durationSec: Double
    let intensityFraction: Double?
    let intensityLow: Double?
    let intensityHigh: Double?
    let role: SegmentRole?
}

struct LibraryWorkoutDTO: Decodable, Identifiable {
    let path: String
    let name: String
    let discipline: PlannedDiscipline
    let durationMin: Int?
    let intensity: Int?
    let trainingStress: Int?
    let profile: String?
    let segments: [WorkoutSegmentDTO]?
    let category: String?

    var id: String { path }
}

struct PlannedDayDTO: Decodable {
    let id: String
    let date: String
    let isRestDay: Bool
    let restReason: String?
    let sourcePath: String?
    let name: String?
    let discipline: PlannedDiscipline?
    let durationMin: Int?
    let intensity: Int?
    let trainingStress: Int?
    let profile: String?
    let segments: [WorkoutSegmentDTO]?
    let category: String?
}

struct ThresholdSettingsDTO: Decodable {
    let ftpWatts: Double
    let thresholdPaceSecPerKm: Double

    /// Meters/sec at threshold pace — the same conversion the server and web
    /// client use (1000 / secPerKm), so a fraction-of-threshold segment maps
    /// to the same speed everywhere.
    var thresholdSpeedMps: Double {
        thresholdPaceSecPerKm > 0 ? 1000.0 / thresholdPaceSecPerKm : 0
    }
}

/// A named, runnable workout — either today's plan or a library pick — reduced
/// to just what WorkoutKit needs.
struct RunnableWorkout {
    let name: String
    let discipline: PlannedDiscipline
    let segments: [WorkoutSegmentDTO]

    init?(from day: PlannedDayDTO) {
        guard !day.isRestDay, let discipline = day.discipline, let segments = day.segments, !segments.isEmpty else {
            return nil
        }
        self.name = day.name ?? "Planned workout"
        self.discipline = discipline
        self.segments = segments
    }

    init?(from workout: LibraryWorkoutDTO) {
        guard let segments = workout.segments, !segments.isEmpty else { return nil }
        self.name = workout.name
        self.discipline = workout.discipline
        self.segments = segments
    }
}
