import assert from "node:assert/strict";
import { test } from "node:test";
import { crashLogsOf, crashSummary, listedPaths } from "../lib/crash-logs.mjs";

const TARGETS = ["Gastos", "GastosWidget", "GastosWatch"];

test("a crash log is the app's when its name is a target's, up to a separator", () => {
  const names = [
    "Gastos-2026-09-30-101112.ips",
    "GastosWidget-2026-09-30-101112.ips",
    "GastosWatch.2026-09-30-101112.ips",
    "Retired/Gastos-2026-08-01-000000.ips",
  ];
  assert.deepEqual(crashLogsOf(names, TARGETS), names);
});

test("another app's crash, or a target name inside a longer one, is not", () => {
  // The device's crash directory is the whole system's: every app, every
  // daemon. A substring match would file Stock's crashes under Gastos.
  assert.deepEqual(
    crashLogsOf(
      [
        "Stock-2026-09-30-101112.ips",
        "GastosDraft-2026-09-30-101112.ips",
        "MyGastos-2026-09-30-101112.ips",
        "Gastos-2026-09-30-101112.txt",
        "JetsamEvent-2026-09-30-101112.ips",
      ],
      TARGETS,
    ),
    [],
  );
});

test("the summary is read off the .ips header line", () => {
  const text =
    '{"app_name":"Gastos","timestamp":"2026-09-30 10:11:12.00 +1000","app_version":"1.4.3","bug_type":"309"}\n{"rest":"of the report"}';
  assert.deepEqual(crashSummary(text), {
    app: "Gastos",
    version: "1.4.3",
    at: "2026-09-30 10:11:12.00 +1000",
  });
});

test("a header that does not parse gives no summary rather than a wrong one", () => {
  assert.equal(crashSummary("not json\n"), null);
  assert.equal(crashSummary(""), null);
});

test("the listing's paths are read off devicectl's JSON, directories and all", () => {
  // The shape `devicectl device info files --json-output` wrote on a real
  // phone: directories come back as entries too, and crashLogsOf drops them.
  const listing = {
    result: {
      files: [
        { name: "Assistant", relativePath: "Assistant" },
        { name: "Gastos-2026-10-01-101112.ips", relativePath: "Gastos-2026-10-01-101112.ips" },
        {
          name: "WhatsAppWatchApp-2026-09-28-133325.ips",
          relativePath: "ProxiedDevice-861e/Retired/WhatsAppWatchApp-2026-09-28-133325.ips",
        },
      ],
    },
  };
  assert.deepEqual(listedPaths(listing), [
    "Assistant",
    "Gastos-2026-10-01-101112.ips",
    "ProxiedDevice-861e/Retired/WhatsAppWatchApp-2026-09-28-133325.ips",
  ]);
});

test("a listing of an unexpected shape lists nothing rather than throwing", () => {
  assert.deepEqual(listedPaths({}), []);
  assert.deepEqual(listedPaths(null), []);
  assert.deepEqual(listedPaths({ result: { files: [{ name: "no path" }] } }), []);
});
