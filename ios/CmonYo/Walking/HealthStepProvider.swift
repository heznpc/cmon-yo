import Foundation
@preconcurrency import HealthKit
import Observation

@MainActor
protocol WalkingHealthProvider: AnyObject {
  var available: Bool { get }
  var requested: Bool { get }
  func requestReadAccess() async throws
  func readDays(now: Date) async throws -> [HealthWalkingDay]
  func observe(_ changed: @escaping @MainActor @Sendable () async -> Void)
  func stop()
}

// Authorization completion does not disclose whether HealthKit read access was granted.
// Only statistics with an actual sum are returned; absent data is never synthesized as zero.
@MainActor @Observable
final class HealthStepProvider: WalkingHealthProvider {
  var available: Bool { HKHealthStore.isHealthDataAvailable() }
  var requested: Bool { defaults.bool(forKey: "cmon.walking.read-requested") }
  private let store = HKHealthStore()
  private let defaults: UserDefaults
  private let stepType = HKQuantityType.quantityType(forIdentifier: .stepCount)!
  private var observer: HKObserverQuery?
  private var readOperation: HealthReadOperation?
  private(set) var backgroundNotice: String?

  init(defaults: UserDefaults = .standard) { self.defaults = defaults }

  func requestReadAccess() async throws {
    guard available else { throw ProductError(status: 0, code: "HEALTH_UNAVAILABLE") }
    try await store.requestAuthorization(toShare: [], read: [stepType])
    defaults.set(true, forKey: "cmon.walking.read-requested")
  }

  func readDays(now: Date) async throws -> [HealthWalkingDay] {
    guard available, requested else { return [] }
    try Task.checkCancellation()
    let operation = HealthReadOperation()
    readOperation = operation
    defer {
      if let query = operation.query { store.stop(query) }
      if readOperation === operation { readOperation = nil }
    }
    let start = WalkingCalendar.start(now: now)
    let predicate = HKQuery.predicateForSamples(withStart: start, end: now)
    var interval = DateComponents(day: 1)
    interval.calendar = WalkingCalendar.seoul
    interval.timeZone = WalkingCalendar.seoul.timeZone
    let result = try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<[HealthWalkingDay], Error>) in
        operation.continuation = continuation
        let query = HKStatisticsCollectionQuery(quantityType: stepType, quantitySamplePredicate: predicate,
          options: .cumulativeSum, anchorDate: start, intervalComponents: interval)
        operation.query = query
        query.initialResultsHandler = { _, collection, error in
          if let error {
            Task { @MainActor in operation.finish(.failure(error)) }
            return
          }
          var days: [HealthWalkingDay] = []
          var invalid = false
          collection?.enumerateStatistics(from: start, to: now) { statistics, _ in
            guard let quantity = statistics.sumQuantity() else { return }
            let raw = quantity.doubleValue(for: .count())
            guard raw.isFinite, raw >= 0, raw <= 100_000 else { invalid = true; return }
            days.append(HealthWalkingDay(day: WalkingCalendar.day(statistics.startDate), steps: Int(raw.rounded(.down))))
          }
          let outcome: Result<[HealthWalkingDay], Error> = invalid
            ? .failure(ProductError(status: 0, code: "HEALTH_RANGE")) : .success(days)
          Task { @MainActor in operation.finish(outcome) }
        }
        store.execute(query)
      }
    } onCancel: {
      Task { @MainActor [weak self] in
        if let query = operation.query { self?.store.stop(query) }
        operation.finish(.failure(CancellationError()))
      }
    }
    try Task.checkCancellation()
    return result
  }

  func observe(_ changed: @escaping @MainActor @Sendable () async -> Void) {
    guard available, requested, observer == nil else { return }
    let query = HKObserverQuery(sampleType: stepType, predicate: nil) { _, completion, error in
      let acknowledgement = HealthObserverAcknowledgement(completion)
      Task { @MainActor in
        defer { acknowledgement.finish() }
        guard error == nil else { return }
        await changed()
      }
    }
    observer = query
    store.execute(query)
    // Delivery is system scheduled; foreground reconciliation remains necessary.
    store.enableBackgroundDelivery(for: stepType, frequency: .hourly) { [weak self] enabled, _ in
      Task { @MainActor in
        self?.backgroundNotice = enabled ? nil : "백그라운드 알림을 설정하지 못했습니다. 앱에서 다시 동기화해 주세요."
      }
    }
  }

  func stop() {
    if let observer { store.stop(observer) }
    observer = nil
    if let operation = readOperation {
      if let query = operation.query { store.stop(query) }
      operation.finish(.failure(CancellationError()))
    }
    readOperation = nil
  }
}

@MainActor
private final class HealthReadOperation {
  var query: HKQuery?
  var continuation: CheckedContinuation<[HealthWalkingDay], Error>?
  func finish(_ result: Result<[HealthWalkingDay], Error>) {
    continuation?.resume(with: result)
    continuation = nil
  }
}

private final class HealthObserverAcknowledgement: @unchecked Sendable {
  private let lock = NSLock()
  private var completion: (() -> Void)?
  init(_ completion: @escaping () -> Void) { self.completion = completion }
  func finish() {
    lock.lock()
    let callback = completion
    completion = nil
    lock.unlock()
    callback?()
  }
}
