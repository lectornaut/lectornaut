<script setup lang="ts">
const persons = [
  {
    name: "Tom",
    email: "t@hey.com",
    imageUrl:
      "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Whitney",
    email: "w@hey.com",
    imageUrl:
      "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Leonard",
    email: "l@hey.com",
    imageUrl:
      "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Floyd",
    email: "f@hey.com",
    imageUrl:
      "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
  },
  {
    name: "Emily",
    email: "e@hey.com",
    imageUrl:
      "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
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
        imageUrl:
          "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Whitney",
        email: "w@hey.com",
        imageUrl:
          "https://images.unsplash.com/photo-1517365830460-955ce3ccd263?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Leonard",
        email: "l@hey.com",
        imageUrl:
          "https://images.unsplash.com/photo-1519345182560-3f2917c472ef?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
    ],
  },
  {
    id: "2",
    name: "Marketing Team",
    description: "Marketing and sales team",
    members: [
      {
        name: "Floyd",
        email: "f@hey.com",
        imageUrl:
          "https://images.unsplash.com/photo-1463453091185-61582044d556?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
      {
        name: "Emily",
        email: "e@hey.com",
        imageUrl:
          "https://images.unsplash.com/photo-1502685104226-ee32379fefbe?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=facearea&facepad=2&w=256&h=256&q=80",
      },
    ],
  },
]
</script>

<template>
  <div class="grid divide-y">
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle>
            <span class="truncate"> General </span>
          </CardTitle>
          <CardDescription class="text-xs">
            Configure the general settings of the project.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-8">
          <div class="grid w-full items-center gap-4">
            <Label for="project-name"> Project name </Label>
            <Input
              id="project-name"
              type="text"
              name="project-name"
              placeholder="Name"
            />
          </div>
          <div class="grid w-full items-center gap-4">
            <Label for="project-description"> Description </Label>
            <Textarea
              id="project-description"
              name="project-description"
              placeholder="Description"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button size="sm">Save</Button>
        </CardFooter>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle>
            <span class="truncate"> Team </span>
          </CardTitle>
          <CardDescription class="text-xs">
            Manage the team members of the project.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-8">
          <div class="grid w-full items-center gap-4">
            <Label for="project-invite"> Invite people </Label>
            <div class="flex gap-2">
              <Input
                id="project-invite"
                type="text"
                name="project-invite"
                placeholder="Email"
              />
              <Button variant="outline"> Invite </Button>
            </div>
          </div>
          <div class="grid w-full items-center gap-4">
            <Label for="project-access"> People with access </Label>
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
                        class="inline-block size-8 rounded-full"
                        :src="person.imageUrl"
                        :alt="person.name"
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
                <Select default-value="edit">
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
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
                      class="inline-block size-8 rounded-full"
                      :src="person.imageUrl"
                      :alt="person.name"
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
                <Select default-value="edit">
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="edit"> Edit </SelectItem>
                    <SelectItem value="view"> View </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div class="grid w-full items-center gap-4">
            <Label for="project-sharing"> General access </Label>
            <RadioGroup
              name="sharing"
              default-value="public"
              class="grid gap-4"
            >
              <div class="flex gap-3">
                <RadioGroupItem id="public" value="public" />
                <Label for="public" class="grid gap-1">
                  <span class="truncate">Public to everyone</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    Anyone on the internet with the link can view.
                  </span>
                </Label>
              </div>
              <div class="flex gap-3">
                <RadioGroupItem id="private" value="private" />
                <Label for="private" class="grid gap-1">
                  <span class="truncate">Private to members</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    Only people in your organization can view.
                  </span>
                </Label>
              </div>
              <div class="flex gap-3">
                <RadioGroupItem id="personal" value="personal" />
                <Label for="personal" class="grid gap-1">
                  <span class="truncate">Restricted</span>
                  <span class="text-secondary-foreground/70 text-xs">
                    Only people with access can open the link.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle>
            <span class="truncate"> Notifications </span>
          </CardTitle>
          <CardDescription class="text-xs">
            Configure the notifications of the project.
          </CardDescription>
        </CardHeader>
        <CardContent class="grid gap-8">
          <div class="grid gap-6">
            <div class="flex gap-3">
              <Label for="triggers" class="grid gap-1">
                <span class="truncate">Task updates</span>
                <span class="text-secondary-foreground/70 text-xs">
                  When an automation completes, fails, or encounters an error.
                </span>
              </Label>
              <Switch id="triggers" value="triggers" />
            </div>
            <div class="flex gap-3">
              <Label for="enabled" class="grid gap-1">
                <span class="truncate">Workflow execution</span>
                <span class="text-secondary-foreground/70 text-xs">
                  Start, pause, or completion of multi-step workflows.
                </span>
              </Label>
              <Switch id="enabled" value="enabled" />
            </div>
            <div class="flex gap-3">
              <Label for="agent" class="grid gap-1">
                <span class="truncate">Agent Insights</span>
                <span class="text-secondary-foreground/70 text-xs">
                  AI-generated suggestions, optimizations, or reports.
                </span>
              </Label>
              <Switch id="agent" value="agent" />
            </div>
            <div class="flex gap-3">
              <Label for="collaboration" class="grid gap-1">
                <span class="truncate">Collaboration Alerts</span>
                <span class="text-secondary-foreground/70 text-xs">
                  When a team member assigns a task, comments, or makes updates.
                </span>
              </Label>
              <Switch id="collaboration" value="collaboration" />
            </div>
            <div class="flex gap-3">
              <Label for="security" class="grid gap-1">
                <span class="truncate">Security & Compliance</span>
                <span class="text-secondary-foreground/70 text-xs">
                  Unauthorized access attempts, unusual activity, or system
                  failures.
                </span>
              </Label>
              <Switch id="security" value="security" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    <div>
      <Card class="border-0 shadow-none">
        <CardHeader>
          <CardTitle>
            <span class="truncate"> Danger Zone </span>
          </CardTitle>
          <CardDescription class="text-xs">
            Delete the project and all its data permanently.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button variant="destructive" size="sm">Delete workflow</Button>
        </CardFooter>
      </Card>
    </div>
  </div>
</template>
