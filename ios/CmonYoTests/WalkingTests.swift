import XCTest
@testable import CmonYo

@MainActor
final class WalkingTests: XCTestCase {
  private let account = "11111111-1111-4111-8111-111111111111"
  private let other = "22222222-2222-4222-8222-222222222222"
  private let source = "33333333-3333-4333-8333-333333333333"

  func testSeoulWindowIncludesEightDatesAndRejectsDuplicateOrFutureDays() throws {
    let now = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-09-22T15:05:00Z"))
    XCTAssertEqual(WalkingCalendar.day(now), "2026-09-23")
    XCTAssertEqual(WalkingCalendar.day(WalkingCalendar.start(now: now)), "2026-09-16")
    XCTAssertTrue(WalkingCalendar.validate([.init(day: "2026-09-16", steps: 100_000), .init(day: "2026-09-23", steps: 0)], now: now))
    XCTAssertFalse(WalkingCalendar.validate([], now: now))
    XCTAssertFalse(WalkingCalendar.validate([.init(day: "2026-09-24", steps: 10)], now: now))
    XCTAssertFalse(WalkingCalendar.validate([.init(day: "2026-09-15", steps: 10)], now: now))
    XCTAssertFalse(WalkingCalendar.validate([.init(day: "2026-09-23", steps: 1), .init(day: "2026-09-23", steps: 2)], now: now))
    XCTAssertFalse(WalkingCalendar.validate([.init(day: "2026-09-23", steps: 100_001)], now: now))
    XCTAssertNil(WalkingCalendar.date("2026-02-30"))
  }

  func testFirstBindIsPersistedBeforeSendAndRestartDoesNotReplayIt() async throws {
    let storage = MemoryWalkingStorage()
    let health = TestWalkingHealth()
    let api = TestWalkingTransport(owner: account)
    api.failure = ProductError(status: 0, code: "NETWORK")
    api.beforeSend = { _, key in
      XCTAssertEqual(storage.journals[self.account]?.pending?.key, key)
      XCTAssertEqual(storage.journals[self.account]?.pending?.payload.action, .bindHealth)
    }
    let service = WalkingSyncService(health: health, storage: storage)
    await service.activate(api)
    await service.connect()
    let saved = try XCTUnwrap(service.pending)
    XCTAssertEqual(saved.key, saved.key.lowercased())
    XCTAssertEqual(api.sent.count, 1)

    let restarted = WalkingSyncService(health: health, storage: storage)
    await restarted.activate(api)
    XCTAssertEqual(api.sent.count, 1, "Startup may inspect an unknown bind but must not repeat it.")
    XCTAssertEqual(api.lookedUp, [saved.key])
    XCTAssertEqual(restarted.pending, saved)
    await restarted.retryPending()
    XCTAssertEqual(api.sent.count, 2)
    XCTAssertEqual(api.sent[0].key, api.sent[1].key)
    XCTAssertEqual(try api.sent[0].payload.body(), try api.sent[1].payload.body())
  }

  func testReceiptAcknowledgesUnknownBindWithoutSendingAndEmptyHealthIsNotZero() async throws {
    let storage = MemoryWalkingStorage()
    var journal = WalkingJournal(owner: account)
    try journal.reserve(.init(action: .bindHealth, deviceId: storage.device), now: Date())
    storage.journals[account] = journal
    let api = TestWalkingTransport(owner: account)
    api.receiptID = source
    api.sourceID = source; api.deviceID = storage.device
    let health = TestWalkingHealth()
    health.requested = true; health.days = []
    let service = WalkingSyncService(health: health, storage: storage)
    await service.activate(api)
    XCTAssertNil(service.pending)
    XCTAssertEqual(service.journal?.sourceId, source)
    XCTAssertEqual(api.sent.count, 0)
    XCTAssertNil(service.todaySteps)
    XCTAssertTrue(service.healthMessage.contains("0걸음으로 처리하지 않습니다"))
  }

  func testRevisionRecoveryAndUncertainBatchKeepIdenticalBodyOnRetry() async throws {
    let storage = MemoryWalkingStorage()
    let api = TestWalkingTransport(owner: account)
    api.sourceID = source; api.deviceID = storage.device; api.sourceRevision = 42
    api.failure = ProductError(status: 503, code: "UNAVAILABLE")
    let health = TestWalkingHealth()
    health.requested = true
    health.days = [.init(day: WalkingCalendar.day(Date()), steps: 4321)]
    let service = WalkingSyncService(health: health, storage: storage)
    await service.activate(api)
    let saved = try XCTUnwrap(service.pending)
    XCTAssertEqual(saved.payload.revision, 43)
    XCTAssertEqual(storage.journals[account]?.revision, 43)
    await service.reconcile()
    XCTAssertEqual(api.sent.count, 1)
    XCTAssertEqual(service.pending, saved)
    await service.retryPending()
    XCTAssertEqual(api.sent.count, 2)
    XCTAssertEqual(api.sent[0].payload, api.sent[1].payload)
    XCTAssertEqual(api.sent[0].key, api.sent[1].key)
  }

