import type {
  ProjectChannel,
  ProjectDeliveryLog,
} from "@/types/projects"

const largeMarketingResponse = "{" + '"body"' + ":" + '"' + "A".repeat(4600) + '"' + "}"

export const projectChannels: ProjectChannel[] = [
  {
    id: "marketing-updates",
    name: "Marketing Webhook",
    description:
      "Delivers newsletter engagement events to downstream marketing automation tools.",
    target: "https://hooks.maildash.dev/marketing/ingest",
    stats: {
      successRate: 0.94,
      avgResponseMs: 780,
      lastError: {
        deliveryId: "delivery-mkt-005",
        message: "Upstream ESP responded with 502 Bad Gateway",
        at: "2024-10-15T05:32:14.000Z",
        code: "HTTP_502",
      },
    },
  },
  {
    id: "transactional-email",
    name: "Transactional Email Relay",
    description:
      "Handles mission critical purchase confirmations and password reset notifications.",
    target: "https://hooks.maildash.dev/transactional/dispatch",
    stats: {
      successRate: 0.87,
      avgResponseMs: 920,
    },
  },
  {
    id: "status-alerts",
    name: "Status Alert Bridge",
    description:
      "Broadcasts real-time incident updates to partner dashboards and Slack.",
    target: "https://hooks.maildash.dev/status/alerts",
  },
]

