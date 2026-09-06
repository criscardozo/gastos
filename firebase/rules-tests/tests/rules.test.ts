import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ALICE,
  BOB,
  CAROL,
  HOUSEHOLD,
  INVITE_CODE,
  cardChargeDoc,
  createTestEnv,
  db,
  expenseDoc,
  householdDoc,
  periodBudgetDoc,
  recurringRuleDoc,
  seed,
  serviceDoc,
  statementDoc,
  userDoc,
  without,
} from "./helpers";

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await createTestEnv();
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

/** Seed a household owned by Alice, with Bob optionally already joined. */
async function seedHousehold(withBob = false) {
  await seed(env, async (admin) => {
    await setDoc(
      doc(admin, "households", HOUSEHOLD),
      householdDoc(ALICE, {
        memberIds: withBob ? [ALICE, BOB] : [ALICE],
        memberProfiles: withBob
          ? {
              [ALICE]: { displayName: "Cristian", color: "#2A6FDB" },
              [BOB]: { displayName: "Natalia", color: "#E0447C" },
            }
          : { [ALICE]: { displayName: "Cristian", color: "#2A6FDB" } },
      }),
    );
  });
}

async function seedInvite() {
  await seed(env, async (admin) => {
    await setDoc(doc(admin, "invites", INVITE_CODE), {
      householdId: HOUSEHOLD,
      createdBy: ALICE,
      createdAt: serverTimestamp(),
    });
  });
}

// ============================ users ============================

