<script lang="ts" setup>
import { generateId } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import { useTodoStore } from "@/stores/todoStore"
import { Timestamp } from "firebase/firestore"

const todoStore = useTodoStore()
const teamStore = useTeamStore()

const newTodo = ref("")
const todos = computed(() => todoStore.todos)

const newTeamName = ref("")
const teamMembers = ref<string[]>([])
const teams = computed(() => teamStore.teams)

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

const addTeam = () => {
  if (newTeamName.value.trim() === "") return
  const team = {
    id: generateId(),
    name: newTeamName.value,
    members: teamMembers.value,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }
  teamStore.add(team)
  newTeamName.value = ""
  teamMembers.value = []
}

const deleteTeam = (id: string) => {
  const prevTeam = teams.value.find((t) => t.id === id)
  if (prevTeam) teamStore.del(id, prevTeam)
}

const renameTeam = (id: string) => {
  const team = teams.value.find((t) => t.id === id)
  if (!team) return
  const name = window.prompt("New team name", team.name)
  if (name && name.trim() && name !== team.name) {
    const prevTeam = { ...team }
    team.name = name.trim()
    team.updatedAt = Timestamp.now()
    teamStore.update(id, team, prevTeam)
  }
}
</script>

<template>
  <div>
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

    <hr />

    <h2>Teams</h2>
    <input v-model="newTeamName" type="text" placeholder="Team name" />
    <TagsInput v-model="teamMembers">
      <TagsInputItem v-for="item in teamMembers" :key="item" :value="item">
        <TagsInputItemText />
        <TagsInputItemDelete />
      </TagsInputItem>

      <TagsInputInput placeholder="Add member..." />
    </TagsInput>
    <button @click="addTeam">Create Team</button>
    <ul>
      <li v-for="team in teams" :key="team.id">
        {{ team.id }}
        <br />
        {{ team.name }}
        <br />
        Members: {{ team.members?.join(", ") }}
        <br />
        <button @click="renameTeam(team.id)">Rename</button>
        <br />
        <button @click="deleteTeam(team.id)">Delete</button>
        <br />
        {{ team.createdAt }}
        <br />
        {{ team.updatedAt }}
        <br />
      </li>
    </ul>
  </div>
</template>

<style scoped>
* {
  border: 1px solid #f00;
}
</style>
