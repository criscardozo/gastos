"use client";

// Upload an exported workbook to the user's Google Drive as a Google Sheet.
//
// Drive needs an OAuth access token, which Firebase Auth does not keep around:
// it is handed over once, inside the sign-in credential. So exporting asks
// Google again, with the extra `drive.file` scope. That scope is the narrow
// one — it grants access ONLY to files this app itself creates, never to the
// rest of the user's Drive.
//
// Uploading with `mimeType: application/vnd.google-apps.spreadsheet` makes
// Drive convert the .xlsx on the way in, so the sheet keeps the colours,
// number formats and layout the workbook was built with.

import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  type Auth,
} from "firebase/auth";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id";

/**
 * True when running as the installed app rather than in a browser tab. Google's
 * sign-in popup cannot hand its result back to a standalone window reliably —
 * the very reason the app itself signs in by redirect when installed — so a
 * Drive export started from the home-screen app is expected to fail here, and
 * the UI should say to open it in the browser rather than shrug.
 */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export class DriveExportError extends Error {
  constructor(
    /** Distinguishes "the user closed the dialog" from a real failure, so the
     * UI can stay quiet in the first case, and the installed-app case from
     * both. */
    readonly kind:
      | "cancelled"
      | "auth"
      | "upload"
      | "standalone"
      | "blocked"
      | "wrongAccount",
    message: string,
  ) {
    super(message);
    this.name = "DriveExportError";
  }
}

/**
 * Re-prompts Google for a token that can write to Drive. Returns the access
 * token; throws a DriveExportError otherwise.
 */
async function requestDriveToken(auth: Auth): Promise<string> {
  const user = auth.currentUser;
  if (user === null) throw new DriveExportError("auth", "Not signed in");
  const provider = new GoogleAuthProvider();
  provider.addScope(DRIVE_SCOPE);
  // Keep the user on their own account without a chooser when possible.
  const email = user.email;
  if (email != null && email !== "") {
    provider.setCustomParameters({ login_hint: email });
  }

  let result;
  try {
    // REauthenticate, not sign in: the chooser still lets you pick another
    // Google account, and signInWithPopup would then REPLACE the session with
    // that account — someone who is not a member of the household. This one
    // refuses a different account (auth/user-mismatch) and leaves the session
    // exactly as it was.
    result = await reauthenticateWithPopup(user, provider);
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (
      code === "auth/popup-closed-by-user" ||
      code === "auth/cancelled-popup-request"
    ) {
      throw new DriveExportError("cancelled", "Sign-in dialog closed");
    }
    if (code === "auth/user-mismatch") {
      throw new DriveExportError("wrongAccount", "Another Google account was chosen");
    }
    if (code === "auth/popup-blocked") {
      throw new DriveExportError("blocked", "The browser blocked Google's popup");
    }
    if (isStandalone()) {
      throw new DriveExportError(
        "standalone",
        "Google's popup cannot return to an installed PWA",
      );
    }
    throw new DriveExportError("auth", String(code ?? error));
  }

  const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken;
  if (token === undefined || token === "") {
    throw new DriveExportError("auth", "Google returned no access token");
  }
  return token;
}

/**
 * Uploads the workbook `build` makes (an .xlsx) to Drive, converted to a
 * Google Sheet. Resolves with the URL of the new spreadsheet.
 *
 * The workbook is built AFTER Google's popup, not before, and that order is
 * the point: a browser only lets a click open a popup while nothing has been
 * awaited since the click. Building first (a dynamic import of exceljs, then
 * the workbook) used the gesture up, and Safari blocked the popup.
 */
export async function exportToGoogleDrive(
  auth: Auth,
  filename: string,
  build: () => Promise<Blob>,
): Promise<string> {
  const token = await requestDriveToken(auth);
  const blob = await build();

  const metadata = {
    name: filename.replace(/\.xlsx$/i, ""),
    mimeType: "application/vnd.google-apps.spreadsheet", // convert on upload
  };
  const body = new FormData();
  body.append(
    "metadata",
    new Blob([JSON.stringify(metadata)], { type: "application/json" }),
  );
  body.append("file", blob);

  const response = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
  if (!response.ok) {
    throw new DriveExportError(
      "upload",
      `Drive responded ${response.status}: ${(await response.text()).slice(0, 200)}`,
    );
  }
  const { id } = (await response.json()) as { id?: string };
  if (id === undefined) {
    throw new DriveExportError("upload", "Drive returned no file id");
  }
  return `https://docs.google.com/spreadsheets/d/${id}`;
}
