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
    @State private var serverURL = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("https://your-app.onrender.com", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .onSubmit { appState.baseURLString = serverURL }
                    Button("Use this server") { appState.baseURLString = serverURL }
                        .disabled(serverURL.isEmpty || serverURL == appState.baseURLString)
                }
                Section {
                    Button("Sign out", role: .destructive) { appState.logout() }
                }
            }
            .navigationTitle("Settings")
            .onAppear { serverURL = appState.baseURLString }
        }
    }
}
