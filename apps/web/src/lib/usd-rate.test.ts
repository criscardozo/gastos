import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchTodayRate, resolveRate } from "./usd-rate";

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
