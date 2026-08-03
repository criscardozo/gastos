import WidgetKit
import SwiftUI

// MARK: - Timeline

struct BudgetEntry: TimelineEntry {
    let date: Date
    let snapshot: BudgetSnapshot?
}

struct BudgetProvider: TimelineProvider {
    func placeholder(in context: Context) -> BudgetEntry {
        BudgetEntry(date: Date(), snapshot: .sample)
    }

    func getSnapshot(in context: Context, completion: @escaping (BudgetEntry) -> Void) {
        let snapshot = BudgetSnapshot.load() ?? (context.isPreview ? .sample : nil)
        completion(BudgetEntry(date: Date(), snapshot: snapshot))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<BudgetEntry>) -> Void) {
        // Data changes arrive via reloadAllTimelines() from the app; the
        // hourly policy just keeps the "days left" line honest overnight.
        let entry = BudgetEntry(date: Date(), snapshot: BudgetSnapshot.load())
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: Date())
            ?? Date().addingTimeInterval(3600)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Widget

struct BudgetWidget: Widget {
    let kind = "GastosDiariosBudgetWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: BudgetProvider()) { entry in
            BudgetWidgetView(entry: entry)
        }
        .configurationDisplayName(String(localized: "widget.name"))
        .description(String(localized: "widget.description"))
        .supportedFamilies([.systemSmall, .accessoryCircular, .accessoryRectangular, .accessoryInline])
    }
}

// MARK: - Views

struct BudgetWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: BudgetEntry

    var body: some View {
        Group {
            if let snapshot = entry.snapshot {
                switch family {
                case .accessoryCircular:
                    circular(snapshot)
                case .accessoryRectangular:
                    rectangular(snapshot)
                case .accessoryInline:
                    inline(snapshot)
                default:
                    small(snapshot)
                        // Tapping the small widget jumps straight to quick entry.
                        .widgetURL(URL(string: "gastosdiarios://nuevo"))
                }
            } else {
                empty
            }
        }
        .containerBackground(for: .widget) { WidgetTheme.bg }
    }

    // MARK: Home Screen small

    private func small(_ snapshot: BudgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(String(localized: "widget.remaining.label").uppercased())
                .font(.system(size: 11, weight: .bold))
                .kerning(0.7)
                .foregroundStyle(WidgetTheme.inkTertiary)
            Text(snapshot.formattedRemaining(compact: true))
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(snapshot.state == "over" ? WidgetTheme.red : WidgetTheme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
            bar(snapshot)
            HStack(spacing: 4) {
                if let days = snapshot.daysLeft() {
                    Text(daysText(days))
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(WidgetTheme.inkSecondary)
                }
                Spacer()
                Circle()
                    .fill(WidgetTheme.stateColor(snapshot.state))
                    .frame(width: 7, height: 7)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }

    private func bar(_ snapshot: BudgetSnapshot) -> some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(
                    snapshot.state == "over"
                        ? WidgetTheme.red.opacity(0.2)
                        : WidgetTheme.track
                )
                Capsule()
                    .fill(WidgetTheme.stateColor(snapshot.state))
                    .frame(width: geo.size.width * snapshot.spentFraction)
            }
        }
        .frame(height: 7)
    }

    // MARK: Lock Screen accessories

    private func circular(_ snapshot: BudgetSnapshot) -> some View {
        Gauge(value: snapshot.spentFraction) {
            Text("$")
        } currentValueLabel: {
            Text(snapshot.shortRemaining)
                .monospacedDigit()
                .minimumScaleFactor(0.5)
        }
        .gaugeStyle(.accessoryCircular)
        .tint(WidgetTheme.stateColor(snapshot.state))
    }

    private func rectangular(_ snapshot: BudgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(remainingText(snapshot))
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            ProgressView(value: snapshot.spentFraction)
                .tint(WidgetTheme.stateColor(snapshot.state))
            if let days = snapshot.daysLeft() {
                Text(daysText(days))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func inline(_ snapshot: BudgetSnapshot) -> some View {
        Text(remainingText(snapshot))
    }

    // MARK: Empty state (no snapshot written yet)

    private var empty: some View {
        Group {
            switch family {
            case .accessoryCircular:
                Image(systemName: "arrow.up.forward.app")
            case .accessoryInline, .accessoryRectangular:
                Text(String(localized: "widget.empty.title"))
            default:
                VStack(spacing: 5) {
                    Image(systemName: "arrow.up.forward.app")
                        .font(.system(size: 20, weight: .medium))
                        .foregroundStyle(WidgetTheme.inkTertiary)
                    Text(String(localized: "widget.empty.title"))
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(WidgetTheme.ink)
                    Text(String(localized: "widget.empty.body"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(WidgetTheme.inkSecondary)
                        .multilineTextAlignment(.center)
                }
            }
        }
    }

    // MARK: Localized fragments (widget locale = system locale)

    /// Lock Screen accessories: the active currency only — there is no room
    /// for a second figure in these families.
    private func remainingText(_ snapshot: BudgetSnapshot) -> String {
        String(
            format: String(localized: "widget.remaining"),
            locale: .autoupdatingCurrent,
            snapshot.formattedRemaining(compact: true)
        )
    }

    private func daysText(_ days: Int) -> String {
        if days == 1 {
            return String(localized: "widget.days.one")
        }
        return String(
            format: String(localized: "widget.days.other"),
            locale: .autoupdatingCurrent,
            days
        )
    }
}
