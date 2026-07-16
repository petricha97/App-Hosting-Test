// In-memory fake of the firebase-admin Firestore surface the M3 DAL uses,
// mocked at the same module boundary as the other admin tests
// ("@/app/lib/firestore"). Supports:
//   collection().doc().get/create/set/update/delete, collection().add(),
//   doc().collection() subcollection chains (Event/{id}/EventPromotion),
//   where/orderBy/limit/startAfter query chains with .get(),
//   aggregate .count().get() (M5 attendee stat cards),
//   aggregate .aggregate({...}).get() — count()/sum() AggregateField specs,
//     including nested dotted field paths e.g. "amounts.totalMinor" (M7-T1
//     finance sums) — interprets REAL firebase-admin AggregateField
//     instances (aggregateType + the raw field string/FieldPath passed to
//     .sum()/.count()), so tests exercise the same AggregateField objects
//     the DAL builds in production, not a fake stand-in class,
//   runTransaction with tx.get (ref or query) / tx.create / tx.update.
// update() MERGES into the store (and throws NOT_FOUND on missing docs, like
// the real SDK) so post-write assertions can read final doc state; every
// write is also recorded in `writes` for write-set assertions.

type DocData = Record<string, unknown>;

export interface FakeWrite {
  type: "create" | "set" | "update" | "delete";
  path: string;
  data?: DocData;
}

interface OrderBy {
  field: string;
  direction: "asc" | "desc";
}

function comparableValue(value: unknown): number | string {
  if (value !== null && typeof value === "object") {
    const v = value as { toMillis?: () => number; seconds?: number };
    if (typeof v.toMillis === "function") return v.toMillis();
    if (typeof v.seconds === "number") return v.seconds * 1000;
  }
  return value as number | string;
}

// Minimal structural shape of a REAL firebase-admin AggregateField instance
// (src/lib/db/adminOrder.ts/adminAttendee.ts build these via
// AggregateField.count()/AggregateField.sum(field)) — `_field` is whatever
// was passed to .sum(...): a plain dotted string in every call site this
// codebase makes ("amounts.totalMinor"), or (defensively) a FieldPath-like
// object exposing `.segments`.
interface AggregateFieldLike {
  aggregateType: string;
  _field?: string | { segments: string[] };
}

