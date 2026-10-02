import SwiftUI

@main
struct CmonYoApp: App {
  @State private var session: AccountSession?
  init() {
    #if DEBUG
    let allowLocal = true
    #else
    let allowLocal = false
    #endif
    let url = NativeConfiguration.apiURL(
      environment: ProcessInfo.processInfo.environment["CMON_API_URL"],
      bundled: Bundle.main.object(forInfoDictionaryKey: "CmonAPIBaseURL") as? String,
      allowLocal: allowLocal)
    _session = State(initialValue: url.map { AccountSession(baseURL: $0) })
  }
  var body: some Scene {
    WindowGroup {
      if let session { CmonYoRootView(session: session) }
      else {
        ContentUnavailableView("서비스에 연결할 수 없습니다", systemImage: "network.slash",
          description: Text("이 앱의 서비스 주소가 설정되지 않았습니다. 업데이트된 앱을 설치해 주세요."))
      }
    }
  }
}

private struct CmonYoRootView: View {
  let session: AccountSession
  @State private var walking = WalkingSyncService()
  @Environment(\.scenePhase) private var scenePhase
  @State private var tab = ProcessInfo.processInfo.environment["CMON_START_TAB"] ?? "walking"
  var body: some View {
    TabView(selection: $tab) {
      WalkingTab().tabItem { Label("걷기", systemImage: "figure.walk") }.tag("walking")
      FacilitiesView(api: FacilityAPI(baseURL: session.baseURL))
        .tabItem { Label("둘러보기", systemImage: "tree") }.tag("places")
      if let meetupID = ProcessInfo.processInfo.environment["CMON_MEETUP_ID"] {
        MeetupView(api: MeetupAPI(baseURL: session.baseURL), meetupID: meetupID)
          .tabItem { Label("샘플 모임", systemImage: "person.2") }.tag("meetups")
      } else { MeetingsTab().tabItem { Label("모임", systemImage: "person.2") }.tag("meetups") }
      AccountView().tabItem { Label("내 활동", systemImage: "person") }.tag("account")
    }
    .id(session.privacyEpoch).environment(session).environment(walking)
    .tint(NeighborhoodStyle.link)
    .task { await session.restore() }
    .task(id: "\(session.generation):\(session.user?.id ?? "guest")") { await walking.activate(session) }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active && !session.restoring {
        Task {
          do { try await session.refreshAccount() }
          catch is CancellationError { return }
          catch { session.notice = error.localizedDescription }
          await walking.activate(session)
        }
      }
    }
  }
}
