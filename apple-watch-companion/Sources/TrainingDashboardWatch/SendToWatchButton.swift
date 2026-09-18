import SwiftUI

/// Shared "Send to Watch" control used by both TodayView and RunLibraryView —
/// the run-side equivalent of the web dashboard's "Send to Garmin" button.
struct SendToWatchButton: View {
    let workout: RunnableWorkout
    let thresholds: ThresholdSettingsDTO?

    @State private var state: SendState = .idle

    enum SendState: Equatable {
        case idle
        case sending
        case sent
        case failed(String)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button(action: send) {
                switch state {
                case .idle: Text("Send to Apple Watch")
                case .sending: Text("Sending…")
                case .sent: Text("Sent to Watch ✓")
                case .failed: Text("Retry send to Watch")
                }
            }
            .disabled(state == .sending || thresholds == nil)

            if thresholds == nil {
                Text("Waiting on your threshold pace and FTP — pull to refresh.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if case .failed(let message) = state {
                Text(message).font(.caption).foregroundStyle(.red)
            }
            if case .sent = state {
                Text("Open the Workout app on your Watch — it's in the scheduled list, ready to start.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func send() {
        guard let thresholds else { return }
        state = .sending
        // `@MainActor` because this task writes `state`, which drives the view.
        Task { @MainActor in
            do {
                try await WorkoutKitBridge.sendToWatch(workout, thresholds: thresholds)
                state = .sent
            } catch {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
