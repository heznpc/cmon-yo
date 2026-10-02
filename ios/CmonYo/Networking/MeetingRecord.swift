import CryptoKit
import Foundation
import Observation

struct MeetingRecord: Decodable, Identifiable, Sendable {
  struct Place: Decodable, Sendable { let id: String; let name: String }
  let id: String
  let title: String
  let description: String
  let sport: String
  let place: Place
  let regionCode: String
  let startsAt: String
  let endsAt: String
  let capacity: Int
  let participantCount: Int
  let status: String
  let version: Int
  let role: String?
  let participationStatus: String?
  var start: Date { Self.date(startsAt) ?? .distantPast }
  var end: Date { Self.date(endsAt) ?? .distantPast }
  var mutable: Bool { status == "open" && start > Date() }
  var stateLabel: String { status == "cancelled" ? "모임 취소" : start <= Date() ? "시작됨" : participantCount >= capacity ? "정원 마감" : "모집 중" }
  var sportLabel: String { ["walking": "걷기", "running": "달리기", "cycling": "자전거"][sport] ?? "알 수 없는 종목" }
  func validate() throws {
    guard validID(id), validFacilityID(place.id),
      validRegionCode(regionCode), regionCode == String(place.id.dropFirst(5).prefix(5)), !title.isEmpty, version > 0, (2...100).contains(capacity),
      (0...capacity).contains(participantCount), ["open", "cancelled"].contains(status),
      Self.date(startsAt) != nil, Self.date(endsAt) != nil, end > start,
      [nil, "host", "participant"].contains(role), [nil, "joined", "cancelled"].contains(participationStatus) else { throw ProductError(status: 0, code: "RESPONSE") }
  }
  static func date(_ value: String) -> Date? {
    let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    guard let d = f.date(from: value), f.string(from: d) == value else { return nil }; return d
  }
  static func iso(_ value: Date) -> String { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f.string(from: value) }
  static func display(_ value: Date) -> String { let f = DateFormatter(); f.locale = Locale(identifier: "ko_KR"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); f.dateStyle = .medium; f.timeStyle = .short; return f.string(from: value) }
}
struct MeetingListResponse: Decodable { let meetups: [MeetingRecord]; let nextPage: Int?; let userId: String? }
struct MeetingRecordResponse: Decodable { let meetup: MeetingRecord }
struct MembershipResponse: Decodable { let userId: String; let role: String?; let version: Int }
struct MeetingCommandResult: Decodable { let id: String? }
struct MeetingDraft: Codable {
  var title = ""
  var description = ""
  var sport = "walking"
  var placeId = ""
  var startsAt = MeetingRecord.iso(Date().addingTimeInterval(86400))
  var endsAt = MeetingRecord.iso(Date().addingTimeInterval(90000))
  var capacity = 6
}
struct MeetingChange: Codable { let action: String; let expectedVersion: Int; var input: MeetingDraft? }

struct PendingMeetingMutation: Codable {
  let key: String
  let owner: String
  let path: String
  let method: String
  let body: Data
}

// Keep one unresolved request per account and endpoint. A new editor cannot
// replace a request whose response was lost, including after process termination.
struct MeetingCommandStore {
  private let directory: URL
  init(directory: URL? = nil) {
    self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appending(path: "MeetingCommands", directoryHint: .isDirectory)
  }
  private func file(owner: String, origin: URL, path: String) -> URL {
    let key = origin.absoluteString + ":" + owner + ":" + path
    let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: digest + ".json")
  }
  func load(owner: String, origin: URL, path: String, method: String) throws -> PendingMeetingMutation? {
    let url = file(owner: owner, origin: origin, path: path)
    guard FileManager.default.fileExists(atPath: url.path) else { return nil }
    let request = try JSONDecoder().decode(PendingMeetingMutation.self, from: Data(contentsOf: url))
    guard request.owner == owner, request.path == path, request.method == method,
      validID(request.key), !request.body.isEmpty else { throw ProductError(status: 0, code: "COMMAND_STORAGE") }
    return request
  }
  func save(_ request: PendingMeetingMutation, origin: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    var folder = directory
    var values = URLResourceValues(); values.isExcludedFromBackup = true
    try folder.setResourceValues(values)
    try JSONEncoder().encode(request).write(to: file(owner: request.owner, origin: origin, path: request.path),
      options: [.atomic, .completeFileProtection])
  }
  func clear(_ request: PendingMeetingMutation, origin: URL) throws {
    // Never remove a newer request reserved by another screen.
    guard let saved = try load(owner: request.owner, origin: origin, path: request.path, method: request.method),
      saved.key == request.key else { return }
    try FileManager.default.removeItem(at: file(owner: request.owner, origin: origin, path: request.path))
  }
}

