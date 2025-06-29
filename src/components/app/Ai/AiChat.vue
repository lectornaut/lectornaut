<script setup lang="ts">
const messages = [
  { role: "agent", content: "Hi, how can I help you today?" },
  { role: "user", content: "Hey, I'm having trouble with my account." },
  { role: "agent", content: "What seems to be the problem?" },
  { role: "user", content: "I can't log in." },
  { role: "agent", content: "Let me check that for you." },
  { role: "user", content: "Thanks!" },
  { role: "agent", content: "You're welcome! Is there anything else?" },
  { role: "user", content: "Actually, I have another question." },
  { role: "agent", content: "Sure, what's your question?" },
  { role: "user", content: "Can you help me with my billing?" },
  { role: "agent", content: "Of course! What do you need help with?" },
  { role: "user", content: "I need to update my payment method." },
  { role: "agent", content: "No problem, I can assist you with that." },
  { role: "user", content: "Great, thank you!" },
  {
    role: "agent",
    content: "You're welcome! Let me know if you need anything else.",
  },
  { role: "user", content: "I will, thanks!" },
  { role: "agent", content: "Have a great day!" },
  { role: "user", content: "You too!" },
  { role: "agent", content: "Goodbye!" },
]
</script>

<template>
  <OverlayScrollbarsWrapper>
    <div class="flex grow flex-col overflow-auto overscroll-none">
      <div class="grid grid-cols-1 gap-4 p-4">
        <div
          v-for="(message, index) in messages"
          :key="index"
          :class="[
            'flex w-max max-w-3/4 flex-col rounded-md px-3 py-2',
            message.role === 'user'
              ? 'bg-primary text-primary-foreground ml-auto rounded-br'
              : 'bg-muted rounded-bl',
          ]"
        >
          {{ message.content }}
        </div>
      </div>
    </div>
  </OverlayScrollbarsWrapper>
</template>
