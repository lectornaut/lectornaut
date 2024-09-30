<script setup lang="ts">
useHead({
  title: "Home",
})
</script>

<template>
  <div class="no-scrollbar flex grow flex-col overflow-y-auto p-2">
    <Tabs default-value="today">
      <div class="flex items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="today"> Today </TabsTrigger>
          <TabsTrigger value="week"> Week </TabsTrigger>
          <TabsTrigger value="month"> Month </TabsTrigger>
          <TabsTrigger value="year"> Year </TabsTrigger>
        </TabsList>
        <DateRangePicker />
      </div>
      <TabsContent value="today" class="space-y-2">
        <div class="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm"> Balance </CardTitle>
              <icon-lucide-dollar-sign class="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">$45,231.89</div>
              <p class="text-xs text-muted-foreground">
                +20.1% from last month
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm"> Income </CardTitle>
              <icon-lucide-arrow-down-left class="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">$2.350</div>
              <p class="text-xs text-muted-foreground">
                +180.1% from last month
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm"> Expenses </CardTitle>
              <icon-lucide-arrow-up-right class="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">$12,234</div>
              <p class="text-xs text-muted-foreground">+19% from last month</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader
              class="flex flex-row items-center justify-between space-y-0 pb-2"
            >
              <CardTitle class="text-sm"> Transactions </CardTitle>
              <icon-lucide-arrow-left-right class="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div class="text-2xl font-bold">573</div>
              <p class="text-xs text-muted-foreground">+201 since last hour</p>
            </CardContent>
          </Card>
        </div>
        <div class="grid gap-2 md:grid-cols-4 lg:grid-cols-8">
          <Card class="md:col-span-4 lg:col-span-8">
            <CardHeader>
              <CardTitle>Overview</CardTitle>
            </CardHeader>
            <CardContent class="pl-2">
              <Overview />
            </CardContent>
          </Card>
          <Card class="md:col-span-4 lg:col-span-8">
            <CardHeader>
              <CardTitle>Recent Transactions</CardTitle>
              <CardDescription>
                You made 265 sales this month.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Recent />
            </CardContent>
          </Card>
        </div>
      </TabsContent>
      <TabsContent value="week"> Content </TabsContent>
      <TabsContent value="month"> Content </TabsContent>
      <TabsContent value="year"> Content </TabsContent>
    </Tabs>
  </div>
</template>

<route lang="json">
{
  "meta": {
    "layout": "app"
  }
}
</route>
<!-- "requiresUser": true -->