  func testReplacedHealthSourceDoesNotInheritPreviousSourcesRevision() async throws {
    let storage = MemoryWalkingStorage()
    var journal = WalkingJournal(owner: account)
    journal.sourceId = other; journal.revision = 900
    storage.journals[account] = journal
    let api = TestWalkingTransport(owner: account)
    api.sourceID = source; api.deviceID = storage.device; api.sourceRevision = 4
    let service = WalkingSyncService(health: TestWalkingHealth(), storage: storage)
    await service.activate(api)
    XCTAssertEqual(service.journal?.sourceId, source)
    XCTAssertEqual(service.journal?.revision, 4)
  }

  func testConflictRetainsUnknownAndStorageFailurePreventsFirstMutation() async throws {
    let storage = MemoryWalkingStorage()
    let api = TestWalkingTransport(owner: account)
    api.failure = ProductError(status: 409, code: "COMMAND_CONFLICT")
    let service = WalkingSyncService(health: TestWalkingHealth(), storage: storage)
    await service.activate(api)
    await service.connect()
    XCTAssertNotNil(service.pending)
    await service.inspect()
    XCTAssertEqual(api.sent.count, 1)
    XCTAssertEqual(api.lookedUp.count, 1)

    let broken = MemoryWalkingStorage()
    broken.failSave = true
    let secondAPI = TestWalkingTransport(owner: other)
    let second = WalkingSyncService(health: TestWalkingHealth(), storage: broken)
    await second.activate(secondAPI)
    await second.connect()
    XCTAssertEqual(secondAPI.sent.count, 0, "Persistence must precede even the first source binding.")
  }

  func testAccountSwitchDoesNotReplayOrShowOldPending() async throws {
    let storage = MemoryWalkingStorage()
    let api = TestWalkingTransport(owner: account)
    api.failure = ProductError(status: 0, code: "NETWORK")
    let health = TestWalkingHealth()
    let service = WalkingSyncService(health: health, storage: storage)
    await service.activate(api)
    await service.connect()
    let pending = try XCTUnwrap(storage.journals[account]?.pending)
    api.walkingUserID = other; api.walkingGeneration += 1
    await service.activate(api)
    XCTAssertEqual(service.owner, other)
    XCTAssertNil(service.pending)
    XCTAssertEqual(storage.journals[account]?.pending, pending)
    await service.retryPending()
    XCTAssertEqual(api.sent.count, 1)
    XCTAssertTrue(health.stopped > 0)
  }

  func testGenerationChangeDuringSendCannotAcknowledgeOldAccount() async throws {
    let storage = MemoryWalkingStorage()
    let api = TestWalkingTransport(owner: account)
    api.successID = source
    api.beforeSend = { _, _ in api.walkingUserID = self.other; api.walkingGeneration += 1 }
    let service = WalkingSyncService(health: TestWalkingHealth(), storage: storage)
    await service.activate(api)
    await service.connect()
    XCTAssertNotNil(storage.journals[account]?.pending)
    XCTAssertNil(storage.journals[account]?.sourceId)
    await service.activate(api)
    XCTAssertEqual(service.owner, other)
    XCTAssertNil(service.pending)
  }

  func testJournalCannotReplaceUnresolvedCommand() throws {
    var journal = WalkingJournal(owner: account)
    try journal.reserve(.init(action: .bindHealth, deviceId: other), now: Date())
    let before = journal
    XCTAssertThrowsError(try journal.reserve(.init(action: .bindHealth, deviceId: source), now: Date()))
    XCTAssertEqual(journal, before)
    let restored = try JSONDecoder().decode(WalkingJournal.self, from: JSONEncoder().encode(journal))
    XCTAssertEqual(restored, journal)
  }

  func testSyncReceiptCannotAcknowledgeAnotherHealthSource() throws {
    var journal = WalkingJournal(owner: account)
    journal.sourceId = source
    try journal.reserve(.init(action: .syncHealth, sourceId: source, revision: 1,
      days: [.init(day: WalkingCalendar.day(Date()), steps: 123)]), now: Date())
    let pending = journal.pending
    XCTAssertThrowsError(try journal.acknowledge(other))
    XCTAssertEqual(journal.pending, pending)
    try journal.acknowledge(source)
    XCTAssertNil(journal.pending)
  }

