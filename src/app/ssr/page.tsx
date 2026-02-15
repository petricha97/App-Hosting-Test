// Import the Firestore instance we set up in lib/firestore.ts.
// Because this is a Server Component (no "use client" at the top),
// this code runs on the server — so it's safe to use the Admin SDK here.
import { db } from "../lib/firestore";

// force-dynamic tells Next.js to ALWAYS render this page on the server
// for every request (no caching). This ensures we always get fresh data
// from Firestore. Without this, Next.js might cache the page at build time.
export const dynamic = "force-dynamic";

// --- TESTING SECRET / API KEY ---
// process.env.GPT_API_KEY reads the secret you configured in:
//   - apphosting.yaml (production — pulls from Cloud Secret Manager)
//   - apphosting.emulator.yaml (local dev — reads plaintext value)
// This works because Firebase App Hosting injects secrets as environment                                                    
// variables at runtime, just like regular env vars.
const apiKey = process.env.GPT_API_KEY;       

// it's the right key without exposing it.                       
const isKeyLoaded = !!apiKey;                                    
const maskedKey = apiKey ? `${apiKey.slice(-8)}****` : "NOT FOUND";                          

export default async function Page() {
  // --- READING DATA FROM FIRESTORE ---
  // db.collection("messages") points to the "messages" collection in Firestore.
  // .get() fetches ALL documents in that collection.
  // The result is a "QuerySnapshot" containing all matching documents.
  const snapshot = await db.collection("messages").get();

  // snapshot.docs is an array of document snapshots.
  // For each doc, we extract:
  //   - doc.id: the auto-generated document ID (e.g., "abc123")
  //   - doc.data(): the actual fields/data stored in that document
  // We spread (...) doc.data() to merge all fields into one flat object.
  const messages = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));

  return (
    <main className="content">
      <h1 className="heading">Data from Firestore</h1>

      <section className="data-container">
        <p>GPT_API_KEY Status</p>
        <h2>{isKeyLoaded ? "Loaded" : "NOT LOADED"}</h2>
        <p>Preview: <code>{maskedKey}</code></p>
        {/* If there are no documents yet, show a helpful hint */}
        {messages.length === 0 && (
          <article className="card">
            <p>No messages found in Firestore yet.</p>
            <p>
              Go to your Firebase Console &gt; Firestore Database, create a
              collection called <strong>&quot;messages&quot;</strong>, and add
              some documents with a <strong>&quot;text&quot;</strong> field. 
            </p>
            
            
          </article>
        )}

        {/* Loop through each message document and display it */}
        {messages.map((msg) => (
          <article className="card" key={msg.id}>
            {/* Show the document ID so you can cross-reference in the console */}
            <p>Document ID: {msg.id}</p>
            {/*
              We use (msg as Record<string, unknown>).text because TypeScript
              doesn't know what fields exist in your Firestore documents.
              In a real app, you'd define a TypeScript interface for your data.
            */}
            <h2>{(msg as Record<string, unknown>).text as string}</h2>
          </article>
        ))}
      </section>
    </main>
  );
}
