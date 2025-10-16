# BYOL Webhook Projects – Architecture Notes

## Overview

The BYOL (Bring Your Own Listener) webhook projects initiative allows teams to register outbound webhook channels that are triggered by first-party automations. This document captures the proposed architecture prior to implementation so that both the product and engineering teams can align on terminology, data modeling, security boundaries, and front-end integration expectations.

## Domain Terminology

| Term             | Description                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Project**      | Logical container owned by a user or team that groups together one or more webhook channels and their delivery history. Projects surface in the workspace navigation and drive authorization scoping.                                              |
| **Channel**      | A specific webhook endpoint configuration within a project. Channels define the delivery target (`targetUrl`), authentication/signing data, custom transformation code, and aggregate statistics. Channels are uniquely identified by `channelId`. |
| **Delivery Log** | Immutable record of an attempted webhook delivery for a channel. Each log captures the payload, headers, response metadata, retry status, and any error context required for troubleshooting.                                                      |

## End-to-End Flow

1. **Project creation** – A user opens the Projects area (/projects) and creates a BYOL project. The UI enforces App Check and requires authentication (`request.auth`) before invoking secured callable functions.
2. **Channel provisioning** – Within a project, the user adds a channel. The management UI collects `targetUrl`, optional custom transformation code, and generates the webhook signing secret. A Cloud Function writes the channel document and returns a webhook URL that embeds routing metadata and a bearer token.
3. **Event emission** – Internal automations or third-party integrations enqueue webhook jobs that resolve the channel by `channelId` and project context. The delivery function materializes the payload, runs optional sandboxed code, signs the request, and issues the HTTP POST to the channel’s `targetUrl`.
4. **Response handling** – The delivery worker records status, latency, and response payload. Successful requests increment `stats.successCount`; failures increment `stats.failureCount` and may schedule retries following backoff guidance.
5. **Observability** – Delivery logs are written to `channels/{channelId}/logs`, and surfaced in the project UI. Critical failures (permanent errors, repeated timeouts) emit alerts to the owner and appear in the activity feed.
6. **Maintenance** – Users can rotate secrets, pause channels, or update code snippets. All changes are versioned and audited through Firestore document history.

## Firestore Data Model

Top-level collection: `channels`

```jsonc
// Document at channels/{channelId}
{
  "channelId": "auto-generated string",
  "projectId": "projects/{projectId}",
  "ownerId": "users/{userId}",
  "targetUrl": "https://example.com/webhook",
  "signingSecretHash": "sha256:...", // hash of the generated secret
  "token": "short-lived bearer token for webhook URL validation",
  "code": "function transform(payload) { return payload; }", // optional BYOL script
  "status": "active", // active | paused | archived
  "stats": {
    "successCount": 0,
    "failureCount": 0,
    "lastDeliveryAt": null,
    "lastErrorAt": null,
    "lastErrorMessage": null,
    "retryScheduled": false,
  },
  "createdAt": "Timestamp",
  "updatedAt": "Timestamp",
}
```

Nested subcollection: `channels/{channelId}/logs/{logId}`

```jsonc
{
  "logId": "auto-generated",
  "deliveryAt": "Timestamp",
  "status": "success", // success | retrying | failed
  "attempt": 1,
  "payload": { "...": "..." },
  "transformedPayload": { "...": "..." },
  "requestHeaders": {
    "X-Signature": "...",
    "Content-Type": "application/json",
  },
  "responseCode": 200,
  "responseBody": "{\"ok\":true}",
  "latencyMs": 325,
  "error": {
    "message": null,
    "type": null,
    "stack": null,
  },
  "nextRetryAt": null,
  "createdBy": "serviceAccounts/byol-delivery",
  "createdAt": "Timestamp",
}
```

All documents inherit Firestore security rules that restrict access to the owning project members. Aggregated stats enable efficient UI rendering without scanning logs.

## Webhook URL Construction & Secret Management

- **Structure**: `https://{region}-{projectId}.cloudfunctions.net/webhooks/{channelId}?token={token}`
  - `region` – deployment region for the Cloud Function (initially `us-central1`).
  - `projectId` – Firebase project slug to route to the correct environment (dev, staging, prod).
  - `channelId` – Firestore identifier for the channel document.
  - `token` – short-lived, rotatable token issued at channel creation / secret rotation.