describe("users/{uid}", () => {
  it("owner can create a valid user doc", async () => {
    await assertSucceeds(setDoc(doc(db(env, ALICE), "users", ALICE), userDoc()));
  });

  it("cannot create a user doc for someone else", async () => {
    await assertFails(setDoc(doc(db(env, BOB), "users", ALICE), userDoc()));
  });

  it("unauthenticated access is denied", async () => {
    await assertFails(getDoc(doc(db(env, null), "users", ALICE)));
    await assertFails(setDoc(doc(db(env, null), "users", ALICE), userDoc()));
  });

  it("another user cannot read my doc", async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "users", ALICE), userDoc());
    });
    await assertFails(getDoc(doc(db(env, BOB), "users", ALICE)));
    await assertSucceeds(getDoc(doc(db(env, ALICE), "users", ALICE)));
  });

  it("rejects schema pollution and bad values", async () => {
    const me = doc(db(env, ALICE), "users", ALICE);
    await assertFails(setDoc(me, userDoc({ hacked: true })));
    await assertFails(setDoc(me, userDoc({ language: "fr" })));
    await assertFails(setDoc(me, userDoc({ displayCurrency: "usd" })));
    await assertFails(setDoc(me, userDoc({ displayName: "" })));
    await assertFails(setDoc(me, userDoc({ displayName: "x".repeat(81) })));
    await assertFails(setDoc(me, userDoc({ defaultEntryCurrency: "EUR" })));
  });

  // defaultEntryCurrency is deprecated (AUD is the only entry currency now) but
  // still accepted: the existing user docs carry it, and dropping it from
  // hasOnly() would make every later update of those docs fail.
  it("still accepts the deprecated default entry currency", async () => {
    await assertSucceeds(
      setDoc(doc(db(env, ALICE), "users", ALICE), userDoc({ defaultEntryCurrency: "USD" })),
    );
  });

  it("cannot claim membership of a household I am not in", async () => {
    await seedHousehold();
    await assertFails(
      setDoc(doc(db(env, BOB), "users", BOB), userDoc({ householdId: HOUSEHOLD })),
    );
    // ...but a real member can link themselves
    await assertSucceeds(
      setDoc(doc(db(env, ALICE), "users", ALICE), userDoc({ householdId: HOUSEHOLD })),
    );
  });

  it("createdAt is immutable on update", async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "users", ALICE), userDoc());
    });
    await assertFails(
      updateDoc(doc(db(env, ALICE), "users", ALICE), {
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "users", ALICE), {
        displayName: "Cris",
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

// ============================ households ============================

describe("households/{id} — create & member access", () => {
  it("creator can create a household with only themselves", async () => {
    await assertSucceeds(
      setDoc(doc(db(env, ALICE), "households", HOUSEHOLD), householdDoc(ALICE)),
    );
  });

  it("cannot create a household pre-seeded with another member", async () => {
    await assertFails(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD),
        householdDoc(ALICE, { memberIds: [ALICE, BOB] }),
      ),
    );
    await assertFails(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD),
        householdDoc(BOB), // memberIds = [BOB] but auth is ALICE
      ),
    );
  });

  it("members can read; non-members and unauthenticated cannot", async () => {
    await seedHousehold();
    await assertSucceeds(getDoc(doc(db(env, ALICE), "households", HOUSEHOLD)));
    await assertFails(getDoc(doc(db(env, BOB), "households", HOUSEHOLD)));
    await assertFails(getDoc(doc(db(env, null), "households", HOUSEHOLD)));
  });

  it("households cannot be listed", async () => {
    await seedHousehold();
    await assertFails(getDocs(collection(db(env, ALICE), "households")));
  });

  it("rejects invalid budget and schema pollution", async () => {
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    await assertFails(
      setDoc(
        ref,
        householdDoc(ALICE, {
          defaultBudget: { amountCents: 900.5, period: "fortnightly", anchorDate: "2026-07-01" },
        }),
      ),
    );
    await assertFails(
      setDoc(
        ref,
        householdDoc(ALICE, {
          defaultBudget: { amountCents: 90000, period: "monthly", anchorDate: "2026-07-01" },
        }),
      ),
    );
    await assertFails(
      setDoc(
        ref,
        householdDoc(ALICE, {
          defaultBudget: { amountCents: 90000, period: "weekly", anchorDate: "1 July" },
        }),
      ),
    );
    await assertFails(setDoc(ref, householdDoc(ALICE, { extra: 1 })));
    await assertFails(setDoc(ref, householdDoc(ALICE, { currency: "aud" })));
  });

  it("editing the default budget does not switch rollover off", async () => {
    // Not a rules test: a test of what Firestore DOES, pinned here because the
    // difference cost a real setting. Writing the whole `defaultBudget` map
    // replaces it, so a payload that never carried `rollover` turned the
    // carry-the-leftover setting off — silently, and the next period was then
    // materialized without the leftover. iOS wrote the map; the web has always
    // written separate paths. Both write paths now.
    await seedHousehold();
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    await assertSucceeds(
      updateDoc(ref, { "defaultBudget.rollover": true, updatedAt: serverTimestamp() }),
    );

    // Editing a neighbouring field, one path at a time: rollover survives.
    await assertSucceeds(
      updateDoc(ref, {
        "defaultBudget.amountCents": 95000,
        "defaultBudget.period": "weekly",
        updatedAt: serverTimestamp(),
      }),
    );
    let after = await getDoc(ref);
    expect(after.data()?.defaultBudget).toMatchObject({
      amountCents: 95000,
      period: "weekly",
      rollover: true,
    });

    // And the shape that caused it: the same edit as a whole-map write drops
    // the setting entirely. Asserted so nobody reintroduces it believing
    // Firestore merges nested maps on update. It does not.
    await assertSucceeds(
      updateDoc(ref, {
        defaultBudget: {
          amountCents: 90000,
          period: "fortnightly",
          anchorDate: "2026-07-01",
        },
        updatedAt: serverTimestamp(),
      }),
    );
    after = await getDoc(ref);
    expect(after.data()?.defaultBudget.rollover).toBeUndefined();
  });

  it("accepts the optional rollover setting and per-period carryover", async () => {
    await seedHousehold();
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        "defaultBudget.rollover": true,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        "defaultBudget.rollover": "yes",
        updatedAt: serverTimestamp(),
      }),
    );
    // A period may record the carried amount, including a negative one when
    // the previous period was overspent.
    await assertSucceeds(
      setDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-03"), {
        startDate: "2026-08-03",
        endDate: "2026-08-09",
        period: "weekly",
        amountCents: 102000,
        rolloverCents: -3000,
        source: "default",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-10"), {
        startDate: "2026-08-10",
        endDate: "2026-08-16",
        period: "weekly",
        amountCents: 90000,
        rolloverCents: "1000",
        source: "default",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("either member can rename the household", async () => {
    await seedHousehold(true);
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        name: "Casa Cardozo",
        updatedAt: serverTimestamp(),
      }),
    );
    // Not just the creator — the joiner may rename it too.
    await assertSucceeds(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        name: "Nuestra casa",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("rejects an empty or oversized household name", async () => {
    await seedHousehold();
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    await assertFails(
      updateDoc(ref, { name: "", updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(ref, { name: "x".repeat(61), updatedAt: serverTimestamp() }),
    );
    // 60 is the documented maximum, and must still pass.
    await assertSucceeds(
      updateDoc(ref, { name: "x".repeat(60), updatedAt: serverTimestamp() }),
    );
  });

  /**
   * The caps nothing in the app can reach.
   *
   * Every one of these is a bound no screen can violate — nobody types a
   * 31st category, and the profiles map is written by code that only ever puts
   * two people in it. That is exactly why they need a test: their removal
   * would be invisible, and this is the ONE document every listener in both
   * apps holds open, so an unbounded map here is read by everything, forever,
   * on every launch.
   *
   * Found by taking each cap out and seeing whether anything complained. These
   * five did not.
   */
  it("caps the maps on the household document", async () => {
    await seedHousehold();
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);

    // 30 categories is the documented maximum.
    const categories = (n: number) =>
      Object.fromEntries(
        Array.from({ length: n }, (_, i) => [
          `c${i}`,
          { key: "groceries", icon: "shopping_basket", color: "#2A6FDB", sortOrder: i },
        ]),
      );
    await assertFails(
      updateDoc(ref, { categories: categories(31), updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(ref, { categories: categories(30), updatedAt: serverTimestamp() }),
    );
    // ...and never empty: a household with no categories cannot file an
    // expense, and every screen that groups by one would have nothing to say.
    await assertFails(
      updateDoc(ref, { categories: {}, updatedAt: serverTimestamp() }),
    );

    // A household is two people. The profiles map is display data for the
    // roster, so a third entry is either a bug or somebody widening the
    // household past what the join rule allows.
    await assertFails(
      updateDoc(ref, {
        memberProfiles: {
          [ALICE]: { displayName: "Cristian", color: "#2A6FDB" },
          [BOB]: { displayName: "Natalia", color: "#E4572E" },
          [CAROL]: { displayName: "Un tercero", color: "#111111" },
        },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a member can edit settings but not the roster", async () => {
    await seedHousehold(true);
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    await assertSucceeds(
      updateDoc(ref, {
        "defaultBudget.amountCents": 105000,
        updatedAt: serverTimestamp(),
      }),
    );
    // removing the other member is not allowed
    await assertFails(
      updateDoc(ref, { memberIds: [ALICE], updatedAt: serverTimestamp() }),
    );
  });

  it("a member can edit their own profile but not their partner's", async () => {
    await seedHousehold(true);
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    await assertSucceeds(
      updateDoc(ref, {
        [`memberProfiles.${ALICE}`]: { displayName: "Cris", color: "#2A6FDB" },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ref, {
        [`memberProfiles.${BOB}`]: { displayName: "Hacked", color: "#000000" },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("households cannot be deleted", async () => {
    await seedHousehold();
    await assertFails(deleteDoc(doc(db(env, ALICE), "households", HOUSEHOLD)));
  });
});

// ============================ invite join flow ============================

describe("invite flow — end to end", () => {
  /** The exact update a joining client performs. */
  function joinUpdate(uid: string, who = "Natalia", color = "#E0447C") {
    return {
      memberIds: arrayUnion(uid),
      [`memberProfiles.${uid}`]: { displayName: who, color },
      updatedAt: serverTimestamp(),
    };
  }

  it("full happy path: invite → self-add → member access", async () => {
    await seedHousehold();
    await seedInvite();

    // Bob reads the invite (any signed-in user can, code = capability)
    const invite = await getDoc(doc(db(env, BOB), "invites", INVITE_CODE));
    const householdId = invite.data()!.householdId as string;

    // Bob self-adds
    await assertSucceeds(
      updateDoc(doc(db(env, BOB), "households", householdId), joinUpdate(BOB)),
    );

    // Bob is now a member: read household, write an expense, link own user doc
    await assertSucceeds(getDoc(doc(db(env, BOB), "households", householdId)));
    await assertSucceeds(
      setDoc(
        doc(collection(db(env, BOB), "households", householdId, "expenses")),
        expenseDoc(BOB),
      ),
    );
    await assertSucceeds(
      setDoc(doc(db(env, BOB), "users", BOB), userDoc({ householdId, displayName: "Natalia" })),
    );

    // Bob cleans up the invite
    await assertSucceeds(deleteDoc(doc(db(env, BOB), "invites", INVITE_CODE)));
  });

  it("a third user cannot join a full household", async () => {
    await seedHousehold(true); // Alice + Bob already in
    await seedInvite();
    await assertFails(
      updateDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD),
        joinUpdate(CAROL, "Carol", "#123456"),
      ),
    );
  });

  it("joiner cannot touch anything besides the roster", async () => {
    await seedHousehold();
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        ...joinUpdate(BOB),
        name: "Bob's house now",
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        ...joinUpdate(BOB),
        "defaultBudget.amountCents": 1,
      }),
    );
  });

  it("joiner can only add THEMSELVES", async () => {
    await seedHousehold();
    // Bob tries to add Carol instead of himself
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        memberIds: arrayUnion(CAROL),
        [`memberProfiles.${CAROL}`]: { displayName: "Carol", color: "#123456" },
        updatedAt: serverTimestamp(),
      }),
    );
    // Bob tries to add himself AND Carol
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        memberIds: arrayUnion(BOB, CAROL),
        [`memberProfiles.${BOB}`]: { displayName: "Natalia", color: "#E0447C" },
        updatedAt: serverTimestamp(),
      }),
    );
    // Bob tries to write ALICE's profile entry during the join
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        memberIds: arrayUnion(BOB),
        [`memberProfiles.${ALICE}`]: { displayName: "Pwned", color: "#000000" },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("joiner cannot replace the roster to evict the owner", async () => {
    await seedHousehold();
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD), {
        memberIds: [BOB],
        [`memberProfiles.${BOB}`]: { displayName: "Natalia", color: "#E0447C" },
        updatedAt: serverTimestamp(),
      }),
    );
  });
});

