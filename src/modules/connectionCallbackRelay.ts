// OAuth connection popup relay. Imported FIRST in main.ts so it runs before any
// Firebase module evaluates: the connect popup lands on /connections/callback,
// and booting the full SPA here (Firestore multi-tab persistence, Auth, App
// Check, the device-session heartbeat) in the popup churns the opener tab's
// session via shared IndexedDB — which made the opener's completeConnectionBinding
// call race a transiently-null auth token ("Sign-in required."). Relaying the
// code and closing without booting anything removes that disturbance at the
// source. No-op when there's no opener (direct navigation) so callback.vue still
// renders its "opened outside the popup flow" notice.
if (
  window.location.pathname === "/connections/callback" &&
  window.opener &&
  window.opener !== window
) {
  const params = new URLSearchParams(window.location.search)
  window.opener.postMessage(
    {
      // Must match CONNECTION_OAUTH_MESSAGE in useConnections.ts.
      type: "connection_oauth",
      code: params.get("code"),
      state: params.get("state"),
      error:
        params.get("error_description") || params.get("error") || undefined,
    },
    window.location.origin
  )
  window.close()
  // Abort the module graph so main.ts's Firebase imports never evaluate in the
  // (now closing) popup. ponytail: throw-to-halt; the window is gone, the log
  // is invisible. Upgrade to an if/else bootstrap wrapper only if that changes.
  throw new Error("connection-callback-relay")
}
