import {
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    type Unsubscribe,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { OrganizationDoc, WithId } from "@/types/collection";

const ORGS  = "Organization";


// Domain auto-join suggestion — the ONLY Organization list query the
// firestore.rules allow client-side (the exact filter shape below).
export async function getOrganizationByDomain(domain: string): Promise<WithId<OrganizationDoc> | null> {
    const q = query(
        collection(db, ORGS),
        where("domain", "==", domain),
        where("allowDomainAutoJoin", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...(snap.docs[0].data() as OrganizationDoc) };
}

// NOTE (SEC M2 Finding 3): the invite-code lookup and memberCount increment
// that used to live here are SERVER-ONLY now — see
// /api/organizations/lookup + /api/organizations/join and
// src/lib/db/adminOrganization.ts / adminUserOrganization.ts.
// firestore.rules denies the underlying client queries/writes.

export async function getOrganization(orgId: string): Promise<OrganizationDoc | null> {
    const snap = await getDoc(doc(db, ORGS, orgId));
    return snap.exists() ? (snap.data() as OrganizationDoc) : null;
}

export async function createOrganization(data: OrganizationDoc): Promise<string> {
    const ref = doc(collection(db, ORGS));
    await setDoc(ref, data);
    return ref.id;
}

export function subscribeToOrganization(orgId: string, callback: (data: OrganizationDoc | null) => void): Unsubscribe {
    return onSnapshot(doc(db, ORGS, orgId), (snap) => {
        callback(snap.exists() ? (snap.data() as OrganizationDoc) : null);
    });
}