@MainActor @Observable
final class MeetingCommand {
  private(set) var pending = false
  private(set) var uncertain = false
  var message: String?
  private var request: PendingMeetingMutation?
  private let store: MeetingCommandStore
  init(store: MeetingCommandStore = MeetingCommandStore()) { self.store = store }
  var recoveryDraft: MeetingDraft? {
    guard let request else { return nil }
    if request.method == "POST" { return try? JSONDecoder().decode(MeetingDraft.self, from: request.body) }
    return (try? JSONDecoder().decode(MeetingChange.self, from: request.body))?.input
  }

  func restore(session: AccountSession, path: String, method: String) async -> String? {
    guard !pending, let owner = session.user?.id else { return nil }
    do {
      request = try store.load(owner: owner, origin: session.baseURL, path: path, method: method)
      uncertain = request != nil
      message = nil
      if uncertain { return await inspect(session: session) }
    } catch {
      message = "저장된 요청을 읽지 못했습니다. 기기 잠금을 해제한 뒤 다시 확인해 주세요."
    }
    return nil
  }

  func run(session: AccountSession, path: String, method: String, body: Data) async -> String? {
    guard !pending, !uncertain, let owner = session.user?.id else { return nil }
    do {
      if let saved = try store.load(owner: owner, origin: session.baseURL, path: path, method: method) {
        request = saved; uncertain = true
        message = "아직 결과를 확인하지 못한 요청이 있습니다. 저장된 요청의 처리 상태를 먼저 확인해 주세요."
        return nil
      }
      let next = PendingMeetingMutation(key: UUID().uuidString.lowercased(), owner: owner, path: path, method: method, body: body)
      // A failed write must prevent the first network mutation.
      try store.save(next, origin: session.baseURL)
      request = next
    } catch {
      message = "요청을 안전하게 저장하지 못했습니다. 기기 잠금을 해제한 뒤 다시 시도해 주세요."
      return nil
    }
    return await send(session: session)
  }
  func send(session: AccountSession) async -> String? {
    guard !pending, let request, request.owner == session.user?.id else { return nil }
    let generation = session.generation
    pending = true; message = nil
    defer { pending = false }
    do {
      let result: MeetingCommandResult = try await session.request(request.path, method: request.method, body: request.body, commandID: request.key)
      guard session.generation == generation else { return nil }
      guard let id = result.id, validID(id) else { throw ProductError(status: 0, code: "RESPONSE") }
      try store.clear(request, origin: session.baseURL)
      self.request = nil; uncertain = false; return id
    } catch is CancellationError {
      guard session.generation == generation else { return nil }
      // Cancellation stops the response wait, not a mutation already accepted by the server.
      uncertain = true
      message = "응답을 확인하지 못했습니다. 처리되었을 수 있으니 요청 처리 상태를 확인해 주세요."
      return nil
    }
    catch {
      guard session.generation == generation else { return nil }
      let error = error as? ProductError
      uncertain = error == nil || error!.status == 0 || error!.status == 408 || error!.status >= 500 || error!.code == "COMMAND_CONFLICT"
      if !uncertain {
        do { try store.clear(request, origin: session.baseURL); self.request = nil }
        catch { uncertain = true }
      }
      message = uncertain ? "응답을 확인하지 못했습니다. 처리되었을 수 있으니 현재 상태를 확인해 주세요." : error?.localizedDescription
      return nil
    }
  }
  func inspect(session: AccountSession) async -> String? {
    guard !pending, uncertain, let request, request.owner == session.user?.id else { return nil }
    let generation = session.generation
    pending = true; defer { pending = false }
    do {
      let result: MeetingCommandResult = try await session.request("api/v1/me/commands/\(request.key)")
      guard session.generation == generation else { return nil }
      if let id = result.id {
        guard validID(id) else { throw ProductError(status: 0, code: "RESPONSE") }
        try store.clear(request, origin: session.baseURL)
        self.request = nil; uncertain = false; message = nil; return id
      }
      message = "아직 처리 결과가 없습니다. 같은 요청을 다시 보내거나 내 모임에서 확인해 주세요."
    } catch is CancellationError { return nil }
    catch { if session.generation == generation { message = error.localizedDescription } }
    return nil
  }
}
