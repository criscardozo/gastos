import SwiftUI

/// Categories management (Settings → CATEGORÍAS): rename, add, reorder and
/// delete the household's categories map (capped at
/// `SeedCategories.maxCategories`, which the rules enforce).
struct CategoriesManagerView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var renamingId: String?
    @State private var renameText = ""
    @State private var deletingId: String?
    @State private var showAdd = false

    private var l10n: L10n { model.l10n }

    private var entries: [(id: String, category: Category)] {
        model.household?.sortedCategories ?? []
    }

    private var footerText: String {
        let count: String = l10n.t("categories.count", entries.count)
        let cap: String = l10n.t("categories.max.foot")
        // Explain the switch column here rather than crowding every row.
        let budget: String = l10n.t("categories.countsToBudget.foot")
        return count + " · " + cap + "\n" + budget
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(entries, id: \.id) { entry in
                        row(entry)
                            .listRowBackground(Theme.surface)
                            .listRowSeparatorTint(Theme.separator)
                    }
                    .onMove { from, to in
                        model.moveCategories(fromOffsets: from, toOffset: to)
                    }
                    .onDelete { offsets in
                        guard let index = offsets.first, entries.indices.contains(index) else { return }
                        deletingId = entries[index].id
                    }
                    .deleteDisabled(entries.count <= 1)
                } footer: {
                    Text(footerText)
                        .appFont(12)
                        .foregroundStyle(Theme.inkTertiary)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Theme.bg.ignoresSafeArea())
            .navigationTitle(l10n.t("settings.categories"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(l10n.t("common.done")) { dismiss() }
                        .appFont(15, .bold)
                        .foregroundStyle(Theme.accentStrong)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    EditButton()
                        .appFont(15, .semibold)
                        .foregroundStyle(Theme.ink)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAdd = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(entries.count < SeedCategories.maxCategories ? Theme.accentStrong : Theme.inkTertiary)
                    }
                    .disabled(entries.count >= SeedCategories.maxCategories)  // rules cap, enforced in UI
                }
            }
        }
        .alert(
            l10n.t("categories.rename.title"),
            isPresented: Binding(
                get: { renamingId != nil },
                set: { if !$0 { renamingId = nil } }
            )
        ) {
            TextField(l10n.t("categories.name.placeholder"), text: $renameText)
            Button(l10n.t("common.save")) {
                if let id = renamingId {
                    model.renameCategory(id: id, name: renameText)
                }
                renamingId = nil
            }
            Button(l10n.t("common.cancel"), role: .cancel) { renamingId = nil }
        } message: {
            Text(l10n.t("categories.rename.foot"))
        }
        .confirmationDialog(
            l10n.t("categories.delete.confirm"),
            isPresented: Binding(
                get: { deletingId != nil },
                set: { if !$0 { deletingId = nil } }
            ),
            titleVisibility: .visible
        ) {
            Button(l10n.t("history.delete"), role: .destructive) {
                if let id = deletingId {
                    model.deleteCategory(id: id)
                }
                deletingId = nil
            }
            Button(l10n.t("common.cancel"), role: .cancel) { deletingId = nil }
        } message: {
            Text(l10n.t("categories.delete.foot"))
        }
        .sheet(isPresented: $showAdd) {
            AddCategorySheet()
        }
    }

    private func row(_ entry: (id: String, category: Category)) -> some View {
        HStack(spacing: 11) {
            Button {
                renameText = l10n.categoryName(entry.category)
                renamingId = entry.id
            } label: {
                HStack(spacing: 11) {
                    CategoryCircle(categoryId: entry.id, category: entry.category, size: 34)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(l10n.categoryName(entry.category))
                            .appFont(14.5, .semibold)
                            .foregroundStyle(Theme.ink)
                            .lineLimit(1)
                        if !entry.category.isBudgeted {
                            Text(l10n.t("category.offBudget"))
                                .appFont(11)
                                .foregroundStyle(Theme.inkTertiary)
                        }
                    }
                    Image(systemName: "pencil")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.inkTertiary.opacity(0.6))
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            // Does spending here eat into the period budget? Off still records
            // the expense — it just doesn't move the remaining figure.
            Toggle("", isOn: Binding(
                get: { entry.category.isBudgeted },
                set: { model.setCategoryCountsToBudget(id: entry.id, counts: $0) }
            ))
            .labelsHidden()
            .tint(Theme.green)
            .accessibilityLabel(l10n.t("categories.countsToBudget"))
        }
    }
}

