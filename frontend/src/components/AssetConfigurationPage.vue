<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import AssetModelSettingsPage from "./AssetModelSettingsPage.vue";
import type { AssetConfigSection } from "../router";
import type { PageContext } from "../page-context";

const props = defineProps<{ context: PageContext }>();
const route = useRoute();

const activeSection = computed<AssetConfigSection>(() => {
  if (route.query.tab === "models" && props.context.can("settings.view")) return "models";
  if (route.query.tab === "tags" && props.context.can("tags.view")) return "tags";
  if (route.query.tab === "custom-fields" && props.context.can("custom_fields.view")) return "custom-fields";
  if (props.context.can("custom_fields.view")) return "custom-fields";
  if (props.context.can("tags.view")) return "tags";
  return "models";
});

function canView(section: AssetConfigSection): boolean {
  return props.context.can(
    section === "tags" ? "tags.view" : section === "models" ? "settings.view" : "custom_fields.view",
  );
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
  <AssetModelSettingsPage
    v-else-if="activeSection === 'models' && canView('models')"
    :context="props.context"
  />
</template>
