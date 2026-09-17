import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        if appState.isLoggedIn {
            TabView {
                TodayView()
                    .tabItem { Label("Today", systemImage: "calendar") }
                RunLibraryView()
                    .tabItem { Label("Library", systemImage: "figure.run") }
                SettingsView()
                    .tabItem { Label("Settings", systemImage: "gear") }
            }
        } else {
            LoginView()
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    Text(appState.baseURLString).foregroundStyle(.secondary)
                }
                Button("Sign out", role: .destructive) { appState.logout() }
            }
            .navigationTitle("Settings")
        }
    }
}