export const projectDeliveryLogs: ProjectDeliveryLog[] = [
  {
    id: "delivery-mkt-001",
    channelId: "marketing-updates",
    status: "success",
    attempt: 1,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-16T12:45:30.000Z",
    completedAt: "2024-10-16T12:45:30.650Z",
    responseTimeMs: 650,
    sizeBytes: 1824,
    requestPayload: {
      event: "newsletter.send",
      userId: "usr_1289",
      campaign: "autumn-launch",
      metadata: {
        locale: "en-US",
        workspaceId: "workspace_AZ81",
      },
    },
    transformedPayload: {
      campaign: "autumn-launch",
      sentAt: "2024-10-16T12:45:29.900Z",
      normalizedUserId: "USR-1289",
    },
    responsePayload: {
      status: "queued",
      provider: "MailDash",
    },
  },
  {
    id: "delivery-mkt-002",
    channelId: "marketing-updates",
    status: "success",
    attempt: 1,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-16T11:10:12.000Z",
    completedAt: "2024-10-16T11:10:13.121Z",
    responseTimeMs: 1121,
    sizeBytes: 2579,
    requestPayload: {
      event: "newsletter.open",
      userId: "usr_9321",
      campaign: "autumn-launch",
      metadata: {
        locale: "fr-FR",
        workspaceId: "workspace_AZ81",
      },
    },
    transformedPayload: {
      campaign: "autumn-launch",
      openedAt: "2024-10-16T11:10:12.421Z",
      normalizedUserId: "USR-9321",
    },
    responsePayload: {
      acknowledged: true,
      providerLatency: 987,
      provider: "MailDash",
    },
  },
  {
    id: "delivery-mkt-003",
    channelId: "marketing-updates",
    status: "failed",
    attempt: 2,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-16T09:02:01.000Z",
    completedAt: "2024-10-16T09:02:04.431Z",
    responseTimeMs: 2431,
    sizeBytes: 3812,
    requestPayload: {
      event: "newsletter.click",
      userId: "usr_5523",
      campaign: "autumn-launch",
      metadata: {
        locale: "es-ES",
        workspaceId: "workspace_AZ81",
      },
    },
    transformedPayload: {
      campaign: "autumn-launch",
      clickedAt: "2024-10-16T09:02:01.320Z",
      normalizedUserId: "USR-5523",
    },
    responsePayload: {
      status: "error",
      error: "Request body exceeded limit",
    },
    error: {
      message: "Provider rejected payload because it exceeded the allowed size",
      code: "PAYLOAD_TOO_LARGE",
      stack:
        "DeliveryError: payload rejected\n    at DeliveryClient.execute (/srv/worker/delivery.js:83:15)",
      occurredAt: "2024-10-16T09:02:04.431Z",
      detail: "Payload was 3.8KB while the provider enforces a 3KB upper bound.",
    },
  },
  {
    id: "delivery-mkt-004",
    channelId: "marketing-updates",
    status: "retrying",
    attempt: 3,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-16T08:44:21.000Z",
    completedAt: null,
    responseTimeMs: null,
    sizeBytes: 4021,
    requestPayload: {
      event: "newsletter.send",
      userId: "usr_8831",
      campaign: "holiday-flash",
      metadata: {
        workspaceId: "workspace_AZ81",
      },
    },
    transformedPayload: {
      campaign: "holiday-flash",
      attempt: 3,
      normalizedUserId: "USR-8831",
    },
    responsePayload: null,
    error: {
      message: "Delivery is queued for retry after backoff",
      code: "DELIVERY_RETRY_SCHEDULED",
      occurredAt: "2024-10-16T08:44:21.000Z",
    },
  },
  {
    id: "delivery-mkt-005",
    channelId: "marketing-updates",
    status: "failed",
    attempt: 1,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-15T05:31:57.000Z",
    completedAt: "2024-10-15T05:31:58.210Z",
    responseTimeMs: 1210,
    sizeBytes: 1655,
    requestPayload: {
      event: "newsletter.send",
      userId: "usr_7819",
      campaign: "sunrise-beta",
      metadata: {
        workspaceId: "workspace_AZ81",
      },
    },
    transformedPayload: {
      campaign: "sunrise-beta",
      normalizedUserId: "USR-7819",
    },
    responsePayload: {
      status: 502,
      provider: "MailDash",
    },
    error: {
      message: "Upstream ESP responded with 502 Bad Gateway",
      code: "HTTP_502",
      occurredAt: "2024-10-15T05:31:58.210Z",
      stack:
        "DeliveryError: upstream responded 502\n    at DeliveryClient.execute (/srv/worker/delivery.js:83:15)",
    },
  },
  {
    id: "delivery-mkt-006",
    channelId: "marketing-updates",
    status: "success",
    attempt: 1,
    destination: "https://hooks.maildash.dev/marketing/ingest",
    triggeredAt: "2024-10-14T21:12:40.000Z",
    completedAt: "2024-10-14T21:12:41.140Z",
    responseTimeMs: 1140,
    sizeBytes: 1122,
    requestPayload: {
      event: "newsletter.send",
      userId: "usr_3110",
      campaign: "sunrise-beta",
    },
    transformedPayload: {
      campaign: "sunrise-beta",
      normalizedUserId: "USR-3110",
    },
    responsePayload: JSON.parse(largeMarketingResponse),
  },
  {
    id: "delivery-trx-001",
    channelId: "transactional-email",
    status: "success",
    attempt: 1,
    destination: "https://hooks.maildash.dev/transactional/dispatch",
    triggeredAt: "2024-10-16T12:50:02.000Z",
    completedAt: "2024-10-16T12:50:02.312Z",
    responseTimeMs: 312,
    sizeBytes: 894,
    requestPayload: {
      event: "receipt.issued",
      orderId: "order_98231",
      userId: "usr_9341",
      amount: 129.99,
      currency: "USD",
    },
    transformedPayload: {
      orderId: "order_98231",
      total: {
        amount: 129.99,
        currency: "USD",
      },
      normalizedUserId: "USR-9341",
    },
    responsePayload: {
      provider: "MailDash",
      status: "delivered",
    },
  },
  {
    id: "delivery-trx-002",
    channelId: "transactional-email",
    status: "processing",
    attempt: 1,
    destination: "https://hooks.maildash.dev/transactional/dispatch",
    triggeredAt: "2024-10-16T12:48:10.000Z",
    completedAt: null,
    responseTimeMs: null,
    sizeBytes: 978,
    requestPayload: {
      event: "password.reset",
      token: "tok_239012",
      userId: "usr_5512",
    },
    transformedPayload: {
      normalizedUserId: "USR-5512",
      expiresAt: "2024-10-16T13:48:10.000Z",
    },
    responsePayload: null,
  },
  {
    id: "delivery-trx-003",
    channelId: "transactional-email",
    status: "failed",
    attempt: 1,
    destination: "https://hooks.maildash.dev/transactional/dispatch",
    triggeredAt: "2024-10-16T11:12:44.000Z",
    completedAt: "2024-10-16T11:12:44.540Z",
    responseTimeMs: 540,
    sizeBytes: 1188,
    requestPayload: {
      event: "receipt.issued",
      orderId: "order_98211",
      userId: "usr_2395",
      amount: 19.99,
      currency: "USD",
    },
    transformedPayload: {
      orderId: "order_98211",
      total: {
        amount: 19.99,
        currency: "USD",
      },
      normalizedUserId: "USR-2395",
    },
    responsePayload: {
      provider: "MailDash",
      status: "error",
      error: "Mailbox unavailable",
    },
    error: {
      message: "SMTP target mailbox returned 550 mailbox unavailable",
      code: "SMTP_550",
      occurredAt: "2024-10-16T11:12:44.540Z",
    },
  },
  {
    id: "delivery-alert-001",
    channelId: "status-alerts",
    status: "queued",
    attempt: 1,
    destination: "https://hooks.maildash.dev/status/alerts",
    triggeredAt: "2024-10-16T12:58:11.000Z",
    completedAt: null,
    responseTimeMs: null,
    sizeBytes: 1345,
    requestPayload: {
      event: "incident.created",
      incidentId: "inc_10923",
      severity: "major",
      message: "Users are experiencing elevated latency in workspace region us-east-1.",
    },
    transformedPayload: {
      incidentId: "inc_10923",
      severity: "major",
      broadcastChannels: ["status-page", "slack"],
    },
    responsePayload: null,
  },
]
