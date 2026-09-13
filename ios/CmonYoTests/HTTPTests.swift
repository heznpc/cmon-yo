import XCTest

@testable import CmonYo

final class HTTPTests: XCTestCase {
  let origin = URL(string: "http://127.0.0.1:3100")!
  let id = "11111111-1111-4111-8111-111111111111"
  func state(_ state: String) async throws {
    var request = URLRequest(url: origin.appending(path: "_test/state/\(state)"))
    request.httpMethod = "PUT"
    _ = try await URLSession.shared.data(for: request)
  }
  func testRealFastifyChanges404AndConnectionFailure() async throws {
    let api = MeetupAPI(baseURL: origin)
    try await state("normal")
    let original = try await api.detail(id: id)
    XCTAssertTrue(original.meetup.title.contains("Fixture"))
    try await state("changed")
    let changed = try await api.detail(id: id)
    XCTAssertEqual(changed.meetup.title, "[Fixture] HTTP에서 변경된 모임")
    try await state("normal")
    do {
      _ = try await api.detail(id: "33333333-3333-4333-8333-333333333333")
      XCTFail("Expected 404")
    } catch APIError.notFound {} catch { XCTFail("Unexpected error: \(error)") }
    do {
      _ = try await MeetupAPI(baseURL: URL(string: "http://127.0.0.1:3199")!).detail(id: id)
      XCTFail("Expected connection failure")
    } catch APIError.unavailable {} catch { XCTFail("Unexpected error: \(error)") }
  }
}
