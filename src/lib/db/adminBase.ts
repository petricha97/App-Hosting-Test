//though this mirror the createCollectionAPI but uses adminDb different type
//(firebaseFirestore.Firestore instead of firestore) hence cannot share same base

import type {
    DocumentData,
    CollectionReference,
    QueryDocumentSnapshot,
    UpdateData,
} from "firebase-admin/firestore";
import { adminDb } from "@/app/lib/firestore";

export type WithId<T> = T & { id: string };

export function createAdminCollectionApi<T extends DocumentData>(
    collectionName: string
) {
    const colRef = adminDb.collection(collectionName) as CollectionReference<T>;

    return {
        async create(data: T): Promise<string> {
            const ref = await colRef.add(data);
            return ref.id;
        },

        async set(id: string, data: T): Promise<void> {
            await colRef.doc(id).set(data);
        },

        async getById(id: string): Promise<WithId<T> | null> {
            const snap = await colRef.doc(id).get();
            if (!snap.exists) return null;
            return { id: snap.id, ...snap.data()! };
        },

        async getAll(): Promise<WithId<T>[]> {
            const snap = await colRef.get();
            return snap.docs.map((d: QueryDocumentSnapshot<T>) => ({ id: d.id, ...d.data() }));
        },

        async update(id: string, data: Partial<T>): Promise<void> {
            await colRef.doc(id).update(data as UpdateData<T>);
        },

        async remove(id: string): Promise<void> {
            await colRef.doc(id).delete();
        },

        async findWhere<K extends keyof T>(
            field: K,
            value: T[K]
        ): Promise<WithId<T>[]> {
            const snap = await colRef.where(field as string, "==", value).get();
            return snap.docs.map((d: QueryDocumentSnapshot<T>) => ({ id: d.id, ...d.data() }));
        },

        async findMany(
            ...constraints: Parameters<CollectionReference["where"]>
        ): Promise<WithId<T>[]> {
            const snap = await colRef.where(...constraints).get();
            return snap.docs.map((d: QueryDocumentSnapshot<T>) => ({ id: d.id, ...d.data() }));
        },
    };
}
