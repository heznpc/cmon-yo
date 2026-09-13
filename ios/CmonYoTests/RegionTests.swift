import XCTest
@testable import CmonYo

@MainActor
final class RegionTests: XCTestCase {
  func testFacilityIdentifiersDoNotEncodeASingleSupportedRegion() throws {
    for id in ["park-46840-00023", "park-11680-00001", "park-11110-00001"] { XCTAssertTrue(validFacilityID(id)) }
    for id in ["park-1168-00001", "park-11680-1", "park-11680-00001/extra"] { XCTAssertFalse(validFacilityID(id)) }
    let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "place", withExtension: "json", subdirectory: "fixtures"))
    var object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    var place = try XCTUnwrap(object["place"] as? [String: Any])
    place["id"] = "park-11680-00001"; object["place"] = place
    XCTAssertEqual(try JSONDecoder().decode(FacilityDetail.self, from: JSONSerialization.data(withJSONObject: object)).place.id, "park-11680-00001")
  }

  func testConfiguredRegionsOverRealHTTP() async throws {
    guard let raw = ProcessInfo.processInfo.environment["CMON_REGION_TEST_URL"], let url = URL(string: raw) else { throw XCTSkip("Set CMON_REGION_TEST_URL to the isolated multi-region QA server.") }
    let api = FacilityAPI(baseURL: url)
    let catalog = try await api.regions()
    XCTAssertTrue(catalog.regions.contains(where: { $0.code == "11680" }))
    var page = 0, seen = Set<String>()
    repeat {
      let result = try await api.list(regionCode: "11680", page: page)
      for place in result.places {
        XCTAssertTrue(place.id.hasPrefix("park-11680-"))
        XCTAssertTrue(seen.insert(place.id).inserted)
      }
      if let next = result.nextPage { XCTAssertGreaterThan(next, page); page = next }
      else { break }
    } while page < 10
    XCTAssertGreaterThan(seen.count, 100)
    let id = try XCTUnwrap(seen.sorted().first)
    let detail = try await api.info(id: id)
    XCTAssertEqual(detail.place.id, id)
  }
}
