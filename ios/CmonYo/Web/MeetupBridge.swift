import Foundation
import WebKit

@MainActor
final class MeetupBridge: NSObject, WKScriptMessageHandlerWithReply {
  let allowedOrigin: URL
  let meetupID: String
  private(set) var active = true
  let openMeetup: (String) -> Void
  init(origin: URL, meetupID: String, openMeetup: @escaping (String) -> Void) {
    self.allowedOrigin = origin
    self.meetupID = meetupID
    self.openMeetup = openMeetup
  }
  func close() { active = false }
  func accepts(scheme: String, host: String, port: Int, mainFrame: Bool) -> Bool {
    let expectedPort = allowedOrigin.port ?? (allowedOrigin.scheme == "https" ? 443 : 80)
    let actualPort = port == 0 ? (scheme == "https" ? 443 : 80) : port
    return mainFrame && scheme == allowedOrigin.scheme && host == allowedOrigin.host
      && actualPort == expectedPort
  }
  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
  ) {
    let origin = message.frameInfo.securityOrigin
    guard
      accepts(
        scheme: origin.protocol, host: origin.host, port: origin.port,
        mainFrame: message.frameInfo.isMainFrame)
    else {
      replyHandler(nil, "forbidden")
      return
    }
    receive(message.body, reply: replyHandler)
  }
  func receive(_ body: Any, reply: (Any?, String?) -> Void) {
    guard let raw = body as? [String: Any], let requestID = raw["requestId"] as? String,
      validID(requestID)
    else {
      reply(nil, "invalid_message")
      return
    }
    func result(_ status: String, _ error: String? = nil, _ data: [String: Any]? = nil) {
      var response: [String: Any] = ["version": 1, "requestId": requestID, "status": status]
      if let error { response["error"] = error }
      if let data { response["result"] = data }
      reply(response, nil)
    }
    guard active else {
      result("error", "closed")
      return
    }
    guard Set(raw.keys) == ["version", "requestId", "type", "payload"],
      let version = raw["version"] as? NSNumber,
      CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
      let type = raw["type"] as? String,
      let payload = raw["payload"] as? [String: Any]
    else {
      result("error", "invalid_message")
      return
    }
    switch type {
    case "capabilities":
      guard payload.isEmpty else {
        result("error", "invalid_payload")
        return
      }
      result("ok", nil, ["openMeetup": true])
    case "openMeetup":
      guard Set(payload.keys) == ["meetupId"], let id = payload["meetupId"] as? String, validID(id)
      else {
        result("error", "invalid_payload")
        return
      }
      guard id == meetupID else {
        result("unsupported", "different_meetup")
        return
      }
      // Accepted now. Closing the web wait/host during reply cannot cancel this command.
      result("ok", nil, ["accepted": true])
      openMeetup(id)
    default: result("unsupported", "unknown_type")
    }
  }
}
