import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    query,
    setDoc,
    updateDoc,
    where,
    type QueryConstraint,
    type DocumentData,
    type WithFieldValue,
    type FirestoreDataConverter,
    type QueryDocumentSnapshot,
    type SnapshotOptions,
    type UpdateData,
  } from "firebase/firestore";
  import { db } from "@/lib/firebase";
  
  export type WithId<T> = T & { id: string };
  
  function createConverter<T extends DocumentData>(): FirestoreDataConverter<T, T> {
    return {
      toFirestore(data: WithFieldValue<T>): WithFieldValue<T> {
        return data;
      },
      fromFirestore(snapshot: QueryDocumentSnapshot<T, T>, options?: SnapshotOptions): T {
        return snapshot.data(options);
      },
    };
  }
  
  export function createCollectionApi<T extends DocumentData>(collectionName: string) {
    const converter = createConverter<T>();
    const colRef = collection(db, collectionName).withConverter(converter);
  
    return {
      async create(data: WithFieldValue<T>): Promise<string> {
        const ref = doc(colRef);
        await setDoc(ref, data);
        return ref.id;
      },
  
      async set(id: string, data: WithFieldValue<T>): Promise<void> {
        const ref = doc(colRef, id);
        await setDoc(ref, data);
      },
  
      async getById(id: string): Promise<WithId<T> | null> {
        const ref = doc(colRef, id);
        const snap = await getDoc(ref);
  
        if (!snap.exists()) return null;
  
        return {
          id: snap.id,
          ...snap.data(),
        };
      },
  
      async getAll(): Promise<WithId<T>[]> {
        const snap = await getDocs(colRef);
  
        return snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
      },
  
      async update(id: string, data: UpdateData<T>): Promise<void> {
        const ref = doc(colRef, id);
        await updateDoc(ref, data);
      },
  
      async remove(id: string): Promise<void> {
        const ref = doc(colRef, id);
        await deleteDoc(ref);
      },
  
      async findWhere<K extends keyof T>(
        field: K,
        value: T[K]
      ): Promise<WithId<T>[]> {
        const q = query(colRef, where(field as string, "==", value));
        const snap = await getDocs(q);
  
        return snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
      },
  
      async findMany(...constraints: QueryConstraint[]): Promise<WithId<T>[]> {
        const q = query(colRef, ...constraints);
        const snap = await getDocs(q);
  
        return snap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
      },
    };
  }