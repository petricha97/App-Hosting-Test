"use client";

import * as React from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
  Timestamp,
} from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { db, auth } from "@/lib/firebase";

type Todo = {
  id: string;
  uid: string;
  title: string;
  completed: boolean;
  createdAt?: Timestamp | Date;
};

export default function TodosPage() {
  const [user, setUser] = React.useState<User | null>(auth.currentUser);
  const [todos, setTodos] = React.useState<Todo[]>([]);
  const [loading, setLoading] = React.useState(true);

  const [title, setTitle] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Track auth
  React.useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return unsub;
  }, []);

  // Realtime subscribe (client SDK)
  React.useEffect(() => {
    let unsub: Unsubscribe | undefined;

    if (!user) {
      setTodos([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, "todos"),
      where("uid", "==", user.uid),
    );

    unsub = onSnapshot(
      q,
      (snap) => {
        const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Todo, "id">) }));
        setTodos(next);
        setLoading(false);
      },
      (err) => {
        console.error(err);
        setLoading(false);
      }
    );

    return () => unsub?.();
  }, [user]);

  async function onCreateTodo(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmed = title.trim();
    if (!trimmed) return;

    if (!auth.currentUser) {
      setError("You must be signed in.");
      return;
    }

    setSubmitting(true);
    try {
      const idToken = await auth.currentUser.getIdToken();

      const res = await fetch("/api/todos", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title: trimmed }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setTitle("");
      // No need to manually update UI: onSnapshot will update automatically
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create todo");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading...</p>;

  if (!user) {
    return (
      <div style={{ maxWidth: 520, margin: "40px auto" }}>
        <h1 style={{ fontSize: 24, fontWeight: 700 }}>Todo List</h1>
        <p style={{ marginTop: 12 }}>Please sign in to view your todos.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 520, margin: "40px auto" }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>Todo List</h1>

      <form onSubmit={onCreateTodo} style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="New todo..."
          style={{ flex: 1, padding: "10px 12px", border: "1px solid #ccc", borderRadius: 8 }}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !title.trim()}
          style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ccc" }}
        >
          {submitting ? "Adding..." : "Add"}
        </button>
      </form>

      {error && <p style={{ color: "crimson", marginTop: 10 }}>{error}</p>}

      <ul style={{ marginTop: 18, paddingLeft: 18 }}>
        {todos.map((t) => (
          <li key={t.id} style={{ marginBottom: 8 }}>
            {t.title}
          </li>
        ))}
      </ul>

      {todos.length === 0 && <p style={{ marginTop: 12 }}>No todos yet.</p>}
    </div>
  );
}