- **Secret generation**: 32-byte cryptographically secure random value (`crypto.getRandomValues`). The raw secret is shown once to the user, stored hashed (`signingSecretHash`) using `crypto.subtle.digest('SHA-256', secret)` with a static salt per environment.
- **Validation**: Incoming requests must include `X-BYOL-Signature` header containing an HMAC SHA-256 signature of the request body using the raw secret. The delivery function re-computes and constant-time compares signatures. Tokens are verified against the stored token on the channel; mismatches reject immediately with `401`.
- **Rotation**: Rotating a secret issues a new token and secret pair, invalidating previous ones while preserving audit history. Logs capture rotation events for traceability.

## Error Reporting & Observability Expectations

- **Per-delivery logging**: Every attempt writes a log entry, including transient errors (timeouts, 5XX, network failures) and the final status.
- **Aggregated stats**: `stats.failureCount` and `stats.lastErrorAt` drive badges and alerts in the UI. Reaching configurable thresholds triggers email/Slack notifications.
- **UI surfacing**: Deliveries marked `failed` surface elevated callouts in the channel detail panel, with quick access to retry or download payload/response data.
- **Tracing & correlation**: Delivery logs include `traceId` values that tie into centralized logging (Cloud Logging) for cross-service debugging.

## Security Boundaries

- **Management UI**: Protected by Firebase App Check to block automated abuse. Only authenticated users with project membership (`request.auth != null && request.auth.uid in project.members`) can read/write channel metadata.
- **Callable / HTTPS Functions**: Use Firebase security rules and explicit server-side authorization checks. BYOL transformation code runs in a Cloud Functions 2nd-gen VM sandbox with outbound-only access to the target URL. No arbitrary file system or network beyond the outbound request is available.
- **Delivery execution**: Runs under a dedicated service account with least privilege. Secrets never leave secure memory and are not logged. All external requests honor egress firewall policies.
- **Client boundaries**: The raw signing secret is never stored client-side after initial display. Subsequent management uses tokenized operations (rotate, revoke) that never expose the hash.

## Operational Constraints

- **Timeouts**: Delivery functions target a 15-second timeout; retries occur if downstream services fail within that window. Management endpoints maintain sub-5 second execution targets.
- **Payload limits**: Maximum request payload size of 256 KB. Transformation code must produce JSON serializable output within this limit.
- **Retry guidance**: Exponential backoff (1 min, 5 min, 15 min) with a maximum of 5 attempts per delivery. `nextRetryAt` is recorded in the log document.
- **Concurrency**: Limit concurrent deliveries per channel to prevent target overload (initial cap of 3 parallel requests). Additional events queue until slots free.
- **Code execution**: Transformation scripts run with CPU/memory quotas aligned to Cloud Functions 2nd-gen defaults (256 MB, 80 MHz CPU). Long-running or blocking operations are terminated.

## Front-end Routing & Module Dependencies

- **Routes**:
  - `/projects` – List view of all projects the user can access, highlighting BYOL channels and surfacing aggregate stats.
  - `/projects/:id` – Project detail view with tabs for Channels, Delivery Logs, and Settings.
  - Nested modal routes for creating channels (`/projects/:id/channels/new`) leverage existing modal layout conventions.
- **Navigation**:
  - Add a "Projects" entry to the primary workspace navigation grouping alongside Agents and Automations.
  - Introduce a home dashboard quick action tile (“Create BYOL Channel”) linking to `/projects`.
- **Dependencies**:
  - **Pinia**: New `useProjectsStore` and `useChannelsStore` for caching Firestore collections and derived stats.
  - **VueFire**: Real-time bindings for `channels` and `logs` collections; leverage existing `useCollection` utilities.
  - **CodeEditor component**: Reuse for editing the BYOL transformation code snippet with syntax highlighting and validation.
  - **UI primitives**: Compose existing table, badge, and callout components for list/detail views. Respect Tailwind v4 conventions and theming.
- **State & Permissions**:
  - Gate write actions behind feature flags controlled by the Feature Toggle store.
  - Ensure route guards validate project membership before resolving page components.

## Next Steps

- Finalize Firestore security rules that enforce project-based ownership.
- Define integration tests for delivery success/failure scenarios.
- Align DevRel documentation with URL structure and signing expectations prior to beta release.
