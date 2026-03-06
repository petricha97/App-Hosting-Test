import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    where,
    getDocs,
    onSnapshot,
    serverTimestamp,
    increment,
    type Unsubscribe,
} from "firebase/firestore";
export { serverTimestamp } from "firebase/firestore";

import { db } from "@/lib/firebase";
import type { OrganizationDoc, WithId } from "@/types/collection";

const ORGS  = "Organization";


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

export async function getOrganizationByInviteCode(normalizedCode: string): Promise<WithId<OrganizationDoc> | null> {
    const q = query(
        collection(db, ORGS),
        where("inviteCode", "==", normalizedCode),
        where("inviteCodeEnabled", "==", true)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...(snap.docs[0].data() as OrganizationDoc) };
}

export async function getOrganization(orgId: string): Promise<OrganizationDoc | null> {
    const snap = await getDoc(doc(db, ORGS, orgId));
    return snap.exists() ? (snap.data() as OrganizationDoc) : null;
}

export async function createOrganization(data: OrganizationDoc): Promise<string> {
    const ref = doc(collection(db, ORGS));
    await setDoc(ref, data);
    return ref.id;
}

export async function updateOrganizationMemberCount(orgId: string, delta: number): Promise<void> {
    await updateDoc(doc(db, ORGS, orgId), {
        memberCount: increment(delta),
        updatedAt: serverTimestamp(),
    });
}

export function subscribeToOrganization(orgId: string, callback: (data: OrganizationDoc | null) => void): Unsubscribe {
    return onSnapshot(doc(db, ORGS, orgId), (snap) => {
        callback(snap.exists() ? (snap.data() as OrganizationDoc) : null);
    });
}