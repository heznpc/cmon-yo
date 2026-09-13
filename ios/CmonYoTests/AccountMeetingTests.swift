import XCTest
@testable import CmonYo

@MainActor
final class AccountMeetingTests: XCTestCase {
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
