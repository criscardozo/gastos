#!/usr/bin/env node
// Build, re-sign and install on the phone — the whole procedure, so that none
// of it depends on remembering.
//
// Installing ALWAYS renews the signature. A free team reuses whatever
// provisioning profile already exists, so an ordinary build keeps the old
// expiry and reinstalling buys nothing: every install spends days off the same
// profile until the app stops opening. One install left an app 23 hours from
// dying, and reinstalling could not save it. It is not a decision to make by
// looking at how long is left — looking is exactly what leads to skipping it.
//
// The guards, each earned in both projects independently:
//
//   1. The build's status is captured BEFORE anything is piped. `xcodebuild |
//      grep` returns GREP's exit code — measured: 0 for a build that failed
//      with 65. Reading "BUILD SUCCEEDED" out of the text works only because
//      xcodebuild happens to print it.
//   2. Nothing is read out of the bundle until the build is known to have
//      succeeded. When it fails, the .app on disk is still the PREVIOUS one,
//      so its old dates read as "it did not renew" when the truth is "nothing
//      was issued".
//   3. The profiles go back when the build FAILS, and only then. After a
//      success Xcode has already issued replacements under new filenames, so
//      putting the old ones back restores nothing and piles up a dead set
//      every run. Measured: 12 profiles became 16 in two runs.
//   4. It aborts when the freshly issued signature has under a day left, which
//      is precisely what a silent non-renewal looks like from here.
//   5. It compares what the built bundle will SHOW against what the project
//      declares. The version guard reads the tracked files, and those hold
//      `$(MARKETING_VERSION)`; only the bundle has the substituted value.
//
// And every exit says WHICH STAGE it died at. A negative result has to say
// where, not just that: one of these scripts once failed its own failure-test
// at the first stage and still printed a plausible "non-zero exit, profiles
// restored" for a build that had never run.
//
// Last run against a real phone: 15 September 2026, in a project with three
// projects' profiles on the machine. It set aside 3 of 13 — exactly that app's
// — built, reissued a signature good for 6 days 23 hours, and the bundle
// reported the same version the manifest declares. The first attempt failed at
// the install step on a CoreDevice error, which is how guard 3 came to be
// exercised for real rather than in a test: the machine was left with all 13
// profiles, the three reissued ones among them. The date is written down
// instead of the assurance, because this claim is only as true as the last
// time somebody ran it.
//
// After installing it brings the app's crash reports back off the phone into
// <repo>/crash-logs/ (gitignore it): a free-team sideload never reaches
// App Store Connect, so Xcode's Organizer collects nothing, and the install is
// the one moment the phone is on a cable. Matched by the names in
// `iosTargets` (or `iosScheme`). It never fails the install — that has
// already succeeded — and says so when it could not look. Measured against a
// real phone on 1 October 2026: the domain copied 556 reports from the whole
// system, named `<executable>-<date>.ips` with `app_name` in the header line;
// the watch's crashes arrive on the phone too. 159 were another app's watch
// app, which is what told 0 of ours apart from a match that never matches.
//
// Usage:  node scripts/install-ios.mjs [--device <udid-or-name>]
// Reads from scripts/project.json: bundleId, iosScheme, and optionally iosDir,
// iosDevice, iosTargets and webManifest.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadProject } from "./lib/project.mjs";
import { ScriptError, run } from "./lib/errors.mjs";
import { belongsToApp, signingVerdict, versionVerdict } from "./lib/signing.mjs";
import { crashLogsOf, crashSummary, listedPaths } from "./lib/crash-logs.mjs";

const PROFILES = join(
  process.env.HOME ?? "",
  "Library/Developer/Xcode/UserData/Provisioning Profiles",
);

let stage = "arranque";
const say = (text) => {
  stage = text;
  console.log(`\n== ${text} ==`);
};

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });

/**
 * Bring this app's crash reports off the phone. Lists the crash domain, keeps
 * the reports named after `targets`, and copies those one by one.
 *
 * It copied the whole domain in one go at first, and the second real run
 * failed on a file that was not ours: a watch analytics report the phone
 * would not open (POSIX error 1, under ProxiedDevice-…/Retired), and one
 * unreadable file fails the whole copy. One file at a time, so a report that
 * will not come only costs itself — and 500-odd reports nobody wanted stop
 * crossing the cable. Prints the counts, so "none of ours" never passes for
 * "could not look", and never throws: the install has already succeeded.
 */
