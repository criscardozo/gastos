import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What the browser cares about is the ORDER: Google's popup has to be the
// first thing awaited after the click, or it is blocked. So the mock records
// every step, and the tests read the record.
const steps: string[] = [];
const reauth = vi.fn();

vi.mock("firebase/auth", () => {
  class GoogleAuthProvider {
    addScope() {}
    setCustomParameters() {}
    static credentialFromResult(result: { token?: string }) {
      return { accessToken: result.token };
    }
  }
  return {
    GoogleAuthProvider,
    reauthenticateWithPopup: (...args: unknown[]) => {
      steps.push("popup");
      return reauth(...args);
    },
    signInWithPopup: () => {
      steps.push("signIn");
      throw new Error("signInWithPopup replaces the session; never call it");
    },
  };
});

const { DriveExportError, exportToGoogleDrive } = await import("./drive");

const user = { email: "cristian@example.com" };
const auth = { currentUser: user } as never;

function build() {
  steps.push("build");
  return Promise.resolve(new Blob(["xlsx"]));
}

beforeEach(() => {
  steps.length = 0;
  reauth.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      steps.push("upload");
      return new Response(JSON.stringify({ id: "sheet1" }), { status: 200 });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("exportToGoogleDrive", () => {
  it("asks Google first and builds the workbook only after the popup", async () => {
    reauth.mockResolvedValue({ token: "t" });
    const url = await exportToGoogleDrive(auth, "Gastos.xlsx", build);
    expect(steps).toEqual(["popup", "build", "upload"]);
    expect(url).toBe("https://docs.google.com/spreadsheets/d/sheet1");
  });

  it("re-authenticates the signed-in user rather than signing in again", async () => {
    reauth.mockResolvedValue({ token: "t" });
    await exportToGoogleDrive(auth, "Gastos.xlsx", build);
    expect(reauth).toHaveBeenCalledWith(user, expect.anything());
    expect(steps).not.toContain("signIn");
  });

  it.each([
    ["auth/user-mismatch", "wrongAccount"],
    ["auth/popup-blocked", "blocked"],
    ["auth/popup-closed-by-user", "cancelled"],
    ["auth/network-request-failed", "auth"],
  ])("%s is reported as %s, and nothing is built", async (code, kind) => {
    reauth.mockRejectedValue({ code });
    const failure = await exportToGoogleDrive(auth, "Gastos.xlsx", build).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DriveExportError);
    expect((failure as InstanceType<typeof DriveExportError>).kind).toBe(kind);
    expect(steps).toEqual(["popup"]);
  });
});
