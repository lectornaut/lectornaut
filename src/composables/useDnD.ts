import { useVueFlow } from "@vue-flow/core"

let id = 0

/**
 * Generates a unique ID for drag-and-drop nodes.
 * @returns A unique node identifier.
 */
function getId(): string {
  return `dndnode_${id++}`
}

/**
 * Global drag-and-drop state shared across all component instances.
 *
 * This is intentionally defined at module scope because:
 * 1. Only one drag operation can occur at a time in the browser
 * 2. Multiple drop zones need to react to the same drag state
 * 3. The cursor style needs to be coordinated globally
 *
 * Using shallowRef for better performance with primitive values.
 */
const state = {
  /** The type of the node being dragged */
  draggedType: shallowRef<string | null>(null),
  /** Whether a dragged item is over a valid drop zone */
  isDragOver: shallowRef(false),
  /** Whether a drag operation is in progress */
  isDragging: shallowRef(false),
}

export default function useDragAndDrop() {
  const { draggedType, isDragOver, isDragging } = state

  const { addNodes, screenToFlowCoordinate, onNodesInitialized, updateNode } =
    useVueFlow()

  // Global watcher for cursor style
  watch(state.isDragging, (dragging) => {
    if (typeof document !== "undefined" && document.body) {
      document.body.style.userSelect = dragging ? "none" : ""
    }
  })

  // Cleanup event listeners on component unmount to prevent memory leaks
  onUnmounted(() => {
    document.removeEventListener("drop", onDragEnd)
    document.removeEventListener("dragend", onDragEnd)
    // Reset state if this component was mid-drag
    if (isDragging.value) {
      isDragging.value = false
      isDragOver.value = false
      draggedType.value = null
    }
  })

  function onDragStart(event: DragEvent, type: string) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("application/vueflow", type)
      event.dataTransfer.effectAllowed = "move"
    }

    draggedType.value = type
    isDragging.value = true

    document.addEventListener("drop", onDragEnd)
    document.addEventListener("dragend", onDragEnd)
  }

  /**
   * Handles the drag over event.
   *
   * @param {DragEvent} event
   */
  function onDragOver(event: DragEvent) {
    event.preventDefault()

    if (draggedType.value) {
      isDragOver.value = true

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move"
      }
    }
  }

  function onDragLeave() {
    isDragOver.value = false
  }

  function onDragEnd() {
    isDragging.value = false
    isDragOver.value = false
    draggedType.value = null
    document.removeEventListener("drop", onDragEnd)
    document.removeEventListener("dragend", onDragEnd)
  }

  /**
   * Handles the drop event.
   *
   * @param {DragEvent} event
   */
  function onDrop(event: DragEvent) {
    const position = screenToFlowCoordinate({
      x: event.clientX,
      y: event.clientY,
    })

    const nodeId = getId()

    const newNode = {
      id: nodeId,
      type: draggedType.value ?? undefined,
      position,
      data: { label: nodeId },
    }

    /**
     * Align node position after drop, so it's centered to the mouse
     *
     * We can hook into events even in a callback, and we can remove the event listener after it's been called.
     */
    const { off } = onNodesInitialized(() => {
      updateNode(nodeId, (node) => ({
        position: {
          x: node.position.x - node.dimensions.width / 2,
          y: node.position.y - node.dimensions.height / 2,
        },
      }))

      off()
    })

    addNodes(newNode)
  }

  return {
    draggedType,
    isDragOver,
    isDragging,
    onDragStart,
    onDragLeave,
    onDragOver,
    onDrop,
  }
}
