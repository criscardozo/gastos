// A fixture written straight to the emulator, so the round trip has something
// with subcollections and timestamps in it.
// 8390, this project's own block. This said 8080 from the port move until
// today, which means the round-trip rehearsal has been pointed at an SSH
// forward to another project's emulator ever since — the one rehearsal that
// proves the backups are restorable, quietly aimed at the wrong database.
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8390";
const { initializeApp } = await import("firebase-admin/app");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
initializeApp({ projectId: "qcris-gastos-diarios" });
const db = getFirestore();
const now = Timestamp.fromDate(new Date("2026-09-01T10:30:00.000Z"));
await db.doc("households/h1").set({
  name: "Casa", currency: "AUD", timezone: "Australia/Sydney",
  defaultBudget: { amountCents: 90000, period: "fortnightly", anchorDate: "2026-09-01" },
  memberIds: ["u1"], memberProfiles: { u1: { displayName: "C", color: "#FF5C39" } },
  categories: {}, createdAt: now, updatedAt: now,
});
for (const [id, cents] of [["e1", 1250], ["e2", 7000]]) {
  await db.doc(`households/h1/expenses/${id}`).set({
    amountCents: cents, categoryId: "groceries", note: "x",
    date: "2026-09-02", createdBy: "u1", verified: false,
    createdAt: now, updatedAt: now,
  });
}
await db.doc("households/h1/periodBudgets/2026-09-01").set({
  startDate: "2026-09-01", endDate: "2026-09-14", period: "fortnightly",
  amountCents: 90000, source: "default", createdAt: now, updatedAt: now,
});
await db.doc("users/u1").set({ displayName: "C", householdId: "h1", createdAt: now, updatedAt: now });
console.log("fixture escrito");
