import XCTest

/// Archived categories on iOS (shared/schema.md, Category.archived).
final class CategoryArchiveTests: XCTestCase {

    private func category(archived: Bool?) -> Category {
        Category(key: nil, name: "Gimnasio", icon: "fitness_center", color: "#000000",
                 sortOrder: 3, countsToBudget: nil, archived: archived)
    }

    /// The entry is written whole, field by field. Without `archived` in that
    /// list, renaming an archived category — or flipping its budget switch —
    /// on the phone wrote it back ACTIVE, which is what this pins.
    func testWritingAnArchivedCategoryKeepsItArchived() {
        let data = category(archived: true).firestoreData
        XCTAssertEqual(data["archived"] as? Bool, true)
    }

    func testAnActiveOneWritesNoKey() {
        // Absent means active; false is never written.
        XCTAssertNil(category(archived: nil).firestoreData["archived"])
        XCTAssertNil(category(archived: false).firestoreData["archived"])
    }

    func testDecodesTheFlag() throws {
        let json = ##"{"name":"Gimnasio","icon":"tag","color":"#000000","sortOrder":1,"archived":true}"##
        let decoded = try JSONDecoder().decode(Category.self, from: Data(json.utf8))
        XCTAssertTrue(decoded.isArchived)
    }

    /// What a form offers: active ones by sortOrder, plus the one the thing
    /// being edited is already in.
    func testEntryCategoriesLeaveArchivedOutUnlessKept() {
        let categories: [String: Category] = [
            "food": Category(key: nil, name: "Comida", icon: "tag", color: "#000000", sortOrder: 1),
            "gym": category(archived: true),
            "rent": Category(key: nil, name: "Alquiler", icon: "tag", color: "#000000", sortOrder: 2),
        ]
        XCTAssertEqual(Category.entryOrder(categories).map(\.id), ["food", "rent"])
        XCTAssertEqual(Category.entryOrder(categories, keeping: "gym").map(\.id), ["food", "rent", "gym"])
    }
}
