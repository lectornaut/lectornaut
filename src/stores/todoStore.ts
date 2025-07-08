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
  const todos = useCollection<ITodo>(todoRef)

  const add = (todo: ITodo) => {
    useAddDoc(todoRef, todo)
  }

  const del = (id: string, prevDoc: ITodo) => {
    useDeleteDoc(todoRef, id, prevDoc)
  }

  const update = (id: string, todo: ITodo, prevDoc: ITodo) => {
    useUpdateDoc(todoRef, id, todo, prevDoc)
  }

  return { todos, add, del, update }
})
