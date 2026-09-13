import Foundation
import Observation
import Security

struct AccountUser: Codable, Equatable, Sendable {
  let id: String
  let name: String
  let email: String
  let emailVerified: Bool
}
struct AccountResponse: Decodable { let user: AccountUser? }
struct NativeCredential: Decodable { let token: String }
struct ActionResult: Decodable { let success: Bool }
struct ProductError: Error, LocalizedError {
  let status: Int
  let code: String
  var errorDescription: String? {
    switch code {
    case "EMAIL_NOT_VERIFIED": "이메일 인증을 완료한 뒤 로그인해 주세요."
    case "UNAUTHENTICATED": "세션이 만료되었습니다. 다시 로그인해 주세요."
    case "VERSION_CONFLICT": "모임이 변경되었습니다. 현재 상태를 다시 확인해 주세요."
    case "FULL": "정원이 마감되었습니다."
    case "CLOSED": "취소되었거나 시작한 모임은 변경할 수 없습니다."
    case "FORBIDDEN": "주최자만 변경할 수 있습니다."
    case "CAPACITY": "현재 참여 인원보다 정원을 줄일 수 없습니다."
    case "INVALID_INPUT", "STARTED": "제목·시설·일시·정원을 확인해 주세요."
    case "NOT_FOUND": "모임을 찾을 수 없습니다."
    case "KEYCHAIN": "이 기기에 로그인 정보를 저장하지 못했습니다. 다시 시도해 주세요."
    default: status == 429 ? "요청이 많습니다. 잠시 후 다시 시도해 주세요." : status >= 500 || status == 0 ? "응답을 확인하지 못했습니다. 현재 상태를 다시 조회해 주세요." : "요청을 처리하지 못했습니다. 입력 내용을 확인해 주세요."
    }
  }
}
private struct ErrorEnvelope: Decodable { struct Detail: Decodable { let code: String }; let error: Detail }
private final class NoRedirect: NSObject, URLSessionTaskDelegate, Sendable {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest, completionHandler: @escaping @Sendable (URLRequest?) -> Void) { completionHandler(nil) }
}
protocol SessionCredentialStore {
  func read() throws -> String?
  func save(_ token: String?) throws
}
struct SessionVault: SessionCredentialStore {
  let origin: String
  private var query: [String: Any] { [kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "app.heznpc.cmonyo.session", kSecAttrAccount as String: origin] }
  func read() throws -> String? {
    var q = query; q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(q as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data, let token = String(data: data, encoding: .utf8) else { throw ProductError(status: 0, code: "KEYCHAIN") }
    return token
  }
  func save(_ token: String?) throws {
    if let token {
      let attributes: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly]
      var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
      if status == errSecItemNotFound { status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) }
      guard status == errSecSuccess else { throw ProductError(status: 0, code: "KEYCHAIN") }
    } else {
      let status = SecItemDelete(query as CFDictionary)
      guard status == errSecSuccess || status == errSecItemNotFound else { throw ProductError(status: 0, code: "KEYCHAIN") }
    }
  }
}

@MainActor @Observable
final class AccountSession {
  let baseURL: URL
  private(set) var user: AccountUser?
  private(set) var generation = 0
  private(set) var privacyEpoch = 0
  private(set) var restoring = true
  var notice: String?
  private var token: String?
  private var transport: URLSession
  private let vault: any SessionCredentialStore
  init(baseURL: URL, credentialStore: (any SessionCredentialStore)? = nil) {
    self.baseURL = baseURL
    vault = credentialStore ?? SessionVault(origin: baseURL.absoluteString)
    transport = Self.makeTransport()
  }
  private static func makeTransport() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil; config.httpShouldSetCookies = false; config.urlCache = nil
    config.timeoutIntervalForRequest = 8; config.timeoutIntervalForResource = 10
    return URLSession(configuration: config, delegate: NoRedirect(), delegateQueue: nil)
  }
  func request<T: Decodable>(_ path: String, method: String = "GET", body: Data? = nil, commandID: String? = nil, authenticated: Bool = true) async throws -> T {
    guard baseURL.scheme == "https" || (baseURL.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(baseURL.host ?? "")) else { throw ProductError(status: 0, code: "CONFIGURATION") }
    let epoch = generation
    var request = URLRequest(url: baseURL.appending(path: path.components(separatedBy: "?")[0]), cachePolicy: .reloadIgnoringLocalCacheData)
    if let query = path.split(separator: "?", maxSplits: 1).dropFirst().first {
      var parts = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!
      parts.percentEncodedQuery = String(query); request.url = parts.url
    }
    request.httpMethod = method; request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    if body != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
    if authenticated, let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
    if let commandID {
      request.setValue(commandID, forHTTPHeaderField: "Idempotency-Key")
      request.setValue(user?.id, forHTTPHeaderField: "X-Cmon-User")
    }
    let data: Data; let response: URLResponse
    do { (data, response) = try await transport.data(for: request) }
    catch { if epoch != generation || Task.isCancelled { throw CancellationError() }; throw ProductError(status: 0, code: "NETWORK") }
    guard epoch == generation else { throw CancellationError() }
    try Task.checkCancellation()
    guard let http = response as? HTTPURLResponse else { throw ProductError(status: 0, code: "RESPONSE") }
    guard (200..<300).contains(http.statusCode) else {
      if http.statusCode == 401 && authenticated { try clear() }
      throw ProductError(status: http.statusCode, code: (try? JSONDecoder().decode(ErrorEnvelope.self, from: data).error.code) ?? "UNAVAILABLE")
    }
    do { return try JSONDecoder().decode(T.self, from: data) }
    catch { throw ProductError(status: 0, code: "RESPONSE") }
  }
  func restore() async {
    guard restoring else { return }
    defer { restoring = false }
    do { token = try vault.read(); if token != nil { try await refreshAccount() } }
    catch { notice = error.localizedDescription }
  }
  func refreshAccount() async throws {
    guard token != nil else { return }
    let response: AccountResponse = try await request("api/v1/me")
    guard let next = response.user, UUID(uuidString: next.id) != nil, next.emailVerified else { try clear(); throw ProductError(status: 401, code: "UNAUTHENTICATED") }
    if let user, user.id != next.id { try clear(); throw CancellationError() }
    user = next
  }
  func login(email: String, password: String) async throws {
    let credential: NativeCredential = try await request("api/native/auth/sign-in/email", method: "POST", body: JSONEncoder().encode(["email": email, "password": password]), authenticated: false)
    try vault.save(credential.token)
    generation += 1; token = credential.token
    try await refreshAccount()
    notice = nil
  }
  func emailAction(_ action: String, email: String, password: String = "", name: String = "") async throws {
    var body = ["email": email]
    if action == "sign-up/email" { body["password"] = password; body["name"] = name; body["callbackURL"] = "/account" }
    if action == "send-verification-email" { body["callbackURL"] = "/account" }
    if action == "request-password-reset" { body["redirectTo"] = "/account?mode=reset" }
    let _: ActionResult = try await request("api/native/auth/\(action)", method: "POST", body: JSONEncoder().encode(body), authenticated: false)
  }
  func logout() async {
    do { let _: ActionResult = try await request("api/native/auth/sign-out", method: "POST", body: Data("{}".utf8)) }
    catch { notice = "서버 로그아웃 응답을 확인하지 못했습니다. 이 기기의 로그인 정보를 제거합니다." }
    do { try clear() } catch { notice = error.localizedDescription }
  }
  private func clear() throws {
    user = nil; token = nil; generation += 1; privacyEpoch += 1
    transport.invalidateAndCancel(); transport = Self.makeTransport()
    try vault.save(nil)
  }
}
