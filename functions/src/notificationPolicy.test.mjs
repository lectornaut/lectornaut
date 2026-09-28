import assert from "node:assert/strict"
import test from "node:test"
import { planNotificationDelivery } from "./notificationPolicy.ts"

const config = {
  inApp: true,
  email: true,
  native: true,
  category: "communication",
}

const settings = (overrides = {}) => ({
  categories: { communication: true, marketing: true, security: true },
  frequency: "immediate",
  channels: { inApp: true, email: true, native: true },
  ...overrides,
})

test("immediate routes to every enabled channel", () => {
  assert.deepEqual(planNotificationDelivery(config, settings()), {
    mode: "immediate",
    frequency: null,
    channels: { inApp: true, email: true, native: true },
  })
})

test("a disabled category blocks every channel", () => {
  assert.equal(
    planNotificationDelivery(
      config,
      settings({ categories: { communication: false } })
    ).mode,
    "disabled"
  )
})

test("security notifications obey the security category setting", () => {
  assert.equal(
    planNotificationDelivery(
      { ...config, category: "security" },
      settings({ categories: { security: false } })
    ).mode,
    "disabled"
  )
})

test("disabled channels are never routed", () => {
  const plan = planNotificationDelivery(
    config,
    settings({ channels: { inApp: false, email: true, native: false } })
  )

  assert.deepEqual(plan.channels, {
    inApp: false,
    email: true,
    native: false,
  })
})

test("none blocks all channels", () => {
  assert.equal(
    planNotificationDelivery(config, settings({ frequency: "none" })).mode,
    "disabled"
  )
})

for (const frequency of ["daily", "weekly"]) {
  test(`${frequency} batches every enabled channel`, () => {
    assert.deepEqual(
      planNotificationDelivery(config, settings({ frequency })),
      {
        mode: "digest",
        frequency,
        channels: { inApp: true, email: true, native: true },
      }
    )
  })
}

test("channel-specific tests cannot bypass preferences", () => {
  const plan = planNotificationDelivery(
    config,
    settings({ channels: { inApp: true, email: false, native: true } }),
    ["email"]
  )

  assert.equal(plan.mode, "disabled")
  assert.deepEqual(plan.channels, {
    inApp: false,
    email: false,
    native: false,
  })
})
