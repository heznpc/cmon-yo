import Foundation
import Observation

@MainActor
protocol WalkingTransport: AnyObject {
  var walkingUserID: String? { get }
  var walkingGeneration: Int { get }
  var walkingOrigin: URL { get }
  func walkingDashboard() async throws -> WalkingDashboard
  func sendWalking(_ payload: WalkingMutation, key: String) async throws -> WalkingReceipt
  func walkingReceipt(key: String) async throws -> WalkingReceipt
}

extension AccountSession: WalkingTransport {
  var walkingUserID: String? { user?.id.lowercased() }
  var walkingGeneration: Int { generation }
  var walkingOrigin: URL { baseURL }
  func walkingDashboard() async throws -> WalkingDashboard { try await request("api/v1/me/walking") }
  func sendWalking(_ payload: WalkingMutation, key: String) async throws -> WalkingReceipt {
    try await request("api/v1/walking/commands", method: "POST", body: payload.body(), commandID: key)
  }
  func walkingReceipt(key: String) async throws -> WalkingReceipt {
    try await request("api/v1/me/walking-commands/\(key)")
  }
}

@MainActor @Observable
final class WalkingSyncService {
  private(set) var dashboard: WalkingDashboard?
  private(set) var localDays: [HealthWalkingDay] = []
  private(set) var busy = false
  private(set) var message: String?
  private(set) var healthMessage = "건강 앱의 걸음 수 읽기를 연결해 주세요."
  private(set) var journal: WalkingJournal?
  private(set) var deviceID: String?
  private(set) var owner: String?
  private(set) var lastSync: Date?
  private var generation = -1
  private var activation = 0
  private weak var transport: (any WalkingTransport)?
  private let health: any WalkingHealthProvider
  private let storage: any WalkingJournalStore

  init(health: any WalkingHealthProvider = HealthStepProvider(), storage: any WalkingJournalStore = FileWalkingJournalStore()) {
    self.health = health
    self.storage = storage
  }
  var healthAvailable: Bool { health.available }
  var pending: PendingWalkingMutation? { journal?.pending }
  var today: String { dashboard?.today ?? WalkingCalendar.day(Date()) }
  var todaySteps: Int? { localDays.first(where: { $0.day == today })?.steps }
  var serverToday: WalkingDayRecord? { dashboard?.days.first(where: { $0.day == today }) }
  var connectedHere: Bool {
    guard let source = journal?.sourceId, let dashboard else { return false }
    return source == dashboard.sourceId?.lowercased() && deviceID == dashboard.sourceDeviceId?.lowercased()
  }

  // The session supplies authentication only. No WebKit instance or cookie preparation is needed.
  func activate(_ transport: any WalkingTransport) async {
    let nextOwner = transport.walkingUserID
    if owner != nextOwner || generation != transport.walkingGeneration || self.transport?.walkingOrigin != transport.walkingOrigin
      || (nextOwner != nil && journal == nil) {
      health.stop()
      activation += 1
      self.transport = transport
      owner = nextOwner
      generation = transport.walkingGeneration
      dashboard = nil; localDays = []; journal = nil; deviceID = nil; lastSync = nil; busy = false; message = nil
      healthMessage = "건강 앱의 걸음 수 읽기를 연결해 주세요."
      guard let nextOwner else { return }
      do {
        deviceID = try storage.deviceID(origin: transport.walkingOrigin)
        journal = try storage.load(owner: nextOwner, origin: transport.walkingOrigin)
      } catch {
        message = "이 계정의 동기화 기록을 읽지 못했습니다. 기기 잠금을 해제하고 다시 확인해 주세요."
        return
      }
    }
    startObserving()
    await reconcile()
  }

  private func current(_ epoch: Int, _ account: String) -> Bool {
    matches(epoch, account) && !Task.isCancelled
  }

  private func matches(_ epoch: Int, _ account: String) -> Bool {
    activation == epoch && owner == account && transport?.walkingGeneration == generation
      && transport?.walkingUserID == account
  }

  private func startObserving() {
    guard owner != nil, journal != nil else { return }
    let epoch = activation, account = owner!
    health.observe { [weak self] in
      guard let self, self.current(epoch, account) else { return }
      await self.reconcile()
    }
  }

