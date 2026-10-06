"use client";

// Keyboard focus for a modal dialog: in on open, kept inside, back on close.
//
// Every dialog in the app is a hand-drawn `role="dialog" aria-modal="true"`
// panel, and none of them did this. Measured on Tarjetas' tax breakdown: on
// open, focus stayed on the "i" that opened it, and the second Tab was already
// on the page BEHIND the backdrop — a keyboard user could not reach the
// dialog's own buttons without first walking through everything under it.
// `aria-modal` tells a screen reader the rest of the page is inert; it does
// nothing for the Tab key.
//
// A hook rather than a <Dialog> component because the twelve panels differ in
// everything else (sheet vs card, scroll, footers) and a wrapper would have to
// take all of that as props. This is the one behaviour they must all share.
//
// Mount semantics: call it in a component that exists only while its dialog is
// open. The element that opened the dialog is read on the FIRST render — before
// any `autoFocus` inside the panel has run, which happens during commit — and
// that is the only moment it is still `document.activeElement`.

import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** What Tab can land on inside `root`, in document order. */
function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    // Hidden things are not reachable by Tab, so cycling to one would stall.
    (el) => el.getClientRects().length > 0,
  );
}

/**
 * Attach the returned ref to the element carrying `role="dialog"`.
 *
 * - On open, focus moves to the first control, unless an `autoFocus` inside
 *   already put it somewhere in the panel — that choice is kept.
 * - Tab and Shift+Tab wrap inside the panel.
 * - On close, focus returns to whatever opened it, if it is still on the page.
 */
export function useModalFocus<T extends HTMLElement>(): RefObject<T | null> {
  const panel = useRef<T>(null);
  const [opener] = useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  // Where focus first settled inside the panel. Kept across StrictMode's
  // mount → cleanup → mount in development: the cleanup hands focus back to
  // the opener, and without this the second mount would move it to the first
  // control instead of the field the dialog chose with `autoFocus`.
  const settled = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const root = panel.current;
    if (root === null) return;

    const active = document.activeElement;
    if (active instanceof HTMLElement && root.contains(active)) {
      settled.current = active;
    } else if (settled.current?.isConnected && root.contains(settled.current)) {
      settled.current.focus();
    } else {
      // A panel with nothing focusable still has to hold focus, or Tab would
      // start from the page underneath.
      if (!root.hasAttribute("tabindex")) root.setAttribute("tabindex", "-1");
      const target = focusables(root)[0] ?? root;
      target.focus();
      settled.current = target;
    }

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables(root);
      if (items.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      const outside = !root.contains(active);
      if (event.shiftKey && (active === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      // Back where the person was. Not when that control is gone — a row that
      // was deleted from inside its own dialog, say — because focusing a
      // detached node silently drops focus to <body> anyway.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [opener]);

  return panel;
}
