import {
  useAddDoc,
  useDeleteDoc,
  useUpdateDoc,
} from "@/composables/useFirestore"
import { firestore } from "@/modules/firebase"
import type { ITodo } from "@/types"
import { collection } from "firebase/firestore"
import { defineStore } from "pinia"
import { useCollection } from "vuefire"

const todoRef = collection(firestore, "todos")

export const useTodoStore = defineStore("todos", () => {
  const { data: todos, pending: isLoading } = useCollection<ITodo>(todoRef)

  const add = (todo: ITodo) => {
    useAddDoc<ITodo>(todoRef, todo)
  }

  const del = (id: string, prevDoc: ITodo) => {
    useDeleteDoc<ITodo>(todoRef, id, prevDoc)
  }

  const update = (id: string, todo: Partial<ITodo>, prevDoc: ITodo) => {
    useUpdateDoc<ITodo>(todoRef, id, todo, prevDoc)
  }

  return { todos, isLoading, add, del, update }
})