  // An unresolved command is only looked up. A new HealthKit batch may be uploaded
  // automatically after reconciliation, but an uncertain mutation is never replayed here.
  func reconcile() async {
    guard !busy, let account = owner, journal != nil, let transport else { return }
    let epoch = activation
    busy = true
    if pending == nil { message = nil }
    defer { if matches(epoch, account) { busy = false } }
    do {
      if pending != nil { try await inspectPending(transport, epoch: epoch, account: account) }
      try await refresh(transport, epoch: epoch, account: account)
      guard current(epoch, account), health.requested, connectedHere else { return }
      try await readHealth(epoch: epoch, account: account)
      guard pending == nil, connectedHere else { return }
      try await uploadNewBatch(transport, epoch: epoch, account: account)
    } catch is CancellationError { return }
    catch { if current(epoch, account) { message = describe(error) } }
  }

  func connect() async {
    guard !busy, pending == nil, let account = owner, journal != nil, let deviceID, let transport else { return }
    let epoch = activation
    busy = true; message = nil
    defer { if matches(epoch, account) { busy = false } }
    do {
      try await health.requestReadAccess()
      guard current(epoch, account) else { throw CancellationError() }
      healthMessage = "읽기 요청을 마쳤습니다. 실제 걸음 기록이 있는지 확인합니다."
      startObserving()
      try await refresh(transport, epoch: epoch, account: account)
      if !connectedHere {
        try reserve(WalkingMutation(action: .bindHealth, deviceId: deviceID), transport: transport)
        try await sendPending(transport, epoch: epoch, account: account)
        try await refresh(transport, epoch: epoch, account: account)
      }
      try await readHealth(epoch: epoch, account: account)
      guard pending == nil, connectedHere else { return }
      try await uploadNewBatch(transport, epoch: epoch, account: account)
    } catch is CancellationError { return }
    catch { if current(epoch, account) { message = describe(error) } }
  }

  func inspect() async {
    guard !busy, pending != nil, let account = owner, let transport else { return }
    let epoch = activation
    busy = true
    defer { if matches(epoch, account) { busy = false } }
    do {
      try await inspectPending(transport, epoch: epoch, account: account)
      try await refresh(transport, epoch: epoch, account: account)
    } catch is CancellationError { return }
    catch { if current(epoch, account) { message = describe(error) } }
  }

  // This method is called only by the explicit retry button. Stored key and body are unchanged.
  func retryPending() async {
    guard !busy, pending != nil, let account = owner, let transport else { return }
    let epoch = activation
    busy = true
    defer { if matches(epoch, account) { busy = false } }
    do {
      try await sendPending(transport, epoch: epoch, account: account)
      try await refresh(transport, epoch: epoch, account: account)
    } catch is CancellationError { return }
    catch { if current(epoch, account) { message = describe(error) } }
  }

  private func refresh(_ transport: any WalkingTransport, epoch: Int, account: String) async throws {
    let result = try await transport.walkingDashboard()
    guard current(epoch, account) else { throw CancellationError() }
    try result.validate(owner: account)
    dashboard = result
    // The server revision permits recovery after local journal loss. Never adopt
    // a source owned by another device, nor change a reserved batch's revision.
    if var next = journal, next.pending == nil, result.sourceDeviceId?.lowercased() == deviceID,
      let source = result.sourceId {
      let revision = result.sourceRevision
      let sameSource = next.sourceId?.lowercased() == source.lowercased()
      next.sourceId = source.lowercased()
      next.revision = sameSource ? max(next.revision, revision) : revision
      try storage.save(next, origin: transport.walkingOrigin)
      journal = next
    }
  }

  private func readHealth(epoch: Int, account: String) async throws {
    let days = try await health.readDays(now: Date())
    guard current(epoch, account) else { throw CancellationError() }
    localDays = days
    healthMessage = days.isEmpty
      ? "읽을 수 있는 걸음 기록이 없습니다. 0걸음으로 처리하지 않습니다. 건강 앱에서 기록과 읽기 설정을 확인해 주세요."
      : "건강 앱의 걸음 기록을 확인했습니다. 서울 날짜 기준으로 반영합니다."
  }

  private func uploadNewBatch(_ transport: any WalkingTransport, epoch: Int, account: String) async throws {
    guard current(epoch, account), var next = journal, next.pending == nil, let source = next.sourceId,
      !localDays.isEmpty else { return }
    guard WalkingCalendar.validate(localDays, now: Date()), next.revision < 9_007_199_254_740_991 else {
      throw ProductError(status: 0, code: "HEALTH_RANGE")
    }
    // Avoid uploading unchanged reads at every observer delivery or foreground entry.
    let changed = localDays.contains { day in dashboard?.days.first(where: { $0.day == day.day })?.steps != day.steps }
    guard changed else { return }
    let payload = WalkingMutation(action: .syncHealth, sourceId: source, revision: next.revision + 1, days: localDays)
    try next.reserve(payload, now: Date())
    try storage.save(next, origin: transport.walkingOrigin)
    journal = next
    try await sendPending(transport, epoch: epoch, account: account)
    try await refresh(transport, epoch: epoch, account: account)
  }