function pullCrashLogs(device, targets, root) {
  const work = mkdtempSync(join(tmpdir(), "gastos-crashes-"));
  try {
    const listingFile = join(work, "listing.json");
    sh("xcrun", [
      "devicectl", "device", "info", "files", "--device", device,
      "--domain-type", "systemCrashLogs", "--json-output", listingFile,
    ]);
    const all = listedPaths(JSON.parse(readFileSync(listingFile, "utf8")));
    const ours = crashLogsOf(all, targets);
    const dest = join(root, "crash-logs");
    mkdirSync(dest, { recursive: true });
    const fresh = ours.filter((rel) => !existsSync(join(dest, basename(rel))));
    const copied = [];
    const failed = [];
    for (const rel of fresh) {
      try {
        sh("xcrun", [
          "devicectl", "device", "copy", "from", "--device", device,
          "--domain-type", "systemCrashLogs", "--source", rel,
          "--destination", join(dest, basename(rel)),
        ]);
        copied.push(rel);
      } catch {
        failed.push(rel);
      }
    }
    console.log(
      `   ${all.length} entradas en el teléfono, ${ours.length} de ${targets.join("/")}, ` +
        `${copied.length} nuevos en crash-logs/` +
        (failed.length > 0 ? `, ${failed.length} que no se dejaron copiar` : ""),
    );
    for (const rel of copied) {
      const summary = crashSummary(readFileSync(join(dest, basename(rel)), "utf8"));
      console.log(
        summary === null
          ? `   ${basename(rel)} (no pude leer la cabecera)`
          : `   ${summary.app} ${summary.version} · ${summary.at}`,
      );
    }
    for (const rel of failed) console.log(`   no se copió: ${basename(rel)}`);
  } catch (error) {
    console.log(
      `   no pude traer los crash logs: ${String(error.stderr ?? error.message).slice(0, 200)}`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The decoded plist of a .mobileprovision, or null when it cannot be read. */
function readProfile(path) {
  try {
    const xml = sh("security", ["cms", "-D", "-i", path], { maxBuffer: 8 << 20 });
    const get = (key) =>
      sh("plutil", ["-extract", key, "raw", "-o", "-", "-"], { input: xml }).trim();
    return {
      name: get("Name"),
      appId: get("Entitlements.application-identifier"),
      expiry: new Date(get("ExpirationDate")),
    };
  } catch {
    return null;
  }
}

async function main() {
  const { root, config, dir } = loadProject({ required: ["bundleId", "iosScheme"] });
  const iosDir = config.iosDir ? dir("iosDir") : join(root, "apps", "ios");
  const manifest = config.webManifest
    ? dir("webManifest")
    : join(root, "apps", "web", "package.json");

  // The gate in `run` already refused anything undeclared, so this only has
  // to read the value it let through.
  const argv = process.argv.slice(2);
  const flag = argv.indexOf("--device");
  const device = flag !== -1 ? argv[flag + 1] : (process.env.IOS_DEVICE ?? config.iosDevice);
  if (device === undefined || device === "") {
    throw new ScriptError(
      "No device. Pass --device <udid or name>, set IOS_DEVICE, or put\n" +
        '  "iosDevice" in scripts/project.json.',
    );
  }

  const project = join(iosDir, `${config.iosScheme}.xcodeproj`);
  if (!existsSync(project)) {
    throw new ScriptError(`No ${basename(project)} in ${iosDir}. Run xcodegen first.`);
  }

  const stash = mkdtempSync(join(tmpdir(), "gastos-profiles-"));
  const derived = mkdtempSync(join(tmpdir(), "gastos-dd-"));
  let renewed = false;
  // The build directory is a whole Debug build, hundreds of MB, and it was
  // left in $TMPDIR on every run. It goes in `finally` unless the build
  // failed, in which case its log is the one thing worth keeping, and the
  // error says where it is — before, nothing did.
  let keepLog = false;

  const restoreProfiles = () => {
    // Guard 3: only on failure, and only what is actually missing.
    if (renewed) return;
    const held = readdirSync(stash).filter((f) => f.endsWith(".mobileprovision"));
    for (const file of held) {
      const back = join(PROFILES, file);
      if (!existsSync(back)) copyFileSync(join(stash, file), back);
    }
    if (held.length > 0) console.log("   (perfiles restaurados: no se emitió ninguno nuevo)");
  };

  try {
    say(`1. Apartando los perfiles de ${config.bundleId}`);
    let moved = 0;
    for (const file of readdirSync(PROFILES).filter((f) => f.endsWith(".mobileprovision"))) {
      const profile = readProfile(join(PROFILES, file));
      if (profile === null || !belongsToApp(profile.appId, config.bundleId)) continue;
      copyFileSync(join(PROFILES, file), join(stash, file));
      rmSync(join(PROFILES, file));
      console.log(`   ${profile.name}`);
      moved += 1;
    }
    console.log(`   ${moved} apartados (se reemiten en la misma pasada, así quedan alineados)`);

    say(`2. Compilando ${config.iosScheme}`);
    // Guard 1: the status first, and only then the log. Nothing is piped here.
    const log = join(derived, "build.log");
    let status = 0;
    try {
      const out = sh(
        "xcodebuild",
        [
          "build",
          "-project", project,
          "-scheme", config.iosScheme,
          "-configuration", "Debug",
          "-destination", "generic/platform=iOS",
          "-derivedDataPath", derived,
          "-allowProvisioningUpdates",
        ],
        { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 },
      );
      writeFileSync(log, out);
    } catch (error) {
      status = error.status ?? 1;
      writeFileSync(log, `${error.stdout ?? ""}${error.stderr ?? ""}`);
    }

    if (status !== 0) {
      const text = readFileSync(log, "utf8");
      console.log(`   el build falló (${status}):`);
      for (const line of text.split("\n").filter((l) => l.includes("error:")).slice(0, 5)) {
        console.log(`     ${line.trim()}`);
      }
      // "No Accounts" is xcodebuild's own message and it is misleading. Xcode
      // HAS the account; what it could not do is load the account's
      // credential, and it then PRUNES the account it could not authenticate
      // — so the empty account list is the consequence, not the cause.
      //
      // Read from the LOG and not from the keychain: Xcode keeps that
      // credential in the data-protection keychain, which the `security` CLI
      // cannot enumerate at all, so a pre-flight check there fails even with
      // signing working perfectly.
      if (/missing Xcode-Username|No Accounts/.test(text)) {
        console.log(
          "\n   La cuenta está en Xcode pero se perdió su credencial del keychain,\n" +
            "   así que xcodebuild no puede pedir un perfil nuevo. Se arregla\n" +
            "   volviendo a firmar: Xcode -> Settings -> Accounts -> Sign In,\n" +
            "   y corriendo esto otra vez.",
        );
      }
      keepLog = true;
      throw new ScriptError(`   el build terminó en ${status}. Log completo: ${log}`);
    }
    console.log("   BUILD SUCCEEDED (exit 0, no leído del texto)");
    // Past here the old profiles are superseded, not worth putting back.
    renewed = true;

    // Guard 2: reached only with status 0, so the bundle is this build's.
    say("3. Firma emitida");
    const app = join(derived, "Build/Products/Debug-iphoneos", `${config.iosScheme}.app`);
    const embedded = sh("find", [app, "-name", "embedded.mobileprovision"])
      .trim()
      .split("\n")
      .filter(Boolean);
    const profiles = embedded
      .map((path) => readProfile(path))
      .filter((p) => p !== null)
      .map((p) => ({ name: p.name, expiry: p.expiry }));
    const verdict = signingVerdict(profiles);
    for (const p of verdict.sorted) {
      console.log(`   ${p.name.padEnd(52)} vence ${p.expiry.toISOString()}`);
    }
    console.log(`   el más corto manda: quedan ${verdict.days} días y ${verdict.hours} horas`);
    // Guard 4.
    if (!verdict.fresh) {
      throw new ScriptError(
        `   ABORTO: una firma recién emitida dura 7 días, no ${verdict.days}d ${verdict.hours}h.\n` +
          "   No se reemitió nada. No instalo para no dejarte una app que muere hoy.",
      );
    }

    // Guard 5.
    say("4. La versión que se vería en Ajustes");
    const declared = JSON.parse(readFileSync(manifest, "utf8")).version;
    let shipped = "(sin clave)";
    try {
      shipped = sh("plutil", [
        "-extract", "CFBundleShortVersionString", "raw", join(app, "Info.plist"),
      ]).trim();
    } catch {
      // Left as the placeholder, which cannot agree with a real version.
    }
    const version = versionVerdict(shipped, declared);
    console.log(`   la app declara ${version.shipped} · el manifiesto dice ${version.declared}`);
    if (!version.agrees) {
      throw new ScriptError(
        `   ABORTO: lo que se instalaría muestra ${version.shipped}, no ${version.declared}.\n` +
          "   Revisá CFBundleShortVersionString en project.yml y corré xcodegen.",
      );
    }

    say(`5. Instalando en ${device}`);
    // The phone sometimes answers "disconnected immediately after connecting"
    // on the first try and is fine on the second.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const out = sh("xcrun", [
          "devicectl", "device", "install", "app", "--device", device, app,
        ]);
        const line = out.split("\n").find((l) => l.includes("bundleID"));
        console.log(`   ${line === undefined ? "instalado" : line.trim()}`);
        // Named for the same reason as the app: an extension that failed to
        // embed installs a perfectly working app with no widget, and nothing
        // else says so.
        for (const extra of ["Watch", "PlugIns"]) {
          const path = join(app, extra);
          const what = existsSync(path) ? readdirSync(path).join(" ") : "no embebido";
          console.log(`   ${extra.toLowerCase().padEnd(7)} ${what}`);
        }
        say("6. Crash logs del teléfono");
        pullCrashLogs(device, config.iosTargets ?? [config.iosScheme], root);
        say(`Listo. Vence en ${verdict.days} días.`);
        return;
      } catch (error) {
        if (attempt === 3) {
          throw new ScriptError(
            `   no pude instalar: ${String(error.stderr ?? error.message).slice(0, 200)}`,
          );
        }
        console.log(`   intento ${attempt} falló, reintento en 20s`);
        execFileSync("sleep", ["20"]);
      }
    }
  } catch (error) {
    // Where, not just whether: without this, dying before the build looks
    // exactly like a build that failed.
    console.error(`\nFALLÓ en: ${stage}`);
    throw error;
  } finally {
    restoreProfiles();
    rmSync(stash, { recursive: true, force: true });
    if (!keepLog) rmSync(derived, { recursive: true, force: true });
  }
}

run(main, {
  usage:
    "Usage: node scripts/install-ios.mjs [--device <udid-or-name>]\n" +
    "  Without --device it uses IOS_DEVICE, then iosDevice from scripts/project.json.",
  values: ["--device"],
});
