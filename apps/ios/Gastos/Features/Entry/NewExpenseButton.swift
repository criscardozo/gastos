import SwiftUI

/// "Nuevo gasto", on the screen you were already looking at.
///
/// Loading an expense stopped being a tab: it is an action, and the two places
/// you take it from are the summary (you just checked what is left) and the
/// history (you just checked what has gone). Both attach this the same way, so
/// there is one button rather than two that drift apart.
///
/// Attached with `safeAreaInset` rather than laid over the content: an overlay
/// would sit on top of the last row of the list, and the last row of a history
/// is the expense you most likely just added.
struct NewExpenseButton: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        Button {
            model.showQuickEntry = true
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.system(size: 15, weight: .bold))
                Text(model.l10n.t("entry.title"))
                    .appFont(15, .bold)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 22)
            .frame(height: 50)
            .background(Theme.accent)
            .clipShape(Capsule())
            .shadow(color: Theme.accent.opacity(0.35), radius: 12, y: 6)
        }
        .buttonStyle(.plain)
        .padding(.bottom, 10)
    }
}

extension View {
    /// Puts the button under a screen's content without covering any of it.
    func newExpenseButton() -> some View {
        safeAreaInset(edge: .bottom) { NewExpenseButton() }
    }
}
