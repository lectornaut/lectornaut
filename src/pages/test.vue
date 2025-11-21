<script lang="ts" setup>
import { generateId } from "@/helpers/utilities"
import { useTeamStore } from "@/stores/teamStore"
import { useTodoStore } from "@/stores/todoStore"
import type { ITeam, ITodo } from "@/types"
import { Timestamp } from "firebase/firestore"

const todoStore = useTodoStore()
const teamStore = useTeamStore()

const newTodo = ref("")
const todos = computed(() => todoStore.todos)
const isTodosLoading = computed(() => todoStore.isLoading)

const newTeamName = ref("")
const teamMembers = ref<string[]>([])
const teams = computed(() => teamStore.teams)
const isTeamsLoading = computed(() => teamStore.isLoading)

const isRenameDialogOpen = ref(false)
const teamToRename = ref<ITeam | null>(null)
const renameValue = ref("")

const addTodo = () => {
  if (newTodo.value.trim() === "") return
  const todo: ITodo = {
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
  if (prevTodo) {
    todoStore.del(id, prevTodo)
  }
}

const toggleCompletion = (id: string) => {
  const todo = todos.value.find((todo) => todo.id === id)
  if (todo) {
    const prevTodo = { ...todo }
    const updates = {
      completed: !todo.completed,
      updatedAt: Timestamp.now(),
    }
    todoStore.update(id, updates, prevTodo)
  }
}

const addTeam = () => {
  if (newTeamName.value.trim() === "") return
  const team: ITeam = {
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

const openRenameDialog = (team: ITeam) => {
  teamToRename.value = team
  renameValue.value = team.name
  isRenameDialogOpen.value = true
}

const handleRenameTeam = () => {
  if (!teamToRename.value || !renameValue.value.trim()) return

  if (renameValue.value.trim() !== teamToRename.value.name) {
    const prevTeam = { ...teamToRename.value }
    const updates = {
      name: renameValue.value.trim(),
      updatedAt: Timestamp.now(),
    }
    teamStore.update(teamToRename.value.id, updates, prevTeam)
  }
  isRenameDialogOpen.value = false
}

const formatDate = (timestamp: Timestamp) => {
  if (!timestamp) return ""
  return timestamp.toDate().toLocaleString()
}
</script>

<template>
  <div class="space-y-8 p-8">
    <section class="space-y-4">
      <h2 class="text-2xl font-bold">Todos</h2>
      <div class="flex gap-2">
        <Input
          v-model="newTodo"
          type="text"
          placeholder="Add a new todo"
          @keyup.enter="addTodo"
        />
        <Button @click="addTodo">Create</Button>
      </div>
      <div v-if="isTodosLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="todo in todos"
          :key="todo.id"
          class="flex items-center justify-between rounded-lg border p-4"
        >
          <div>
            <div
              :class="{ 'text-muted-foreground line-through': todo.completed }"
            >
              {{ todo.title }}
            </div>
            <div class="text-muted-foreground text-xs">
              Created: {{ formatDate(todo.createdAt) }}
            </div>
          </div>
          <div class="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              @click="toggleCompletion(todo.id)"
            >
              {{ todo.completed ? "Undo" : "Complete" }}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              @click="deleteTodo(todo.id)"
            >
              Delete
            </Button>
          </div>
        </li>
      </ul>
    </section>

    <hr />

    <section class="space-y-4">
      <h2 class="text-2xl font-bold">Teams</h2>
      <div class="space-y-2">
        <Input v-model="newTeamName" type="text" placeholder="Team name" />
        <TagsInput v-model="teamMembers">
          <TagsInputItem v-for="item in teamMembers" :key="item" :value="item">
            <TagsInputItemText />
            <TagsInputItemDelete />
          </TagsInputItem>

          <TagsInputInput placeholder="Add member..." />
        </TagsInput>
        <Button @click="addTeam">Create Team</Button>
      </div>
      <div v-if="isTeamsLoading" class="flex justify-center py-8">
        <Spinner />
      </div>
      <ul v-else class="space-y-2">
        <li
          v-for="team in teams"
          :key="team.id"
          class="flex items-center justify-between rounded-lg border p-4"
        >
          <div>
            <div class="font-medium">{{ team.name }}</div>
            <div class="text-muted-foreground text-sm">
              Members: {{ team.members?.join(", ") }}
            </div>
            <div class="text-muted-foreground text-xs">
              Updated: {{ formatDate(team.updatedAt) }}
            </div>
          </div>
          <div class="flex gap-2">
            <Button variant="outline" size="sm" @click="openRenameDialog(team)">
              Rename
            </Button>
            <Button
              variant="destructive"
              size="sm"
              @click="deleteTeam(team.id)"
            >
              Delete
            </Button>
          </div>
        </li>
      </ul>
    </section>

    <Dialog v-model:open="isRenameDialogOpen">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename Team</DialogTitle>
        </DialogHeader>
        <div class="py-4">
          <Input
            v-model="renameValue"
            placeholder="Team name"
            @keyup.enter="handleRenameTeam"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="isRenameDialogOpen = false">
            Cancel
          </Button>
          <Button @click="handleRenameTeam">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
