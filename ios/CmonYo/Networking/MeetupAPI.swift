import Foundation

enum APIError: Error, LocalizedError {
  case notFound, unavailable, invalidResponse
  var errorDescription: String? {
    switch self {
    case .notFound: "모임을 찾을 수 없습니다."
    case .unavailable: "연결에 실패했습니다. 다시 시도해 주세요."
    case .invalidResponse: "모임 응답을 읽을 수 없습니다."
    }
  }
}
struct MeetupAPI: Sendable {
  let baseURL: URL
  func detail(id: String) async throws -> MeetupDetail {
    guard validID(id) else { throw APIError.notFound }
    var request = URLRequest(
      url: baseURL.appending(path: "api/v1/meetups/\(id)"),
      cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 5)
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    let data: Data
    let response: URLResponse
    do { (data, response) = try await URLSession.shared.data(for: request) } catch {
      if Task.isCancelled { throw CancellationError() }
      throw APIError.unavailable
    }
    guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }
    guard http.statusCode == 200 else {
      throw http.statusCode == 404 ? APIError.notFound : APIError.unavailable
    }
    do { return try JSONDecoder().decode(MeetupDetail.self, from: data) } catch {
      throw APIError.invalidResponse
    }
  }
}
