<template>
  <input v-model="newTodo" type="text" placeholder="Add a new todo" />
  <button @click="addTodo">Create</button>
  <ul>
    <li v-for="todo in todos" :key="todo.id">
      {{ todo.id }}
      <br />
      {{ todo.title }}
      <br />
      <button @click="toggleCompletion(todo.id)">
        {{ todo.completed ? "Undo" : "Complete" }}
      </button>
      <br />
      <button @click="deleteTodo(todo.id)">Delete</button>
      <br />
      {{ todo.createdAt }}
      <br />
      {{ todo.updatedAt }}
      <br />
    </li>
  </ul>
</template>

<script setup lang="ts">
import { generateId } from "@/helpers/utilities"
import { useTodoStore } from "@/stores/todoStore"
import { Timestamp } from "firebase/firestore"

const todoStore = useTodoStore()

const newTodo = ref("")
const todos = computed(() => todoStore.todos)

const addTodo = () => {
  if (newTodo.value.trim() === "") return
  const todo = {
    id: generateId(),
    title: newTodo.value,
    completed: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }
  todoStore.add(todo)
  newTodo.value = ""
}

const deleteTodo = (id: string) => {
  const prevTodo = todos.value.find((todo) => todo.id === id)
  todoStore.del(id, prevTodo!)
}

const toggleCompletion = (id: string) => {
  const todo = todos.value.find((todo) => todo.id === id)
  if (todo) {
    const prevTodo = { ...todo }
    todo.completed = !todo.completed
    todo.updatedAt = Timestamp.now()
    todoStore.update(id, todo, prevTodo)
  }
}
</script>

<style scoped>
* {
  border: 1px solid #f00;
}
</style>
