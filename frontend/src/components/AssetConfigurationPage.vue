<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import CustomFieldSettingsPage from "./CustomFieldSettingsPage.vue";
import TagSettingsPage from "./TagSettingsPage.vue";
import AssetModelSettingsPage from "./AssetModelSettingsPage.vue";
import DeviceTypeSettingsPage from "./DeviceTypeSettingsPage.vue";
import CustomFieldSetSettingsPage from "./CustomFieldSetSettingsPage.vue";
import type { AssetConfigSection } from "../router";
import type { PageContext } from "../page-context";

const props = defineProps<{ context: PageContext }>();
const route = useRoute();

const activeSection = computed<AssetConfigSection>(() => {
  if (route.query.tab === "models" && props.context.can("settings.view")) return "models";
  if (route.query.tab === "device-types" && props.context.can("settings.view")) return "device-types";
  if (route.query.tab === "fieldsets" && props.context.can("custom_fields.view")) return "fieldsets";
  if (route.query.tab === "tags" && props.context.can("tags.view")) return "tags";
  if (route.query.tab === "custom-fields" && props.context.can("custom_fields.view")) return "custom-fields";
  if (props.context.can("settings.view")) return "models";
  if (props.context.can("custom_fields.view")) return "fieldsets";
  if (props.context.can("tags.view")) return "tags";
  return "models";
});

function canView(section: AssetConfigSection): boolean {
  return props.context.can(
    section === "tags" || section === "device-types" ? (section === "tags" ? "tags.view" : "settings.view") : section === "models" ? "settings.view" : "custom_fields.view",
  );
}
</script>

<template>
  <CustomFieldSettingsPage
    v-if="activeSection === 'custom-fields' && canView('custom-fields')"
    :context="props.context"
  />
  <CustomFieldSetSettingsPage
    v-else-if="activeSection === 'fieldsets' && canView('fieldsets')"
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
  <DeviceTypeSettingsPage
    v-else-if="activeSection === 'device-types' && canView('device-types')"
    :context="props.context"
  />
</template>
