import Foundation

enum QuestsNavigationDecision: Equatable { case owned, offerBrowser, blocked }

struct QuestsNavigationPolicy {
  let origin: URL
  func sameOrigin(_ url: URL) -> Bool {
    guard url.user == nil, url.password == nil else { return false }
    return url.scheme == origin.scheme && url.host == origin.host
      && (url.port ?? (url.scheme == "https" ? 443 : 80)) == (origin.port ?? (origin.scheme == "https" ? 443 : 80))
  }
  func owned(_ url: URL) -> Bool { sameOrigin(url) && url.path == "/quests" }
  func decide(url: URL, sourceIsMain: Bool, targetIsMain: Bool, userLink: Bool) -> QuestsNavigationDecision {
    guard sourceIsMain, ["http", "https"].contains(url.scheme ?? ""), url.user == nil, url.password == nil else { return .blocked }
    if targetIsMain && owned(url) { return .owned }
    return userLink ? .offerBrowser : .blocked
  }
}
