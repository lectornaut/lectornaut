# Projects Data Model & Firestore Scaffolding

This project now stores project channels and their execution logs in Firestore. The collections introduced are:

- `channels` — top-level collection scoped by `ownerId` and linked to a `projectId`.
- `channels/{channelId}/logs` — sub-collection that captures request/response activity and diagnostics for the channel.

## Local Development Checklist

1. **Apply Firestore Rules and Indexes**

   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```

   This will publish the scoped security rules that enforce owner-based access control and the composite indexes required for channel and log queries.

2. **Seed Initial Channel Metadata (Optional)**
   - Create a channel document in the `channels` collection with default `stats` set to zeroed values and `signingSecretHash` left `null` until a secret is generated server-side.
   - Populate the nested `logs` sub-collection only via trusted tooling or Cloud Functions to guarantee hashes and message-size limits are respected.

3. **Backfill Existing Projects (if applicable)**
   - For each legacy project, create a channel record that references the legacy identifier in `projectId`.
   - Migrate any historical execution trace data into the `logs` sub-collection, ensuring the documents conform to the new schema (see `src/types/index.ts`).
   - Re-run step 1 after migration to confirm rules and indexes remain in sync.

> **Note:** These steps serve as a starting point. Tailor the migration script or seeding routine to the environment (development, staging, production) before executing against live data.
