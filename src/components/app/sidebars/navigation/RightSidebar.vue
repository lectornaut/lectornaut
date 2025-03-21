<template>
  <Sidebar>
    <Sidebar collapsible="none" class="shrink-0">
      <Tabs default-value="details">
        <SidebarHeader class="p-4">
          <div class="text-foreground text-base font-medium">Information</div>
        </SidebarHeader>
        <Separator />
        <SidebarHeader>
          <TabsList class="bg-background w-full p-0">
            <TabsTrigger
              class="text-muted-foreground/50 data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
              value="details"
            >
              <span class="flex items-center justify-center gap-2">
                <!-- <icon-lucide-workflow /> -->
                Details
              </span>
            </TabsTrigger>
            <TabsTrigger
              class="text-muted-foreground/50 data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
              value="activity"
            >
              <span class="flex items-center justify-center gap-2">
                <!-- <icon-lucide-activity /> -->
                Activity
              </span>
            </TabsTrigger>
            <TabsTrigger
              class="text-muted-foreground/50 data-[state=active]:after:bg-primary relative w-full rounded-md py-2.5 data-[state=active]:z-10 data-[state=active]:shadow-none data-[state=active]:after:absolute data-[state=active]:after:-bottom-2 data-[state=active]:after:h-0.5 data-[state=active]:after:w-full"
              value="settings"
            >
              <span class="flex items-center justify-center gap-2">
                <!-- <icon-lucide-settings /> -->
                Settings
              </span>
            </TabsTrigger>
          </TabsList>
        </SidebarHeader>
        <Separator />
        <SidebarContent class="flex flex-col gap-4 p-2">
          <OverlayScrollbarsComponent
            defer
            :options="{ scrollbars: { autoHide: 'scroll' } }"
          >
            <TabsContent value="details">
              <pre>
Metrics
---
Period: 2021-09-01 - 2021-09-30
---
Usage
---
Total minutes [PLUG]
24
Total minutes across all workflows in this organization for current month
---
Total job runs
12
Total job runs across all workflows in this organization for current month
---
Performance
---
Avg job run time
1m 19s
Average run time of jobs in this organization for current month
---
Avg job queue time [PLUG]
4s
Average queue time of jobs in this organization for current month
---
Job failure rate
100%
Failure rate across jobs in this organization for current month
---
Failed job usage
24
Total minutes used across failed jobs in this organization for current month
</pre
              >
            </TabsContent>
            <TabsContent value="activity">
              <pre>
Activity
---
queued
in progress
waiting
completed
neutral
success
failure
cancelled
action required
timed out
skipped
stale
---
3 days ago
3m 15s
---
Old logs [PLUG]
</pre
              >
            </TabsContent>
            <TabsContent value="settings">
              <pre>
Settings
---
General
---
Name
Description
---
Collaborators [PLUG]
---
Add collaborator
---
Notifications
---
Artifact and log retention [PLUG]
---
</pre
              >
            </TabsContent>
          </OverlayScrollbarsComponent>
        </SidebarContent>
      </Tabs>
    </Sidebar>
    <SidebarRail />
  </Sidebar>
</template>
