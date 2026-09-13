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
  @Binding var loading: Bool
  @Binding var failed: Bool
  let onReturn: (String) -> Void
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> WKWebView {
    let config = WKWebViewConfiguration()
    config.userContentController.addScriptMessageHandler(
      context.coordinator.bridge, contentWorld: .page, name: "cmonYo")
    let view = WKWebView(frame: .zero, configuration: config)
    view.navigationDelegate = context.coordinator
    view.load(URLRequest(url: origin.appending(path: "meetups/\(meetupID)/discussion")))
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
