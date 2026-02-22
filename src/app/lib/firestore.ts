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

// Why this check? In development, Next.js hot-reloads your code frequently.
// Without this guard, each hot reload would try to call initializeApp() again,
// which throws an error because the app is already initialized.
// So we only initialize if no app exists yet.
getApps().length > 0
  ? getApps()[0]
  : initializeApp({
    credential:
      process.env.FIREBASE_PRIVATE_KEY
        ? cert({
          projectId: process.env.FIREBASE_PROJECT_ID!,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL!,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        })
        : applicationDefault(),
  });

// Export the Firestore instance so other files can import it like:
//   import { db } from "../lib/firestore";
//
// Common usage examples:
//   READ:   const snapshot = await db.collection("users").get();
//   WRITE:  await db.collection("users").add({ name: "John", age: 25 });
//   GET ONE: const doc = await db.collection("users").doc("someId").get();
//   UPDATE: await db.collection("users").doc("someId").update({ age: 26 });
//   DELETE: await db.collection("users").doc("someId").delete();
export const adminDb = getFirestore();
adminDb.settings({ preferRest: true });
export const adminAuth = getAuth();