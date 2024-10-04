<template>
  <Tabs default-value="today">
    <TabsList class="gap-1">
      <div class="truncate">
        <TabsTrigger value="today"> Today </TabsTrigger>
        <TabsTrigger value="week"> Week </TabsTrigger>
        <TabsTrigger value="month"> Month </TabsTrigger>
        <TabsTrigger value="year"> Year </TabsTrigger>
      </div>
      <DateRangePicker />
    </TabsList>
  </Tabs>
</template>