// ============================ invites ============================

describe("invites/{code}", () => {
  it("any signed-in user can get; unauthenticated cannot", async () => {
    await seedHousehold();
    await seedInvite();
    await assertSucceeds(getDoc(doc(db(env, CAROL), "invites", INVITE_CODE)));
    await assertFails(getDoc(doc(db(env, null), "invites", INVITE_CODE)));
  });

  it("invites cannot be listed (no code enumeration)", async () => {
    await seedInvite();
    await assertFails(getDocs(collection(db(env, ALICE), "invites")));
  });

  it("only household members can create invites", async () => {
    await seedHousehold();
    const payload = {
      householdId: HOUSEHOLD,
      createdBy: BOB,
      createdAt: serverTimestamp(),
    };
    await assertFails(setDoc(doc(db(env, BOB), "invites", "GD-BOBCODE99"), payload));
    await assertSucceeds(
      setDoc(doc(db(env, ALICE), "invites", "GD-ALICE9999"), {
        ...payload,
        createdBy: ALICE,
      }),
    );
  });

  it("rejects short codes and spoofed creators", async () => {
    await seedHousehold();
    await assertFails(
      setDoc(doc(db(env, ALICE), "invites", "SHORT"), {
        householdId: HOUSEHOLD,
        createdBy: ALICE,
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db(env, ALICE), "invites", "GD-ALICE9999"), {
        householdId: HOUSEHOLD,
        createdBy: BOB,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("invites are immutable; members can delete", async () => {
    await seedHousehold();
    await seedInvite();
    await assertFails(
      updateDoc(doc(db(env, ALICE), "invites", INVITE_CODE), { householdId: "other" }),
    );
    await assertFails(deleteDoc(doc(db(env, CAROL), "invites", INVITE_CODE)));
    await assertSucceeds(deleteDoc(doc(db(env, ALICE), "invites", INVITE_CODE)));
  });
});

// ============================ expenses ============================

describe("households/{id}/expenses", () => {
  beforeEach(async () => {
    await seedHousehold(true);
  });

  it("members can create valid expenses; outsiders cannot", async () => {
    const col = (uid: string) =>
      collection(db(env, uid), "households", HOUSEHOLD, "expenses");
    await assertSucceeds(setDoc(doc(col(ALICE)), expenseDoc(ALICE)));
    await assertSucceeds(setDoc(doc(col(BOB)), expenseDoc(BOB)));
    await assertFails(setDoc(doc(col(CAROL)), expenseDoc(CAROL)));
  });

  it("non-members cannot read expenses", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "expenses", "e1"),
        expenseDoc(ALICE),
      );
    });
    await assertSucceeds(
      getDoc(doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e1")),
    );
    await assertFails(
      getDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "expenses", "e1")),
    );
    await assertFails(
      getDoc(doc(db(env, null), "households", HOUSEHOLD, "expenses", "e1")),
    );
  });

  it("rejects invalid money, dates and schema pollution", async () => {
    const ref = () =>
      doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses"));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { amountCents: 0 })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { amountCents: -100 })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { amountCents: 12.5 })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { amountCents: 10000001 })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { date: "11/07/2026" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { date: "2026-7-11" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { date: "2026-13-01" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { date: "2026-07-32" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { date: "2026-07-00" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { note: "x".repeat(201) })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { categoryId: "" })));
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { injected: true })));
    // AUD is the only entry currency: the old bi-currency keys are gone and
    // must now be rejected like any other unknown field.
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { entryCurrency: "USD", entryAmountCents: 700 })),
    );
  });

  it("accepts an unverified expense (both verification fields absent, or false)", async () => {
    const ref = () =>
      doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses"));
    // What the clients write on create, and what the docs predating the
    // verification fields look like.
    await assertSucceeds(setDoc(ref(), expenseDoc(ALICE, { verified: false })));
    await assertSucceeds(setDoc(ref(), expenseDoc(ALICE)));
  });

  it("accepts a verified expense (bank USD charge + verified true)", async () => {
    await assertSucceeds(
      setDoc(
        doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses")),
        expenseDoc(ALICE, { usdCents: 6390, verified: true }),
      ),
    );
  });

  it("rejects a verification that claims more than it knows", async () => {
    const ref = () =>
      doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses"));
    // verified without the figure that verifies it.
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { verified: true })));
    // The figure without the flag (and with the flag saying otherwise).
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { usdCents: 6390 })));
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: 6390, verified: false })),
    );
    // A USD charge is money: same integer-cents bounds as amountCents.
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: 0, verified: true })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: -100, verified: true })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: 63.9, verified: true })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: 10000001, verified: true })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: "63,90", verified: true })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { usdCents: 6390, verified: "yes" })),
    );
  });

  it("verifying and un-verifying an existing expense", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "expenses", "e1"),
        expenseDoc(ALICE, { verified: false }),
      );
    });
    const ref = doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e1");
    // Either member can verify — the validator runs on the merged document, so
    // the pair must move together.
    await assertFails(
      updateDoc(ref, { usdCents: 6390, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(
      updateDoc(ref, {
        usdCents: 6390,
        verified: true,
        updatedAt: serverTimestamp(),
      }),
    );
    // Correcting the figure keeps it verified.
    await assertSucceeds(
      updateDoc(ref, {
        usdCents: 6500,
        verified: true,
        updatedAt: serverTimestamp(),
      }),
    );
    // Flipping the flag alone would leave a stored charge nobody trusts.
    await assertFails(
      updateDoc(ref, { verified: false, updatedAt: serverTimestamp() }),
    );
    // Clearing a verification deletes the charge and the flag together.
    await assertSucceeds(
      updateDoc(ref, {
        usdCents: deleteField(),
        verified: false,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("cannot spoof attribution on create", async () => {
    await assertFails(
      setDoc(
        doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses")),
        expenseDoc(BOB), // createdBy = BOB but auth = ALICE
      ),
    );
  });

  it("either member can edit/delete any expense, but attribution is immutable", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "expenses", "e1"),
        expenseDoc(ALICE),
      );
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "expenses", "e2"),
        expenseDoc(ALICE),
      );
    });
    // Bob edits Alice's expense — allowed by design
    await assertSucceeds(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e1"), {
        amountCents: 999,
        updatedAt: serverTimestamp(),
      }),
    );
    // ...but cannot reassign attribution
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e1"), {
        createdBy: BOB,
        updatedAt: serverTimestamp(),
      }),
    );
    // update must keep the document valid (validator runs on update too)
    await assertFails(
      updateDoc(doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e1"), {
        amountCents: -5,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertSucceeds(
      deleteDoc(doc(db(env, BOB), "households", HOUSEHOLD, "expenses", "e2")),
    );
    await assertFails(
      deleteDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "expenses", "e1")),
    );
  });
});

