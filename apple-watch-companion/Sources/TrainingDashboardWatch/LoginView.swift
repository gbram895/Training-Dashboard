import SwiftUI

struct LoginView: View {
    @EnvironmentObject private var appState: AppState
    @State private var email = ""
    @State private var password = ""
    @State private var serverURL = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("https://your-app.onrender.com", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                }
                Section("Account") {
                    TextField("Email", text: $email)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.emailAddress)
                    SecureField("Password", text: $password)
                }
                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
                }
                Button(isLoading ? "Signing in…" : "Sign in") {
                    Task { await login() }
                }
                .disabled(isLoading || email.isEmpty || password.isEmpty || serverURL.isEmpty)
            }
            .navigationTitle("Training Dashboard")
            .onAppear { serverURL = appState.baseURLString }
        }
    }

    private func login() async {
        isLoading = true
        errorMessage = nil
        appState.baseURLString = serverURL
        do {
            try await appState.login(email: email, password: password)
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}
