<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { useWorkspaceActions } from "@/composables/useWorkspaceActions"
import { IconX } from "@/data/icons"
import { getInitials } from "@/helpers/utilities"
import type { IWorkspace } from "@/types/domain"
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
const {
  createWorkspace,
  updateWorkspace,
  canCreateWorkspace,
  getCannotCreateWorkspaceReason,
  canUpdateWorkspace,
  getCannotUpdateWorkspaceReason,
} = useWorkspaceActions()

const isOpen = ref(props.open || false)
const isLoading = ref(false)

// Form State
const workspaceName = ref("")
const workspaceDescription = ref("")

// Photo Upload State
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}

const workspacePhotoUpload = usePhotoUpload({
  canUpload: () =>
    (props.mode === "create" && canCreateWorkspace.value) ||
    (props.mode === "edit" && canUpdateWorkspace.value),
  onUpload: async (_id, file) => {
    revokeBlobUrl()
    photoFile.value = file
    photoPreview.value = URL.createObjectURL(file)
  },
})

const triggerWorkspacePhotoSelection = () => {
  if (
    (props.mode === "create" && !canCreateWorkspace.value) ||
    (props.mode === "edit" && !canUpdateWorkspace.value)
  ) {
    return
  }
  workspacePhotoUpload.triggerUpload(props.workspace?.id || "draft-workspace")
}

const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
}

const resetForm = () => {
  revokeBlobUrl()
  workspaceName.value = ""
  workspaceDescription.value = ""
  photoFile.value = null
  photoPreview.value = null
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

  if (props.mode === "create" && !canCreateWorkspace.value) {
    toast.error(t(getCannotCreateWorkspaceReason.value || ""))
    return
  }

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
          {{
            mode === "create"
              ? t("components.workspaceDialog.createTitle")
              : t("components.workspaceDialog.editTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? t("components.workspaceDialog.createDescription")
              : t("components.workspaceDialog.editDescription")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Workspace Profile Picture -->
        <Field class="grid gap-2">
          <div class="flex flex-col items-center gap-2">
            <FieldLabel class="text-secondary-foreground text-xs">
              {{ t("components.workspaceDialog.photoLabel") }}
            </FieldLabel>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div
                      :class="{
                        'cursor-not-allowed opacity-50':
                          (!canCreateWorkspace && mode === 'create') ||
                          (!canUpdateWorkspace && mode === 'edit'),
                      }"
                    >
                      <Avatar
                        class="size-16"
                        :class="{
                          'cursor-pointer':
                            (canCreateWorkspace && mode === 'create') ||
                            (canUpdateWorkspace && mode === 'edit'),
                        }"
                        @click="triggerWorkspacePhotoSelection"
                      >
                        <AvatarImage
                          class="size-16"
                          :src="photoPreview!"
                          referrerpolicy="no-referrer"
                        />
                        <AvatarFallback class="size-16">
                          {{ getInitials(workspaceName) }}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent
                    v-if="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canUpdateWorkspace && mode === 'edit')
                    "
                  >
                    {{
                      mode === "create"
                        ? t(getCannotCreateWorkspaceReason || "")
                        : t(getCannotUpdateWorkspaceReason || "")
                    }}
                  </TooltipContent>
                  <TooltipContent v-else>
                    {{ t("components.workspaceDialog.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip
                  v-if="
                    photoPreview &&
                    ((canCreateWorkspace && mode === 'create') ||
                      (canUpdateWorkspace && mode === 'edit'))
                  "
                >
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute -top-2 -right-2 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.workspaceDialog.removePhoto") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <p>
              {{
                photoPreview
                  ? t("components.workspaceDialog.clickToChange")
                  : t("components.workspaceDialog.clickToUpload")
              }}
            </p>
          </div>
        </Field>

        <!-- Workspace Name -->
        <Field class="grid gap-2">
          <FieldLabel class="text-secondary-foreground text-xs" for="name">
            {{ t("components.workspaceDialog.nameLabel") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Input
                    id="name"
                    v-model="workspaceName"
                    :placeholder="
                      t('components.workspaceDialog.namePlaceholder')
                    "
                    :disabled="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canUpdateWorkspace && mode === 'edit')
                    "
                    @keyup.enter="handleSubmit"
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                v-if="
                  (!canCreateWorkspace && mode === 'create') ||
                  (!canUpdateWorkspace && mode === 'edit')
                "
              >
                {{
                  mode === "create"
                    ? t(getCannotCreateWorkspaceReason || "")
                    : t(getCannotUpdateWorkspaceReason || "")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>

        <!-- Workspace Description -->
        <Field class="grid gap-2">
          <FieldLabel
            class="text-secondary-foreground text-xs"
            for="description"
          >
            {{ t("components.workspaceDialog.descriptionLabel") }}
          </FieldLabel>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger as-child>
                <div>
                  <Textarea
                    id="description"
                    v-model="workspaceDescription"
                    :placeholder="
                      t('components.workspaceDialog.descriptionPlaceholder')
                    "
                    :disabled="
                      (!canCreateWorkspace && mode === 'create') ||
                      (!canUpdateWorkspace && mode === 'edit')
                    "
                  />
                </div>
              </TooltipTrigger>
              <TooltipContent
                v-if="
                  (!canCreateWorkspace && mode === 'create') ||
                  (!canUpdateWorkspace && mode === 'edit')
                "
              >
                {{
                  mode === "create"
                    ? t(getCannotCreateWorkspaceReason || "")
                    : t(getCannotUpdateWorkspaceReason || "")
                }}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="ghost" :disabled="isLoading">
            {{ t("common.actions.cancel") }}
          </Button>
        </DialogClose>
        <Button
          :disabled="isLoading || (!canUpdateWorkspace && mode === 'edit')"
          @click="handleSubmit"
        >
          <Spinner v-if="isLoading" />
          {{
            mode === "create"
              ? t("components.workspaceDialog.createTitle")
              : t("components.workspaceDialog.saveChanges")
          }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