  private func reserve(_ payload: WalkingMutation, transport: any WalkingTransport) throws {
    guard var next = journal else { throw ProductError(status: 0, code: "WALKING_STORAGE") }
    try next.reserve(payload, now: Date())
    // Persistence must succeed before the first bind request as well as every sync request.
    try storage.save(next, origin: transport.walkingOrigin)
    journal = next
  }

  private func sendPending(_ transport: any WalkingTransport, epoch: Int, account: String) async throws {
    guard current(epoch, account), let pending else { throw CancellationError() }
    message = "건강 연결·걸음 반영 결과를 확인하는 중입니다."
    do {
      let result = try await transport.sendWalking(pending.payload, key: pending.key)
      guard current(epoch, account), journal?.pending?.key == pending.key else { throw CancellationError() }
      guard let id = result.id else { throw ProductError(status: 0, code: "RESPONSE") }
      try acknowledge(id, transport: transport)
      message = "서버 반영을 확인했습니다."
    } catch {
      guard current(epoch, account) else { throw CancellationError() }
      if let failure = error as? ProductError, (400..<500).contains(failure.status),
        ![401, 408, 429].contains(failure.status), failure.code != "COMMAND_CONFLICT", var next = journal {
        // A definite command rejection is not an unknown outcome. Keep the
        // consumed revision, but permit a newly read batch or explicit rebind.
        next.pending = nil
        try storage.save(next, origin: transport.walkingOrigin)
        journal = next
      }
      throw error
    }
  }

  private func inspectPending(_ transport: any WalkingTransport, epoch: Int, account: String) async throws {
    guard let pending else { return }
    let receipt = try await transport.walkingReceipt(key: pending.key)
    guard current(epoch, account), journal?.pending?.key == pending.key else { throw CancellationError() }
    if let id = receipt.id {
      try acknowledge(id, transport: transport)
      message = "저장된 요청의 반영을 확인했습니다."
    } else {
      message = "아직 처리 결과가 없습니다. 결과를 다시 조회하거나 같은 요청을 명시적으로 다시 보내 주세요."
    }
  }

  private func acknowledge(_ id: String, transport: any WalkingTransport) throws {
    guard var next = journal else { throw ProductError(status: 0, code: "WALKING_STORAGE") }
    let wasSync = next.pending?.payload.action == .syncHealth
    try next.acknowledge(id)
    try storage.save(next, origin: transport.walkingOrigin)
    journal = next
    if wasSync { lastSync = Date() }
  }

  private func describe(_ error: Error) -> String {
    if pending != nil { return "응답을 확인하지 못했습니다. 처리되었을 수 있으니 결과를 조회해 주세요. 같은 요청은 직접 다시 보낼 때만 전송합니다." }
    switch (error as? ProductError)?.code {
    case "HEALTH_UNAVAILABLE": return "이 기기에서는 건강 데이터를 사용할 수 없습니다."
    case "HEALTH_RANGE": return "걸음 기록의 날짜나 수치를 확인하지 못했습니다. 건강 앱 기록을 확인한 뒤 다시 동기화해 주세요."
    case "WALKING_STORAGE": return "기기의 동기화 기록에 접근하지 못했습니다. 잠금을 해제하고 다시 확인해 주세요."
    case "UNAUTHENTICATED": return "다시 로그인한 뒤 건강 연결을 확인해 주세요."
    case "DEVICE_BOUND": return "이 기기는 다른 계정에 연결되어 있습니다. 건강 기록을 연결했던 계정으로 로그인해 주세요."
    case "SOURCE_CHANGED": return "건강 연결이 변경되었습니다. 현재 상태를 확인하고 이 기기를 다시 연결해 주세요."
    case "STALE_REVISION", "REVISION_CONFLICT": return "더 최신 걸음 기록이 있거나 기록 번호가 달라졌습니다. 현재 상태를 조회한 뒤 새로 동기화해 주세요."
    case "DAY_OUT_OF_RANGE": return "저장된 요청의 날짜가 반영 기간을 지났습니다. 최근 걸음 기록을 새로 동기화해 주세요."
    default: return "걷기 정보를 확인하지 못했습니다. 계정과 연결을 확인한 뒤 다시 시도해 주세요."
    }
  }
}
