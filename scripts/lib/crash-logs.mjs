// Which of the phone's crash logs are this app's, and what each one says.
//
// Apps sideloaded with a free team never reach App Store Connect, so Xcode's
// Organizer collects nothing for them: a crash on the phone was simply never
// seen. The phone keeps the reports itself, and the install already has it
// on a cable, so install-ios brings them back. These two are the decisions,
// kept pure so they can be tested without a device.

import { basename } from "node:path";

/**
 * The names (paths) that are crash reports of one of `targets`.
 *
 * The device's crash directory is the whole system's — every app, every
 * daemon — so the match is the target's name followed by a separator, never
 * a substring: "Gastos" must not take "GastosDraft", and "GastosWidget" is a
 * target of its own.
 */
export function crashLogsOf(names, targets) {
  return names.filter((name) => {
    const file = basename(name);
    if (!file.endsWith(".ips")) return false;
    return targets.some(
      (target) => file.startsWith(`${target}-`) || file.startsWith(`${target}.`),
    );
  });
}

/**
 * The header of an .ips report — its first line is a JSON object — as what is
 * worth printing. Null when it does not parse: a summary invented from a
 * report it could not read is worse than none.
 */
export function crashSummary(text) {
  const first = text.split("\n", 1)[0];
  let header;
  try {
    header = JSON.parse(first);
  } catch {
    return null;
  }
  if (header === null || typeof header !== "object" || typeof header.app_name !== "string") {
    return null;
  }
  return {
    app: header.app_name,
    version: typeof header.app_version === "string" ? header.app_version : "?",
    at: typeof header.timestamp === "string" ? header.timestamp : "?",
  };
}

/**
 * The relative paths in a `devicectl device info files --json-output` listing.
 * Anything not shaped like one is skipped, so a changed format reads as "no
 * reports" and the caller's count says so, instead of crashing the install.
 */
export function listedPaths(listing) {
  const files = listing?.result?.files;
  if (!Array.isArray(files)) return [];
  return files
    .map((f) => f?.relativePath)
    .filter((p) => typeof p === "string" && p !== "");
}
