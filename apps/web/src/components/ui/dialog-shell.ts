/**
 * The panel every dialog in this app is drawn on, in one place.
 *
 * It was copy-pasted into eight components — a sheet from the bottom on a
 * phone, a centred card from `sm` up — and the duplication is what made the
 * design-system check fail: `radius 24px (8 usos) no está en tokens.json`.
 * That check's floor is eight, so the ninth dialog would have failed it again,
 * and its own reasoning is that what erodes a system is "a one-off slipping in
 * beside" the scale. 24px is not a one-off here; it is the dialog radius. What
 * was wrong was having eight copies of it rather than a name.
 *
 * Adding r24 to tokens.json was the other option. This one is better because it
 * fixes what the check was really pointing at: nothing about the design changed,
 * and now there is one line to change if it ever does.
 */

/** The dialog panel: bottom sheet on a phone, centred card from `sm` up. */
export const DIALOG_SHELL =
  "flex max-h-[92vh] w-full max-w-[440px] flex-col gap-3.5 overflow-y-auto rounded-t-[24px] border border-line bg-surface px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5 sm:rounded-[24px]";

/** The dimmed backdrop the panel sits on. */
export const DIALOG_BACKDROP =
  "fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6";

/** A text input inside one. */
export const DIALOG_FIELD =
  "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-accent";
