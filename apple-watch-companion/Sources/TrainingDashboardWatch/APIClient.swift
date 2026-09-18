import Foundation

enum APIError: LocalizedError {
    case invalidURL
    case server(status: Int, message: String)
    case decoding(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL — check it in Settings."
        case .server(let status, let message):
            return status == 401 ? "Your session expired — sign in again." : message
        case .decoding: return "The server sent back something this app didn't expect."
        }
    }
}

/// Talks to the same Express/Prisma API the web dashboard uses — same JWT
/// auth, same JSON shapes. See client/src/api/client.ts for the web
/// equivalent this mirrors.
struct APIClient {
    let baseURLString: String
    let token: String?

    private func request(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest? {
        // A trailing slash on the saved base URL would produce "…//api/…".
        let base = baseURLString.hasSuffix("/") ? String(baseURLString.dropLast()) : baseURLString
        guard let url = URL(string: base + "/api" + path), url.scheme != nil, url.host != nil else { return nil }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        req.httpBody = body
        return req
    }

    private func rawData(_ path: String, method: String, body: Data?) async throws -> Data {
        guard let req = request(path, method: method, body: body) else { throw APIError.invalidURL }
        let (data, response) = try await URLSession.shared.data(for: req)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ServerErrorBody.self, from: data))?.readableMessage
                ?? "Request failed (\(status))"
            throw APIError.server(status: status, message: message)
        }
        return data
    }

    private func send<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil) async throws -> T {
        let data = try await rawData(path, method: method, body: body)
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    /// For endpoints that answer with a bare `null` when there's nothing to
    /// return — decoding a top-level JSON fragment into `T?` is doable but
    /// fiddly, so check for it up front instead.
    private func sendOptional<T: Decodable>(_ path: String) async throws -> T? {
        let data = try await rawData(path, method: "GET", body: nil)
        let trimmed = String(decoding: data, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "null" { return nil }
        do {
            return try JSONDecoder().decode(T.self, from: data)
        } catch {
            throw APIError.decoding(error)
        }
    }

    func login(email: String, password: String) async throws -> LoginResponse {
        let body = try JSONEncoder().encode(["email": email, "password": password])
        return try await send("/auth/login", method: "POST", body: body)
    }

    /// `null` when the account has no training-plan config yet.
    func fetchToday() async throws -> PlannedDayDTO? {
        try await sendOptional("/training-plan/today")
    }

    func fetchLibrary() async throws -> [LibraryWorkoutDTO] {
        try await send("/workout-library")
    }

    func fetchThresholds() async throws -> ThresholdSettingsDTO {
        try await send("/settings/thresholds")
    }
}

private struct ServerErrorBody: Decodable {
    let error: StringOrObject?

    var readableMessage: String? {
        switch error {
        case .string(let s): return s
        case .object: return "Request failed"
        case .none: return nil
        }
    }
}

private enum StringOrObject: Decodable {
    case string(String)
    case object

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let s = try? container.decode(String.self) {
            self = .string(s)
        } else {
            self = .object
        }
    }
}
