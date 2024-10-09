<template>
  <div class="grid gap-2 md:grid-cols-2">
    <Card>
      <CardHeader>
        <CardDescription>This Week</CardDescription>
        <CardTitle>
          <div class="truncate font-geist text-2xl font-bold">
            $<AnimatedCounter :value="1329" />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>+25% from last week</CardDescription>
      </CardContent>
      <CardFooter>
        <Progress
          :model-value="25"
          aria-label="25% increase"
          class="h-2 w-full"
        />
      </CardFooter>
    </Card>
    <Card>
      <CardHeader>
        <CardDescription>This Month</CardDescription>
        <CardTitle>
          <div class="truncate font-geist text-2xl font-bold">
            $<AnimatedCounter :value="5329" />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <CardDescription>+10% from last month</CardDescription>
      </CardContent>
      <CardFooter>
        <Progress
          :model-value="12"
          aria-label="12% increase"
          class="h-2 w-full"
        />
      </CardFooter>
    </Card>
  </div>
</template>
