import type { SignalType } from "@/collab/signaling"

export interface IncomingSignal {
  fromPeerId: string
  toPeerId: string
  type: SignalType
  payload: unknown
}

export interface WebRtcMeshOptions {
  myPeerId: string
  onYUpdate: (update: Uint8Array, fromPeerId: string) => void
  onAwarenessUpdate: (update: Uint8Array, fromPeerId: string) => void
  sendSignal: (
    toPeerId: string,
    type: SignalType,
    payload: unknown
  ) => Promise<void>
  onPeerConnected?: (peerId: string) => void
  onPeerDisconnected?: (peerId: string) => void
  rtcConfig?: RTCConfiguration
}

// Binary message type prefixes (1 byte overhead vs ~33% with JSON+Base64)
const MSG_TYPE_Y_UPDATE = 0x01
const MSG_TYPE_AWARENESS = 0x02

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
}
const ICE_SIGNAL_FLUSH_MS = 20
const DISCONNECT_GRACE_PERIOD_MS = 10_000
const ICE_RESTART_DELAY_MS = 2_000

export class WebRtcMesh {
  private readonly options: WebRtcMeshOptions
  private readonly peerConnections = new Map<string, RTCPeerConnection>()
  private readonly dataChannels = new Map<string, RTCDataChannel>()
  private readonly pendingOutgoingIceSignals = new Map<
    string,
    RTCIceCandidateInit[]
  >()
  private readonly pendingOutgoingIceTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly pendingIceCandidates = new Map<
    string,
    RTCIceCandidateInit[]
  >()
  private readonly disconnectTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()
  private readonly iceRestartTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >()

  constructor(options: WebRtcMeshOptions) {
    this.options = {
      ...options,
      rtcConfig: options.rtcConfig ?? DEFAULT_RTC_CONFIG,
    }
  }

  ensurePeer(peerId: string): void {
    if (!peerId || peerId === this.options.myPeerId) {
      return
    }

    if (this.peerConnections.has(peerId)) {
      return
    }

    const shouldInitiateOffer = this.shouldInitiate(peerId)
    const connection = this.createPeerConnection(peerId, shouldInitiateOffer)

    this.peerConnections.set(peerId, connection)

    if (shouldInitiateOffer) {
      const channel = connection.createDataChannel("yjs")
      this.attachDataChannel(peerId, channel)
      void this.createOffer(peerId, connection)
    }
  }

  getPeerIds(): string[] {
    return [...this.peerConnections.keys()]
  }

  sendYUpdate(update: Uint8Array, targetPeerId?: string): void {
    const message = this.createBinaryMessage(MSG_TYPE_Y_UPDATE, update)

    if (targetPeerId) {
      this.sendBinaryMessage(targetPeerId, message)
      return
    }

    this.broadcastBinaryMessage(message)
  }

  sendAwareness(update: Uint8Array, targetPeerId?: string): void {
    const message = this.createBinaryMessage(MSG_TYPE_AWARENESS, update)

    if (targetPeerId) {
      this.sendBinaryMessage(targetPeerId, message)
      return
    }

    this.broadcastBinaryMessage(message)
  }

  private createBinaryMessage(type: number, payload: Uint8Array): ArrayBuffer {
    const message = new ArrayBuffer(1 + payload.length)
    const view = new Uint8Array(message)
    view[0] = type
    view.set(payload, 1)
    return message
  }

  async handleSignal(signal: IncomingSignal): Promise<void> {
    const { fromPeerId, type, payload } = signal

    if (!fromPeerId || fromPeerId === this.options.myPeerId) {
      return
    }

    this.ensurePeer(fromPeerId)

    const connection = this.peerConnections.get(fromPeerId)
    if (!connection) {
      return
    }

    if (type === "offer") {
      if (this.shouldInitiate(fromPeerId)) {
        return
      }
      await this.handleOffer(fromPeerId, connection, payload)
      return
    }

    if (type === "answer") {
      await this.handleAnswer(connection, payload)
      await this.flushPendingIce(fromPeerId, connection)
      return
    }

    if (type === "ice") {
      await this.handleIceCandidate(fromPeerId, connection, payload)
    }
  }

