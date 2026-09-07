import Foundation

/// The peso-per-dollar rate used to estimate what a card statement will cost.
///
/// The ONLY place this project talks to an exchange-rate service, and it is not
/// the ledger: an expense is AUD integer cents and no total ever converts
/// anything, which is what keeps the budget deterministic and offline-safe.
/// This is the Tarjetas screen estimating the ARS side of a USD statement,
/// where being approximately right beats showing nothing.
///
/// OFICIAL, not "tarjeta". The tarjeta quote already has the percepciones baked
/// in — using it here would charge them twice, once inside the rate and once as
/// the lines the screen adds.
///
/// The Swift twin of apps/web/src/lib/usd-rate.ts.
struct UsdArsRate: Equatable, Sendable {
    let rate: Double
    /// False when this came from the household's hand-entered fallback.
    let fromApi: Bool

    private static let url = URL(string: "https://dolarapi.com/v1/dolares/oficial")!

    private struct Response: Decodable {
        let venta: Double?
    }

    /// The API's rate when it answers, the household's stored one otherwise,
    /// nil when there is neither — better no figure than one at a made-up rate.
    ///
    /// Never throws: a screen that cannot reach an exchange-rate service must
    /// still render.
    static func resolve(fallback: Double?) async -> UsdArsRate? {
        if let live = await fetchToday() { return live }
        if let fallback, fallback > 0 { return UsdArsRate(rate: fallback, fromApi: false) }
        return nil
    }

    private static func fetchToday() async -> UsdArsRate? {
        var request = URLRequest(url: url)
        // A slow quote is worth less than a screen that paints.
        request.timeoutInterval = 4
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { return nil }
            let decoded = try JSONDecoder().decode(Response.self, from: data)
            // A rate that is not a positive number is not a rate. Guarded
            // because a wrong number here multiplies into a figure about money.
            guard let venta = decoded.venta, venta.isFinite, venta > 0 else { return nil }
            return UsdArsRate(rate: venta, fromApi: true)
        } catch {
            return nil
        }
    }
}
