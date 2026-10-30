<script setup lang="ts">
import { ref } from "vue";
import AppSession from "./AppSession.vue";

// Dispose all account-owned data, drafts and pending reads at the session boundary.
const session = ref(0);
</script>

<template>
  <AppSession :key="session" :start-signed-out="session > 0" @session-ended="session += 1" />
</template>
