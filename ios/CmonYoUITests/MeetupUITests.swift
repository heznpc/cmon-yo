import XCTest

@MainActor
final class MeetupUITests: XCTestCase {
  func app(
    url: String = "http://127.0.0.1:3100", id: String = "11111111-1111-4111-8111-111111111111"
  ) -> XCUIApplication {
    let app = XCUIApplication()
    app.launchEnvironment = ["CMON_API_URL": url, "CMON_MEETUP_ID": id]
    app.launch()
    return app
  }
  func testRoundTripTwiceReturnsToExistingDetail() {
    let app = app()
    XCTAssertTrue(app.staticTexts["meetup-title"].waitForExistence(timeout: 15))
    for _ in 0..<2 {
      app.buttons["읽기 전용 모임 안내"].tap()
      let back = app.webViews.buttons["앱 모임으로 돌아가기"]
      XCTAssertTrue(back.waitForExistence(timeout: 20))
      back.tap()
      XCTAssertTrue(app.staticTexts["meetup-title"].waitForExistence(timeout: 10))
      XCTAssertEqual(app.webViews.count, 0)
      XCTAssertEqual(app.navigationBars.count, 1)
      XCTAssertEqual(app.staticTexts.matching(identifier: "meetup-title").count, 1)
    }
    app.buttons["읽기 전용 모임 안내"].tap()
    app.buttons["닫기"].tap()
    XCTAssertTrue(app.staticTexts["meetup-title"].exists)
  }
  func setServerState(_ state: String) async throws {
    var request = URLRequest(url: URL(string: "http://127.0.0.1:3100/_test/state/\(state)")!)
    request.httpMethod = "PUT"
    let (_, response) = try await URLSession.shared.data(for: request)
    XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
  }
  func tapRefresh(_ app: XCUIApplication, label: String = "다시 시도") {
    let button = app.buttons[label]
    if !button.isHittable { app.swipeUp() }
    button.tap()
  }
  func test404ConnectionFailureAndRetryControls() async throws {
    var current = app(id: "33333333-3333-4333-8333-333333333333")
    XCTAssertTrue(current.staticTexts["모임을 찾을 수 없습니다."].waitForExistence(timeout: 15))
    current.terminate()
    current = app(url: "http://127.0.0.1:3199")
    XCTAssertTrue(current.staticTexts["연결에 실패했습니다. 다시 시도해 주세요."].waitForExistence(timeout: 15))
    current.buttons["다시 시도"].tap()
    XCTAssertTrue(current.staticTexts["연결에 실패했습니다. 다시 시도해 주세요."].waitForExistence(timeout: 15))
    XCTAssertFalse(current.staticTexts["meetup-title"].exists)
    current.terminate()

    try await setServerState("normal")
    current = app()
    let title = current.staticTexts["meetup-title"]
    let guide = current.buttons["읽기 전용 모임 안내"]
    let error = current.staticTexts["meetup-error"]
    let stale = current.staticTexts["meetup-stale"]
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    try await setServerState("not-found")
    tapRefresh(current, label: "모임 새로고침")
    XCTAssertTrue(error.waitForExistence(timeout: 15))
    XCTAssertEqual(error.label, "모임을 찾을 수 없습니다.")
    XCTAssertFalse(title.exists)
    XCTAssertFalse(guide.exists)
    try await setServerState("disconnect")
    tapRefresh(current)
    let connectionError = current.staticTexts["연결에 실패했습니다. 다시 시도해 주세요."]
    XCTAssertTrue(connectionError.waitForExistence(timeout: 15))
    XCTAssertFalse(title.exists)  // A failed retry cannot revive the detail removed by 404.
    XCTAssertFalse(guide.exists)

    try await setServerState("changed")
    tapRefresh(current)
    XCTAssertTrue(title.waitForExistence(timeout: 15))
    XCTAssertEqual(title.label, "[Fixture] HTTP에서 변경된 모임")
    XCTAssertTrue(guide.exists)
    XCTAssertFalse(error.exists)
    try await setServerState("disconnect")
    tapRefresh(current, label: "모임 새로고침")
    XCTAssertTrue(connectionError.waitForExistence(timeout: 15))
    XCTAssertTrue(stale.exists)
    XCTAssertEqual(title.label, "[Fixture] HTTP에서 변경된 모임")
    try await setServerState("normal")
    tapRefresh(current)
    let normalTitle = current.staticTexts["[Fixture] 일요일 아침 같이 걷기"]
    XCTAssertTrue(normalTitle.waitForExistence(timeout: 15))
    XCTAssertFalse(error.exists)
    XCTAssertFalse(stale.exists)
    XCTAssertTrue(guide.exists)
  }
}
