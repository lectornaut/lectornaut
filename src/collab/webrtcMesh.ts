import { base64ToBytes, bytesToBase64 } from "@/collab/base64"
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

type MeshEnvelope =
  | {
      t: "y-update"
      data: string
    }
  | {
      t: "awareness"
      data: string
    }

const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
}

export class WebRtcMesh {
  private readonly options: WebRtcMeshOptions
  private readonly peerConnections = new Map<string, RTCPeerConnection>()
  private readonly dataChannels = new Map<string, RTCDataChannel>()
  private readonly pendingIceCandidates = new Map<
    string,
    RTCIceCandidateInit[]
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
    const envelope: MeshEnvelope = {
      t: "y-update",
      data: bytesToBase64(update),
    }

    if (targetPeerId) {
      this.sendEnvelope(targetPeerId, envelope)
      return
    }

    this.broadcastEnvelope(envelope)
  }

  sendAwareness(update: Uint8Array, targetPeerId?: string): void {
    const envelope: MeshEnvelope = {
      t: "awareness",
      data: bytesToBase64(update),
    }

    if (targetPeerId) {
      this.sendEnvelope(targetPeerId, envelope)
      return
    }

    this.broadcastEnvelope(envelope)
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
      this.options.onPeerDisconnected?.(peerId)
    }

    this.pendingIceCandidates.delete(peerId)
  }

  destroy(): void {
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

      void this.options.sendSignal(peerId, "ice", event.candidate.toJSON())
    }

    connection.onconnectionstatechange = () => {
      if (
        connection.connectionState === "failed" ||
        connection.connectionState === "disconnected" ||
        connection.connectionState === "closed"
      ) {
        this.removePeer(peerId)
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
    channel.onopen = () => {
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
    const candidate = this.toIceCandidate(payload)
    if (!candidate) {
      return
    }

    if (!connection.remoteDescription) {
      const queued = this.pendingIceCandidates.get(peerId) ?? []
      queued.push(candidate)
      this.pendingIceCandidates.set(peerId, queued)
      return
    }

    await connection.addIceCandidate(new RTCIceCandidate(candidate))
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
    if (typeof rawData !== "string") {
      return
    }

    let envelope: MeshEnvelope | null = null

    try {
      envelope = JSON.parse(rawData) as MeshEnvelope
    } catch {
      return
    }

    if (!envelope || typeof envelope.data !== "string") {
      return
    }

    if (envelope.t === "y-update") {
      this.options.onYUpdate(base64ToBytes(envelope.data), peerId)
      return
    }

    if (envelope.t === "awareness") {
      this.options.onAwarenessUpdate(base64ToBytes(envelope.data), peerId)
    }
  }

  private sendEnvelope(peerId: string, envelope: MeshEnvelope): void {
    const channel = this.dataChannels.get(peerId)
    if (!channel || channel.readyState !== "open") {
      return
    }

    channel.send(JSON.stringify(envelope))
  }

  private broadcastEnvelope(envelope: MeshEnvelope): void {
    this.dataChannels.forEach((channel) => {
      if (channel.readyState !== "open") {
        return
      }

      channel.send(JSON.stringify(envelope))
    })
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

  private toIceCandidate(payload: unknown): RTCIceCandidateInit | null {
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
