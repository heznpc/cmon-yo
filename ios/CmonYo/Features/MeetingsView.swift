import SwiftUI

struct MeetingsTab: View {
  var body: some View { NavigationStack { MeetingListView().toolbar { NeighborhoodToolbar() } } }
}
struct MeetingListView: View {
  @Environment(AccountSession.self) private var session
  var mine = false
  var placeId: String?
  @State private var region = ""
  @State private var sport = ""
  @State private var dateEnabled = false
  @State private var day = Date()
  @State private var page = 0
  @State private var nextPage: Int?
  @State private var rows: [MeetingRecord] = []
  @State private var loading = true
  @State private var error: String?
  @State private var attempt = 0
  @State private var login: AccountView.LoginRoute?
  var body: some View {
    List {
      if mine && session.user == nil {
        Button("로그인하고 내 모임 보기") { login = .init() }
      } else {
        if !mine {
          Section("조회 조건") {
            RegionPicker(api: FacilityAPI(baseURL: session.baseURL), selection: $region)
            Picker("종목", selection: $sport) { Text("전체").tag(""); Text("걷기").tag("walking"); Text("달리기").tag("running"); Text("자전거").tag("cycling") }
            Toggle("날짜 지정", isOn: $dateEnabled)
            if dateEnabled { DatePicker("날짜 · 한국 시간", selection: $day, displayedComponents: .date).environment(\.timeZone, TimeZone(identifier: "Asia/Seoul")!) }
            Button("조건 적용") { page = 0; attempt += 1 }.disabled(loading)
          }
          NavigationLink("모임 만들기") { MeetingEditorView(placeId: placeId) }.buttonStyle(NeighborhoodButton())
        }
        if loading { ProgressView("모임을 불러오는 중…") }
        if let error { Text(error) }
        if !loading && error == nil && rows.isEmpty { Text(mine ? "아직 주최하거나 참여한 모임이 없습니다." : "조건에 맞는 모임이 없습니다.") }
        ForEach(rows) { meeting in
          NavigationLink { MeetingRecordView(id: meeting.id) } label: {
            HStack(alignment: .top, spacing: 16) {
              NeighborhoodIcon(symbol: meeting.sport == "cycling" ? "bicycle" : meeting.sport == "running" ? "figure.run" : "figure.walk")
              VStack(alignment: .leading, spacing: 6) {
              Text(meeting.title).font(.headline).foregroundStyle(.primary)
              Text(meeting.place.name + " · " + meeting.sportLabel)
              Text(MeetingRecord.display(meeting.start))
              Text("\(meeting.stateLabel) · \(meeting.participantCount)/\(meeting.capacity)명")
              if mine { Text(meeting.role == "host" ? "주최" : meeting.participationStatus == "cancelled" ? "참여 취소" : "참여 중") }
              }.font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
            }.padding(.vertical, 12)
          }
        }
        Button("모임 목록 새로고침") { attempt += 1 }.disabled(loading)
        if page > 0 { Button("이전 페이지") { page -= 1; attempt += 1 }.disabled(loading) }
        if let nextPage { Button("다음 페이지") { page = nextPage; attempt += 1 }.disabled(loading) }
      }
    }.listStyle(.plain).navigationTitle(mine ? "내 모임" : "운동 모임")
      .task(id: "\(attempt):\(session.generation):\(session.user?.id ?? "anonymous")") { await load() }
      .sheet(item: $login) { _ in AccountLoginView() }
  }
  private func load() async {
    if mine && session.user == nil { rows = []; loading = false; return }
    loading = true; error = nil
    var parts = URLComponents(); var items = [URLQueryItem(name: "page", value: String(page))]
    if !mine {
      if !region.isEmpty { items.append(.init(name: "regionCode", value: region)) }
      if !sport.isEmpty { items.append(.init(name: "sport", value: sport)) }
      if let placeId { items.append(.init(name: "placeId", value: placeId)) }
      if dateEnabled { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Asia/Seoul"); items.append(.init(name: "date", value: f.string(from: day))) }
    }
    parts.queryItems = items
    do {
      let response: MeetingListResponse = try await session.request("api/v1/\(mine ? "me/meetups" : "meetups")?\(parts.percentEncodedQuery!)", authenticated: mine)
      if mine && response.userId != session.user?.id { throw ProductError(status: 0, code: "RESPONSE") }
      try response.meetups.forEach { try $0.validate() }
      rows = response.meetups; nextPage = response.nextPage
    } catch is CancellationError { return }
    catch { self.error = error.localizedDescription; if mine { rows = [] } }
    loading = false
  }
}

struct MeetingDiscussionRoute: Identifiable { let id: String }

struct MeetingRecordView: View {
  @Environment(AccountSession.self) private var session
  let id: String
  @State private var meeting: MeetingRecord?
  @State private var membership: MembershipResponse?
  @State private var loading = true
  @State private var error: String?
  @State private var attempt = 0
  @State private var login: AccountView.LoginRoute?
  @State private var confirm: String?
  @State private var command = MeetingCommand()
  @State private var discussion: MeetingDiscussionRoute?
  var body: some View {
    List {
      if let error { Text(error).accessibilityIdentifier("meeting-error") }
      if let m = meeting {
        Text(m.title).font(.title2).bold().accessibilityIdentifier("meeting-title")
        Text("일시 · 한국 시간").font(.headline)
        Text(MeetingRecord.display(m.start) + " – " + MeetingRecord.display(m.end))
        Text(m.place.name); Text(m.sportLabel)
        Text("\(m.stateLabel) · \(m.participantCount)/\(m.capacity)명")
        Text(m.description.isEmpty ? "등록된 설명이 없습니다." : m.description)
        if session.user != nil {
          Button("모임 이야기 · 댓글 쓰기") { discussion = .init(id: id) }
            .buttonStyle(NeighborhoodButton()).disabled(loading || error != nil)
        }
        if session.user == nil {
          Button("로그인하고 계속하기") { login = .init() }
        } else if !loading && error == nil && membership?.version == m.version {
          if membership?.role == "host" {
            Text("내가 주최한 모임입니다.")
            if m.mutable {
              NavigationLink("모임 수정") { MeetingEditorView(initial: m) }.disabled(command.pending || command.uncertain)
              Button("모임 취소", role: .destructive) { confirm = "cancel" }.disabled(command.pending || command.uncertain)
            }
          } else if membership?.role == "participant" {
            Text("참여 중입니다.")
            if m.mutable { Button("참여 취소") { confirm = "leave" }.disabled(command.pending || command.uncertain) }
          } else if m.mutable && m.participantCount < m.capacity {
            Button("참여하기") { change("join", meeting: m) }.buttonStyle(NeighborhoodButton()).disabled(command.pending || command.uncertain)
          }
          if let confirm {
            Text(confirm == "cancel" ? "모임을 취소하면 모든 참여자에게 취소 상태로 표시됩니다." : "참여를 취소하시겠습니까?")
            Button("취소 확정", role: .destructive) { change(confirm, meeting: m) }.disabled(command.pending || command.uncertain)
            Button("유지하기") { self.confirm = nil }
          }
        }
      }
      CommandFeedback(command: command) { _ in attempt += 1 }
      if loading { ProgressView("현재 상태를 확인하는 중…") }
      Button("현재 상태 다시 조회") { attempt += 1 }.disabled(loading || command.pending)
    }.navigationTitle("모임 상세")
      .task(id: "\(attempt):\(session.generation):\(session.user?.id ?? "anonymous")") { await load() }
      .sheet(item: $login) { _ in AccountLoginView() }
      .sheet(item: $discussion) { route in
        AuthenticatedDiscussionView(meetupID: route.id) { attempt += 1 }
      }
      .onChange(of: session.generation) { _, _ in discussion = nil }
  }
  private func change(_ action: String, meeting: MeetingRecord) {
    guard let body = try? JSONEncoder().encode(MeetingChange(action: action, expectedVersion: meeting.version)) else { return }
    Task { if await command.run(session: session, path: "api/v1/meetups/\(id)", method: "PATCH", body: body) != nil { confirm = nil; attempt += 1 } }
  }
  private func load() async {
    loading = true; error = nil; membership = nil; confirm = nil
    do {
      let response: MeetingRecordResponse = try await session.request("api/v1/meetups/\(id)", authenticated: false)
      try response.meetup.validate(); meeting = response.meetup
      if let user = session.user {
        let state: MembershipResponse = try await session.request("api/v1/meetups/\(id)/membership")
        guard state.userId == user.id, [nil, "host", "participant"].contains(state.role) else { throw ProductError(status: 0, code: "RESPONSE") }
        membership = state
      }
    } catch is CancellationError { return }
    catch { if (error as? ProductError)?.status == 404 { meeting = nil }; self.error = error.localizedDescription }
    loading = false
  }
}

struct CommandFeedback: View {
  @Environment(AccountSession.self) private var session
  var command: MeetingCommand
  var confirmed: (String) -> Void
  var body: some View {
    if let message = command.message { Text(message) }
    if command.pending { ProgressView("처리 중…") }
    if command.uncertain {
      Button("요청 처리 상태 확인") { Task { if let id = await command.inspect(session: session) { confirmed(id) } } }.disabled(command.pending)
      Button("같은 요청 다시 보내기") { Task { if let id = await command.send(session: session) { confirmed(id) } } }.disabled(command.pending)
    }
  }
}

struct MeetingEditorView: View {
  @Environment(AccountSession.self) private var session
  @Environment(\.dismiss) private var dismiss
  var initial: MeetingRecord?
  var placeId: String?
  @State private var draft = MeetingDraft()
  @State private var start = Date().addingTimeInterval(86400)
  @State private var end = Date().addingTimeInterval(90000)
  @State private var error: String?
  @State private var initialized = false
  @State private var login: AccountView.LoginRoute?
  @State private var createdID: String?
  @State private var command = MeetingCommand()
  var body: some View {
    Form {
      if session.user == nil { Button("로그인하고 모임 만들기") { login = .init() } }
      else if let createdID {
        Text("모임을 생성했습니다.")
        NavigationLink("생성한 모임 보기") { MeetingRecordView(id: createdID) }
      } else {
        Section {
          TextField("제목", text: $draft.title).accessibilityIdentifier("meeting-draft-title")
          TextField("설명", text: $draft.description, axis: .vertical).lineLimit(3...6)
          Picker("종목", selection: $draft.sport) { Text("걷기").tag("walking"); Text("달리기").tag("running"); Text("자전거").tag("cycling") }
          FacilityPicker(api: FacilityAPI(baseURL: session.baseURL), selection: $draft.placeId)
          DatePicker("시작 · 한국 시간", selection: $start).environment(\.timeZone, TimeZone(identifier: "Asia/Seoul")!)
          DatePicker("종료 · 한국 시간", selection: $end).environment(\.timeZone, TimeZone(identifier: "Asia/Seoul")!)
          Stepper("정원 · 주최자 포함 \(draft.capacity)명", value: $draft.capacity, in: 2...100)
          Button(initial == nil ? "모임 생성" : "수정 저장") { submit() }.disabled(draft.placeId.isEmpty)
        }.disabled(command.pending || command.uncertain)
        if let error { Text(error) }
        CommandFeedback(command: command, confirmed: saved)
      }
    }.navigationTitle(initial == nil ? "모임 만들기" : "모임 수정")
      .task {
        if !initialized {
          if let m = initial { draft = MeetingDraft(title: m.title, description: m.description, sport: m.sport, placeId: m.place.id, startsAt: m.startsAt, endsAt: m.endsAt, capacity: m.capacity); start = m.start; end = m.end }
          else { draft.placeId = placeId ?? "" }
          initialized = true
        }
      }
      .sheet(item: $login) { _ in AccountLoginView() }
  }
  private func submit() {
    draft.title = draft.title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !draft.title.isEmpty, draft.title.count <= 120, draft.description.count <= 2000, !draft.placeId.isEmpty, start > Date(), end > start else { error = "제목·시설·시작과 종료 시간·정원을 확인해 주세요."; return }
    draft.startsAt = MeetingRecord.iso(start); draft.endsAt = MeetingRecord.iso(end); error = nil
    let body = initial.map { try? JSONEncoder().encode(MeetingChange(action: "edit", expectedVersion: $0.version, input: draft)) } ?? (try? JSONEncoder().encode(draft))
    guard let body else { return }
    Task { if let id = await command.run(session: session, path: initial.map { "api/v1/meetups/\($0.id)" } ?? "api/v1/meetups", method: initial == nil ? "POST" : "PATCH", body: body) { saved(id) } }
  }
  private func saved(_ id: String) { if initial != nil { dismiss() } else { createdID = id } }
}
