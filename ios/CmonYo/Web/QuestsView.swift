import SwiftUI
import WebKit

struct QuestsRoute: Identifiable { let id = UUID() }

struct AuthenticatedQuestsView: View {
  @Environment(AccountSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var dataStore: WKWebsiteDataStore?
  @State private var attempt = 0
  @State private var loading = true
  @State private var failed = false
  @State private var externalURL: URL?
  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        if loading { ProgressView("원정·보상을 불러오는 중…") }
        if failed {
          Text("원정·보상을 열지 못했습니다. 계정과 연결을 확인한 뒤 다시 시도해 주세요.")
            .accessibilityIdentifier("quests-web-error")
          Button("원정·보상 다시 시도") { attempt += 1 }.frame(minHeight: 44)
        }
        if let externalURL {
          VStack(alignment: .leading, spacing: 8) {
            Text("이 페이지는 브라우저에서 열 수 있습니다. 로그인은 별도로 필요할 수 있습니다.")
            Link("브라우저에서 열기", destination: externalURL).frame(minHeight: 44)
            Button("원정 계속 보기") { self.externalURL = nil }.frame(minHeight: 44)
          }.padding(.horizontal)
        }
        if let dataStore {
          QuestsWebView(origin: session.baseURL, dataStore: dataStore,
            loading: $loading, failed: $failed, externalURL: $externalURL)
            .id(attempt).accessibilityIdentifier("authenticated-quests")
        }
      }
      .navigationTitle("원정·보상")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("걷기로 돌아가기") { dismiss() }.accessibilityIdentifier("quests-close")
        }
      }
      .task(id: attempt) {
        loading = true; failed = false; dataStore = nil; externalURL = nil
        do { dataStore = try await session.prepareWebSession() }
        catch is CancellationError { return }
        catch { loading = false; failed = true }
      }
      .onChange(of: session.generation) { _, _ in dismiss() }
    }
  }
}

struct QuestsWebView: UIViewRepresentable {
  let origin: URL
  let dataStore: WKWebsiteDataStore
  @Binding var loading: Bool
  @Binding var failed: Bool
  @Binding var externalURL: URL?
  func makeCoordinator() -> Coordinator { Coordinator(self) }
  func makeUIView(context: Context) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = dataStore
    // This host needs no script handler. Native credentials never enter page JavaScript.
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = context.coordinator
    var url = origin.appending(path: "quests")
    url.append(queryItems: [.init(name: "surface", value: "native")])
    view.load(URLRequest(url: url))
    return view
  }
  func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }
  static func dismantleUIView(_ view: WKWebView, coordinator: Coordinator) {
    coordinator.closed = true
    view.stopLoading()
    view.navigationDelegate = nil
  }
  @MainActor final class Coordinator: NSObject, WKNavigationDelegate {
    var parent: QuestsWebView
    var closed = false
    let policy: QuestsNavigationPolicy
    init(_ parent: QuestsWebView) { self.parent = parent; policy = QuestsNavigationPolicy(origin: parent.origin) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
      guard !closed else { return }
      parent.loading = false
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
    private func fail(_ error: Error) {
      guard !closed, (error as NSError).code != NSURLErrorCancelled else { return }
      parent.loading = false; parent.failed = true
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
      guard !closed else { return }
      parent.loading = false; parent.failed = true
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
      decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void) {
      guard !closed, let url = navigationAction.request.url else { decisionHandler(.cancel); return }
      let decision = policy.decide(url: url, sourceIsMain: navigationAction.sourceFrame.isMainFrame,
        targetIsMain: navigationAction.targetFrame?.isMainFrame == true,
        userLink: navigationAction.navigationType == .linkActivated)
      switch decision {
      case .owned: decisionHandler(.allow)
      case .offerBrowser:
        parent.externalURL = url
        decisionHandler(.cancel)
      case .blocked:
        if navigationAction.targetFrame?.isMainFrame == true {
          parent.loading = false; parent.failed = true
        }
        decisionHandler(.cancel)
      }
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
      decisionHandler: @escaping @MainActor @Sendable (WKNavigationResponsePolicy) -> Void) {
      guard !closed, navigationResponse.isForMainFrame,
        let response = navigationResponse.response as? HTTPURLResponse,
        let url = response.url, policy.owned(url), response.statusCode < 400 else {
        parent.loading = false; parent.failed = true
        decisionHandler(.cancel)
        return
      }
      decisionHandler(.allow)
    }
  }
}
