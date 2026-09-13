import XCTest
import WebKit
@testable import CmonYo

@MainActor
final class AccountMeetingTests: XCTestCase {
  override func setUp() async throws {
    guard let raw = ProcessInfo.processInfo.environment["CMON_NATIVE_TEST_URL"], let url = URL(string: raw) else { return }
    var request = URLRequest(url: url.appending(path: "_test/reset-limits")); request.httpMethod = "POST"
    let (_, response) = try await URLSession.shared.data(for: request)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
  }
  func testRealNativeLoginMeetupLifecycleAndIsolation() async throws {
    guard let raw = ProcessInfo.processInfo.environment["CMON_NATIVE_TEST_URL"], let url = URL(string: raw) else { throw XCTSkip("Set CMON_NATIVE_TEST_URL to the isolated meetings QA server.") }
    // Standalone xctest has no app keychain entitlement. Actual Keychain restart
    // is checked in the installed app; this store isolates HTTP/state tests.
    let store = TestCredentialStore()
    let host = AccountSession(baseURL: url, credentialStore: store)
    await host.restore(); if host.user != nil { await host.logout() }
    let a = try await register(host, origin: url, name: "Native 주최 시험")
    try await host.login(email: a.email, password: a.password)
    let hostID = try XCTUnwrap(host.user?.id)
    let restored = AccountSession(baseURL: url, credentialStore: store); await restored.restore()
    XCTAssertEqual(restored.user?.id, hostID)
    let facilities = try await FacilityAPI(baseURL: url).list()
    let place = try XCTUnwrap(facilities.places.first)
    var draft = MeetingDraft(); draft.title = "[시험] Native HTTP 운동 약속"; draft.placeId = place.id; draft.capacity = 2
    let created: MeetingCommandResult = try await host.request("api/v1/meetups", method: "POST", body: JSONEncoder().encode(draft), commandID: UUID().uuidString)
    let id = try XCTUnwrap(created.id)
    let guest = AccountSession(baseURL: url, credentialStore: store)
    let b = try await register(guest, origin: url, name: "Native 참여 시험")
    try await guest.login(email: b.email, password: b.password)
    let guestID = try XCTUnwrap(guest.user?.id)
    XCTAssertNotEqual(hostID, guestID)
    let detail: MeetingRecordResponse = try await guest.request("api/v1/meetups/\(id)", authenticated: false)
    try detail.meetup.validate(); XCTAssertEqual(detail.meetup.participantCount, 1)
    let _: MeetingCommandResult = try await guest.request("api/v1/meetups/\(id)", method: "PATCH", body: JSONEncoder().encode(MeetingChange(action: "join", expectedVersion: detail.meetup.version)), commandID: UUID().uuidString)
    let joined: MembershipResponse = try await guest.request("api/v1/meetups/\(id)/membership")
    XCTAssertEqual(joined.role, "participant"); XCTAssertEqual(joined.userId, guestID)
    let _: MeetingCommandResult = try await guest.request("api/v1/meetups/\(id)", method: "PATCH", body: JSONEncoder().encode(MeetingChange(action: "leave", expectedVersion: joined.version)), commandID: UUID().uuidString)
    let mine: MeetingListResponse = try await guest.request("api/v1/me/meetups")
    XCTAssertEqual(mine.userId, guestID); XCTAssertEqual(mine.meetups.first(where: { $0.id == id })?.participationStatus, "cancelled")
    let beforeCancel: MeetingRecordResponse = try await host.request("api/v1/meetups/\(id)", authenticated: false)
    let _: MeetingCommandResult = try await host.request("api/v1/meetups/\(id)", method: "PATCH", body: JSONEncoder().encode(MeetingChange(action: "cancel", expectedVersion: beforeCancel.meetup.version)), commandID: UUID().uuidString)
    let cancelled: MeetingRecordResponse = try await guest.request("api/v1/meetups/\(id)", authenticated: false)
    XCTAssertEqual(cancelled.meetup.status, "cancelled")
    let delayed = Task { () throws -> AccountResponse in try await guest.request("_test/slow-me") }
    try await Task.sleep(for: .milliseconds(100))
    await guest.logout()
    XCTAssertNil(guest.user)
    do { _ = try await delayed.value; XCTFail("Old account response must not survive logout") } catch is CancellationError {} catch { XCTFail("Expected account cancellation") }
    // The same instance switches to a different verified account; old requests
    // and private navigation epoch no longer belong to the new identity.
    let priorEpoch = guest.privacyEpoch
    try await guest.login(email: a.email, password: a.password)
    XCTAssertEqual(guest.user?.id, hostID); XCTAssertGreaterThan(priorEpoch, 0)
    let own: MeetingListResponse = try await guest.request("api/v1/me/meetups")
    XCTAssertEqual(own.userId, hostID); XCTAssertEqual(own.meetups.first(where: { $0.id == id })?.role, "host")
    await guest.logout(); await host.logout()
    let empty = AccountSession(baseURL: url, credentialStore: store); await empty.restore(); XCTAssertNil(empty.user)
  }
  func testAuthenticatedWebCommentAndReturnWithSameNativeAccount() async throws {
    guard let raw = ProcessInfo.processInfo.environment["CMON_NATIVE_TEST_URL"], let url = URL(string: raw) else { throw XCTSkip("Set CMON_NATIVE_TEST_URL") }
    let session = AccountSession(baseURL: url, credentialStore: TestCredentialStore())
    let account = try await register(session, origin: url, name: "웹뷰 작성 시험")
    try await session.login(email: account.email, password: account.password)
    let userID = try XCTUnwrap(session.user?.id)
    let facilities = try await FacilityAPI(baseURL: url).list()
    var draft = MeetingDraft(); draft.title = "[시험] 인증된 댓글 왕복"; draft.placeId = try XCTUnwrap(facilities.places.first?.id)
    let result: MeetingCommandResult = try await session.request("api/v1/meetups", method: "POST", body: JSONEncoder().encode(draft), commandID: UUID().uuidString)
    let id = try XCTUnwrap(result.id)
    let store = try await session.prepareDiscussion()
    let cookies = await store.httpCookieStore.allCookies()
    XCTAssertTrue(cookies.contains { $0.name == "cmon.session_token" && $0.isHTTPOnly })
    XCTAssertFalse(store.isPersistent)
    var returned: [String] = []
    let bridge = MeetupBridge(origin: url, meetupID: id) { returned.append($0) }
    let config = WKWebViewConfiguration(); config.websiteDataStore = store
    config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "cmonYo")
    let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
    let delegate = DiscussionLoadDelegate()
    web.navigationDelegate = delegate
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      delegate.continuation = continuation
      var discussionURL = url.appending(path: "meetups/\(id)/discussion")
      discussionURL.append(queryItems: [.init(name: "surface", value: "native")])
      web.load(URLRequest(url: discussionURL))
    }
    func waitFor(_ script: String) async throws {
      for _ in 0..<150 {
        if (try? await web.evaluateJavaScript(script)) as? Bool == true { return }
        try await Task.sleep(for: .milliseconds(100))
      }
      XCTFail("Expected WebKit state did not render")
    }
    try await waitFor("document.querySelector('textarea')?.disabled === false")
    let productNavigation = try await web.evaluateJavaScript("[...document.querySelectorAll('a')].some(a=>a.textContent==='둘러보기')") as? Bool
    XCTAssertEqual(productNavigation, false)
    let webUser = try await web.callAsyncJavaScript("return (await (await fetch('/api/v1/me')).json()).user.id", arguments: [:], in: nil, contentWorld: .page) as? String
    XCTAssertEqual(webUser, userID)
    let visibleCookies = try await web.evaluateJavaScript("document.cookie") as? String
    XCTAssertFalse(visibleCookies?.contains("session_token") ?? true)
    let body = "Native에서 작성한 웹 댓글 " + UUID().uuidString
    _ = try await web.callAsyncJavaScript("const t=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,body); t.dispatchEvent(new Event('input',{bubbles:true}));", arguments: ["body": body], in: nil, contentWorld: .page)
    try await waitFor("[...document.querySelectorAll('button')].some(b=>b.textContent==='댓글 등록' && !b.disabled)")
    _ = try await web.evaluateJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='댓글 등록').click()")
    let encodedBody = String(data: try JSONEncoder().encode(body), encoding: .utf8)!
    try await waitFor("document.querySelector('section ul')?.textContent.includes(\(encodedBody)) === true")
    _ = try await web.evaluateJavaScript("[...document.querySelectorAll('button')].find(b=>b.textContent==='앱 모임으로 돌아가기').click()")
    for _ in 0..<30 { if !returned.isEmpty { break }; try await Task.sleep(for: .milliseconds(100)) }
    XCTAssertEqual(returned, [id])
    let reopened = try await session.prepareDiscussion()
    XCTAssertTrue(reopened === store)
    await session.logout()
    XCTAssertFalse(session.discussionDataStore === store)
    let loggedOutStatus = try await web.callAsyncJavaScript("return (await fetch('/api/v1/me')).status", arguments: [:], in: nil, contentWorld: .page) as? Int
    XCTAssertEqual(loggedOutStatus, 401)
    bridge.close(); web.stopLoading()
  }
  private func register(_ session: AccountSession, origin: URL, name: String) async throws -> (email: String, password: String) {
    let email = "native-\(UUID().uuidString.lowercased())@example.test", password = "Native-local-\(UUID().uuidString)"
    try await session.emailAction("sign-up/email", email: email, password: password, name: name)
    var parts = URLComponents(url: origin.appending(path: "_test/mail"), resolvingAgainstBaseURL: false)!
    parts.queryItems = [.init(name: "email", value: email), .init(name: "purpose", value: "verify")]
    let (mail, _) = try await URLSession.shared.data(from: parts.url!)
    struct Mail: Decodable { let url: URL }
    let link = try JSONDecoder().decode(Mail.self, from: mail).url
    let (_, response) = try await URLSession.shared.data(from: link)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    return (email, password)
  }
}
private final class TestCredentialStore: SessionCredentialStore {
  var token: String?
  func read() throws -> String? { token }
  func save(_ token: String?) throws { self.token = token }
}

@MainActor private final class DiscussionLoadDelegate: NSObject, WKNavigationDelegate {
  var continuation: CheckedContinuation<Void, Error>?
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { continuation?.resume(); continuation = nil }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { continuation?.resume(throwing: error); continuation = nil }
}
