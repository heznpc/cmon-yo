import Foundation

enum NativeConfiguration {
  static func apiURL(environment: String?, bundled: String?, allowLocal: Bool) -> URL? {
    let configured = (environment ?? bundled)?.trimmingCharacters(in: .whitespacesAndNewlines)
    let raw = configured.flatMap { $0.isEmpty ? nil : $0 } ?? (allowLocal ? "http://127.0.0.1:3000" : "")
    guard let parts = URLComponents(string: raw), let host = parts.host, !host.isEmpty,
      parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
      parts.path.isEmpty || parts.path == "/",
      parts.scheme == "https" || (allowLocal && parts.scheme == "http" && ["localhost", "127.0.0.1", "::1", "[::1]"].contains(host))
    else { return nil }
    // Preserve the existing origin spelling used by Keychain and recovery files.
    return parts.url
  }
}
