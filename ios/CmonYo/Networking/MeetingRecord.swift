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
    guard validID(id), place.id.range(of: "^park-46840-[0-9]{5}$", options: .regularExpression) != nil,
      regionCode == "46840", !title.isEmpty, version > 0, (2...100).contains(capacity),
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
struct MeetingChange: Encodable { let action: String; let expectedVersion: Int; var input: MeetingDraft? }

@MainActor @Observable
final class MeetingCommand {
  private(set) var pending = false
  private(set) var uncertain = false
  var message: String?
  private var key = UUID().uuidString
  private var path = ""
  private var method = ""
  private var body: Data?
  private var owner: String?
  func run(session: AccountSession, path: String, method: String, body: Data) async -> String? {
    guard !pending, !uncertain else { return nil }
    self.path = path; self.method = method; self.body = body; owner = session.user?.id; key = UUID().uuidString
    return await send(session: session)
  }
  func send(session: AccountSession) async -> String? {
    guard !pending, owner == session.user?.id, owner != nil else { return nil }
    let generation = session.generation
    pending = true; message = nil
    defer { pending = false }
    do {
      let result: MeetingCommandResult = try await session.request(path, method: method, body: body, commandID: key)
      guard session.generation == generation, let id = result.id, validID(id) else { return nil }
      uncertain = false; return id
    } catch is CancellationError { return nil }
    catch {
      guard session.generation == generation else { return nil }
      let error = error as? ProductError
      uncertain = error == nil || error!.status == 0 || error!.status >= 500
      message = uncertain ? "응답을 확인하지 못했습니다. 처리되었을 수 있으니 현재 상태를 확인해 주세요." : error?.localizedDescription
      return nil
    }
  }
  func inspect(session: AccountSession) async -> String? {
    guard !pending, uncertain, owner == session.user?.id else { return nil }
    pending = true; defer { pending = false }
    do {
      let result: MeetingCommandResult = try await session.request("api/v1/me/commands/\(key)")
      if let id = result.id { uncertain = false; message = nil; return id }
      message = "아직 처리 결과가 없습니다. 같은 요청을 다시 보내거나 내 모임에서 확인해 주세요."
    } catch is CancellationError { return nil }
    catch { message = error.localizedDescription }
    return nil
  }
}
