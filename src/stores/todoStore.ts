/**
 * Todo Store with Optimistic Firestore Updates
 *
 * All Firestore writes happen through store actions only.
 * Components should never call Firestore directly.
 *
 * Features:
 * - Instant UI updates via optimistic state changes
 * - Automatic rollback on Firestore errors
 * - pendingIds tracking to disable UI during operations
 * - Snapshot protection to prevent overwriting optimistic state
 */

import {
  firestoreAddDoc,
  firestoreDeleteDoc,
  firestoreSetDoc,
  firestoreUpdateDoc,
} from "@/composables/useFirestore"
import { firestore } from "@/modules/firebase"
import type { ITodo } from "@/types"
import {
  cloneState,
  createPendingSet,
  withOptimisticUpdate,
} from "@/utils/firebase-optimistic"
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore"
import { defineStore } from "pinia"

const todoRef = collection(firestore, "todos")

export const useTodoStore = defineStore("todos", () => {
  // ============================================================================
  // State
  // ============================================================================

  /** All todos - managed locally with optimistic updates */
  const todos = ref<ITodo[]>([])

  /** Loading state for initial fetch */
  const isLoading = ref(true)

  /** Set of IDs for operations currently in-flight */
  const pendingIds = shallowRef(createPendingSet())

  /** Firestore snapshot unsubscribe function */
  let unsubscribe: (() => void) | null = null

  // ============================================================================
  // Computed
  // ============================================================================

  /** Check if a specific todo has a pending operation */
  const isPending = computed(() => (id: string) => pendingIds.value.has(id))

  /** Check if any operation is pending */
  const hasAnyPending = computed(() => pendingIds.value.size > 0)

  // ============================================================================
  // Snapshot Listener with Optimistic Protection
  // ============================================================================

  /**
   * Initialize the Firestore snapshot listener
   * Protects optimistic updates by skipping updates for pending IDs
   */
  function initializeSnapshot() {
    if (unsubscribe) return

    const q = query(todoRef, orderBy("createdAt", "desc"))

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        isLoading.value = false

        // Build new state from snapshot, preserving optimistic updates
        const newTodos: ITodo[] = []
        const pendingSet = pendingIds.value

        snapshot.docs.forEach((docSnap) => {
          const data = docSnap.data() as ITodo
          const id = docSnap.id

          // If this ID has a pending operation, keep the optimistic version
          if (pendingSet.has(id)) {
            const optimisticTodo = todos.value.find((t) => t.id === id)
            if (optimisticTodo) {
              newTodos.push(optimisticTodo)
              return
            }
          }

          // Otherwise use the snapshot data
          newTodos.push({ ...data, id })
        })

        // Also preserve any optimistically added todos that aren't in Firestore yet
        todos.value.forEach((todo) => {
          if (
            pendingSet.has(todo.id) &&
            !newTodos.some((t) => t.id === todo.id)
          ) {
            newTodos.push(todo)
          }
        })

        todos.value = newTodos
      },
      (error) => {
        console.error("Todos snapshot error:", error)
        isLoading.value = false
      }
    )
  }

  /**
   * Cleanup the snapshot listener
   */
  function cleanup() {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
  }

  // Initialize on store creation
  initializeSnapshot()

  // ============================================================================
  // Actions - All Firestore writes happen here
  // ============================================================================

  /**
   * Add a new todo with optimistic update
   */
  async function add(todo: ITodo): Promise<void> {
    // Generate ID if not provided
    const id = todo.id || doc(todoRef).id
    const newTodo: ITodo = { ...todo, id }

    // Clone previous state for rollback
    const previousTodos = cloneState(todos.value)

    await withOptimisticUpdate(
      pendingIds.value,
      id,
      // Apply optimistic update
      () => {
        todos.value = [newTodo, ...todos.value]
      },
      // Rollback on error
      () => {
        todos.value = previousTodos
      },
      // Firestore operation
      async () => {
        await firestoreAddDoc(todoRef, newTodo, {
          showSuccessToast: true,
          successMessage: "Todo added",
        })
      }
    )
  }

  /**
   * Delete a todo with optimistic update
   */
  async function del(id: string): Promise<void> {
    // Find and clone the todo for rollback/undo
    const todoToDelete = todos.value.find((t) => t.id === id)
    if (!todoToDelete) {
      console.warn(`Todo with id ${id} not found`)
      return
    }

    const clonedTodo = cloneState(todoToDelete)
    const previousTodos = cloneState(todos.value)

    await withOptimisticUpdate(
      pendingIds.value,
      id,
      // Apply optimistic update
      () => {
        todos.value = todos.value.filter((t) => t.id !== id)
      },
      // Rollback on error
      () => {
        todos.value = previousTodos
      },
      // Firestore operation with undo support
      async () => {
        await firestoreDeleteDoc(todoRef, id, {
          showSuccessToast: true,
          successMessage: "Todo deleted",
          onUndo: async () => {
            // Restore the todo
            const restorePreviousTodos = cloneState(todos.value)
            pendingIds.value.add(id)

            try {
              todos.value = [clonedTodo, ...todos.value]
              await firestoreSetDoc(todoRef, id, clonedTodo, {
                showSuccessToast: false,
              })
            } catch (error) {
              todos.value = restorePreviousTodos
              throw error
            } finally {
              pendingIds.value.delete(id)
            }
          },
        })
      }
    )
  }

  /**
   * Update a todo with optimistic update
   */
  async function update(id: string, updates: Partial<ITodo>): Promise<void> {
    // Find and clone the todo for rollback/undo
    const todoToUpdate = todos.value.find((t) => t.id === id)
    if (!todoToUpdate) {
      console.warn(`Todo with id ${id} not found`)
      return
    }

    const clonedTodo = cloneState(todoToUpdate)
    const previousTodos = cloneState(todos.value)

    await withOptimisticUpdate(
      pendingIds.value,
      id,
      // Apply optimistic update
      () => {
        todos.value = todos.value.map((t) =>
          t.id === id ? { ...t, ...updates } : t
        )
      },
      // Rollback on error
      () => {
        todos.value = previousTodos
      },
      // Firestore operation with undo support
      async () => {
        await firestoreUpdateDoc(todoRef, id, updates, {
          showSuccessToast: true,
          successMessage: "Todo updated",
          onUndo: async () => {
            // Revert to previous state
            const revertPreviousTodos = cloneState(todos.value)
            pendingIds.value.add(id)

            try {
              todos.value = todos.value.map((t) =>
                t.id === id ? clonedTodo : t
              )
              await firestoreUpdateDoc(todoRef, id, clonedTodo, {
                showSuccessToast: false,
              })
            } catch (error) {
              todos.value = revertPreviousTodos
              throw error
            } finally {
              pendingIds.value.delete(id)
            }
          },
        })
      }
    )
  }

  /**
   * Toggle todo completion status
   */
  async function toggleComplete(id: string): Promise<void> {
    const todo = todos.value.find((t) => t.id === id)
    if (!todo) return

    await update(id, { completed: !todo.completed })
  }

  /**
   * Get a single todo by ID
   */
  function getTodoById(id: string): ITodo | undefined {
    return todos.value.find((t) => t.id === id)
  }

  return {
    // State
    todos,
    isLoading,
    pendingIds,

    // Computed
    isPending,
    hasAnyPending,

    // Actions
    add,
    del,
    update,
    toggleComplete,
    getTodoById,

    // Lifecycle
    initializeSnapshot,
    cleanup,
  }
})
