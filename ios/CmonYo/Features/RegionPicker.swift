import SwiftUI

struct RegionPicker: View {
  let api: FacilityAPI
  @Binding var selection: String
  @State private var regions: [FacilityRegion] = []
  @State private var failed = false
  @State private var attempt = 0
  var body: some View {
    Picker("동네", selection: $selection) {
      Text("전체").tag("")
      ForEach(regions) { Text($0.name).tag($0.code) }
      if !selection.isEmpty && !regions.contains(where: { $0.code == selection }) { Text("지역 \(selection)").tag(selection) }
    }.task(id: attempt) {
      do {
        let result = try await api.regions()
        try Task.checkCancellation()
        regions = result.regions; failed = false
      } catch is CancellationError { return }
      catch { failed = true }
    }
    if failed {
      Text("동네 목록을 불러오지 못했습니다.")
      Button("동네 다시 조회") { attempt += 1 }
    }
  }
}

struct FacilityPicker: View {
  let api: FacilityAPI
  @Binding var selection: String
  @State private var region = ""
  @State private var page = 0
  @State private var nextPage: Int?
  @State private var places: [Facility] = []
  @State private var loading = true
  @State private var failed = false
  @State private var attempt = 0
  var body: some View {
    Group {
      RegionPicker(api: api, selection: $region)
        .onChange(of: region) { _, _ in page = 0; places = []; selection = ""; nextPage = nil }
      Picker("장소", selection: $selection) {
        Text("시설 선택").tag("")
        ForEach(places) { Text($0.name).tag($0.id) }
        if !selection.isEmpty && !places.contains(where: { $0.id == selection }) { Text("선택한 시설").tag(selection) }
      }
      if loading { ProgressView("시설을 불러오는 중…") }
      if failed {
        Text("시설 목록을 불러오지 못했습니다. 작성한 입력은 유지됩니다.")
        Button("시설 다시 조회") { attempt += 1 }.disabled(loading)
      }
      if let nextPage { Button("시설 더 불러오기") { page = nextPage }.disabled(loading) }
    }.task(id: "\(region):\(page):\(attempt)") {
      loading = true
      do {
        let result = try await api.list(regionCode: region, page: page)
        try Task.checkCancellation()
        if page == 0 { places = result.places }
        else { places += result.places.filter { item in !places.contains(where: { $0.id == item.id }) } }
        nextPage = result.nextPage; failed = false
      } catch is CancellationError { return }
      catch { failed = true }
      loading = false
    }
  }
}
