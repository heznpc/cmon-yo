import SwiftUI

struct FacilitiesView: View {
  let api: FacilityAPI
  @State private var places: [Facility]?
  @State private var error: String?
  @State private var loading = true
  @State private var attempt = 0
  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          Text("무안군 공공시설 파일럿").font(.headline)
          if let error { Text(error).accessibilityIdentifier("facility-error") }
          if error != nil && places != nil { Text("이전에 불러온 목록입니다. 최신 정보를 확인하지 못했습니다.") }
          if places?.isEmpty == true { Text("등록된 시설 정보가 없습니다.") }
          ForEach(places ?? []) { place in
            VStack(alignment: .leading, spacing: 8) {
              NavigationLink(place.name) { FacilityDetailView(api: api, id: place.id) }
                .font(.headline).frame(minHeight: 44)
              Text(place.address)
              Text(place.exerciseFacilities.isEmpty ? "운동시설 정보 미제공" : place.exerciseFacilities.joined(separator: " · "))
            }.frame(maxWidth: .infinity, alignment: .leading)
          }
          if loading { ProgressView("시설을 불러오는 중…") }
          Button(error == nil ? "시설 새로고침" : "다시 시도") { attempt += 1 }.disabled(loading).frame(minHeight: 44)
          FacilitySource()
        }.padding().buttonStyle(.bordered).controlSize(.large)
      }.navigationTitle("공원과 운동시설")
        .task(id: attempt) {
          loading = true
          do {
            let response = try await api.list()
            try Task.checkCancellation()
            places = response.places
            error = nil
          } catch is CancellationError { return }
          catch { self.error = error.localizedDescription }
          loading = false
        }
    }
  }
}
private struct FacilityDetailView: View {
  let api: FacilityAPI
  let id: String
  @State private var detail: FacilityInfo?
  @State private var error: String?
  @State private var loading = true
  @State private var attempt = 0
  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        if let error { Text(error).accessibilityIdentifier("facility-error") }
        if error != nil && detail != nil { Text("이전에 불러온 정보입니다. 최신 정보를 확인하지 못했습니다.") }
        if let detail {
          Text(detail.place.name).font(.title).bold().accessibilityAddTraits(.isHeader)
          Text(detail.place.kind + " · " + detail.place.address)
          NavigationLink("이 장소의 모임 보기") { MeetingListView(placeId: id) }
          NavigationLink("이 장소에서 모임 만들기") { MeetingEditorView(placeId: id) }
          Text(detail.place.exerciseFacilities.isEmpty ? "운동시설 정보 미제공" : detail.place.exerciseFacilities.joined(separator: " · "))
          Text("공공데이터 기준일 \(detail.place.sourceDate). 현재 이용 가능 여부는 현장과 다를 수 있습니다.")
          WeatherSection(api: api, id: id).id(id)
        }
        if loading { ProgressView("시설을 불러오는 중…") }
        Button("시설 새로고침") { attempt += 1 }
          .disabled(loading).frame(minHeight: 44)
        FacilitySource()
      }.padding().frame(maxWidth: .infinity, alignment: .leading).buttonStyle(.bordered).controlSize(.large)
    }.navigationTitle("시설 상세")
      .task(id: attempt) {
        loading = true
        do {
          let response = try await api.info(id: id)
          try Task.checkCancellation()
          detail = response
          error = nil
        } catch is CancellationError { return }
        catch {
          if case FacilityError.notFound = error { detail = nil }
          self.error = error.localizedDescription
        }
        loading = false
      }
  }
}
private struct WeatherSection: View {
  let api: FacilityAPI
  let id: String
  @State private var weather: FacilityWeather?
  @State private var failed = false
  @State private var loading = true
  @State private var attempt = 0
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      if let weather { ForecastView(weather: weather, refreshFailed: failed) }
      else {
        Text("단기예보").font(.headline)
        if !loading { Text("날씨를 불러오지 못했습니다. 다시 시도해 주세요.") }
      }
      if loading { ProgressView("날씨를 불러오는 중…") }
      Button("날씨 다시 조회") { attempt += 1 }.disabled(loading).frame(minHeight: 44)
    }.task(id: attempt) {
      loading = true
      do {
        let result = try await api.weather(id: id)
        try Task.checkCancellation()
        weather = result.weather; failed = false
      } catch is CancellationError { return }
      catch { failed = true }
      loading = false
    }
  }
}
private struct FacilitySource: View {
  var body: some View {
    Link("출처: 전국도시공원정보표준데이터", destination: URL(string: "https://www.data.go.kr/data/15012890/standard.do")!)
      .frame(minHeight: 44)
  }
}
private struct ForecastView: View {
  let weather: FacilityWeather
  let refreshFailed: Bool
  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("단기예보").font(.headline)
      if let facts = weather.facts {
        Text(weather.status == .stale || refreshFailed ? "날씨 갱신에 실패했습니다. 이전에 받은 예보입니다." : "최근에 받은 예보입니다.")
        Text("예보 대상 · 한국 시간 \(date(facts.validAt))")
        Text("기온 \(number(facts.temperatureC, unit: "°C"))")
        Text("강수확률 \(number(facts.precipitationProbabilityPercent, unit: "%"))")
        Text("강수형태 \(["none": "없음", "rain": "비", "snow": "눈", "mixed": "비/눈"][facts.precipitationType] ?? "정보 없음")")
        Text("풍속 \(number(facts.windSpeedMetersPerSecond, unit: "m/s"))")
        Text("기상청 발표 \(date(facts.issuedAt)) · 조회 \(date(facts.fetchedAt))")
      } else { Text("날씨를 불러오지 못했습니다. 다시 시도해 주세요.") }
    }
  }
  private func number(_ value: Double?, unit: String) -> String {
    guard let value else { return "정보 없음" }
    return "\(value.formatted()) \(unit)"
  }
  private func date(_ value: Date) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "ko_KR")
    formatter.timeZone = TimeZone(identifier: "Asia/Seoul")
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return formatter.string(from: value)
  }
}
