import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import {
  ALICE,
  BOB,
  CAROL,
  HOUSEHOLD,
  INVITE_CODE,
  createTestEnv,
  db,
  expenseDoc,
  householdDoc,
  periodBudgetDoc,
  seed,
  userDoc,
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

  it("accepts a valid default entry currency", async () => {
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
    // Bi-currency: bad entryCurrency, non-int/absent entryAmountCents.
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { entryCurrency: "EUR", entryAmountCents: 700 })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { entryCurrency: "USD", entryAmountCents: 0 })),
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { entryCurrency: "USD" })), // amount missing
    );
    await assertFails(
      setDoc(ref(), expenseDoc(ALICE, { entryAmountCents: 700 })), // currency missing
    );
  });

  it("accepts a USD-entered expense (amountCents stays AUD canonical)", async () => {
    // amountCents = AUD (converted); entryCurrency/entryAmountCents = original USD.
    await assertSucceeds(
      setDoc(
        doc(collection(db(env, ALICE), "households", HOUSEHOLD, "expenses")),
        expenseDoc(ALICE, {
          amountCents: 1076,
          entryCurrency: "USD",
          entryAmountCents: 700,
        }),
      ),
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

  it("only the amount (and source) can change after materialization", async () => {
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
    // moving the boundaries or the type → never
    await assertFails(
      updateDoc(ref, { endDate: "2026-07-20", updatedAt: serverTimestamp() }),
    );
    await assertFails(
      updateDoc(ref, { period: "weekly", updatedAt: serverTimestamp() }),
    );
  });

  it("periods are an immutable record — no deletes", async () => {
    await seed(env, async (admin) => {
      await setDoc(
        doc(admin, "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
        periodBudgetDoc(),
      );
    });
    await assertFails(
      deleteDoc(
        doc(db(env, ALICE), "households", HOUSEHOLD, "periodBudgets", "2026-07-01"),
      ),
    );
  });
});