// ============================ bankCharges ============================

describe("households/{id}/bankCharges", () => {
  beforeEach(async () => {
    await seedHousehold(true);
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        usdCents: 6390,
        date: "2026-08-01",
        merchant: "COLES 0831",
        cardLast4: "1234",
        importedAt: serverTimestamp(),
      });
    });
  });

  it("members can read the pending charges", async () => {
    await assertSucceeds(
      getDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1")),
    );
    await assertSucceeds(
      getDocs(collection(db(env, BOB), "households", HOUSEHOLD, "bankCharges")),
    );
    await assertFails(
      getDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "bankCharges", "gmail-1")),
    );
    await assertFails(
      getDoc(doc(db(env, null), "households", HOUSEHOLD, "bankCharges", "gmail-1")),
    );
  });

  it("nobody can invent or rewrite a bank charge from a client", async () => {
    // Only the ingestion service account writes here, and it bypasses rules as
    // an IAM principal — from a client this is read-only.
    await assertFails(
      setDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "made-up"), {
        usdCents: 100,
        date: "2026-08-01",
        merchant: "INVENTADO",
        importedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        usdCents: 1,
      }),
    );
  });

  it("either member can retire a charge they have dealt with", async () => {
    await assertSucceeds(
      deleteDoc(doc(db(env, BOB), "households", HOUSEHOLD, "bankCharges", "gmail-1")),
    );
  });

  it("an outsider cannot touch the charges", async () => {
    await assertFails(
      deleteDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "bankCharges", "gmail-1")),
    );
  });

  // --- dismissedAt: the one field a client may write ---

  it("a member can dismiss a charge and restore it", async () => {
    const charge = doc(
      db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1",
    );
    await assertSucceeds(updateDoc(charge, { dismissedAt: serverTimestamp() }));
    // Removing the field is how Restore works, so it has to be allowed too.
    await assertSucceeds(updateDoc(charge, { dismissedAt: deleteField() }));
  });

  it("dismissedAt must be the server's clock, not the client's", async () => {
    // A client that picked the value could park a charge in the recoverable
    // list forever, or expire it the moment it was dismissed.
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        dismissedAt: new Date("2030-01-01"),
      }),
    );
  });

  it("dismissing may not smuggle in any other change", async () => {
    // The point of the narrow diff: what the bank said stays exactly as the
    // ingestion filed it, whatever else the write claims to be doing.
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        dismissedAt: serverTimestamp(),
        usdCents: 1,
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        dismissedAt: serverTimestamp(),
        merchant: "OTRO",
      }),
    );
  });

  it("an outsider cannot dismiss a charge", async () => {
    await assertFails(
      updateDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "bankCharges", "gmail-1"), {
        dismissedAt: serverTimestamp(),
      }),
    );
  });
});

// ============================ periodBudgets ============================

