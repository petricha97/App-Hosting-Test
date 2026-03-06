import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
    type Unsubscribe,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { UserDoc } from "@/types/collection";

const USERS = "User";

export async function getUser(email: string): Promise<UserDoc | null> {
    const snap = await getDoc(doc(db, USERS, email.toLowerCase()));
    return snap.exists() ? (snap.data() as UserDoc) : null;
}

export async function createUser(email: string, data: UserDoc): Promise<void> {
    await setDoc(doc(db, USERS, email.toLowerCase()), data);
}

export async function updateUser(email: string, data: Partial<UserDoc>): Promise<void> {
    await updateDoc(doc(db, USERS, email.toLowerCase()), {
        ...data,
        updatedAt: serverTimestamp(),
    });
}

export function subscribeToUser(email: string, callback: (data: UserDoc | null) => void): Unsubscribe {
    return onSnapshot(doc(db, USERS, email.toLowerCase()), (snap) => {
        callback(snap.exists() ? (snap.data() as UserDoc) : null);
    });
}