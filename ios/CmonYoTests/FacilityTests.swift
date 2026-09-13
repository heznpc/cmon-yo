import XCTest
@testable import CmonYo

@MainActor
final class FacilityTests: XCTestCase {
  func testSharedFacilityWeatherContract() throws {
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "place", withExtension: "json", subdirectory: "fixtures"))
    let data = try Data(contentsOf: url)
    let detail = try JSONDecoder().decode(FacilityDetail.self, from: data)
    XCTAssertEqual(detail.place.id, "park-46840-00023")
    XCTAssertEqual(detail.place.exerciseFacilities, ["풋살장", "인라인스케이트장", "농구장"])
    XCTAssertNil(detail.weather.facts?.precipitationProbabilityPercent)
    XCTAssertEqual(detail.weather.facts?.precipitationType, "unknown")
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    object["weather"] = ["status": "fresh", "facts": NSNull()]
    XCTAssertThrowsError(try JSONDecoder().decode(FacilityDetail.self, from: JSONSerialization.data(withJSONObject: object)))
    object["weather"] = ["status": "unavailable", "facts": NSNull()]
    XCTAssertEqual(try JSONDecoder().decode(FacilityDetail.self, from: JSONSerialization.data(withJSONObject: object)).weather.status, .unavailable)
    var place = try XCTUnwrap(object["place"] as? [String: Any])
    place["latitude"] = 100
    object["place"] = place
    XCTAssertThrowsError(try JSONDecoder().decode(FacilityDetail.self, from: JSONSerialization.data(withJSONObject: object)))
  }
  func testRealHTTPFacilitiesAndWeatherFailureRecovery() async throws {
    let base = URL(string: "http://127.0.0.1:3112")!
    let api = FacilityAPI(baseURL: base)
    func state(_ value: String) async throws {
      var request = URLRequest(url: base.appending(path: "_test/state/\(value)"))
      request.httpMethod = "PUT"
      let (_, response) = try await URLSession.shared.data(for: request)
      XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
    }
    try await state("reset")
    let list = try await api.list()
    XCTAssertEqual(list.places.count, 21)
    let id = "park-46840-00023"
    let info = try await api.info(id: id)
    XCTAssertEqual(info.place.id, id)
    let forecast = try await api.weather(id: id)
    XCTAssertEqual(forecast.placeId, id)
    XCTAssertEqual(forecast.weather.status, .fresh)
    let detail = try await api.detail(id: id)
    XCTAssertEqual(detail.weather.status, .fresh)
    try await state("weather-error")
    let stale = try await api.detail(id: id)
    XCTAssertEqual(stale.weather.status, .stale)
    XCTAssertEqual(stale.weather.facts?.temperatureC, detail.weather.facts?.temperatureC)
    try await state("not-found")
    do { _ = try await api.detail(id: id); XCTFail("Expected 404") }
    catch FacilityError.notFound { }
    try await state("disconnect")
    do { _ = try await api.detail(id: id); XCTFail("Expected connection failure") }
    catch FacilityError.unavailable { }
    try await state("reset")
    try await state("weather-timeout")
    // Mandatory facility data remains available even when weather times out.
    let independent = try await api.info(id: id)
    XCTAssertEqual(independent.place.name, "근린공원 36")
    let unavailable = try await api.weather(id: id)
    XCTAssertEqual(unavailable.weather.status, .unavailable)
    try await state("changed")
    let recovered = try await api.detail(id: id)
    XCTAssertEqual(recovered.place.name, "[QA] HTTP로 갱신된 공원")
    XCTAssertEqual(recovered.weather.status, .fresh)
    try await state("normal")
  }
}
