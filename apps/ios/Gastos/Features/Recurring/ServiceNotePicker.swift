import FirebaseFirestore
import SwiftUI

/// The note of an expense filed in the Servicios category, chosen rather than
/// typed.
///
/// Servicios links a service to its charge by NAME: an expense in that
/// category whose note folds to a service's name IS that month's charge (see
/// `ServiceLogic.statuses`). Nothing is stored on either document, which is
/// what makes renaming a service safe — and also what makes a typo silent. The
/// expense is filed, correct, and the service goes on saying it was never
/// charged.
///
/// Both sheets that can file into Servicios use this: the recurring rule and
/// "Crear gasto" from a charge. Both seed the note with the merchant, which is
/// right for a shop and exactly wrong for a bill, so both had the same hole.
@MainActor
@Observable
final class ServiceNotePicker {
    private(set) var services: [ServiceDoc] = []
    /// Set only by choosing "write it myself". Sticky, because the list is
    /// otherwise always what a Servicios note uses.
    var writesOwnNote = false

    private var listener: ListenerRegistration?

    /// Listen only while the category is Servicios: the picker costs a
    /// listener exactly when somebody is looking at it. `services` is a
    /// register — one document per bill, capped — so it is one of the few
    /// collections read unbounded.
    func sync(categoryId: String, householdId: String?, db: FirestoreService) {
        guard categoryId == ServiceLogic.categoryId else { return }
        guard listener == nil, let householdId else { return }
        listener = db.listenServices(householdId: householdId) { [weak self] docs in
            self?.services = docs
        }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }

    func picksService(categoryId: String) -> Bool {
        categoryId == ServiceLogic.categoryId && !services.isEmpty
    }

    func usesList(categoryId: String) -> Bool {
        picksService(categoryId: categoryId) && !writesOwnNote
    }

    func matched(note: String) -> ServiceDoc? {
        services.first { ServiceLogic.nameKey($0.name) == ServiceLogic.nameKey(note) }
    }

    /// Refused rather than warned about: a Servicios note matching no service
    /// is the failure nobody notices, so it does not get to be a warning
    /// somebody clicks past.
    func isValid(categoryId: String, note: String) -> Bool {
        guard picksService(categoryId: categoryId) else { return true }
        if writesOwnNote { return !note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        return matched(note: note) != nil
    }
}

/// The control itself: the list when the category is Servicios, the plain
/// field otherwise or when the note is deliberately not a service.
struct ServiceNoteField: View {
    let picker: ServiceNotePicker
    let categoryId: String
    @Binding var note: String
    let l10n: L10n
    /// The label and placeholder differ between the two sheets.
    let plainLabel: String
    var placeholder: String = ""

    private var usesList: Bool { picker.usesList(categoryId: categoryId) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(
                text: picker.picksService(categoryId: categoryId)
                    ? l10n.t("recurring.noteService")
                    : plainLabel
            )
            if picker.picksService(categoryId: categoryId) {
                Picker(l10n.t("recurring.noteService"), selection: selection) {
                    // Unselected, ALWAYS, when the note is not a service —
                    // including a note seeded with the merchant, which is the
                    // case this exists for. An empty list is what says a
                    // choice is owed; falling back to free text would leave
                    // the merchant sitting there looking answered.
                    if usesList && picker.matched(note: note) == nil {
                        Text(l10n.t("recurring.noteServicePick")).tag("")
                    }
                    ForEach(picker.services) { service in
                        Text(service.name).tag(service.id)
                    }
                    Text(l10n.t("recurring.noteServiceOther")).tag("__other")
                }
                .pickerStyle(.menu)
                .tint(Theme.ink)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(Theme.surface)
                .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
                        .strokeBorder(Theme.border, lineWidth: 1)
                )
            }
            if !usesList {
                TextField(placeholder, text: $note)
                    .appFont(15)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                    .background(Theme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.card, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.card, style: .continuous)
                            .strokeBorder(Theme.border, lineWidth: 1)
                    )
            }
            if picker.picksService(categoryId: categoryId) {
                Text(
                    usesList
                        ? l10n.t("recurring.noteServiceHelp")
                        : l10n.t("recurring.noteServiceOtherHelp")
                )
                .appFont(11.5)
                .foregroundStyle(Theme.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    /// The service's name goes in VERBATIM. Typing it is what breaks the link,
    /// so the one thing this control must never do is hand back something the
    /// user could have typed.
    private var selection: Binding<String> {
        Binding(
            get: { usesList ? (picker.matched(note: note)?.id ?? "") : "__other" },
            set: { picked in
                if picked == "__other" {
                    picker.writesOwnNote = true
                    return
                }
                picker.writesOwnNote = false
                if let service = picker.services.first(where: { $0.id == picked }) {
                    note = service.name
                }
            }
        )
    }
}