// Resolves a dotted nested-field path ("amounts.totalMinor") against a doc's
// data, mirroring Firestore's own dotted-path convention for nested map
// fields. Missing/non-numeric values sum as 0 (matches the real service:
// sum() over a field entirely absent from a doc contributes 0).
function getNestedValue(data: DocData, dottedPath: string): number {
  let current: unknown = data;
  for (const segment of dottedPath.split(".")) {
    if (current === null || typeof current !== "object") return 0;
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "number" ? current : 0;
}

function aggregateFieldPath(field: AggregateFieldLike): string {
  if (typeof field._field === "string") return field._field;
  if (field._field && "segments" in field._field) {
    return field._field.segments.join(".");
  }
  throw new Error("fake-admin-db: aggregate sum() field path not resolvable");
}

export function createFakeAdminDb() {
  const store = new Map<string, DocData>();
  const writes: FakeWrite[] = [];
  let autoId = 0;
  // Counts full-document-transferring query reads (query.get()) SEPARATELY
  // from aggregate reads (query.count().get() / query.aggregate(...).get()),
  // which never populate this counter — lets DAL tests assert "zero
  // full-document reads" for aggregate-only call paths (M5/M7 convention,
  // spec agents/docs/specs/m7-reporting-summaries.md §1 AC-7 / §3 AC-4).
  let queryDocReads = 0;

  interface FakeQuery {
    __isQuery: true;
    collectionPath: string;
    filters: Array<[string, string, unknown]>;
    orderBys: OrderBy[];
    limitN: number | null;
    startAfterValues: unknown[] | null;
    where(field: string, op: string, value: unknown): FakeQuery;
    orderBy(field: string, direction?: "asc" | "desc"): FakeQuery;
    limit(n: number): FakeQuery;
    startAfter(...values: unknown[]): FakeQuery;
    get(): Promise<{
      docs: Array<{ id: string; data: () => DocData }>;
      empty: boolean;
    }>;
    count(): {
      get(): Promise<{ data: () => { count: number } }>;
    };
    aggregate(spec: Record<string, AggregateFieldLike>): {
      get(): Promise<{ data: () => Record<string, number> }>;
    };
  }

  function runQuery(q: FakeQuery) {
    const depth = q.collectionPath.split("/").length + 1;
    let entries = [...store.entries()]
      .filter(
        ([p]) =>
          p.startsWith(`${q.collectionPath}/`) && p.split("/").length === depth,
      )
      .filter(([, data]) =>
        q.filters.every(([field, op, value]) => {
          if (op === "==") return data[field] === value;
          if (op === "array-contains") {
            return (
              Array.isArray(data[field]) &&
              (data[field] as unknown[]).includes(value)
            );
          }
          if (op === "in") {
            return Array.isArray(value) && value.includes(data[field]);
          }
          throw new Error(`fake-admin-db: unsupported operator "${op}"`);
        }),
      );

    if (q.orderBys.length > 0) {
      entries = entries.sort(([, a], [, b]) => {
        for (const { field, direction } of q.orderBys) {
          const left = comparableValue(a[field]);
          const right = comparableValue(b[field]);
          if (left < right) return direction === "asc" ? -1 : 1;
          if (left > right) return direction === "asc" ? 1 : -1;
        }
        return 0;
      });
    }

    if (q.startAfterValues && q.orderBys.length > 0) {
      const cursor = comparableValue(q.startAfterValues[0]);
      const { direction } = q.orderBys[0];
      entries = entries.filter(([, data]) => {
        const v = comparableValue(data[q.orderBys[0].field]);
        return direction === "asc" ? v > cursor : v < cursor;
      });
    }

    if (q.limitN !== null) entries = entries.slice(0, q.limitN);

    const docs = entries.map(([p, data]) => ({
      id: p.split("/").pop()!,
      data: () => data,
    }));
    return { docs, empty: docs.length === 0 };
  }

  function makeQuery(
    collectionPath: string,
    filters: Array<[string, string, unknown]>,
    orderBys: OrderBy[] = [],
    limitN: number | null = null,
    startAfterValues: unknown[] | null = null,
  ): FakeQuery {
    return {
      __isQuery: true,
      collectionPath,
      filters,
      orderBys,
      limitN,
      startAfterValues,
      where(field, op, value) {
        return makeQuery(
          collectionPath,
          [...filters, [field, op, value]],
          orderBys,
          limitN,
          startAfterValues,
        );
      },
      orderBy(field, direction = "asc") {
        return makeQuery(
          collectionPath,
          filters,
          [...orderBys, { field, direction }],
          limitN,
          startAfterValues,
        );
      },
      limit(n) {
        return makeQuery(
          collectionPath,
          filters,
          orderBys,
          n,
          startAfterValues,
        );
      },
      startAfter(...values) {
        return makeQuery(collectionPath, filters, orderBys, limitN, values);
      },
      async get() {
        queryDocReads += 1;
        return runQuery(this);
      },
      count() {
        const query = this;
        return {
          async get() {
            const { docs } = runQuery(query);
            return { data: () => ({ count: docs.length }) };
          },
        };
      },
      aggregate(spec) {
        const query = this;
        return {
          async get() {
            const { docs } = runQuery(query);
            const result = {} as Record<string, number>;
            for (const [key, field] of Object.entries(spec)) {
              if (field.aggregateType === "count") {
                result[key] = docs.length;
              } else if (field.aggregateType === "sum") {
                const path = aggregateFieldPath(field);
                result[key] = docs.reduce(
                  (sum, d) => sum + getNestedValue(d.data(), path),
                  0,
                );
              } else {
                throw new Error(
                  `fake-admin-db: unsupported aggregate type "${field.aggregateType}"`,
                );
              }
            }
            return { data: () => result };
          },
        };
      },
    };
  }

  interface FakeRef {
    __isRef: true;
    id: string;
    path: string;
    get(): Promise<{
      exists: boolean;
      id: string;
      data: () => DocData | undefined;
    }>;
    create(data: DocData): Promise<void>;
    set(data: DocData): Promise<void>;
    update(data: DocData): Promise<void>;
    delete(): Promise<void>;
    collection(name: string): ReturnType<typeof makeCollection>;
  }

  function makeDocRef(path: string): FakeRef {
    return {
      __isRef: true,
      id: path.split("/").pop()!,
      path,
      collection(name: string) {
        return makeCollection(`${path}/${name}`);
      },
      async get() {
        const data = store.get(path);
        return {
          exists: data !== undefined,
          id: path.split("/").pop()!,
          data: () => data,
        };
      },
      async create(data) {
        if (store.has(path)) throw new Error(`ALREADY_EXISTS: ${path}`);
        writes.push({ type: "create", path, data });
        store.set(path, data);
      },
      async set(data) {
        writes.push({ type: "set", path, data });
        store.set(path, data);
      },
      async update(data) {
        const existing = store.get(path);
        if (existing === undefined) throw new Error(`NOT_FOUND: ${path}`);
        writes.push({ type: "update", path, data });
        store.set(path, { ...existing, ...data });
      },
      async delete() {
        writes.push({ type: "delete", path });
        store.delete(path);
      },
    };
  }

  function makeCollection(path: string) {
    return {
      doc(id?: string) {
        return makeDocRef(`${path}/${id ?? `auto-${autoId++}`}`);
      },
      async add(data: DocData) {
        const ref = makeDocRef(`${path}/auto-${autoId++}`);
        await ref.create(data);
        return ref;
      },
      where(field: string, op: string, value: unknown) {
        return makeQuery(path, [[field, op, value]]);
      },
      orderBy(field: string, direction: "asc" | "desc" = "asc") {
        return makeQuery(path, [], [{ field, direction }]);
      },
    };
  }

  const tx = {
    async get(target: FakeRef | FakeQuery) {
      if ("__isQuery" in target && target.__isQuery) {
        return runQuery(target);
      }
      return (target as FakeRef).get();
    },
    create(ref: FakeRef, data: DocData) {
      if (store.has(ref.path)) throw new Error(`ALREADY_EXISTS: ${ref.path}`);
      writes.push({ type: "create", path: ref.path, data });
      store.set(ref.path, data);
    },
    update(ref: FakeRef, data: DocData) {
      const existing = store.get(ref.path);
      if (existing === undefined) throw new Error(`NOT_FOUND: ${ref.path}`);
      writes.push({ type: "update", path: ref.path, data });
      store.set(ref.path, { ...existing, ...data });
    },
  };

  const db = {
    collection: (name: string) => makeCollection(name),
    runTransaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
  };

  function reset() {
    store.clear();
    writes.length = 0;
    autoId = 0;
    queryDocReads = 0;
  }

  return {
    db,
    store,
    writes,
    reset,
    get queryDocReads() {
      return queryDocReads;
    },
  };
}
