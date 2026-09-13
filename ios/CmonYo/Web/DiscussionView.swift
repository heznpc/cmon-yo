import SwiftUI
import WebKit

struct DiscussionView: View {
  let origin: URL
  let meetupID: String
  let onReturn: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var attempt = 0
  @State private var loading = true
  @State private var failed = false
  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        if loading { ProgressView("모임 안내를 불러오는 중…") }
        if failed {
          Text("모임 안내 연결에 실패했습니다.").accessibilityIdentifier("web-error")
          Button("다시 시도") {
            failed = false
            loading = true
            attempt += 1
          }.frame(minHeight: 44)
        }
        DiscussionWebView(
          origin: origin, meetupID: meetupID, loading: $loading, failed: $failed, onReturn: onReturn
        ).id(attempt)
      }
      .navigationTitle("모임 안내")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
    }
  }
}
struct DiscussionWebView: UIViewRepresentable {
  let origin: URL
  let meetupID: String
  var dataStore: WKWebsiteDataStore? = nil
  @Binding var loading: Bool
  @Binding var failed: Bool
  let onReturn: (String) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    if let dataStore { config.websiteDataStore = dataStore }
    config.userContentController.addScriptMessageHandler(
      context.coordinator.bridge, contentWorld: .page, name: "cmonYo")
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = context.coordinator
    var url = origin.appending(path: "meetups/\(meetupID)/discussion")
    if dataStore != nil { url.append(queryItems: [.init(name: "surface", value: "native")]) }
    view.load(URLRequest(url: url))
    return view
  }
  func updateUIView(_ view: WKWebView, context: Context) {}
  static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
    coordinator.bridge.close()
    view.stopLoading()
    view.navigationDelegate = nil
    view.configuration.userContentController.removeScriptMessageHandler(
      forName: "cmonYo", contentWorld: .page)
  }
  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    let parent: DiscussionWebView
    let bridge: MeetupBridge
    init(_ parent: DiscussionWebView) {
      self.parent = parent
      bridge = MeetupBridge(
        origin: parent.origin, meetupID: parent.meetupID, openMeetup: parent.onReturn)
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      parent.loading = false
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
      fail(error)
    }
    func webView(
      _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
      withError error: Error
    ) { fail(error) }
    private func fail(_ error: Error) {
      guard (error as NSError).code != NSURLErrorCancelled else { return }
      parent.loading = false
      parent.failed = true
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      bridge.close()
      parent.loading = false
      parent.failed = true
    }
    func webView(
      _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
      guard let url = navigationAction.request.url else {
        decisionHandler(.cancel)
        return
      }
      let allowed = bridge.accepts(
        scheme: url.scheme ?? "", host: url.host ?? "", port: url.port ?? 0,
        mainFrame: navigationAction.targetFrame?.isMainFrame == true)
      if allowed && parent.dataStore != nil {
        if url.path == "/meetups/\(parent.meetupID)" {
          parent.onReturn(parent.meetupID)
          decisionHandler(.cancel)
          return
        }
        guard url.path == "/meetups/\(parent.meetupID)/discussion" else {
          if url.path == "/account" { parent.failed = true }
          decisionHandler(.cancel)
          return
        }
      }
      decisionHandler(allowed ? .allow : .cancel)
    }
    func webView(
      _ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
      decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void
    ) {
      if let response = navigationResponse.response as? HTTPURLResponse, response.statusCode >= 400
      {
        parent.loading = false
        parent.failed = true
      }
      decisionHandler(.allow)
    }
  }
}


// One authenticated Web surface, presented over the existing Native detail.
struct AuthenticatedDiscussionView: View {
  @Environment(AccountSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  let meetupID: String
  let onReturn: () -> Void
  @State private var dataStore: WKWebsiteDataStore?
  @State private var loading = true
  @State private var failed = false
  @State private var attempt = 0
  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        if loading { ProgressView("모임 이야기를 불러오는 중…") }
        if failed {
          Text("모임 이야기를 열지 못했습니다. 계정과 연결을 확인하고 다시 시도해 주세요.")
          Button("모임 이야기 다시 시도") { attempt += 1 }.frame(minHeight: 44)
        }
        if let dataStore {
          DiscussionWebView(origin: session.baseURL, meetupID: meetupID, dataStore: dataStore,
            loading: $loading, failed: $failed, onReturn: { id in
              guard id == meetupID else { return }
              onReturn()
              dismiss()
            }).id(attempt).accessibilityIdentifier("authenticated-discussion")
        }
      }
      .navigationTitle("모임 이야기")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() } } }
      .task(id: attempt) {
        loading = true; failed = false; dataStore = nil
        do { dataStore = try await session.prepareDiscussion() }
        catch is CancellationError { return }
        catch { loading = false; failed = true }
      }
      .onChange(of: session.generation) { _, _ in dismiss() }
    }
  }
}
