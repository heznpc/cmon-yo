import XCTest

@testable import CmonYo

final class ContractTests: XCTestCase {
  func testSharedMatrix() throws {
    let url = Bundle(for: Self.self).url(
      forResource: "matrix", withExtension: "json", subdirectory: "fixtures")!
    let rows = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [[String: Any]]
    for row in rows {
      let data = try JSONSerialization.data(withJSONObject: row["document"]!)
      if row["valid"] as! Bool {
        let result = try JSONDecoder().decode(MeetupDetail.self, from: data)
        if row["name"] as? String == "unknown sport" {
          XCTAssertEqual(result.meetup.sport, "unknown")
        }
      } else {
        XCTAssertThrowsError(
          try JSONDecoder().decode(MeetupDetail.self, from: data), row["name"] as! String)
      }
    }
  }
}
