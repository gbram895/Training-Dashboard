import Foundation
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published var isLoggedIn: Bool
    @Published var baseURLString: String {
        didSet { UserDefaults.standard.set(baseURLString, forKey: Self.baseURLKey) }
    }

    private static let baseURLKey = "server-base-url"
    /// Same Render deployment the web dashboard talks to — override this in
    /// Settings if you're pointing the app at a local dev server instead.
    static let defaultBaseURL = "https://training-dashboard-peiv.onrender.com"

    /// `nonisolated` so `@StateObject private var appState = AppState()` in the
    /// `App` struct isn't a call into the main actor from a synchronous,
    /// non-isolated initializer — an error under the Swift 6 language mode.
    /// Nothing here touches main-actor state; it's UserDefaults and Keychain.
    nonisolated init() {
        self.isLoggedIn = KeychainStore.loadToken() != nil
        self.baseURLString = UserDefaults.standard.string(forKey: Self.baseURLKey) ?? Self.defaultBaseURL
    }

    var api: APIClient {
        APIClient(baseURLString: baseURLString, token: KeychainStore.loadToken())
    }

    func login(email: String, password: String) async throws {
        let response = try await APIClient(baseURLString: baseURLString, token: nil).login(email: email, password: password)
        KeychainStore.saveToken(response.token)
        isLoggedIn = true
    }

    func logout() {
        KeychainStore.clearToken()
        isLoggedIn = false
    }

    /// The API rejected our token, so the stored one is stale — drop it and
    /// send the user back to the sign-in screen instead of showing an error
    /// they can't act on.
    func handleIfUnauthorized(_ error: Error) {
        guard let apiError = error as? APIError,
              case .server(let status, _) = apiError,
              status == 401 else { return }
        logout()
    }
}
