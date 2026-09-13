import SwiftUI

struct MeetupView: View {
  let api: MeetupAPI
  let meetupID: String
  @State private var detail: MeetupDetail?
  @State private var error: String?
  @State private var loading = true
  @State private var attempt = 0
  @State private var discussion: DiscussionRoute?
  @AccessibilityFocusState private var titleFocused: Bool
  struct DiscussionRoute: Identifiable { let id: String }
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Text("공개 샘플 모임 · 실제 모집이 아닙니다.").foregroundStyle(.primary)
          if let error { Text(error).accessibilityIdentifier("meetup-error") }
          if detail != nil && error != nil {
            Text("이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.")
              .accessibilityIdentifier("meetup-stale")
          }
          if let meetup = detail?.meetup {
            Text(meetup.title).font(.title).bold().accessibilityAddTraits(.isHeader)
              .accessibilityIdentifier("meetup-title").accessibilityFocused($titleFocused)
            field(
              "일시 · 한국 시간", value: "\(displayDate(meetup.startsAt)) – \(displayDate(meetup.endsAt))"
            )
            field("장소", value: meetup.place.name)
            field(
              "종목",
              value: ["walking": "걷기", "running": "달리기", "cycling": "자전거"][meetup.sport]
                ?? "알 수 없는 종목")
            field("정원", value: "\(meetup.capacity)명")
            Text(meetup.description ?? "등록된 설명이 없습니다.")
            Button("읽기 전용 모임 안내") { discussion = DiscussionRoute(id: meetup.id) }.frame(
              minHeight: 44)
          }
          if loading { ProgressView("모임을 불러오는 중…") }
          Button(error == nil ? "모임 새로고침" : "다시 시도") { attempt += 1 }.disabled(loading).frame(
            minHeight: 44)
        }.padding().buttonStyle(.bordered).controlSize(.large)
      }
      .navigationTitle("C'mon Yo!")
      .task(id: attempt) {
        loading = true
        do {
          let loaded = try await api.detail(id: meetupID)
          try Task.checkCancellation()
          detail = loaded
          error = nil
        } catch is CancellationError { return } catch {
          if case APIError.notFound = error { detail = nil }
          self.error = error.localizedDescription
        }
        loading = false
      }
      .sheet(item: $discussion, onDismiss: { titleFocused = true }) { route in
        DiscussionView(origin: api.baseURL, meetupID: route.id) { returnedID in
          guard returnedID == meetupID else { return }
          discussion = nil  // Existing detail stays mounted; no navigation push.
        }
      }
    }
  }
  private func field(_ label: String, value: String) -> some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(label).font(.headline)
      Text(value).foregroundStyle(.primary).fixedSize(horizontal: false, vertical: true)
    }
  }
  private func displayDate(_ value: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.dateStyle = .long
    formatter.timeStyle = .short
    return formatter.string(from: value)
  }
}
