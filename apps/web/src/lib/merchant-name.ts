/**
 * A bank's merchant string, as it is SHOWN: "OPAL AUCKLAND ST" → "Opal
 * Auckland St".
 *
 * The bank sends merchants in capitals, and a list of them reads as a wall of
 * shouting beside expenses written the way people write. An all-caps string is
 * shown with each space-separated word capitalised; anything already in mixed
 * case is left alone, because it was written that way on purpose ("iTunes",
 * "McDonald's"). The same form seeds the note of an expense or a rule made
 * from a charge.
 *
 * Display only: matching, a rule's pattern and the stored charge keep the raw
 * string. The Swift side is `MerchantName.display`; both run
 * shared/merchant-name-vectors.json.
 */
export function displayMerchant(raw: string): string {
  if (!/\p{L}/u.test(raw) || raw !== raw.toUpperCase()) return raw;
  // Word by word on spaces only, so "NETFLIX.COM" becomes "Netflix.com"
  // rather than "Netflix.Com".
  return raw
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
