import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchRateOn,
  fetchStatementRate,
  fetchTodayRate,
  resolveRate,
} from "./usd-rate";

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchTodayRate", () => {
  it("takes the selling rate", () => {
    // Shape of a real dolarapi response.
    vi.stubGlobal(
      "fetch",
      ok({
        moneda: "USD",
        casa: "oficial",
        compra: 1485,
        venta: 1535,
        fechaActualizacion: "2026-08-28T18:55:00.000Z",
      }),
    );
    return expect(fetchTodayRate()).resolves.toEqual({
      rate: 1535,
      asOf: "2026-08-28",
    });
  });

  it("returns null instead of throwing when the network fails", async () => {
    // The screen has to paint with no exchange-rate service reachable.
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(fetchTodayRate()).resolves.toBeNull();
  });

  it("returns null on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(fetchTodayRate()).resolves.toBeNull();
  });

  it("refuses anything that is not a positive number", async () => {
    // This value multiplies straight into a figure about money, so a null, a
    // string or a zero has to be refused rather than propagated.
    for (const venta of [null, "1535", 0, -5, Number.NaN, undefined]) {
      vi.stubGlobal("fetch", ok({ venta }));
      await expect(fetchTodayRate()).resolves.toBeNull();
    }
  });

  it("survives a response with no date", async () => {
    vi.stubGlobal("fetch", ok({ venta: 1535 }));
    await expect(fetchTodayRate()).resolves.toEqual({ rate: 1535, asOf: "" });
  });
});

describe("fetchStatementRate", () => {
  // Shape of a real argentinadatos response.
  const history = { casa: "mayorista", compra: 1508, venta: 1517, fecha: "2026-10-01" };
  const today = { casa: "mayorista", compra: 1511, venta: 1520, fechaActualizacion: "2026-10-02T16:40:00.000Z" };

  const byUrl = (answers: Record<string, unknown>) =>
    vi.fn(async (url: string) => {
      const key = Object.keys(answers).find((part) => url.includes(part));
      return key === undefined || answers[key] === null
        ? { ok: false }
        : { ok: true, json: async () => answers[key] };
    });

  it("values a closed statement at its closing day's mayorista", async () => {
    const fetch = byUrl({ argentinadatos: history, dolarapi: today });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchStatementRate("2026-10-01", "2026-10-05")).resolves.toEqual({
      rate: 1517,
      asOf: "2026-10-01",
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "https://api.argentinadatos.com/v1/cotizaciones/dolares/mayorista/2026/10/01",
    );
  });

  it("counts the closing day itself as closed", async () => {
    vi.stubGlobal("fetch", byUrl({ argentinadatos: history, dolarapi: today }));
    await expect(fetchStatementRate("2026-10-01", "2026-10-01")).resolves.toMatchObject({
      rate: 1517,
    });
  });

  it("values the open statement at today's mayorista, without asking history", async () => {
    const fetch = byUrl({ argentinadatos: history, dolarapi: today });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchStatementRate("2026-10-29", "2026-10-05")).resolves.toEqual({
      rate: 1520,
      asOf: "2026-10-02",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://dolarapi.com/v1/dolares/mayorista");
  });

  it("falls back to today's when the history service says nothing", async () => {
    vi.stubGlobal("fetch", byUrl({ argentinadatos: null, dolarapi: today }));
    await expect(fetchStatementRate("2026-10-01", "2026-10-05")).resolves.toMatchObject({
      rate: 1520,
    });
  });
});

describe("fetchRateOn", () => {
  it("refuses a rate that is not a positive number", async () => {
    vi.stubGlobal("fetch", ok({ venta: "1517", fecha: "2026-10-01" }));
    await expect(fetchRateOn("2026-10-01")).resolves.toBeNull();
  });
});

describe("resolveRate", () => {
  it("prefers the API and says so", () => {
    expect(resolveRate({ rate: 1535, asOf: "2026-08-28" }, 1400)).toEqual({
      rate: 1535,
      origin: "api",
      asOf: "2026-08-28",
    });
  });

  it("falls back to the stored rate, flagged as manual", () => {
    expect(resolveRate(null, 1400)).toEqual({ rate: 1400, origin: "manual" });
  });

  it("is null when there is neither, so the screen can hide the estimate", () => {
    // Better no figure than a figure at a made-up rate.
    expect(resolveRate(null, null)).toBeNull();
    expect(resolveRate(null, 0)).toBeNull();
  });
});
