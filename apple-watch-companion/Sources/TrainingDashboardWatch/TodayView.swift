import SwiftUI

struct TodayView: View {
    @EnvironmentObject private var appState: AppState
    @State private var day: PlannedDayDTO?
    @State private var thresholds: ThresholdSettingsDTO?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Today")
                .task { await load() }
                .refreshable { await load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView()
        } else if let errorMessage {
            ContentUnavailableView("Couldn't load today's plan", systemImage: "wifi.slash", description: Text(errorMessage))
        } else if let day, day.isRestDay {
            ContentUnavailableView("Rest day", systemImage: "moon.zzz", description: Text(day.restReason ?? "Nothing planned today."))
        } else if let day, let workout = RunnableWorkout(from: day) {
            if workout.discipline == .run {
                List {
                    Section(workout.name) {
                        if let minutes = day.durationMin {
                            Text("\(minutes) min")
                        }
                        SendToWatchButton(workout: workout, thresholds: thresholds)
                    }
                }
            } else {
                ContentUnavailableView(
                    "Today is a bike day",
                    systemImage: "bicycle",
                    description: Text("Use \u{201c}Send to Garmin\u{201d} on the dashboard for \(workout.name).")
                )
            }
        } else {
            ContentUnavailableView("No plan for today", systemImage: "calendar")
        }
    }

    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let dayResult = appState.api.fetchToday()
            async let thresholdsResult = appState.api.fetchThresholds()
            day = try await dayResult
            thresholds = try await thresholdsResult
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
