import WebKit
import XCTest

@testable import CmonYo

@MainActor
final class BridgeTests: XCTestCase {
  let id = "11111111-1111-4111-8111-111111111111"
  let origin = URL(string: "http://127.0.0.1:3100")!
  func message(_ type: String = "openMeetup") -> [String: Any] {
    [
      "version": 1, "requestId": UUID().uuidString, "type": type,
      "payload": type == "capabilities" ? [:] : ["meetupId": id],
    ]
  }
  func testAcceptanceAndCloseBoundaries() {
    var moved = 0
    let bridge = MeetupBridge(origin: origin, meetupID: id) { _ in moved += 1 }
    bridge.receive(message()) { result, _ in
      XCTAssertEqual((result as? [String: Any])?["status"] as? String, "ok")
      bridge.close()  // After acceptance, before the navigation callback.
    }
    XCTAssertEqual(moved, 1)
    bridge.receive(message()) { result, _ in
      XCTAssertEqual((result as? [String: Any])?["error"] as? String, "closed")
    }
    XCTAssertEqual(moved, 1)
  }
  func testOriginAndMalformedInputs() {
    var moved = 0
    let bridge = MeetupBridge(origin: origin, meetupID: id) { _ in moved += 1 }
    XCTAssertFalse(bridge.accepts(scheme: "https", host: "127.0.0.1", port: 3100, mainFrame: true))
    XCTAssertFalse(bridge.accepts(scheme: "http", host: "localhost", port: 3100, mainFrame: true))
    XCTAssertFalse(bridge.accepts(scheme: "http", host: "127.0.0.1", port: 3101, mainFrame: true))
    XCTAssertFalse(bridge.accepts(scheme: "http", host: "127.0.0.1", port: 3100, mainFrame: false))
    var cases = [message("unknown")]
    var version = message()
    version["version"] = 2
    cases.append(version)
    var boolean = message()
    boolean["version"] = true
    cases.append(boolean)
    var payload = message()
    payload["payload"] = ["meetupId": "bad"]
    cases.append(payload)
    var other = message()
    other["payload"] = ["meetupId": "33333333-3333-4333-8333-333333333333"]
    cases.append(other)
    for item in cases {
      bridge.receive(item) { result, _ in
        XCTAssertNotEqual((result as? [String: Any])?["status"] as? String, "ok")
      }
    }
    XCTAssertEqual(moved, 0)
  }
  func loadedWebView(bridge: MeetupBridge, path: String, base: String = "http://127.0.0.1:3100")
    async throws -> WKWebView
  {
    let config = WKWebViewConfiguration()
    config.userContentController.addScriptMessageHandler(
      bridge, contentWorld: .page, name: "cmonYo")
    let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: config)
    let delegate = LoadDelegate()
    view.navigationDelegate = delegate
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      delegate.continuation = continuation
      view.load(URLRequest(url: URL(string: base + path)!))
    }
    return view
  }
  func testActualWebKitAllowedAndDisallowedSenders() async throws {
    var moved = 0
    let bridge = MeetupBridge(origin: origin, meetupID: id) { _ in moved += 1 }
    let allowed = try await loadedWebView(bridge: bridge, path: "/_test/blank")
    let capabilities =
      try await allowed.callAsyncJavaScript(
        "return await window.webkit.messageHandlers.cmonYo.postMessage(message)",
        arguments: ["message": message("capabilities")], in: nil, contentWorld: .page)
      as! [String: Any]
    XCTAssertEqual(capabilities["status"] as? String, "ok")
    let result =
      try await allowed.callAsyncJavaScript(
        "return await window.webkit.messageHandlers.cmonYo.postMessage(message)",
        arguments: ["message": message()], in: nil, contentWorld: .page) as! [String: Any]
    XCTAssertEqual(result["status"] as? String, "ok")
    XCTAssertEqual(moved, 1)
    for base in ["http://localhost:3100", "http://127.0.0.1:3101"] {
      let denied = try await loadedWebView(bridge: bridge, path: "/_test/blank", base: base)
      let error =
        try await denied.callAsyncJavaScript(
          "try { await window.webkit.messageHandlers.cmonYo.postMessage(message); return 'unexpected' } catch(e) { return String(e) }",
          arguments: ["message": message()], in: nil, contentWorld: .page) as! String
      XCTAssertTrue(error.contains("forbidden"))
      XCTAssertEqual(moved, 1)
    }
    let framed = try await loadedWebView(bridge: bridge, path: "/_test/subframe")
    let frameResult =
      try await framed.callAsyncJavaScript(
        "return await window.frameResult", arguments: [:], in: nil, contentWorld: .page) as! String
    XCTAssertTrue(frameResult.contains("forbidden"))
    XCTAssertEqual(moved, 1)
    bridge.close()
    let closed =
      try await allowed.callAsyncJavaScript(
        "return await window.webkit.messageHandlers.cmonYo.postMessage(message)",
        arguments: ["message": message()], in: nil, contentWorld: .page) as! [String: Any]
    XCTAssertEqual(closed["error"] as? String, "closed")
    XCTAssertEqual(moved, 1)
  }
  func testActualWebKitMalformedMessagesAndScheme() async throws {
    var moved = 0
    let bridge = MeetupBridge(origin: origin, meetupID: id) { _ in moved += 1 }
    let view = try await loadedWebView(bridge: bridge, path: "/_test/blank")
    var cases = [message("unknown")]
    var version = message()
    version["version"] = 2
    cases.append(version)
    var payload = message()
    payload["payload"] = ["meetupId": "bad"]
    cases.append(payload)
    for item in cases {
      let result =
        try await view.callAsyncJavaScript(
          "return await window.webkit.messageHandlers.cmonYo.postMessage(message)",
          arguments: ["message": item], in: nil, contentWorld: .page) as! [String: Any]
      XCTAssertNotEqual(result["status"] as? String, "ok")
    }
    // loadHTMLString gives WebKit a real HTTPS frame origin without trusting a payload origin.
    let delegate = LoadDelegate()
    view.navigationDelegate = delegate
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      delegate.continuation = continuation
      view.loadHTMLString(
        "<html><body>HTTPS origin</body></html>", baseURL: URL(string: "https://127.0.0.1:3100")!)
    }
    let denied =
      try await view.callAsyncJavaScript(
        "try { await window.webkit.messageHandlers.cmonYo.postMessage(message); return 'unexpected' } catch(e) { return String(e) }",
        arguments: ["message": message()], in: nil, contentWorld: .page) as! String
    XCTAssertTrue(denied.contains("forbidden"))
    XCTAssertEqual(moved, 0)
  }
  func testActualWebKitCloseAfterAcceptanceKeepsNavigation() async throws {
    var moved = 0
    var view: WKWebView?
    var bridge: MeetupBridge!
    bridge = MeetupBridge(origin: origin, meetupID: id) { _ in
      moved += 1
      bridge.close()
      view?.stopLoading()
    }
    view = try await loadedWebView(bridge: bridge, path: "/_test/blank")
    // A reply can be observed here because the document remains; destroying it may lose it.
    let result =
      try await view!.callAsyncJavaScript(
        "return await window.webkit.messageHandlers.cmonYo.postMessage(message)",
        arguments: ["message": message()], in: nil, contentWorld: .page) as! [String: Any]
    XCTAssertEqual(result["status"] as? String, "ok")
    XCTAssertEqual(moved, 1)
    view = nil
    bridge = nil
  }
}
@MainActor final class LoadDelegate: NSObject, WKNavigationDelegate {
  var continuation: CheckedContinuation<Void, Error>?
  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    continuation?.resume()
    continuation = nil
  }
  func webView(
    _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
    withError error: Error
  ) {
    continuation?.resume(throwing: error)
    continuation = nil
  }
}