// MARK: - Add category sheet

/// New category: name + one of the 8 seed colors + a curated material icon.
/// Stored per shared/schema.md: literal `name` (no key), MATERIAL icon name,
/// light-variant hex color.
struct AddCategorySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var colorHex = SeedCategories.seedColorOptions.first ?? "#8A8577"
    @State private var materialIcon = SeedCategories.curatedIcons.first?.material ?? "tag"
    @FocusState private var nameFocused: Bool

    private var l10n: L10n { model.l10n }

    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Capsule()
                    .fill(Theme.ink.opacity(0.15))
                    .frame(width: 40, height: 5)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 14)

                Text(l10n.t("categories.add.title"))
                    .appFont(20, .bold)
                    .foregroundStyle(Theme.ink)

                nameField
                colorPicker
                iconPicker

                PrimaryCTA(title: l10n.t("categories.add.cta"), height: 56, enabled: canSave) {
                    model.addCategory(name: name, colorHex: colorHex, materialIcon: materialIcon)
                    dismiss()
                }
                .padding(.top, 4)
            }
            .padding(.horizontal, 22)
            .padding(.bottom, 24)
        }
        .background(Theme.bg.ignoresSafeArea())
        .presentationDetents([.large])
    }

    private var nameField: some View {
        HStack(spacing: 8) {
            CategoryCircle(
                categoryId: "",
                category: Category(key: nil, name: nil, icon: materialIcon, color: colorHex, sortOrder: 0),
                size: 34
            )
            TextField(l10n.t("categories.name.placeholder"), text: $name)
                .appFont(15)
                .foregroundStyle(Theme.ink)
                .focused($nameFocused)
                .submitLabel(.done)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Theme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(Theme.border, lineWidth: 1)
        )
    }

    private var colorPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("categories.color"))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 8), spacing: 10) {
                ForEach(SeedCategories.seedColorOptions, id: \.self) { hex in
                    let selected = hex.caseInsensitiveCompare(colorHex) == .orderedSame
                    Circle()
                        .fill(Color(hex: hex))
                        .frame(width: 32, height: 32)
                        .overlay(
                            Circle().strokeBorder(selected ? Theme.ink : .clear, lineWidth: 2.5)
                                .padding(-3)
                        )
                        .contentShape(Circle())
                        .onTapGesture {
                            withAnimation(.snappy(duration: 0.15)) { colorHex = hex }
                        }
                }
            }
        }
    }

    private var iconPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionLabel(text: l10n.t("categories.icon"))
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 6), spacing: 10) {
                ForEach(SeedCategories.curatedIcons, id: \.material) { icon in
                    let selected = icon.material == materialIcon
                    Circle()
                        .fill(selected ? Color(hex: colorHex, alpha: 0.16) : Theme.fill)
                        .frame(width: 44, height: 44)
                        .overlay(
                            Image(systemName: icon.sfSymbol)
                                .font(.system(size: 18, weight: .medium))
                                .foregroundStyle(selected ? Color(hex: colorHex) : Theme.inkSecondary)
                        )
                        .overlay(
                            Circle().strokeBorder(selected ? Theme.ink : .clear, lineWidth: 2.5)
                        )
                        .contentShape(Circle())
                        .onTapGesture {
                            withAnimation(.snappy(duration: 0.15)) { materialIcon = icon.material }
                        }
                }
            }
        }
    }
}