  removePeer(peerId: string): void {
    const hadConnection = this.peerConnections.has(peerId)
    const hadDataChannel = this.dataChannels.has(peerId)

    this.clearDisconnectTimer(peerId)
    this.clearQueuedIceSignals(peerId)

    const connection = this.peerConnections.get(peerId)
    if (connection) {
      connection.onicecandidate = null
      connection.ondatachannel = null
      connection.onconnectionstatechange = null
      connection.close()
      this.peerConnections.delete(peerId)
    }

    const channel = this.dataChannels.get(peerId)
    if (channel) {
      channel.onmessage = null
      channel.onopen = null
      channel.onclose = null
      channel.onerror = null
      channel.close()
      this.dataChannels.delete(peerId)
    }

    this.pendingIceCandidates.delete(peerId)

    if (hadConnection || hadDataChannel) {
      this.options.onPeerDisconnected?.(peerId)
    }
  }

  destroy(): void {
    this.pendingOutgoingIceTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    this.pendingOutgoingIceTimers.clear()
    this.pendingOutgoingIceSignals.clear()
    this.disconnectTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    this.disconnectTimers.clear()
    this.iceRestartTimers.forEach((timer) => {
      clearTimeout(timer)
    })
    this.iceRestartTimers.clear()

    this.getPeerIds().forEach((peerId) => {
      this.removePeer(peerId)
    })
  }

  private shouldInitiate(peerId: string): boolean {
    return this.options.myPeerId.localeCompare(peerId) < 0
  }

  private createPeerConnection(
    peerId: string,
    shouldInitiateOffer: boolean
  ): RTCPeerConnection {
    const connection = new RTCPeerConnection(this.options.rtcConfig)

    connection.onicecandidate = (event) => {
      if (!event.candidate) {
        return
      }

      this.queueIceSignal(peerId, event.candidate.toJSON())
    }

    connection.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") {
        // Try ICE restart before giving up
        this.scheduleIceRestart(peerId, connection)
        return
      }

      if (connection.connectionState === "closed") {
        this.removePeer(peerId)
        return
      }

      if (connection.connectionState === "disconnected") {
        this.scheduleDisconnectCheck(peerId, connection)
        return
      }

