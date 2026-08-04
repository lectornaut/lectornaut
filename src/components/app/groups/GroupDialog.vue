<script lang="ts" setup>
import { usePhotoUpload } from "@/composables/usePhotoUpload"
import { IconUsers, IconX } from "@/data/icons"
import { useMembershipStore } from "@/stores/membershipStore"
import { useTeamGroupsStore } from "@/stores/teamGroupsStore"
import type { IGroup } from "@/types/domain"
import { isUserMembership, type IMembership } from "@/types/membership"
import { storeToRefs } from "pinia"
import { toast } from "vue-sonner"

const props = defineProps<{
  open?: boolean
  mode: "create" | "edit"
  group?: IGroup
}>()

const emit = defineEmits<{
  (e: "update:open", value: boolean): void
}>()

const { t } = useI18n()

const membershipStore = useMembershipStore()
const { teamMembers } = storeToRefs(membershipStore)
const groupsStore = useTeamGroupsStore()
const { usageForGroup } = storeToRefs(groupsStore)

const humanMembers = computed(() => teamMembers.value.filter(isUserMembership))

const memberLabel = (member: IMembership) =>
  member.user?.displayName || member.user?.email || member.userId

// ── Form state ────────────────────────────────────────────────────────────────
const isOpen = ref(props.open || false)
const isSaving = ref(false)
const groupName = ref("")
const groupDescription = ref("")
const selectedIds = ref<Set<string>>(new Set())
const search = ref("")

// ── Photo upload (staged; committed on Save) ─────────────────────────────────
const photoFile = ref<File | null>(null)
const photoPreview = ref<string | null>(null)
const revokeBlobUrl = () => {
  if (photoPreview.value?.startsWith("blob:")) {
    URL.revokeObjectURL(photoPreview.value)
  }
}
const groupPhotoUpload = usePhotoUpload({
  onUpload: async (_id, file) => {
    revokeBlobUrl()
    photoFile.value = file
    photoPreview.value = URL.createObjectURL(file)
  },
})
const triggerGroupPhotoSelection = () => {
  groupPhotoUpload.triggerUpload(props.group?.id || "draft-group")
}
const removePhoto = () => {
  revokeBlobUrl()
  photoFile.value = null
  photoPreview.value = null
}

const filteredMembers = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return humanMembers.value
  return humanMembers.value.filter((m) =>
    memberLabel(m).toLowerCase().includes(q)
  )
})

const isSelected = (userId: string) => selectedIds.value.has(userId)

const toggleMember = (userId: string, checked: boolean) => {
  const next = new Set(selectedIds.value)
  if (checked) next.add(userId)
  else next.delete(userId)
  selectedIds.value = next
}

const usageCount = computed(() =>
  props.mode === "edit" && props.group ? usageForGroup.value(props.group.id) : 0
)

const resetForm = () => {
  revokeBlobUrl()
  groupName.value = ""
  groupDescription.value = ""
  selectedIds.value = new Set()
  search.value = ""
  photoFile.value = null
  photoPreview.value = null
}

const initFromGroup = () => {
  if (props.mode === "edit" && props.group) {
    groupName.value = props.group.name
    groupDescription.value = props.group.description || ""
    selectedIds.value = new Set(props.group.memberIds)
    photoPreview.value = props.group.photoURL || null
  } else {
    resetForm()
  }
}

watch(
  () => props.open,
  (val) => {
    isOpen.value = val ?? false
  }
)

watch(isOpen, (val) => {
  emit("update:open", val)
  if (val) initFromGroup()
  else resetForm()
})

const handleSubmit = async () => {
  const name = groupName.value.trim()
  if (!name) return

  isSaving.value = true
  try {
    const memberIds = [...selectedIds.value]
    const description = groupDescription.value.trim() || null
    if (props.mode === "create") {
      await groupsStore.createGroup(
        name,
        memberIds,
        description,
        photoFile.value || undefined
      )
    } else if (props.group) {
      // null filePayload signals "remove the existing photo".
      let filePayload: File | null | undefined = undefined
      if (photoFile.value) {
        filePayload = photoFile.value
      } else if (props.group.photoURL && !photoPreview.value) {
        filePayload = null
      }
      await groupsStore.updateGroup(props.group.id, {
        name,
        description,
        memberIds,
        photoFile: filePayload,
      })
    }
    isOpen.value = false
  } catch (error) {
    console.error("[GroupDialog] Failed to save group", error)
    toast.error(
      t(
        props.mode === "create"
          ? "settings.groups.createError"
          : "settings.groups.updateError"
      )
    )
  } finally {
    isSaving.value = false
  }
}
</script>

