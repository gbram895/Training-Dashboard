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
    private static let defaultBaseURL = "https://training-dashboard-peiv.onrender.com"

    init() {
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
}
