import SwiftUI

struct RunLibraryView: View {
    @EnvironmentObject private var appState: AppState
    @State private var runWorkouts: [LibraryWorkoutDTO] = []
    @State private var thresholds: ThresholdSettingsDTO?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                content
            }
            .navigationTitle("Run Library")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    @ViewBuilder
    private var content: some View {
        if isLoading {
            ProgressView()
        } else if let errorMessage {
            ContentUnavailableView("Couldn't load the library", systemImage: "wifi.slash", description: Text(errorMessage))
        } else if runWorkouts.isEmpty {
            ContentUnavailableView("No run workouts", systemImage: "figure.run")
        } else {
            ForEach(runWorkouts) { workout in
                if let runnable = RunnableWorkout(from: workout) {
                    Section {
                        VStack(alignment: .leading, spacing: 6) {
                            Text(workout.name).font(.headline)
                            if let minutes = workout.durationMin {
                                Text("\(minutes) min").font(.caption).foregroundStyle(.secondary)
                            }
                            SendToWatchButton(workout: runnable, thresholds: thresholds)
                        }
                    }
                }
            }
        }
    }

    @MainActor
    private func load() async {
        isLoading = true
        errorMessage = nil
        do {
            async let libraryResult = appState.api.fetchLibrary()
            async let thresholdsResult = appState.api.fetchThresholds()
            let (library, loadedThresholds) = try await (libraryResult, thresholdsResult)
            runWorkouts = library.filter { $0.discipline == .run && ($0.segments?.isEmpty == false) }
            thresholds = loadedThresholds
        } catch {
            errorMessage = error.localizedDescription
            appState.handleIfUnauthorized(error)
        }
        isLoading = false
    }
}