  func testProtectedJournalSurvivesRecreationAndPartitionsAccountAndOrigin() throws {
    let directory = FileManager.default.temporaryDirectory.appending(path: UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: directory) }
    let origin = URL(string: "https://example.test")!
    let otherOrigin = URL(string: "https://other.example.test")!
    let store = FileWalkingJournalStore(directory: directory)
    let device = try store.deviceID(origin: origin)
    XCTAssertEqual(device, try store.deviceID(origin: origin))
    XCTAssertNotEqual(device, try store.deviceID(origin: otherOrigin))
    var journal = WalkingJournal(owner: account)
    try journal.reserve(.init(action: .bindHealth, deviceId: device), now: Date())
    try store.save(journal, origin: origin)
    let reopened = FileWalkingJournalStore(directory: directory)
    XCTAssertEqual(try reopened.load(owner: account, origin: origin), journal)
    XCTAssertNil(try reopened.load(owner: other, origin: origin).pending)
    XCTAssertNil(try reopened.load(owner: account, origin: otherOrigin).pending)
  }

  func testInitialKeychainReadFailureCanRecoverAfterUnlockWithoutRepeatedReads() async throws {
    let vault = InitiallyLockedWalkingVault()
    let session = AccountSession(baseURL: URL(string: "https://example.test")!, credentialStore: vault)
    await session.restore()
    XCTAssertEqual(vault.reads, 1)
    XCTAssertFalse(session.restoring)
    try await session.refreshAccount()
    XCTAssertEqual(vault.reads, 2)
    try await session.refreshAccount()
    XCTAssertEqual(vault.reads, 2)
    XCTAssertNil(session.user)
  }

  func testQuestsHostBlocksSubframesAndOffersExplicitBrowserForOtherRoutes() throws {
    let policy = QuestsNavigationPolicy(origin: URL(string: "https://example.test")!)
    let quests = URL(string: "https://example.test/quests?surface=native")!
    XCTAssertEqual(policy.decide(url: quests, sourceIsMain: true, targetIsMain: true, userLink: false), .owned)
    XCTAssertEqual(policy.decide(url: quests, sourceIsMain: false, targetIsMain: true, userLink: true), .blocked)
    XCTAssertEqual(policy.decide(url: URL(string: "https://example.test:444/quests")!, sourceIsMain: true, targetIsMain: true, userLink: false), .blocked)
    XCTAssertEqual(policy.decide(url: URL(string: "https://example.test/community")!, sourceIsMain: true, targetIsMain: false, userLink: true), .offerBrowser)
    XCTAssertEqual(policy.decide(url: URL(string: "https://elsewhere.test/")!, sourceIsMain: true, targetIsMain: true, userLink: false), .blocked)
    XCTAssertEqual(policy.decide(url: URL(string: "https://elsewhere.test/")!, sourceIsMain: true, targetIsMain: false, userLink: true), .offerBrowser)
    XCTAssertEqual(policy.decide(url: URL(string: "javascript:alert(1)")!, sourceIsMain: true, targetIsMain: true, userLink: true), .blocked)
    XCTAssertFalse(policy.owned(URL(string: "https://user:password@example.test/quests")!))
  }
}

private final class InitiallyLockedWalkingVault: SessionCredentialStore {
  var reads = 0
  func read() throws -> String? {
    reads += 1
    if reads == 1 { throw ProductError(status: 0, code: "KEYCHAIN") }
    return nil
  }
  func save(_ token: String?) throws {}
}

@MainActor
private final class TestWalkingHealth: WalkingHealthProvider {
  var available = true
  var requested = false
  var days: [HealthWalkingDay] = []
  var stopped = 0
  func requestReadAccess() async throws { requested = true }
  func readDays(now: Date) async throws -> [HealthWalkingDay] { days }
  func observe(_ changed: @escaping @MainActor @Sendable () async -> Void) {}
  func stop() { stopped += 1 }
}

@MainActor
private final class MemoryWalkingStorage: WalkingJournalStore {
  let device = "44444444-4444-4444-8444-444444444444"
  var journals: [String: WalkingJournal] = [:]
  var failSave = false
  func deviceID(origin: URL) throws -> String { device }
  func load(owner: String, origin: URL) throws -> WalkingJournal { journals[owner] ?? WalkingJournal(owner: owner) }
  func save(_ journal: WalkingJournal, origin: URL) throws {
    if failSave { throw ProductError(status: 0, code: "WALKING_STORAGE") }
    journals[journal.owner] = journal
  }
}

@MainActor
private final class TestWalkingTransport: WalkingTransport {
  var walkingUserID: String?
  var walkingGeneration = 0
  let walkingOrigin = URL(string: "https://example.test")!
  var sourceID: String?
  var deviceID: String?
  var sourceRevision = 0
  var receiptID: String?
  var successID: String?
  var failure: Error?
  var sent: [(payload: WalkingMutation, key: String)] = []
  var lookedUp: [String] = []
  var beforeSend: ((WalkingMutation, String) -> Void)?
  init(owner: String) { walkingUserID = owner }
  func walkingDashboard() async throws -> WalkingDashboard {
    WalkingDashboard(userId: walkingUserID!, today: WalkingCalendar.day(Date()), timezone: "Asia/Seoul",
      sourceId: sourceID, sourceDeviceId: deviceID, sourceRevision: sourceRevision,
      dailyCap: 10_000, stepsPerPoint: 1_000, balance: 0, days: [])
  }
  func sendWalking(_ payload: WalkingMutation, key: String) async throws -> WalkingReceipt {
    beforeSend?(payload, key)
    sent.append((payload, key))
    if let failure { throw failure }
    return WalkingReceipt(id: successID)
  }
  func walkingReceipt(key: String) async throws -> WalkingReceipt {
    lookedUp.append(key)
    return WalkingReceipt(id: receiptID)
  }
}