<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="w-2xl max-w-fit">
      <DialogHeader>
        <DialogTitle>
          {{
            mode === "create"
              ? t("components.groupDialog.createTitle")
              : t("components.groupDialog.editTitle")
          }}
        </DialogTitle>
        <DialogDescription>
          {{
            mode === "create"
              ? t("components.groupDialog.createDescription")
              : t("components.groupDialog.editDescription")
          }}
        </DialogDescription>
      </DialogHeader>

      <div class="mt-4 grid gap-4">
        <!-- Group Photo -->
        <Field>
          <div class="flex flex-col items-center gap-2">
            <FieldLabel>
              {{ t("components.groupDialog.photoLabel") }}
            </FieldLabel>
            <div class="group relative">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <div class="bg-secondary cursor-pointer rounded-4xl p-3">
                      <AppAvatar
                        class="size-16"
                        :src="photoPreview"
                        :name="groupName"
                        @click="triggerGroupPhotoSelection"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.groupDialog.uploadPhoto") }}
                  </TooltipContent>
                </Tooltip>
                <Tooltip v-if="photoPreview">
                  <TooltipTrigger as-child>
                    <Button
                      variant="secondary"
                      class="ring-background absolute top-1 right-1 size-4 opacity-0 ring-2 transition group-hover:opacity-100"
                      size="icon"
                      @click.stop="removePhoto"
                    >
                      <IconX />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {{ t("components.groupDialog.removePhoto") }}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </Field>

        <!-- Name -->
        <Field>
          <FieldLabel for="group-name">
            {{ t("components.groupDialog.nameLabel") }}
          </FieldLabel>
          <Input
            id="group-name"
            v-model="groupName"
            :placeholder="t('components.groupDialog.namePlaceholder')"
            @keyup.enter="handleSubmit"
          />
        </Field>

        <!-- Description -->
        <Field>
          <FieldLabel for="group-description">
            {{ t("components.groupDialog.descriptionLabel") }}
          </FieldLabel>
          <Textarea
            id="group-description"
            v-model="groupDescription"
            :placeholder="t('components.groupDialog.descriptionPlaceholder')"
          />
        </Field>

        <!-- Members -->
        <Field>
          <div class="flex items-center justify-between">
            <FieldLabel>
              {{ t("components.groupDialog.membersLabel") }}
            </FieldLabel>
            <span class="text-muted-foreground text-xs">
              {{
                t("components.groupDialog.selectedCount", {
                  count: selectedIds.size,
                })
              }}
              <!-- Blast-radius cue (edit mode) -->
              <template v-if="mode === 'edit' && usageCount > 0">
                /
                {{
                  t("components.groupDialog.usedInWorkspaces", {
                    count: usageCount,
                  })
                }}
              </template>
            </span>
          </div>
          <Input
            v-model="search"
            :placeholder="t('components.groupDialog.searchPlaceholder')"
          />
          <Empty
            v-if="humanMembers.length === 0"
            class="border border-dashed p-6"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <IconUsers />
              </EmptyMedia>
              <EmptyTitle>
                {{ t("components.groupDialog.noMembers") }}
              </EmptyTitle>
            </EmptyHeader>
          </Empty>
          <ItemGroup
            class="bg-secondary max-h-56 overflow-y-auto rounded-4xl p-3"
          >
            <Item
              v-for="member in filteredMembers"
              :key="member.userId"
              class="p-0"
            >
              <ItemMedia>
                <AppAvatar
                  :src="member.user?.photoURL"
                  :name="memberLabel(member)"
                />
              </ItemMedia>
              <ItemContent>
                <ItemTitle>
                  {{ memberLabel(member) }}
                </ItemTitle>
                <ItemDescription
                  v-if="
                    member.user?.email &&
                    member.user.email !== memberLabel(member)
                  "
                  class="text-xs"
                >
                  {{ member.user.email }}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button variant="outline" size="icon" :disabled="isSaving">
                  <Checkbox
                    :model-value="isSelected(member.userId)"
                    :disabled="isSaving"
                    class="rounded border-none opacity-100! disabled:opacity-25! data-[state=checked]:bg-transparent"
                    @update:model-value="
                      (value) => toggleMember(member.userId, value === true)
                    "
                  />
                </Button>
              </ItemActions>
            </Item>
          </ItemGroup>
        </Field>
      </div>

      <DialogFooter>
        <DialogClose as-child>
          <Button variant="outline" :disabled="isSaving">
            {{ t("actions.cancel") }}
            <Kbd>Esc</Kbd>
          </Button>
        </DialogClose>
        <Button
          data-dialog-action
          :disabled="isSaving || !groupName.trim()"
          @click="handleSubmit"
        >
          <Spinner v-if="isSaving" />
          {{
            mode === "create"
              ? t("components.groupDialog.create")
              : t("components.groupDialog.saveChanges")
          }}
          <Kbd>↩</Kbd>
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
