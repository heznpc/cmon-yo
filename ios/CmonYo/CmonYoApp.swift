import SwiftUI

@main
struct CmonYoApp: App {
  @State private var tab = ProcessInfo.processInfo.environment["CMON_START_TAB"] ?? "places"
  var body: some Scene {
    WindowGroup {
      TabView(selection: $tab) {
        FacilitiesView(api: FacilityAPI(baseURL: configurationURL))
          .tabItem { Label("시설", systemImage: "tree") }.tag("places")
        MeetupView(
        api: MeetupAPI(baseURL: configurationURL),
        meetupID: ProcessInfo.processInfo.environment["CMON_MEETUP_ID"]
          ?? "11111111-1111-4111-8111-111111111111")
          .tabItem { Label("샘플 모임", systemImage: "person.2") }.tag("meetups")
      }
    }
  }
  private var configurationURL: URL {
    // Local PR1 server. No bundled data fallback or invented production endpoint.
    URL(string: ProcessInfo.processInfo.environment["CMON_API_URL"] ?? "http://127.0.0.1:3000")!
  }
}