describe("households/{id}/periodBudgets", () => {
  beforeEach(async () => {
    await seedHousehold(true);
  });

  it("members can materialize a period; doc ID must equal startDate", async () => {
    await assertSucceeds(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      ),
    );
    await assertFails(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-02"),
        periodBudgetDoc(), // startDate says 2026-07-01
      ),
    );
    await assertFails(
      setDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      ),
    );
  });

  it("rejects inverted ranges and bad enums", async () => {
    const ref = doc(
      db(env, ALICE),
      "households",
      HOUSEHOLD,
      "periodBudgets",
      "2026-07-01",
    );
    await assertFails(setDoc(ref, periodBudgetDoc({ endDate: "2026-06-30" })));
    await assertFails(setDoc(ref, periodBudgetDoc({ endDate: "2026-07-01" })));
    await assertFails(setDoc(ref, periodBudgetDoc({ period: "monthly" })));
    await assertFails(setDoc(ref, periodBudgetDoc({ source: "magic" })));
    await assertFails(setDoc(ref, periodBudgetDoc({ amountCents: 0 })));
  });

  it("only the amount, its carried-in part and source can change after materialization", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      );
    });
    const ref = doc(
      db(env, ALICE),
      "households",
      HOUSEHOLD,
      "periodBudgets",
      "2026-07-01",
    );
    // adjust this period's budget → OK
    await assertSucceeds(
      updateDoc(ref, {
        amountCents: 105000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // Answering the start-period screen moves the amount and the part of it
    // that was carried in together — the second explains the first, so the
    // record would be a lie if only one could move.
    await assertSucceeds(
      updateDoc(ref, {
        amountCents: 102000,
        rolloverCents: 12000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // ...and dropping the carry-over back to nothing is just as valid.
    await assertSucceeds(
      updateDoc(ref, {
        amountCents: 90000,
        rolloverCents: 0,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // A carried-in figure still has to be a sane integer.
    await assertFails(
      updateDoc(ref, { rolloverCents: "1000", updatedAt: serverTimestamp() }),
    );
    // Pulling a boundary IN, or changing the type → never. Pushing the end
    // date out is the one exception and has its own branch and tests below
    // (stretching), because it buys days without touching the money.
    await assertFails(
      updateDoc(ref, { endDate: "2026-07-10", updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(ref, { period: "weekly", updatedAt: serverTimestamp() }),
    );
  });

  it("the week under way can be stretched into a fortnight, once and forwards", async () => {
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-07");
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-07"),
        periodBudgetDoc({
          startDate: "2026-08-07",
          endDate: "2026-08-13",
          period: "weekly",
          amountCents: 45000,
          rolloverCents: 5000,
        }),
      );
    });

    // Friday-to-Thursday week becomes Friday-to-Thursday fortnight, with a
    // week's budget added. The carried-in figure describes what came in at the
    // START, so it does not move.
    await assertSucceeds(
      updateDoc(ref, {
        period: "fortnightly",
        endDate: "2026-08-20",
        amountCents: 90000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("an extension cannot shrink, reverse, or move the start", async () => {
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-07");
    const seedWeek = async () => {
      await seed(env, async (admin) => {
        await setDoc(
          doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-07"),
          periodBudgetDoc({
            startDate: "2026-08-07",
            endDate: "2026-08-13",
            period: "weekly",
            amountCents: 45000,
          }),
        );
      });
    };
    await seedWeek();

    // Pulling the end date BACKWARDS would strand expenses between periods.
    await assertFails(
      updateDoc(ref, {
        period: "fortnightly",
        endDate: "2026-08-10",
        amountCents: 45000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // Becoming a fortnight without the end date moving is incoherent — the
    // type and the range describe the same fact. (The end date moving on its
    // own is a different, sanctioned move: see the stretch tests below.)
    await assertFails(
      updateDoc(ref, { period: "fortnightly", updatedAt: serverTimestamp() }),
    );
    // The start of a period is never negotiable.
    await assertFails(
      updateDoc(ref, {
        startDate: "2026-08-01",
        period: "fortnightly",
        endDate: "2026-08-20",
        amountCents: 90000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // Extending must not quietly cut the budget.
    await assertFails(
      updateDoc(ref, {
        period: "fortnightly",
        endDate: "2026-08-20",
        amountCents: 30000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // Nor rewrite what was carried in from the previous period.
    await assertFails(
      updateDoc(ref, {
        period: "fortnightly",
        endDate: "2026-08-20",
        amountCents: 90000,
        rolloverCents: 99000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a fortnight cannot be extended again — the door only opens one way", async () => {
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-07");
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-07"),
        periodBudgetDoc({
          startDate: "2026-08-07",
          endDate: "2026-08-20",
          period: "fortnightly",
          amountCents: 90000,
        }),
      );
    });
    await assertFails(
      updateDoc(ref, {
        period: "fortnightly",
        endDate: "2026-08-27",
        amountCents: 135000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
    // ...and it cannot be walked back to a week either.
    await assertFails(
      updateDoc(ref, {
        period: "weekly",
        endDate: "2026-08-13",
        amountCents: 45000,
        source: "custom",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("an outsider cannot extend anything", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-07"),
        periodBudgetDoc({
          startDate: "2026-08-07",
          endDate: "2026-08-13",
          period: "weekly",
          amountCents: 45000,
        }),
      );
    });
    await assertFails(
      updateDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD, "periodBudgets", "2026-08-07"),
        {
          period: "fortnightly",
          endDate: "2026-08-20",
          amountCents: 90000,
          source: "custom",
          updatedAt: serverTimestamp(),
        },
      ),
    );
  });

  it("bounds the carried-in figure, in both directions", async () => {
    // Signed on purpose — an overspent period carries its deficit forward — so
    // it is the one money field with a floor as well as a ceiling, and neither
    // had a test. Nothing in either app can produce a figure this size; that is
    // what makes the bound invisible if it goes.
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      );
    });
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    for (const rolloverCents of [100000001, -100000001]) {
      await assertFails(
        updateDoc(ref, {
          amountCents: 90000,
          rolloverCents,
          source: "custom",
          updatedAt: serverTimestamp(),
        }),
      );
    }
    // The documented edges still pass.
    for (const rolloverCents of [100000000, -100000000]) {
      await assertSucceeds(
        updateDoc(ref, {
          amountCents: 90000,
          rolloverCents,
          source: "custom",
          updatedAt: serverTimestamp(),
        }),
      );
    }
  });

  it("a settled period is an immutable record — no deletes", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc({ confirmedAt: serverTimestamp() }),
      );
    });
    await assertFails(
      deleteDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
      ),
    );
  });

  it("a period nobody answered yet can be dropped", async () => {
    // What the stretch below needs: the freshly materialized period being
    // swallowed goes away in the same batch. It carries no decision (that is
    // what confirmedAt records) and holds no expenses — those live in
    // `expenses`, bucketed by date, and get re-read against the new range.
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      );
    });
    await assertSucceeds(
      deleteDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
      ),
    );
  });

  it("an outsider cannot drop a period, answered or not", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      );
    });
    await assertFails(
      deleteDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
      ),
    );
  });

  // ----------------------------- stretching -----------------------------
  //
  // Buying days, not money: the end date moves out and the amount stays put.
  // Cristian's case — a week that ended with $55,31 left, stretched through
  // Sunday so the next one starts on a Monday.

  it("a member can stretch a period's end date without touching the amount", async () => {
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-28");
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-28"),
        periodBudgetDoc({
          startDate: "2026-08-28",
          endDate: "2026-09-03",
          period: "weekly",
          amountCents: 18386,
        }),
      );
    });
    await assertSucceeds(
      updateDoc(ref, { endDate: "2026-09-06", updatedAt: serverTimestamp() }),
    );
  });

  it("a stretch only goes forward", async () => {
    // Backwards would orphan every expense logged in the days given up: an
    // expense belongs to whichever period's range holds its date, and those
    // days would then belong to none.
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-28");
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-28"),
        periodBudgetDoc({
          startDate: "2026-08-28",
          endDate: "2026-09-03",
          period: "weekly",
          amountCents: 18386,
        }),
      );
    });
    await assertFails(
      updateDoc(ref, { endDate: "2026-09-01", updatedAt: serverTimestamp() }),
    );
    // Note what is NOT asserted: re-writing the same end date. That changes
    // nothing but updatedAt, so it is a no-op the re-budget branch already
    // permits — refusing it here would be testing the emulator's diff, not a
    // rule. The client refuses it (stretchPeriodTo) because it is a mistake.

  });

  it("a stretch cannot smuggle in money or a different period type", async () => {
    // The whole point of a separate branch: growing the budget is what the
    // week-to-fortnight extend is for, and it has its own conditions.
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-08-28");
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-28"),
        periodBudgetDoc({
          startDate: "2026-08-28",
          endDate: "2026-09-03",
          period: "weekly",
          amountCents: 18386,
        }),
      );
    });
    await assertFails(
      updateDoc(ref, {
        endDate: "2026-09-06",
        amountCents: 25000,
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ref, {
        endDate: "2026-09-06",
        period: "fortnightly",
        updatedAt: serverTimestamp(),
      }),
    );
    // startDate is the document id; a payload that disagrees with it is a bug.
    await assertFails(
      updateDoc(ref, {
        endDate: "2026-09-06",
        startDate: "2026-08-29",
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("an outsider cannot stretch anything", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-08-28"),
        periodBudgetDoc({
          startDate: "2026-08-28",
          endDate: "2026-09-03",
          period: "weekly",
          amountCents: 18386,
        }),
      );
    });
    await assertFails(
      updateDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD, "periodBudgets", "2026-08-28"),
        { endDate: "2026-09-06", updatedAt: serverTimestamp() },
      ),
    );
  });

  // ---------------------------- confirmedAt ----------------------------

  it("a member can confirm a period without touching a figure", async () => {
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    await assertSucceeds(setDoc(ref, periodBudgetDoc()));
    await assertSucceeds(
      updateDoc(ref, { confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );
  });

  it("confirming needs the server's clock, not the device's", async () => {
    // The whole point of the field is that every client agrees this period was
    // answered; a client-supplied time is a claim, not a fact.
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    await assertSucceeds(setDoc(ref, periodBudgetDoc()));
    await assertFails(
      // A date far from request.time: `new Date()` can land ON request.time in
      // the emulator, which would pass for the wrong reason.
      updateDoc(ref, {
        confirmedAt: new Date("2030-01-01"),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a confirmation cannot be taken back or rewritten", async () => {
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    await assertSucceeds(
      setDoc(ref, periodBudgetDoc({ confirmedAt: serverTimestamp() })),
    );
    await assertFails(
      updateDoc(ref, { confirmedAt: deleteField(), updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(ref, { confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    );
  });

  it("re-budgeting may carry the confirmation, since answering is what re-budgets", async () => {
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    await assertSucceeds(setDoc(ref, periodBudgetDoc()));
    await assertSucceeds(
      updateDoc(ref, {
        amountCents: 95000,
        source: "custom",
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a confirmation cannot smuggle a moved boundary", async () => {
    const ref = doc(
      db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01",
    );
    await assertSucceeds(setDoc(ref, periodBudgetDoc()));
    await assertFails(
      updateDoc(ref, {
        endDate: "2026-07-28",
        confirmedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a non-member cannot confirm", async () => {
    await assertSucceeds(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      ),
    );
    await assertFails(
      updateDoc(
        doc(db(env, CAROL), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        { confirmedAt: serverTimestamp(), updatedAt: serverTimestamp() },
      ),
    );
  });
});

  it("accepts the household's cards, and caps them", async () => {
    await seedHousehold();
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);

    // Stand-ins, never anyone's real digits.
    await assertSucceeds(
      updateDoc(ref, {
        cards: {
          "1234": { kind: "debit" },
          "5678": { kind: "credit", brand: "visa" },
        },
        updatedAt: serverTimestamp(),
      }),
    );

    // Six is the cap; a seventh is refused.
    const many: Record<string, { kind: string }> = {};
    for (let i = 0; i < 7; i += 1) many[`00${i}${i}`] = { kind: "debit" };
    await assertFails(updateDoc(ref, { cards: many, updatedAt: serverTimestamp() }));

    // The entry SHAPE is a client contract — a map's entries cannot be iterated
    // in rules — exactly as `categories` has always been. Asserted so the gap is
    // recorded rather than discovered.
    await assertSucceeds(
      updateDoc(ref, {
        cards: { "1234": { nonsense: true } },
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(ref, { cards: "not-a-map", updatedAt: serverTimestamp() }),
    );
  });

  // ------------------------ ingestRequestedAt ------------------------

  it("a member can ask the Gmail ingestion to run", async () => {
    await seedHousehold();
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        ingestRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("the request needs the server's clock", async () => {
    // The script trusts this stamp to decide whether a run was just asked for.
    // A device clock would be a claim; this makes it a fact.
    await seedHousehold();
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        ingestRequestedAt: new Date("2030-01-01"),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a stranger cannot ask for a run", async () => {
    await seedHousehold();
    await assertFails(
      updateDoc(doc(db(env, CAROL), "households", HOUSEHOLD), {
        ingestRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("the stamp still needs the server's clock inside a bigger edit", async () => {
    // Members may legitimately rename the household or change the default
    // budget, so those are NOT smuggling. What must hold either way is that
    // the stamp itself never comes from a device — which is why the rule sits
    // outside the branches rather than in its own.
    await seedHousehold();
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        name: "Merlines",
        ingestRequestedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        name: "Merlines",
        ingestRequestedAt: new Date("2030-01-01"),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  // ------------------------ cardFees ------------------------

  it("accepts the card fee settings", async () => {
    await seedHousehold();
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        cardFees: { commissionArsCents: 4041322, usdArsRate: 1514.5 },
        updatedAt: serverTimestamp(),
      }),
    );
    // Either field alone, because a household may know the fee before the rate.
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        cardFees: { commissionArsCents: 4041322 },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("refuses a fee or a rate that is not one", async () => {
    // Both multiply into a figure about money, so the shape is worth enforcing
    // here rather than trusting the one screen that writes them.
    await seedHousehold();
    const ref = doc(db(env, ALICE), "households", HOUSEHOLD);
    const bad = [
      { commissionArsCents: -1 },
      { commissionArsCents: 4041322.5 },
      { commissionArsCents: "40413" },
      { usdArsRate: 0 },
      { usdArsRate: -1514 },
      // A rate this far out is a typo, not a devaluation.
      { usdArsRate: 1000001 },
      { usdArsRate: "1514" },
      { commissionArsCents: 1, unexpected: true },
    ];
    for (const cardFees of bad) {
      await assertFails(updateDoc(ref, { cardFees, updatedAt: serverTimestamp() }));
    }
  });

  it("a stranger cannot set the card fees", async () => {
    await seedHousehold();
    await assertFails(
      updateDoc(doc(db(env, CAROL), "households", HOUSEHOLD), {
        cardFees: { commissionArsCents: 4041322 },
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("a household without cards still validates — the field is optional", async () => {
    // Every household predates this field; making it required would reject the
    // next write on all of them.
    await seedHousehold();
    await assertSucceeds(
      updateDoc(doc(db(env, ALICE), "households", HOUSEHOLD), {
        name: "Merlines",
        updatedAt: serverTimestamp(),
      }),
    );
  });

// ============================ services ============================

describe("households/{id}/services", () => {
  beforeEach(async () => {
    await seedHousehold(true);
  });

  const ref = (uid: string, id = "svc-1") =>
    doc(db(env, uid), "households", HOUSEHOLD, "services", id);

  it("caps a service name and a category id", async () => {
    // Neither is reachable from a screen — the fields have their own limits —
    // so both bounds would vanish silently. The service NAME is the whole link
    // to the ledger (Servicios finds the expense that paid a bill by matching
    // it), and an 81-character name is a name nobody typed.
    await assertFails(setDoc(ref(ALICE), serviceDoc(ALICE, { name: "x".repeat(81) })));
    await assertSucceeds(setDoc(ref(ALICE), serviceDoc(ALICE, { name: "x".repeat(80) })));
    await assertFails(
      setDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "expenses", "e-long-cat"),
        expenseDoc(ALICE, { categoryId: "x".repeat(41) }),
      ),
    );
  });

  it("either member can add, edit and delete a service", async () => {
    await assertSucceeds(setDoc(ref(ALICE), serviceDoc(ALICE)));
    // createdBy is attribution, not ownership — Natalia edits Cristian's row.
    await assertSucceeds(
      updateDoc(ref(BOB), { amountAudCents: 2599, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(deleteDoc(ref(BOB)));
  });

  it("an outsider cannot read or write them", async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "households", HOUSEHOLD, "services", "svc-1"), {
        ...serviceDoc(ALICE),
      });
    });
    await assertFails(getDoc(ref(CAROL)));
    await assertFails(getDocs(collection(db(env, CAROL), "households", HOUSEHOLD, "services")));
    await assertFails(setDoc(ref(CAROL, "svc-2"), serviceDoc(CAROL)));
    await assertFails(deleteDoc(ref(CAROL)));
  });

  it("a service must carry at least one price, and both must be positive ints", async () => {
    await assertFails(
      setDoc(
        ref(ALICE, "no-price"),
        without(serviceDoc(ALICE), "amountAudCents", "amountUsdCents"),
      ),
    );
    // One of the two is enough: plenty of bills are quoted in a single currency.
    await assertSucceeds(
      setDoc(ref(ALICE, "aud-only"), without(serviceDoc(ALICE), "amountUsdCents")),
    );
    await assertSucceeds(
      setDoc(ref(ALICE, "usd-only"), without(serviceDoc(ALICE), "amountAudCents")),
    );
    // Money is integer cents, never a float or a string.
    await assertFails(
      setDoc(ref(ALICE, "float"), serviceDoc(ALICE, { amountAudCents: 22.99 })),
    );
    await assertFails(
      setDoc(ref(ALICE, "string"), serviceDoc(ALICE, { amountUsdCents: "14.99" })),
    );
    await assertFails(
      setDoc(ref(ALICE, "zero"), serviceDoc(ALICE, { amountAudCents: 0 })),
    );
  });

  it("anchorMonth is required off-monthly and forbidden on it", async () => {
    // Monthly: every month is a due month, so an anchor would be dead weight
    // that could silently contradict the interval.
    await assertFails(
      setDoc(ref(ALICE, "monthly-anchored"), serviceDoc(ALICE, { anchorMonth: 3 })),
    );
    // Yearly without one is unanswerable: which month does it fall in?
    await assertFails(
      setDoc(ref(ALICE, "yearly-bare"), serviceDoc(ALICE, { interval: "yearly" })),
    );
    await assertSucceeds(
      setDoc(
        ref(ALICE, "yearly-ok"),
        serviceDoc(ALICE, { interval: "yearly", anchorMonth: 3 }),
      ),
    );
    await assertFails(
      setDoc(
        ref(ALICE, "month-13"),
        serviceDoc(ALICE, { interval: "quarterly", anchorMonth: 13 }),
      ),
    );
  });

  it("rejects an unknown interval, a bad dueDay or an unknown payment method", async () => {
    await assertFails(
      setDoc(ref(ALICE, "i"), serviceDoc(ALICE, { interval: "weekly" })),
    );
    await assertFails(setDoc(ref(ALICE, "d0"), serviceDoc(ALICE, { dueDay: 0 })));
    await assertFails(setDoc(ref(ALICE, "d32"), serviceDoc(ALICE, { dueDay: 32 })));
    await assertFails(
      setDoc(ref(ALICE, "p"), serviceDoc(ALICE, { paidWith: "cash" })),
    );
  });

  it("createdBy must be the author, and never changes afterwards", async () => {
    await assertFails(setDoc(ref(ALICE, "spoof"), serviceDoc(BOB)));
    await assertSucceeds(setDoc(ref(ALICE), serviceDoc(ALICE)));
    await assertFails(
      updateDoc(ref(BOB), { createdBy: BOB, updatedAt: serverTimestamp() }),
    );
  });
});

// ============================ cardStatements ============================

describe("households/{id}/cardStatements", () => {
  beforeEach(async () => {
    await seedHousehold(true);
  });

  const ref = (uid: string, closing = "2026-08-27") =>
    doc(db(env, uid), "households", HOUSEHOLD, "cardStatements", closing);

  it("members can open a statement; the doc ID must equal closingDate", async () => {
    await assertSucceeds(setDoc(ref(ALICE), statementDoc()));
    await assertFails(
      setDoc(ref(ALICE, "2026-09-27"), statementDoc()), // id ≠ closingDate
    );
    await assertFails(setDoc(ref(CAROL, "2026-10-27"), statementDoc({ closingDate: "2026-10-27" })));
  });

  it("the bill must be payable after it closes, and the window must be ordered", async () => {
    await assertFails(
      setDoc(ref(ALICE), statementDoc({ dueDate: "2026-08-27" })), // same day
    );
    await assertFails(
      setDoc(ref(ALICE), statementDoc({ dueDate: "2026-08-01" })), // before closing
    );
    await assertFails(
      setDoc(ref(ALICE), statementDoc({ startDate: "2026-09-01" })), // starts after it closes
    );
    await assertFails(
      setDoc(ref(ALICE), statementDoc({ closingDate: "2026-8-27" })), // not zero-padded
    );
  });

  it("only the due date can be corrected — the charge window cannot move", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "cardStatements", "2026-08-27"),
        statementDoc(),
      );
    });
    await assertSucceeds(
      updateDoc(ref(BOB), { dueDate: "2026-09-10", updatedAt: serverTimestamp() }),
    );
    // Moving startDate would silently re-file charges nobody touched.
    await assertFails(
      updateDoc(ref(ALICE), { startDate: "2026-07-01", updatedAt: serverTimestamp() }),
    );
  });

  it("a statement opened with the wrong dates can be deleted", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "cardStatements", "2026-08-27"),
        statementDoc(),
      );
    });
    await assertFails(deleteDoc(ref(CAROL)));
    await assertSucceeds(deleteDoc(ref(BOB)));
  });
});

// ============================ cardCharges ============================

describe("households/{id}/cardCharges", () => {
  beforeEach(async () => {
    await seedHousehold(true);
  });

  const ref = (uid: string, id = "chg-1") =>
    doc(db(env, uid), "households", HOUSEHOLD, "cardCharges", id);

  it("either member can add, edit and delete a charge", async () => {
    await assertSucceeds(setDoc(ref(ALICE), cardChargeDoc(ALICE)));
    await assertSucceeds(
      updateDoc(ref(BOB), { usdCents: 2499, updatedAt: serverTimestamp() }),
    );
    await assertSucceeds(deleteDoc(ref(BOB)));
  });

  it("an outsider cannot read or write them", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "cardCharges", "chg-1"),
        cardChargeDoc(ALICE),
      );
    });
    await assertFails(getDoc(ref(CAROL)));
    await assertFails(
      getDocs(collection(db(env, CAROL), "households", HOUSEHOLD, "cardCharges")),
    );
    await assertFails(setDoc(ref(CAROL, "chg-2"), cardChargeDoc(CAROL)));
    await assertFails(deleteDoc(ref(CAROL)));
  });

  it("only visa or mastercard, and the amount is positive integer USD cents", async () => {
    await assertFails(setDoc(ref(ALICE, "amex"), cardChargeDoc(ALICE, { card: "amex" })));
    await assertSucceeds(
      setDoc(ref(ALICE, "mc"), cardChargeDoc(ALICE, { card: "mastercard" })),
    );
    await assertFails(
      setDoc(ref(ALICE, "float"), cardChargeDoc(ALICE, { usdCents: 19.99 })),
    );
    await assertFails(setDoc(ref(ALICE, "zero"), cardChargeDoc(ALICE, { usdCents: 0 })));
  });

  it("the date is a household calendar date and the detail may be empty", async () => {
    await assertSucceeds(setDoc(ref(ALICE, "blank"), cardChargeDoc(ALICE, { detail: "" })));
    await assertFails(
      setDoc(ref(ALICE, "bad-date"), cardChargeDoc(ALICE, { date: "2026-8-3" })),
    );
    await assertFails(
      setDoc(ref(ALICE, "long"), cardChargeDoc(ALICE, { detail: "x".repeat(201) })),
    );
  });

  it("takes the digital flag, and only as a boolean", async () => {
    // Optional because every charge predates it, and the client reads its
    // absence as true — see shared/schema.md. Two peso tax lines depend on it.
    await assertSucceeds(
      setDoc(ref(ALICE, "dig"), cardChargeDoc(ALICE, { digital: true })),
    );
    await assertSucceeds(
      setDoc(ref(ALICE, "shop"), cardChargeDoc(ALICE, { digital: false })),
    );
    await assertSucceeds(setDoc(ref(ALICE, "absent"), cardChargeDoc(ALICE)));
    await assertFails(
      setDoc(ref(ALICE, "str"), cardChargeDoc(ALICE, { digital: "true" })),
    );
  });

  it("a charge carries no statement id — nothing to spoof", async () => {
    // Bucketing is by date, so an extra field is not just unused: accepting it
    // would let two clients disagree about which statement a charge is in.
    await assertFails(
      setDoc(ref(ALICE, "extra"), cardChargeDoc(ALICE, { statementId: "2026-08-27" })),
    );
  });

  it("createdBy must be the author, and never changes afterwards", async () => {
    await assertFails(setDoc(ref(ALICE, "spoof"), cardChargeDoc(BOB)));
    await assertSucceeds(setDoc(ref(ALICE), cardChargeDoc(ALICE)));
    await assertFails(
      updateDoc(ref(BOB), { createdBy: BOB, updatedAt: serverTimestamp() }),
    );
  });
});

describe("recurringRules — the patterns that file a charge on their own", () => {
  beforeEach(async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "households", HOUSEHOLD), householdDoc(ALICE));
    });
  });

  const ref = () =>
    doc(db(env, ALICE), "households", HOUSEHOLD, "recurringRules", "r1");

  it("a member writes one, and a stranger cannot read it", async () => {
    await assertSucceeds(setDoc(ref(), recurringRuleDoc(ALICE)));
    await assertFails(
      getDoc(doc(db(env, CAROL), "households", HOUSEHOLD, "recurringRules", "r1")),
    );
  });

  it("refuses a pattern that would claim every charge that ever arrives", async () => {
    // The one outcome a rule must never have. The clients refuse it too; this
    // is what makes it true of the data rather than of the screens.
    await assertFails(setDoc(ref(), recurringRuleDoc(ALICE, { pattern: "" })));
  });

  it("caps the pattern, the note and the category", async () => {
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { pattern: "x".repeat(81) })),
    );
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { note: "x".repeat(201) })),
    );
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { categoryId: "x".repeat(41) })),
    );
  });

  it("lets the amount be ABSENT, because that is the rule saying ask me", async () => {
    await assertSucceeds(
      setDoc(ref(), without(recurringRuleDoc(ALICE), "amountAudCents")),
    );
  });

  it("...but not zero or negative, which would file a free expense", async () => {
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { amountAudCents: 0 })),
    );
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { amountAudCents: -1 })),
    );
  });

  it("holds the amount to the same ceiling as an expense", async () => {
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { amountAudCents: 10000001 })),
    );
  });

  it("refuses a field nobody asked for", async () => {
    await assertFails(
      setDoc(ref(), recurringRuleDoc(ALICE, { enabled: true })),
    );
  });

  it("keeps createdBy and createdAt across an edit", async () => {
    await assertSucceeds(setDoc(ref(), recurringRuleDoc(ALICE)));
    await assertFails(
      setDoc(ref(), recurringRuleDoc(BOB, { pattern: "Coles*" })),
    );
  });
});

