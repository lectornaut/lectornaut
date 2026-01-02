<script lang="ts" setup>
const { t } = useI18n()

const persons = [
  {
    name: "Tom",
    email: "t@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "edit",
  },
  {
    name: "Whitney",
    email: "w@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Leonard",
    email: "l@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Floyd",
    email: "f@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
  {
    name: "Emily",
    email: "e@hey.com",
    avatar:
      "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
    role: "view",
  },
]

const teams = [
  {
    id: "1",
    name: "Senior Design Team",
    description: "Hands-on design team",
    members: [
      {
        name: "Tom",
        email: "t@hey.com",
        avatar:
          "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Whitney",
        email: "w@hey.com",
        avatar:
          "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Leonard",
        email: "l@hey.com",
        avatar:
          "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
    ],
    role: "edit",
  },
  {
    id: "2",
    name: "Marketing Team",
    description: "Marketing and sales team",
    members: [
      {
        name: "Floyd",
        email: "f@hey.com",
        avatar:
          "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Emily",
        email: "e@hey.com",
        avatar:
          "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
    ],
    role: "view",
  },
]
</script>

<template>
  <div class="grid">
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>
              <span> {{ t("components.flow.settings.general.title") }} </span>
            </CardTitle>
            <CardDescription class="text-xs">
              {{ t("components.flow.settings.general.description") }}
            </CardDescription>
          </CardHeader>
          <CardContent class="grid gap-8">
            <div class="grid w-full items-center gap-4">
              <Label for="project-name">
                {{ t("components.flow.settings.general.projectName") }}
              </Label>
              <Input
                id="project-name"
                type="text"
                name="project-name"
                :placeholder="
                  t('components.flow.settings.general.placeholders.name')
                "
              />
            </div>
            <div class="grid w-full items-center gap-4">
              <Label for="project-description">
                {{ t("components.flow.settings.general.projectDesc") }}
              </Label>
              <Textarea
                id="project-description"
                name="project-description"
                :placeholder="
                  t('components.flow.settings.general.placeholders.desc')
                "
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button size="sm">{{
              t("components.flow.settings.general.save")
            }}</Button>
          </CardFooter>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>
              <span> {{ t("components.flow.settings.team.title") }} </span>
            </CardTitle>
            <CardDescription class="text-xs">
              {{ t("components.flow.settings.team.description") }}
            </CardDescription>
          </CardHeader>
          <CardContent class="grid gap-8">
            <div class="grid w-full items-center gap-4">
              <Label for="project-invite">
                {{ t("components.flow.settings.team.invite") }}
              </Label>
              <div class="flex gap-2">
                <Input
                  id="project-invite"
                  type="text"
                  name="project-invite"
                  :placeholder="
                    t('components.flow.settings.team.emailPlaceholder')
                  "
                />
                <Button variant="outline">
                  {{ t("components.flow.settings.team.inviteButton") }}
                </Button>
              </div>
            </div>
            <div class="grid w-full items-center gap-4">
              <Label for="project-access">
                {{ t("components.flow.settings.team.peopleAccess") }}
              </Label>
              <div class="grid gap-4">
                <div
                  v-for="team in teams"
                  :key="team.id"
                  class="flex justify-between space-x-4"
                >
                  <div class="flex flex-col gap-2">
                    <div class="flex -space-x-2">
                      <Avatar
                        v-for="person in team.members"
                        :key="person.email"
                        class="ring-background ring-3"
                      >
                        <AvatarImage
                          v-if="person.avatar"
                          class="inline-block size-8 rounded-full"
                          :src="person.avatar"
                          :alt="person.name"
                          referrerpolicy="no-referrer"
                        />
                        <AvatarFallback>
                          {{ person.name[0] }}
                        </AvatarFallback>
                      </Avatar>
                    </div>
                    <div>
                      <p class="font-medium">
                        {{ team.name }}
                      </p>
                      <p class="text-muted-foreground text-xs">
                        {{ team.description }}
                      </p>
                    </div>
                  </div>
                  <Select v-model="team.role">
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="edit"> Edit </SelectItem>
                      <SelectItem value="view"> View </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div
                  v-for="person in persons"
                  :key="person.email"
                  class="flex justify-between space-x-4"
                >
                  <div class="flex flex-col gap-2">
                    <Avatar>
                      <AvatarImage
                        v-if="person.avatar"
                        class="inline-block size-8 rounded-full"
                        :src="person.avatar"
                        :alt="person.name"
                        referrerpolicy="no-referrer"
                      />
                      <AvatarFallback>
                        {{ person.name[0] }}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p class="font-medium">
                        {{ person.name }}
                      </p>
                      <p class="text-muted-foreground text-xs">
                        {{ person.email }}
                      </p>
                    </div>
                  </div>
                  <Select v-model="person.role">
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="edit"> Edit </SelectItem>
                      <SelectItem value="view"> View </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div class="grid w-full items-center gap-4">
              <Label for="project-sharing">
                {{ t("components.flow.settings.team.generalAccess") }}
              </Label>
              <RadioGroup
                name="sharing"
                default-value="public"
                class="grid gap-4"
              >
                <div class="flex gap-3">
                  <RadioGroupItem id="public" value="public" />
                  <Label for="public" class="grid gap-1">
                    <span>{{
                      t("components.flow.settings.team.access.public.label")
                    }}</span>
                    <span class="text-secondary-foreground/70 text-xs">
                      {{
                        t("components.flow.settings.team.access.public.desc")
                      }}
                    </span>
                  </Label>
                </div>
                <div class="flex gap-3">
                  <RadioGroupItem id="private" value="private" />
                  <Label for="private" class="grid gap-1">
                    <span>{{
                      t("components.flow.settings.team.access.private.label")
                    }}</span>
                    <span class="text-secondary-foreground/70 text-xs">
                      {{
                        t("components.flow.settings.team.access.private.desc")
                      }}
                    </span>
                  </Label>
                </div>
                <div class="flex gap-3">
                  <RadioGroupItem id="personal" value="personal" />
                  <Label for="personal" class="grid gap-1">
                    <span>{{
                      t("components.flow.settings.team.access.restricted.label")
                    }}</span>
                    <span class="text-secondary-foreground/70 text-xs">
                      {{
                        t(
                          "components.flow.settings.team.access.restricted.desc"
                        )
                      }}
                    </span>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>
              <span>
                {{ t("components.flow.settings.notifications.title") }}
              </span>
            </CardTitle>
            <CardDescription class="text-xs">
              {{ t("components.flow.settings.notifications.description") }}
            </CardDescription>
          </CardHeader>
          <CardContent class="grid gap-8">
            <div class="grid gap-6">
              <div class="flex gap-3">
                <Label for="triggers" class="grid gap-1">
                  <span>{{
                    t(
                      "components.flow.settings.notifications.taskUpdates.label"
                    )
                  }}</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    {{
                      t(
                        "components.flow.settings.notifications.taskUpdates.desc"
                      )
                    }}
                  </span>
                </Label>
                <Switch id="triggers" value="triggers" />
              </div>
              <div class="flex gap-3">
                <Label for="enabled" class="grid gap-1">
                  <span>{{
                    t("components.flow.settings.notifications.workflow.label")
                  }}</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    {{
                      t("components.flow.settings.notifications.workflow.desc")
                    }}
                  </span>
                </Label>
                <Switch id="enabled" value="enabled" />
              </div>
              <div class="flex gap-3">
                <Label for="agent" class="grid gap-1">
                  <span>{{
                    t("components.flow.settings.notifications.agent.label")
                  }}</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    {{ t("components.flow.settings.notifications.agent.desc") }}
                  </span>
                </Label>
                <Switch id="agent" value="agent" />
              </div>
              <div class="flex gap-3">
                <Label for="collaboration" class="grid gap-1">
                  <span>{{
                    t(
                      "components.flow.settings.notifications.collaboration.label"
                    )
                  }}</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    {{
                      t(
                        "components.flow.settings.notifications.collaboration.desc"
                      )
                    }}
                  </span>
                </Label>
                <Switch id="collaboration" value="collaboration" />
              </div>
              <div class="flex gap-3">
                <Label for="security" class="grid gap-1">
                  <span>{{
                    t("components.flow.settings.notifications.security.label")
                  }}</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    {{
                      t("components.flow.settings.notifications.security.desc")
                    }}
                  </span>
                </Label>
                <Switch id="security" value="security" />
              </div>
            </div>
          </CardContent>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
    <SidebarGroup>
      <SidebarGroupContent>
        <Card class="shadow-none">
          <CardHeader>
            <CardTitle>
              <span> {{ t("components.flow.settings.danger.title") }} </span>
            </CardTitle>
            <CardDescription class="text-xs">
              {{ t("components.flow.settings.danger.description") }}
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="destructive" size="sm">{{
              t("components.flow.settings.danger.delete")
            }}</Button>
          </CardFooter>
        </Card>
      </SidebarGroupContent>
    </SidebarGroup>
  </div>
</template>
