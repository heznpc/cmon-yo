import SwiftUI

struct WalkingTab: View {
  @Environment(AccountSession.self) private var session
  @Environment(WalkingSyncService.self) private var walking
  @State private var quests: QuestsRoute?
  @State private var login: LoginRoute?
  private struct LoginRoute: Identifiable { let id = UUID() }
  var body: some View {
    NavigationStack {
      List {
        Section {
          Text("오늘의 걸음으로 함께 원정을 떠나요.").font(.title2.bold())
          Text("서울 날짜 기준 · 하루 최대 10,000걸음 반영 · 1,000걸음마다 1P")
            .font(.subheadline).foregroundStyle(.secondary)
        }
        if session.restoring { ProgressView("계정을 확인하는 중…") }
        if session.user == nil {
          Section {
            Text("로그인한 계정에 걸음과 보상을 기록합니다.")
            Button("로그인하고 걷기 시작") { login = LoginRoute() }
              .frame(minHeight: 44).disabled(session.restoring)
          }
        } else if walking.owner != session.user?.id.lowercased() {
          ProgressView("이 계정의 걷기 기록을 확인하는 중…")
        } else {
          todaySection
          healthSection
          syncSection
          Section {
            Button("원정·보상 열기") { quests = QuestsRoute() }
              .buttonStyle(NeighborhoodButton()).accessibilityIdentifier("open-quests")
            Text("혼자 걸은 보상을 받고, 최대 5명이 7일 원정의 세 단계를 함께 열 수 있습니다.")
              .font(.subheadline).foregroundStyle(.secondary)
          }
        }
      }
      .listStyle(.insetGrouped).navigationTitle("걷기")
      .sheet(item: $login) { _ in AccountLoginView() }
      .sheet(item: $quests, onDismiss: { Task { await walking.reconcile() } }) { _ in AuthenticatedQuestsView() }
      .onChange(of: session.generation) { _, _ in quests = nil }
    }
  }
  private var todaySection: some View {
    Section("오늘 · \(walking.today)") {
      if let steps = walking.todaySteps {
        Text("\(steps.formatted())걸음").font(.largeTitle.bold()).accessibilityIdentifier("walking-today")
      } else {
        Text("걸음 기록 확인 필요").font(.title3.bold()).accessibilityIdentifier("walking-no-data")
      }
      if let day = walking.serverToday {
        Text("서버 반영 \(day.creditedSteps.formatted()) / 10,000걸음")
        Text("받을 수 있는 오늘 보상 \(day.availablePoints)P · 받은 보상 \(day.claimedPoints)P")
      }
      if let dashboard = walking.dashboard { Text("보유 포인트 \(dashboard.balance)P") }
      Text("기기 기록과 서버 반영은 동기화 시점에 따라 다를 수 있습니다.")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }
  private var healthSection: some View {
    Section("건강 앱 연결") {
      Text(walking.connectedHere ? "이 기기의 건강 기록을 연결했습니다." : "이 기기의 건강 기록을 연결해 주세요.")
      Text(walking.healthMessage).font(.subheadline)
      if !walking.healthAvailable { Text("이 기기에서는 건강 데이터를 사용할 수 없습니다.") }
      Button(walking.connectedHere ? "건강 읽기 설정 다시 확인" : "건강 읽기 연결") {
        Task { await walking.connect() }
      }.frame(minHeight: 44).disabled(walking.busy || walking.pending != nil || !walking.healthAvailable)
        .accessibilityIdentifier("walking-connect")
      Text("걸음 수만 읽습니다. 읽기 요청 완료만으로 허용 여부를 판단하지 않으며, 기록이 비어 있으면 0걸음으로 반영하지 않습니다.")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }
  private var syncSection: some View {
    Section("동기화") {
      if walking.busy { ProgressView("걷기 정보를 확인하는 중…") }
      if let message = walking.message { Text(message).accessibilityIdentifier("walking-sync-message") }
      if let date = walking.lastSync { Text("마지막 반영 \(date.formatted(date: .abbreviated, time: .shortened))").font(.subheadline) }
      if walking.pending != nil {
        Button("처리 결과 조회") { Task { await walking.inspect() } }
          .frame(minHeight: 44).disabled(walking.busy)
        Button("저장된 같은 요청 다시 보내기") { Task { await walking.retryPending() } }
          .frame(minHeight: 44).disabled(walking.busy).accessibilityIdentifier("walking-retry")
      } else {
        Button("걸음 동기화·현재 상태 확인") { Task { await walking.activate(session) } }
          .frame(minHeight: 44).disabled(walking.busy).accessibilityIdentifier("walking-sync")
      }
      Text("백그라운드 반영 시각은 보장되지 않습니다. 기기 잠금을 해제하고 앱을 열면 최근 8일을 다시 확인합니다.")
        .font(.footnote).foregroundStyle(.secondary)
    }
  }
}
