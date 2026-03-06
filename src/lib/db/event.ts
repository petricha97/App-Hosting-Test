import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    deleteDoc,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { EventDoc } from "@/types/collection";

const EVENTS = "Event";

export async function createEvent(data: EventDoc): Promise<string> {
    const ref = doc(collection(db, EVENTS));
    await setDoc(ref, data);
    return ref.id;
}

// GET ONE
export async function getEvent(eventId: string): Promise<EventDoc | null> {
    const ref = doc(db, EVENTS, eventId);
    const snap = await getDoc(ref);

    if (!snap.exists()) return null;

    return snap.data() as EventDoc;
}


// GET ALL
export async function getEvents(): Promise<(EventDoc & { id: string })[]> {
    const snap = await getDocs(collection(db, EVENTS));

    return snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as EventDoc),
    }));
}


// UPDATE
export async function updateEvent(
    eventId: string,
    data: Partial<EventDoc>
): Promise<void> {
    const ref = doc(db, EVENTS, eventId);
    await updateDoc(ref, data);
}


// DELETE
export async function deleteEvent(eventId: string): Promise<void> {
    const ref = doc(db, EVENTS, eventId);
    await deleteDoc(ref);
}


// QUERY BY FIELD (example)
export async function getEventsByField(
    field: keyof EventDoc,
    value: unknown
): Promise<(EventDoc & { id: string })[]> {

    const q = query(collection(db, EVENTS), where(field as string, "==", value));
    const snap = await getDocs(q);

    return snap.docs.map((doc) => ({
        id: doc.id,
        ...(doc.data() as EventDoc),
    }));
}