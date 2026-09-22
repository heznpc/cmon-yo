import CryptoKit
import Foundation

@MainActor
protocol WalkingJournalStore {
  func deviceID(origin: URL) throws -> String
  func load(owner: String, origin: URL) throws -> WalkingJournal
  func save(_ journal: WalkingJournal, origin: URL) throws
}

@MainActor
struct FileWalkingJournalStore: WalkingJournalStore {
  private let directory: URL
  init(directory: URL? = nil) {
    self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
      .appending(path: "Walking", directoryHint: .isDirectory)
  }
  private func path(_ key: String) -> URL {
    let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
    return directory.appending(path: digest + ".json")
  }
  private func write(_ data: Data, to url: URL) throws {
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    var protectedDirectory = directory
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try protectedDirectory.setResourceValues(values)
    try data.write(to: url, options: [.atomic, .completeFileProtection])
  }
  func deviceID(origin: URL) throws -> String {
    let url = path("device:" + origin.absoluteString)
    if FileManager.default.fileExists(atPath: url.path) {
      let id = try JSONDecoder().decode(String.self, from: Data(contentsOf: url))
      guard UUID(uuidString: id) != nil else { throw ProductError(status: 0, code: "WALKING_STORAGE") }
      return id.lowercased()
    }
    let id = UUID().uuidString.lowercased()
    try write(JSONEncoder().encode(id), to: url)
    return id
  }
  func load(owner: String, origin: URL) throws -> WalkingJournal {
    let url = path(origin.absoluteString + ":" + owner)
    guard FileManager.default.fileExists(atPath: url.path) else { return WalkingJournal(owner: owner) }
    let journal = try JSONDecoder().decode(WalkingJournal.self, from: Data(contentsOf: url))
    guard journal.owner == owner, journal.revision >= 0,
      journal.sourceId.map({ UUID(uuidString: $0) != nil }) ?? true,
      journal.pending.map({ UUID(uuidString: $0.key) != nil }) ?? true
    else { throw ProductError(status: 0, code: "WALKING_STORAGE") }
    return journal
  }
  func save(_ journal: WalkingJournal, origin: URL) throws {
    try write(JSONEncoder().encode(journal), to: path(origin.absoluteString + ":" + journal.owner))
  }
}
