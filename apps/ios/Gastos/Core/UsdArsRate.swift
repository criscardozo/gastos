import Foundation

/// The peso-per-dollar rate used to estimate what a card statement will cost.
///
/// The ONLY place this project talks to an exchange-rate service, and it is not
/// the ledger: an expense is AUD integer cents and no total ever converts
/// anything, which is what keeps the budget deterministic and offline-safe.
/// This is the Tarjetas screen estimating the ARS side of a USD statement,
/// where being approximately right beats showing nothing.
///
/// MAYORISTA, not oficial: BBVA values the whole statement at one rate, and on
/// the statement closing 2026-10-01 it was 1517,00 — that day's mayorista
/// selling rate; the oficial was 1540. A closed statement is valued at its
/// closing day's (argentinadatos.com, history by date), the open one at
/// today's (dolarapi.com). Never "tarjeta": it has the percepciones baked in.
/// The measurements behind all of it are in apps/web/src/lib/usd-rate.ts.
///
/// The Swift twin of that file.
struct UsdArsRate: Equatable, Sendable {
    let rate: Double
    /// False when this came from the household's hand-entered fallback.
    let fromApi: Bool

    private static let todayUrl = URL(string: "https://dolarapi.com/v1/dolares/mayorista")!
    private static let historyBase = "https://api.argentinadatos.com/v1/cotizaciones/dolares/mayorista"

    private struct Response: Decodable {
        let venta: Double?
    }

    /// The statement's rate when a service answers, the household's stored one
    /// otherwise, nil when there is neither — better no figure than one at a
    /// made-up rate.
    ///
    /// Never throws: a screen that cannot reach an exchange-rate service must
    /// still render.
    static func resolve(
        closingDate: CalendarDate,
        today: CalendarDate,
        fallback: Double?
    ) async -> UsdArsRate? {
        if let live = await fetchStatementRate(closingDate: closingDate, today: today) {
            return live
        }
        if let fallback, fallback > 0 { return UsdArsRate(rate: fallback, fromApi: false) }
        return nil
    }

    /// The closing day's rate once the statement has closed (today is on or
    /// past it), today's while it is open — and today's too when the history
    /// service says nothing, because a near rate beats none.
    static func fetchStatementRate(
        closingDate: CalendarDate,
        today: CalendarDate,
        fetch: (URL) async -> Data? = download
    ) async -> UsdArsRate? {
        if closingDate <= today,
           let url = historyUrl(closingDate),
           let onClosing = decode(await fetch(url)) {
            return onClosing
        }
        return decode(await fetch(todayUrl))
    }

    static func historyUrl(_ day: CalendarDate) -> URL? {
        URL(string: "\(historyBase)/\(day.raw.replacingOccurrences(of: "-", with: "/"))")
    }

    static func decode(_ data: Data?) -> UsdArsRate? {
        guard let data, let decoded = try? JSONDecoder().decode(Response.self, from: data) else {
            return nil
        }
        // A rate that is not a positive number is not a rate. Guarded because a
        // wrong number here multiplies into a figure about money.
        guard let venta = decoded.venta, venta.isFinite, venta > 0 else { return nil }
        return UsdArsRate(rate: venta, fromApi: true)
    }

    private static func download(_ url: URL) async -> Data? {
        var request = URLRequest(url: url)
        // A slow quote is worth less than a screen that paints.
        request.timeoutInterval = 4
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            return data
        } catch {
            return nil
        }
    }
}
