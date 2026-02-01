<script lang="ts" setup>
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { IWorkspace } from "@/types"
import { validateImageFile } from "@/utils/imageFile"
import { toast } from "vue-sonner"

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

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)
const {
  files,
  open: openFileDialog,
  reset,
} = useFileDialog({
  accept: "image/*",
  multiple: false,
})

watch(files, (newFiles) => {
  if (!newFiles || newFiles.length === 0) return
  const file = newFiles.item(0)
  if (!file) return
  const res = validateImageFile(file)
  if (!res.ok) {
    toast.error(res.message)
    return
  }
  // Revoke previous blob URL to avoid leaks
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  photoFile.value = file
  photoPreview.value = URL.createObjectURL(file)
})

const removePhoto = () => {
  if (photoPreview.value && photoPreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  photoFile.value = null
  photoPreview.value = null
  reset()
}

const resetForm = () => {
  if (photoPreview.value && photoPreview.value.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
  workspaceName.value = ""
  workspaceDescription.value = ""
  photoFile.value = null
  photoPreview.value = null
  reset()
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
      photoPreview.value = props.workspace.photoURL || null
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
        workspaceDescription.value || undefined,
        photoFile.value || undefined
      )
    } else if (props.mode === "edit" && props.workspace) {
      // If photoFile is set, we upload it.
      // If photoPreview is null but we had a photo, it means we removed it.
      let filePayload: File | null | undefined = undefined
      if (photoFile.value) {
        filePayload = photoFile.value
      } else if (
        props.workspace.photoURL &&
        !photoPreview.value &&
        !photoFile.value
      ) {
        filePayload = null // Signal to remove photo
      }

      await updateWorkspace(props.workspace.id, {
        name: workspaceName.value,
        description: workspaceDescription.value || null,
        photoFile: filePayload,
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
        <!-- Workspace Profile Picture -->
        <div class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <Label class="text-secondary-foreground text-xs">
              Workspace Photo
            </Label>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Avatar
                      class="size-16 rounded-md"
                      @click="
                        openFileDialog({ accept: 'image/*', multiple: false })
                      "
                    >
                      <AvatarImage
                        class="size-16 rounded-md"
                        :src="photoPreview!"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback class="size-16 rounded-md">
                        {{ getInitials(workspaceName) }}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent> Upload workspace photo </TooltipContent>
                </Tooltip>
                <Tooltip v-if="photoPreview">
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-5 rounded-full opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon-sm"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent> Remove photo </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p class="text-muted-foreground text-xs">
              {{ photoPreview ? "Click to change" : "Click to upload" }}
            </p>
          </div>
        </div>

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
            Description
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