describe("an expense a rule filed on its own", () => {
  beforeEach(async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "households", HOUSEHOLD), householdDoc(ALICE));
    });
  });

  const ref = () => doc(db(env, ALICE), "households", HOUSEHOLD, "expenses", "e1");

  it("may name the rule that filed it", async () => {
    await assertSucceeds(
      setDoc(ref(), expenseDoc(ALICE, { autoRuleId: "r1" })),
    );
  });

  it("...and a typed one simply has no such field", async () => {
    await assertSucceeds(setDoc(ref(), expenseDoc(ALICE)));
  });

  it("refuses an empty or oversized rule id", async () => {
    await assertFails(setDoc(ref(), expenseDoc(ALICE, { autoRuleId: "" })));
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { autoRuleId: "x".repeat(61) })),
    );
  });
});

describe("filing a charge a rule recognised", () => {
  beforeEach(async () => {
    await seed(env, async (admin) => {
      await setDoc(doc(admin, "households", HOUSEHOLD), householdDoc(ALICE));
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "bankCharges", "msg1"),
        { usdCents: 1240, date: "2026-09-05", merchant: "OPAL AUCKLAND ST", importedAt: serverTimestamp() },
      );
    });
  });

  /** Exactly what mutations.ts sends: both halves in one batch. */
  function fileIt(uid: string) {
    const client = db(env, uid);
    const batch = writeBatch(client);
    batch.set(doc(client, "households", HOUSEHOLD, "expenses", "auto_msg1"), {
      ...expenseDoc(uid, {
        amountCents: 1500,
        usdCents: 1240,
        verified: true,
        autoRuleId: "r1",
        date: "2026-09-05",
      }),
    });
    batch.update(doc(client, "households", HOUSEHOLD, "bankCharges", "msg1"), {
      dismissedAt: serverTimestamp(),
    });
    return batch.commit();
  }

  it("goes through as one batch: the expense lands and the charge leaves", async () => {
    await assertSucceeds(fileIt(ALICE));
  });

  it("and comes back the same way, which is what the 48 hours are", async () => {
    await fileIt(ALICE);
    const client = db(env, ALICE);
    const batch = writeBatch(client);
    batch.delete(doc(client, "households", HOUSEHOLD, "expenses", "auto_msg1"));
    batch.update(doc(client, "households", HOUSEHOLD, "bankCharges", "msg1"), {
      dismissedAt: deleteField(),
    });
    await assertSucceeds(batch.commit());
  });

  it("a stranger cannot file one", async () => {
    await assertFails(fileIt(CAROL));
  });

  it("filing cannot smuggle another field onto the charge", async () => {
    // The charge is the ingestion's document; a client may only ever dismiss
    // it. If this stopped holding, a client could rewrite what the bank said.
    const client = db(env, ALICE);
    const batch = writeBatch(client);
    batch.update(doc(client, "households", HOUSEHOLD, "bankCharges", "msg1"), {
      dismissedAt: serverTimestamp(),
      usdCents: 1,
    });
    await assertFails(batch.commit());
  });
});
