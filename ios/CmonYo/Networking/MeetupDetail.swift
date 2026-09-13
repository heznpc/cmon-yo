import Foundation

enum ContractError: Error { case invalid }
func validID(_ value: String) -> Bool {
  value.range(
    of: "^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    options: [.regularExpression, .caseInsensitive]) != nil
}
func utcDate(_ value: String) throws -> Date {
  guard
    value.range(
      of: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$", options: .regularExpression)
      != nil
  else { throw ContractError.invalid }
  let formatter = DateFormatter()
  formatter.locale = Locale(identifier: "en_US_POSIX")
  formatter.timeZone = TimeZone(secondsFromGMT: 0)
  formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"
  formatter.isLenient = false
  guard let date = formatter.date(from: value), formatter.string(from: date) == value else {
    throw ContractError.invalid
  }
  return date
}
struct MeetupDetail: Decodable, Sendable {
  let meetup: Meetup
  enum CodingKeys: String, CodingKey { case meetup, viewerParticipation }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    meetup = try values.decode(Meetup.self, forKey: .meetup)
    guard values.contains(.viewerParticipation), try values.decodeNil(forKey: .viewerParticipation)
    else { throw ContractError.invalid }
  }
}
struct Meetup: Decodable, Sendable {
  let id: String
  let title: String
  let description: String?
  let sport: String
  let startsAt: Date
  let endsAt: Date
  let capacity: Int
  let place: Place
  enum CodingKeys: String, CodingKey {
    case id, title, description, sport, startsAt, endsAt, capacity, place
  }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    title = try values.decode(String.self, forKey: .title)
    description = try values.decodeIfPresent(String.self, forKey: .description)
    let rawSport = try values.decode(String.self, forKey: .sport)
    sport = ["walking", "running", "cycling"].contains(rawSport) ? rawSport : "unknown"
    startsAt = try utcDate(values.decode(String.self, forKey: .startsAt))
    endsAt = try utcDate(values.decode(String.self, forKey: .endsAt))
    capacity = try values.decode(Int.self, forKey: .capacity)
    place = try values.decode(Place.self, forKey: .place)
    guard validID(id), !title.isEmpty, !rawSport.isEmpty, capacity > 0, capacity <= 2_147_483_647,
      endsAt > startsAt
    else { throw ContractError.invalid }
  }
}
struct Place: Decodable, Sendable {
  let id: String
  let name: String
  enum CodingKeys: String, CodingKey { case id, name }
  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    id = try values.decode(String.self, forKey: .id)
    name = try values.decode(String.self, forKey: .name)
    guard validID(id), !name.isEmpty else { throw ContractError.invalid }
  }
}
