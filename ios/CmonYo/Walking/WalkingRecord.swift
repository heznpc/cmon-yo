import Foundation

struct HealthWalkingDay: Codable, Equatable, Sendable {
  let day: String
  let steps: Int
}

enum WalkingCalendar {
  static var seoul: Calendar {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return calendar
  }
  static func day(_ date: Date) -> String {
    let parts = seoul.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
  }
  static func date(_ day: String) -> Date? {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.calendar = seoul
    formatter.timeZone = seoul.timeZone
    formatter.dateFormat = "yyyy-MM-dd"
    formatter.isLenient = false
    guard let date = formatter.date(from: day), self.day(date) == day else { return nil }
    return date
  }
  static func start(now: Date) -> Date {
    seoul.date(byAdding: .day, value: -7, to: seoul.startOfDay(for: now))!
  }
  static func validate(_ days: [HealthWalkingDay], now: Date) -> Bool {
    let first = day(start(now: now)), last = day(now)
    return !days.isEmpty && days.count <= 8 && Set(days.map(\.day)).count == days.count
      && days.allSatisfy { date($0.day) != nil && $0.day >= first && $0.day <= last && (0...100_000).contains($0.steps) }
  }
}

struct WalkingDayRecord: Decodable, Sendable {
  let day: String
  let steps: Int
  let creditedSteps: Int
  let availablePoints: Int
  let claimedPoints: Int
  let updatedAt: String
}

struct WalkingDashboard: Decodable, Sendable {
  let userId: String
  let today: String
  let timezone: String
  let sourceId: String?
  let sourceDeviceId: String?
  let sourceRevision: Int
  let dailyCap: Int
  let stepsPerPoint: Int
  let balance: Int
  let days: [WalkingDayRecord]

  func validate(owner: String) throws {
    guard userId.lowercased() == owner, UUID(uuidString: userId) != nil,
      timezone == "Asia/Seoul", WalkingCalendar.date(today) != nil,
      sourceId.map({ UUID(uuidString: $0) != nil }) ?? true,
      sourceDeviceId.map({ UUID(uuidString: $0) != nil }) ?? true,
      (sourceId == nil) == (sourceDeviceId == nil),
      (0...9_007_199_254_740_991).contains(sourceRevision),
      sourceId != nil || sourceRevision == 0,
      dailyCap == 10_000, stepsPerPoint == 1_000, balance >= 0,
      days.allSatisfy({ WalkingCalendar.date($0.day) != nil && $0.steps >= 0
        && (0...dailyCap).contains($0.creditedSteps) && $0.availablePoints >= 0 && $0.claimedPoints >= 0 })
    else { throw ProductError(status: 0, code: "RESPONSE") }
  }
}

struct WalkingReceipt: Decodable, Sendable { let id: String? }

struct WalkingMutation: Codable, Equatable, Sendable {
  enum Action: String, Codable, Sendable { case bindHealth, syncHealth }
  let action: Action
  var deviceId: String?
  var sourceId: String?
  var revision: Int?
  var days: [HealthWalkingDay]?

  func body() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(self)
  }
}

struct PendingWalkingMutation: Codable, Equatable, Sendable {
  let key: String
  let payload: WalkingMutation
  let createdAt: Date
}

struct WalkingJournal: Codable, Equatable, Sendable {
  let owner: String
  var sourceId: String?
  var revision = 0
  var pending: PendingWalkingMutation?

  mutating func reserve(_ payload: WalkingMutation, now: Date) throws {
    guard pending == nil else { throw ProductError(status: 0, code: "WALKING_PENDING") }
    pending = PendingWalkingMutation(key: UUID().uuidString.lowercased(), payload: payload, createdAt: now)
    if let next = payload.revision { revision = next }
  }

  mutating func acknowledge(_ id: String) throws {
    guard UUID(uuidString: id) != nil, let pending else { throw ProductError(status: 0, code: "RESPONSE") }
    if pending.payload.action == .bindHealth {
      sourceId = id.lowercased()
      revision = 0
    }
    self.pending = nil
  }
}
