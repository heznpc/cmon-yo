import Foundation

struct Facility: Decodable, Identifiable, Sendable {
  let id: String
  let name: String
  let kind: String
  let address: String
  let latitude: Double
  let longitude: Double
  let exerciseFacilities: [String]
  let sourceDate: String
  enum CodingKeys: String, CodingKey {
    case id, name, kind, address, latitude, longitude, exerciseFacilities, sourceDate
  }
  init(from decoder: Decoder) throws {
    let v = try decoder.container(keyedBy: CodingKeys.self)
    id = try v.decode(String.self, forKey: .id)
    name = try v.decode(String.self, forKey: .name)
    kind = try v.decode(String.self, forKey: .kind)
    address = try v.decode(String.self, forKey: .address)
    latitude = try v.decode(Double.self, forKey: .latitude)
    longitude = try v.decode(Double.self, forKey: .longitude)
    exerciseFacilities = try v.decode([String].self, forKey: .exerciseFacilities)
    sourceDate = try v.decode(String.self, forKey: .sourceDate)
    guard validFacilityID(id), [name, kind, address].allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }),
      (-90...90).contains(latitude), (-180...180).contains(longitude),
      exerciseFacilities.allSatisfy({ !$0.isEmpty }) else { throw ContractError.invalid }
    _ = try utcDate(sourceDate + "T00:00:00.000Z")
  }
}
func validFacilityID(_ id: String) -> Bool {
  id.range(of: "^park-[0-9]{5}-[0-9]{5}$", options: .regularExpression) != nil
}
struct ForecastFacts: Decodable, Sendable {
  let temperatureC: Double?
  let precipitationProbabilityPercent: Double?
  let precipitationType: String
  let windSpeedMetersPerSecond: Double?
  let issuedAt: Date
  let validAt: Date
  let fetchedAt: Date
  enum CodingKeys: String, CodingKey {
    case temperatureC, precipitationProbabilityPercent, precipitationType, windSpeedMetersPerSecond, issuedAt, validAt, fetchedAt
  }
  init(from decoder: Decoder) throws {
    let v = try decoder.container(keyedBy: CodingKeys.self)
    func number(_ key: CodingKeys, _ range: ClosedRange<Double>) throws -> Double? {
      guard v.contains(key) else { throw ContractError.invalid }
      let value = try v.decodeIfPresent(Double.self, forKey: key)
      if let value, !range.contains(value) { throw ContractError.invalid }
      return value
    }
    temperatureC = try number(.temperatureC, -90...60)
    precipitationProbabilityPercent = try number(.precipitationProbabilityPercent, 0...100)
    windSpeedMetersPerSecond = try number(.windSpeedMetersPerSecond, 0...150)
    precipitationType = try v.decode(String.self, forKey: .precipitationType)
    guard ["none", "rain", "snow", "mixed", "unknown"].contains(precipitationType) else { throw ContractError.invalid }
    issuedAt = try utcDate(v.decode(String.self, forKey: .issuedAt))
    validAt = try utcDate(v.decode(String.self, forKey: .validAt))
    fetchedAt = try utcDate(v.decode(String.self, forKey: .fetchedAt))
  }
}
struct FacilityWeather: Decodable, Sendable {
  enum Status: String, Decodable, Sendable { case fresh, stale, unavailable }
  let status: Status
  let facts: ForecastFacts?
  enum CodingKeys: String, CodingKey { case status, facts }
  init(from decoder: Decoder) throws {
    let v = try decoder.container(keyedBy: CodingKeys.self)
    status = try v.decode(Status.self, forKey: .status)
    guard v.contains(.facts) else { throw ContractError.invalid }
    facts = try v.decodeIfPresent(ForecastFacts.self, forKey: .facts)
    guard (status == .unavailable) == (facts == nil) else { throw ContractError.invalid }
  }
}
struct FacilityList: Decodable, Sendable { let places: [Facility]; let nextPage: Int? }
struct FacilityRegion: Decodable, Identifiable, Sendable { let code: String; let name: String; var id: String { code } }
struct FacilityRegions: Decodable, Sendable { let regions: [FacilityRegion] }
func validRegionCode(_ code: String) -> Bool { code.range(of: "^[0-9]{5}$", options: .regularExpression) != nil }
struct FacilityInfo: Decodable, Sendable { let place: Facility }
struct PlaceForecast: Decodable, Sendable { let placeId: String; let weather: FacilityWeather }
struct FacilityDetail: Decodable, Sendable {
  let place: Facility
  let weather: FacilityWeather
}
enum FacilityError: Error, LocalizedError {
  case notFound, unavailable, invalidResponse
  var errorDescription: String? {
    switch self {
    case .notFound: "시설을 찾을 수 없습니다."
    case .unavailable: "시설을 불러오지 못했습니다. 다시 시도해 주세요."
    case .invalidResponse: "시설 응답을 읽을 수 없습니다."
    }
  }
}
struct FacilityAPI: Sendable {
  let baseURL: URL
  func list(regionCode: String = "", page: Int = 0) async throws -> FacilityList {
    guard (regionCode.isEmpty || validRegionCode(regionCode)), (0...10000).contains(page) else { throw FacilityError.invalidResponse }
    var query = [URLQueryItem(name: "page", value: String(page))]
    if !regionCode.isEmpty { query.append(.init(name: "regionCode", value: regionCode)) }
    return try await get("api/v1/places", query: query)
  }
  func regions() async throws -> FacilityRegions {
    let value: FacilityRegions = try await get("api/v1/regions")
    guard value.regions.allSatisfy({ validRegionCode($0.code) && !$0.name.isEmpty }), Set(value.regions.map(\.code)).count == value.regions.count else { throw FacilityError.invalidResponse }
    return value
  }
  func info(id: String) async throws -> FacilityInfo {
    guard validFacilityID(id) else { throw FacilityError.notFound }
    let result: FacilityInfo = try await get("api/v1/places/\(id)/info")
    guard result.place.id == id else { throw FacilityError.invalidResponse }
    return result
  }
  func weather(id: String) async throws -> PlaceForecast {
    guard validFacilityID(id) else { throw FacilityError.notFound }
    let result: PlaceForecast = try await get("api/v1/places/\(id)/weather")
    guard result.placeId == id else { throw FacilityError.invalidResponse }
    return result
  }
  func detail(id: String) async throws -> FacilityDetail {
    guard validFacilityID(id) else { throw FacilityError.notFound }
    return try await get("api/v1/places/\(id)")
  }
  private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
    var url = URLComponents(url: baseURL.appending(path: path), resolvingAgainstBaseURL: false)!
    if !query.isEmpty { url.queryItems = query }
    var request = URLRequest(url: url.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 6)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: URLResponse
    do { (data, response) = try await URLSession.shared.data(for: request) }
    catch {
      if Task.isCancelled { throw CancellationError() }
      throw FacilityError.unavailable
    }
    try Task.checkCancellation()
    guard let http = response as? HTTPURLResponse else { throw FacilityError.invalidResponse }
    guard http.statusCode == 200 else { throw http.statusCode == 404 ? FacilityError.notFound : FacilityError.unavailable }
    do { return try JSONDecoder().decode(T.self, from: data) }
    catch { throw FacilityError.invalidResponse }
  }
}
