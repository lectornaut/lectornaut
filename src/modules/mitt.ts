import mitt from "mitt"

/**
 * Global Event Emitter
 * Used for cross-component communication, especially for hotkeys
 */
export const emitter = mitt()
