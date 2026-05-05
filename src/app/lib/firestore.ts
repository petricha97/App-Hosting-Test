import "server-only";
// Firebase Admin SDK - this is the SERVER-SIDE SDK.
// Unlike the client SDK, the Admin SDK has FULL access to your Firebase project
// (bypasses security rules). That's why it should ONLY be used in server code
// (Server Components, Route Handlers, Server Actions) — NEVER in "use client" files.

// initializeApp: Sets up the Firebase Admin connection to your project.
// getApps: Returns a list of already-initialized apps (used to prevent duplicate init).
// applicationDefault: Automatically finds credentials:
//   - On Firebase App Hosting: uses the Cloud Run service account (no setup needed).
//   - Locally: uses credentials from `gcloud auth application-default login`.
import {
  initializeApp,
  getApps,
  applicationDefault,
  cert,
} from "firebase-admin/app";

// getFirestore: Returns the Firestore database instance so you can read/write data.
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";


function hasAllCertEnv() {
  return (
    !!process.env.FIREBASE_PROJECT_ID &&
    !!process.env.FIREBASE_CLIENT_EMAIL &&
    !!process.env.FIREBASE_PRIVATE_KEY
  );
}

if (!getApps().length) {
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET ??
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  // If running on Firebase App Hosting / Cloud Run, prefer Application Default Credentials
  // (no FIREBASE_* env vars needed).
  if (process.env.K_SERVICE || process.env.FIREBASE_APP_HOSTING) {
    initializeApp({
      credential: applicationDefault(),
      ...(storageBucket ? { storageBucket } : {}),
    });
  } else if (hasAllCertEnv()) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID!,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
        privateKey: process.env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      }),
      ...(storageBucket ? { storageBucket } : {}),
    });
  } else {
    // Last-resort: still try ADC (works if you've done `gcloud auth application-default login` locally)
    initializeApp({
      credential: applicationDefault(),
      ...(storageBucket ? { storageBucket } : {}),
    });
  }
}


export const adminDb = getFirestore();
// adminDb.settings({ preferRest: true });
export const adminAuth = getAuth();
export const adminStorage = getStorage();


// Why this check? In development, Next.js hot-reloads your code frequently.
// Without this guard, each hot reload would try to call initializeApp() again,
// which throws an error because the app is already initialized.
// So we only initialize if no app exists yet.


// Export the Firestore instance so other files can import it like:
//   import { db } from "../lib/firestore";
//
// Common usage examples:
//   READ:   const snapshot = await db.collection("users").get();
//   WRITE:  await db.collection("users").add({ name: "John", age: 25 });
//   GET ONE: const doc = await db.collection("users").doc("someId").get();
//   UPDATE: await db.collection("users").doc("someId").update({ age: 26 });
//   DELETE: await db.collection("users").doc("someId").delete();
