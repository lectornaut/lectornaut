<script lang="ts" setup>
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import type { IWorkspace } from "@/types"

const props = defineProps<{
  open?: boolean
  mode: "create" | "edit"
  workspace?: IWorkspace
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
  (e: "success"): void
}>()

const { t } = useI18n()
const { createWorkspace, updateWorkspace } = useWorkspaceActions()

const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const workspaceName = ref("")
const workspaceDescription = ref("")

const resetForm = () => {
  workspaceName.value = ""
  workspaceDescription.value = ""
}

// Sync internal open state with prop
watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

watch(isOpen, (val) => {
  emit("update:open", val)
  if (!val) {
    resetForm()
  } else {
    // Initialize form when opened
    if (props.mode === "edit" && props.workspace) {
      workspaceName.value = props.workspace.name
      workspaceDescription.value = props.workspace.description || ""
    }
  }
})

const handleSubmit = async () => {
  if (!workspaceName.value.trim()) return

  isLoading.value = true
  try {
    if (props.mode === "create") {
      await createWorkspace(
        workspaceName.value,
        workspaceDescription.value || undefined
      )
    } else if (props.mode === "edit" && props.workspace) {
      await updateWorkspace(props.workspace.id, {
        name: workspaceName.value,
        description: workspaceDescription.value || null,
      })
    }

    emit("success")
    isOpen.value = false
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogTrigger as-child>
      <slot name="trigger" />
    </DialogTrigger>
    <DialogContent class="w-md max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{ mode === "create" ? "Create Workspace" : "Edit Workspace" }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? "Create a new workspace to organize your content within this team."
              : "Update workspace details."
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Workspace Name -->
        <Field>
          <FieldLabel class="text-secondary-foreground text-xs" for="name">
            Workspace Name
          </FieldLabel>
          <Input
            id="name"
            v-model="workspaceName"
            placeholder="My Workspace"
            @keyup.enter="handleSubmit"
          />
        </Field>

        <!-- Workspace Description -->
        <Field>
          <FieldLabel
            class="text-secondary-foreground text-xs"
            for="description"
          >
            Description (Optional)
          </FieldLabel>
          <Textarea
            id="description"
            v-model="workspaceDescription"
            placeholder="A brief description of this workspace..."
            rows="3"
          />
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline">{{ t("actions.cancel") }}</Button>
        </DialogClose>
        <Button
          :disabled="isLoading || !workspaceName.trim()"
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{ mode === "create" ? "Create Workspace" : "Save Changes" }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
