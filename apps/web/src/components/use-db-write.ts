"use client";

import { useCallback } from "react";
import type { Firestore } from "firebase/firestore";

import { useAppError } from "@/components/app-error";
import { getFirebaseClient } from "@/lib/firebase/client";

/**
 * Run a mutation against the client's Firestore, fire-and-forget, with a
 * refusal reported through the app's error dialog.
 *
 * Four screens each wrote their own `withDb` helper that did `void fn(db)`:
 * right about not awaiting — Firestore resolves a write only on server ack,
 * so awaiting freezes the form offline — and wrong about the rejection, which
 * went nowhere. A service, a card charge, a card fee or a default budget the
 * rules refused stayed on screen from the local cache, saved nowhere, and the
 * only sign was an unhandled rejection in the console. One helper, so the next
 * screen inherits the report instead of copying the swallow.
 */
export function useDbWrite(): (
  fn: (db: Firestore) => Promise<unknown>,
) => void {
  const { write } = useAppError();
  return useCallback(
    (fn) => {
      const fb = getFirebaseClient();
      if (fb === null) return;
      write(fn(fb.db));
    },
    [write],
  );
}
