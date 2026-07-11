// Firebase client configuration. These values are PUBLIC by design — the
// Firestore security rules are the security boundary, not this config.
// Each value can be overridden via NEXT_PUBLIC_FIREBASE_* env vars (Vercel).

export const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ??
    "AIzaSyCFjRzCIzkg3Lkh44J1UxwNV1w9EBbMX6s",
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ??
    "qcris-gastos-diarios.firebaseapp.com",
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "qcris-gastos-diarios",
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ??
    "qcris-gastos-diarios.firebasestorage.app",
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "56331687585",
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ??
    "1:56331687585:web:85445c77bb34f8048682e0",
};

export const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === "1";
