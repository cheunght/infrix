<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import type { AssetConfigSection } from "../router";
import type { PageContext } from "../page-context";

const props = defineProps<{ context: PageContext }>();
const route = useRoute();

const activeSection = computed<AssetConfigSection>(() =>
  route.query.tab === "tags"
    ? "tags"
    : route.query.tab === "custom-fields" || props.context.can("custom_fields.view")
      ? "custom-fields"
      : "tags",
);

function canView(section: AssetConfigSection): boolean {
  return props.context.can(section === "tags" ? "tags.view" : "custom_fields.view");
}
</script>

<template>
  <CustomFieldSettingsPage
    v-if="activeSection === 'custom-fields' && canView('custom-fields')"
    :context="props.context"
  />
  <TagSettingsPage
    v-else-if="activeSection === 'tags' && canView('tags')"
    :context="props.context"
  />
</template>
