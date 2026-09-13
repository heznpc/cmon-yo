import SwiftUI

struct AccountView: View {
  @Environment(AccountSession.self) private var session
  @State private var working = false
  @State private var login: LoginRoute?
  struct LoginRoute: Identifiable { let id = UUID() }
  var body: some View {
    NavigationStack {
      List {
        if session.restoring { ProgressView("로그인 정보를 확인하는 중…") }
        if let notice = session.notice { Text(notice) }
        if let user = session.user {
          Section("내 계정") {
            HStack(spacing: 16) { NeighborhoodIcon(symbol: "person"); VStack(alignment: .leading, spacing: 6) { Text(user.name + "님").font(.title3.bold()); Text(user.email).font(.subheadline).foregroundStyle(.secondary) } }.padding(.vertical, 12)
          }
          NavigationLink("내 모임") { MeetingListView(mine: true) }
          Button("로그아웃") { working = true; Task { await session.logout(); working = false } }.disabled(working)
          Link("계정 설정·탈퇴", destination: session.baseURL.appending(path: "account"))
          Text("계정 설정은 브라우저에서 별도로 로그인한 뒤 이용할 수 있습니다.")
        } else {
          Section { Text("이웃과 함께 운동해요.").font(.title2.bold()); Text("로그인하고 모임과 이야기를 이어가세요.").foregroundStyle(.secondary) }
          Button("이메일로 로그인") { login = LoginRoute() }.buttonStyle(NeighborhoodButton()).disabled(session.restoring)
          Button("저장된 로그인 다시 확인") {
            Task { do { try await session.refreshAccount(); session.notice = nil } catch { session.notice = error.localizedDescription } }
          }
        }
      }.listStyle(.plain).navigationTitle("내 활동")
        .toolbar { NeighborhoodToolbar() }
        .sheet(item: $login) { _ in AccountLoginView() }
    }
  }
}

struct AccountLoginView: View {
  @Environment(AccountSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var password = ""
  @State private var name = ""
  @State private var signup = false
  @State private var pending = false
  @State private var message: String?
  @AccessibilityFocusState private var messageFocused: Bool
  var body: some View {
    NavigationStack {
      Form {
        if let message { Text(message).accessibilityFocused($messageFocused) }
        if signup { TextField("닉네임", text: $name).textContentType(.nickname) }
        TextField("이메일", text: $email).keyboardType(.emailAddress).textContentType(.emailAddress)
          .textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("account-email")
        SecureField("비밀번호 · 12~128자", text: $password).textContentType(signup ? .newPassword : .password)
          .accessibilityIdentifier("account-password")
        Button(signup ? "회원가입" : "로그인") {
          perform {
            if signup {
              try await session.emailAction("sign-up/email", email: email, password: password, name: name)
              signup = false; password = ""; message = "인증 메일을 확인한 뒤 로그인해 주세요."
            } else { try await session.login(email: email, password: password); password = ""; dismiss() }
          }
        }.buttonStyle(NeighborhoodButton()).disabled(pending || email.isEmpty || password.count < 12 || password.count > 128 || (signup && name.trimmingCharacters(in: .whitespaces).isEmpty))
        Button(signup ? "로그인으로 전환" : "회원가입으로 전환") { signup.toggle(); message = nil }.disabled(pending)
        Button("인증 메일 다시 받기") { perform { try await session.emailAction("send-verification-email", email: email); message = "인증이 필요한 계정이면 메일을 보냈습니다." } }.disabled(pending || email.isEmpty)
        Button("비밀번호 재설정 메일 받기") { perform { try await session.emailAction("request-password-reset", email: email); message = "등록된 계정이면 재설정 메일을 보냈습니다. 메일 링크에서 변경한 뒤 돌아와 로그인해 주세요." } }.disabled(pending || email.isEmpty)
        if pending { ProgressView("계정 요청 중…") }
      }.navigationTitle(signup ? "회원가입" : "로그인")
        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("닫기") { dismiss() }.disabled(pending) } }
        .interactiveDismissDisabled(pending)
    }
  }
  private func perform(_ action: @escaping @MainActor () async throws -> Void) {
    guard !pending else { return }; pending = true; message = nil
    Task {
      defer { pending = false }
      do { try await action() } catch is CancellationError { return }
      catch { message = error.localizedDescription }
      if message != nil { messageFocused = true }
    }
  }
}
