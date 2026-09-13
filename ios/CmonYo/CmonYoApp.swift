import SwiftUI

@main
struct CmonYoApp: App {
  var body: some Scene {
    WindowGroup {
      MeetupView(
        api: MeetupAPI(baseURL: configurationURL),
        meetupID: ProcessInfo.processInfo.environment["CMON_MEETUP_ID"]
          ?? "11111111-1111-4111-8111-111111111111")
    }
  }
  private var configurationURL: URL {
    // Local PR1 server. No bundled data fallback or invented production endpoint.
    URL(string: ProcessInfo.processInfo.environment["CMON_API_URL"] ?? "http://127.0.0.1:3000")!
  }
}
