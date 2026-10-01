import Foundation

/// Whether the Gmail ingestion has stopped running.
///
/// Its 15-minute Apps Script trigger can stop without a word — Google disables
/// a trigger that keeps failing, an authorisation lapses — and from then on no
/// charge arrives and the bank section simply looks quiet. The ingestion stamps
/// `households/{id}/ingestStatus/latest` at the end of every run it finishes,
/// and this decides when that stamp is too old. The web's `ingestHealth` runs
/// the same cases (`shared/ingest-vectors.json`).
enum IngestHealth: Equatable {
    /// No heartbeat document: an ingestion older than the heartbeat, which
    /// says nothing about whether it runs — so nothing is said.
    case unknown
    case fresh(hours: Int)
    case stale(hours: Int)

    static let staleAfterMinutes = 120

    static func of(ranAt: Date?, now: Date) -> IngestHealth {
        guard let ranAt else { return .unknown }
        // A stamp in the future says the script ran, not that it stopped.
        let minutes = max(0, Int((now.timeIntervalSince(ranAt) / 60).rounded(.down)))
        let hours = minutes / 60
        return minutes > staleAfterMinutes ? .stale(hours: hours) : .fresh(hours: hours)
    }
}