      if (connection.connectionState === "connected") {
        this.clearDisconnectTimer(peerId)
        this.clearIceRestartTimer(peerId)
      }
    }

    if (!shouldInitiateOffer) {
      connection.ondatachannel = (event) => {
        this.attachDataChannel(peerId, event.channel)
      }
    }

    return connection
  }

  private attachDataChannel(peerId: string, channel: RTCDataChannel): void {
    // Use binary mode for better performance
    channel.binaryType = "arraybuffer"

    channel.onopen = () => {
      this.clearDisconnectTimer(peerId)
      this.dataChannels.set(peerId, channel)
      this.options.onPeerConnected?.(peerId)
    }

    channel.onmessage = (event) => {
      this.handleDataChannelMessage(peerId, event.data)
    }

    channel.onerror = () => {
      this.removePeer(peerId)
    }

    channel.onclose = () => {
      this.removePeer(peerId)
    }
  }

  private async createOffer(
    peerId: string,
    connection: RTCPeerConnection
  ): Promise<void> {
    const offer = await connection.createOffer()
    await connection.setLocalDescription(offer)

    const payload = connection.localDescription?.toJSON() ?? offer
    await this.options.sendSignal(peerId, "offer", payload)
  }

  private async handleOffer(
    peerId: string,
    connection: RTCPeerConnection,
    payload: unknown
  ): Promise<void> {
    const offer = this.toSessionDescription(payload)
    if (!offer) {
      return
    }

    await connection.setRemoteDescription(new RTCSessionDescription(offer))
    await this.flushPendingIce(peerId, connection)

    const answer = await connection.createAnswer()
    await connection.setLocalDescription(answer)

    const answerPayload = connection.localDescription?.toJSON() ?? answer
    await this.options.sendSignal(peerId, "answer", answerPayload)
  }

  private async handleAnswer(
    connection: RTCPeerConnection,
    payload: unknown
  ): Promise<void> {
    const answer = this.toSessionDescription(payload)
    if (!answer) {
      return
    }

    await connection.setRemoteDescription(new RTCSessionDescription(answer))
  }

  private async handleIceCandidate(
    peerId: string,
    connection: RTCPeerConnection,
    payload: unknown
  ): Promise<void> {
    const candidates = this.toIceCandidates(payload)
    if (!candidates.length) {
      return
    }

    if (!connection.remoteDescription) {
      const queued = this.pendingIceCandidates.get(peerId) ?? []
      queued.push(...candidates)
      this.pendingIceCandidates.set(peerId, queued)
      return
    }

    await Promise.all(
      candidates.map((candidate) =>
        connection.addIceCandidate(new RTCIceCandidate(candidate))
      )
    )
  }

  private async flushPendingIce(
    peerId: string,
    connection: RTCPeerConnection
  ): Promise<void> {
    const queued = this.pendingIceCandidates.get(peerId)
    if (!queued?.length) {
      return
    }

    this.pendingIceCandidates.delete(peerId)

    await Promise.all(
      queued.map((candidate) =>
        connection.addIceCandidate(new RTCIceCandidate(candidate))
      )
    )
  }

  private handleDataChannelMessage(peerId: string, rawData: unknown): void {
    if (!(rawData instanceof ArrayBuffer) || rawData.byteLength < 2) {
      return
    }

    const view = new Uint8Array(rawData)
    const messageType = view[0]
    const payload = view.slice(1)

    if (messageType === MSG_TYPE_Y_UPDATE) {
      this.options.onYUpdate(payload, peerId)
      return
    }

    if (messageType === MSG_TYPE_AWARENESS) {
      this.options.onAwarenessUpdate(payload, peerId)
    }
  }

  private sendBinaryMessage(peerId: string, message: ArrayBuffer): void {
    const channel = this.dataChannels.get(peerId)
    if (!channel || channel.readyState !== "open") {
      return
    }

    channel.send(message)
  }

  private broadcastBinaryMessage(message: ArrayBuffer): void {
    this.dataChannels.forEach((channel) => {
      if (channel.readyState !== "open") {
        return
      }

      channel.send(message)
    })
  }

  private queueIceSignal(peerId: string, candidate: RTCIceCandidateInit): void {
    const queued = this.pendingOutgoingIceSignals.get(peerId) ?? []
    queued.push(candidate)
    this.pendingOutgoingIceSignals.set(peerId, queued)

    if (this.pendingOutgoingIceTimers.has(peerId)) {
      return
    }

    const timer = setTimeout(() => {
      this.pendingOutgoingIceTimers.delete(peerId)
      void this.flushQueuedIceSignals(peerId)
    }, ICE_SIGNAL_FLUSH_MS)

    this.pendingOutgoingIceTimers.set(peerId, timer)
  }

  private async flushQueuedIceSignals(peerId: string): Promise<void> {
    const queued = this.pendingOutgoingIceSignals.get(peerId)
    if (!queued?.length) {
      return
    }

    this.pendingOutgoingIceSignals.delete(peerId)

    const payload =
      queued.length === 1 ? queued[0] : ({ candidates: queued } as const)

    try {
      await this.options.sendSignal(peerId, "ice", payload)
    } catch {
      if (!this.peerConnections.has(peerId)) {
        return
      }

      const currentQueue = this.pendingOutgoingIceSignals.get(peerId) ?? []
      this.pendingOutgoingIceSignals.set(peerId, [...queued, ...currentQueue])

      if (this.pendingOutgoingIceTimers.has(peerId)) {
        return
      }

      const timer = setTimeout(() => {
        this.pendingOutgoingIceTimers.delete(peerId)
        void this.flushQueuedIceSignals(peerId)
      }, ICE_SIGNAL_FLUSH_MS)

      this.pendingOutgoingIceTimers.set(peerId, timer)
    }
  }

  private clearQueuedIceSignals(peerId: string): void {
    const timer = this.pendingOutgoingIceTimers.get(peerId)
    if (timer) {
      clearTimeout(timer)
      this.pendingOutgoingIceTimers.delete(peerId)
    }
    this.pendingOutgoingIceSignals.delete(peerId)
  }

  private scheduleDisconnectCheck(
    peerId: string,
    connection: RTCPeerConnection
  ): void {
    if (this.disconnectTimers.has(peerId)) {
      return
    }

    const timer = setTimeout(() => {
      this.disconnectTimers.delete(peerId)

      const current = this.peerConnections.get(peerId)
      if (!current || current !== connection) {
        return
      }

      if (
        current.connectionState === "disconnected" ||
        current.connectionState === "failed" ||
        current.connectionState === "closed"
      ) {
        this.removePeer(peerId)
      }
    }, DISCONNECT_GRACE_PERIOD_MS)

    this.disconnectTimers.set(peerId, timer)
  }

  private clearDisconnectTimer(peerId: string): void {
    const timer = this.disconnectTimers.get(peerId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.disconnectTimers.delete(peerId)
  }

  private scheduleIceRestart(
    peerId: string,
    connection: RTCPeerConnection
  ): void {
    if (this.iceRestartTimers.has(peerId)) {
      return
    }

    const timer = setTimeout(() => {
      this.iceRestartTimers.delete(peerId)

      const current = this.peerConnections.get(peerId)
      if (!current || current !== connection) {
        return
      }

      if (current.connectionState === "failed") {
        try {
          // Attempt ICE restart to recover the connection
          current.restartIce()
          void this.createOffer(peerId, current)
        } catch {
          // ICE restart failed, remove peer and let reconnection logic handle it
          this.removePeer(peerId)
        }
      }
    }, ICE_RESTART_DELAY_MS)

    this.iceRestartTimers.set(peerId, timer)
  }

  private clearIceRestartTimer(peerId: string): void {
    const timer = this.iceRestartTimers.get(peerId)
    if (!timer) {
      return
    }

    clearTimeout(timer)
    this.iceRestartTimers.delete(peerId)
  }

  private toSessionDescription(
    payload: unknown
  ): RTCSessionDescriptionInit | null {
    if (
      !payload ||
      typeof payload !== "object" ||
      typeof (payload as { type?: unknown }).type !== "string" ||
      typeof (payload as { sdp?: unknown }).sdp !== "string"
    ) {
      return null
    }

    return {
      type: (payload as { type: RTCSdpType }).type,
      sdp: (payload as { sdp: string }).sdp,
    }
  }

  private toIceCandidates(payload: unknown): RTCIceCandidateInit[] {
    if (Array.isArray(payload)) {
      return payload
        .map((entry) => this.toSingleIceCandidate(entry))
        .filter((entry): entry is RTCIceCandidateInit => entry !== null)
    }

    if (
      payload &&
      typeof payload === "object" &&
      Array.isArray((payload as { candidates?: unknown }).candidates)
    ) {
      return (payload as { candidates: unknown[] }).candidates
        .map((entry) => this.toSingleIceCandidate(entry))
        .filter((entry): entry is RTCIceCandidateInit => entry !== null)
    }

    const single = this.toSingleIceCandidate(payload)
    return single ? [single] : []
  }

  private toSingleIceCandidate(payload: unknown): RTCIceCandidateInit | null {
    if (!payload || typeof payload !== "object") {
      return null
    }

    const candidate = payload as {
      candidate?: unknown
      sdpMid?: unknown
      sdpMLineIndex?: unknown
      usernameFragment?: unknown
    }

    if (typeof candidate.candidate !== "string") {
      return null
    }

    return {
      candidate: candidate.candidate,
      sdpMid:
        typeof candidate.sdpMid === "string" ? candidate.sdpMid : undefined,
      sdpMLineIndex:
        typeof candidate.sdpMLineIndex === "number"
          ? candidate.sdpMLineIndex
          : undefined,
      usernameFragment:
        typeof candidate.usernameFragment === "string"
          ? candidate.usernameFragment
          : undefined,
    }
  }
}
