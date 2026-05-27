# Project conventions

## Vue reactivity with third-party SDK class instances

Never wrap an SDK class instance in a plain `ref()`. Use `shallowRef` (or
`markRaw` at assignment).

A plain `ref<SomeClass>(…)` deep-proxies the instance: every nested property
read through `.value.foo.bar` returns a *reactive Proxy*, not the raw value.
When the SDK later introspects the instance (e.g. to extract cursor positions,
serialize state, or write to IndexedDB), it walks those Proxies and ends up
with Proxy-wrapped internals where it expects plain objects. Symptoms range
from quiet bugs to `DataCloneError` and library-internal assertion failures.

Concrete fixed bug: `ref<QueryDocumentSnapshot>` in `usePaginatedLogs.ts`
caused Firestore's `startAfter(cursor)` cursor positions to be reactive
proxies; the SDK's `addTargetData → IndexedDB put` failed structured-clone,
which poisoned the entire `AsyncQueue` (assertion `0xb815`) and made every
subsequent Firestore call appear to fail at an unrelated call site.

**Applies to**: Firestore SDK classes (`QueryDocumentSnapshot`,
`DocumentSnapshot`, `QuerySnapshot`, `DocumentReference`, `CollectionReference`,
`Query`, `Timestamp`, `GeoPoint`, `Bytes`, `FieldValue`, `VectorValue`),
Yjs (`Y.Doc`, `Y.Text`, `Y.Map`, `Y.Array`, awareness), and any other
library class with non-trivial internals.

The Firestore variants are enforced by an ESLint `no-restricted-syntax`
rule in `eslint.config.mjs`. The rule is name-match on the type annotation —
when adding new SDK classes (or aliased imports), extend the rule or rely
on this convention.
