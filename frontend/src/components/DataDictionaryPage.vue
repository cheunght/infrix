<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import type { FormInstance, FormRules } from "element-plus";
import PagedTable from "./PagedTable.vue";
import SearchField from "./SearchField.vue";
import PageContainer from "./page/PageContainer.vue";
import PageContent from "./page/PageContent.vue";
import PageTabs, { type PageTabItem } from "./page/PageTabs.vue";
import PageToolbar from "./page/PageToolbar.vue";
import StatusTag from "./StatusTag.vue";
import TableIconButton from "./TableIconButton.vue";
import FormDialogShell from "./FormDialogShell.vue";
import FieldHelp from "./FieldHelp.vue";
import type { SettingsContext } from "../page-context";
import { useDataDictionary } from "../composables/useDataDictionary";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const context = props.context;
const dictionary = useDataDictionary({
  request: context.request,
  confirmAction: context.confirmAction,
  can: context.can,
  actionMessage: context.actionMessage,
  actionMessageType: context.actionMessageType,
});
const {
  dictionarySection,
  dictionaryPage,
  dictionaryPageSize,
  dictionarySearch,
  dictionaryCount,
  dictionaryLoading,
  dictionaryError,
  dictionarySaving,
  dictionaryActionId,
  dictionaryFormErrors,
  showDictionaryModal,
  editingDictionary,
  dictionaryForm,
  currentDictionaryItems,
  canView,
  canManage,
  loadDictionaries,
  retryDictionaries,
  changeDictionarySection,
  searchDictionaries,
  changeDictionaryPage,
  changeDictionaryPageSize,
  dictionaryItemUsed,
  openDictionaryModal,
  closeDictionaryModal,
  saveDictionary,
  toggleDictionary,
  deleteDictionary,
} = dictionary;

const dictionaryTabs = computed<PageTabItem[]>(() => [
  { label: t("settings.manufacturersTab"), value: "manufacturers" },
  { label: t("settings.spareCategoriesTab"), value: "spare-categories" },
]);
const dictionaryPrimaryLabel = computed(() =>
  dictionarySection.value === "manufacturers"
    ? t("settings.addManufacturer")
    : t("settings.addType"),
);
const localizedDictionaryLabel = computed(() =>
  dictionarySection.value === "manufacturers"
    ? t("settings.manufacturer")
    : t("settings.spareCategory"),
);
const dictionaryAttributeLabel = computed(() =>
  dictionarySection.value === "manufacturers"
    ? t("settings.manufacturerCode")
    : t("settings.typeCode"),
);
const dictionaryCountLabel = computed(() =>
  dictionarySection.value === "manufacturers"
    ? t("settings.assetCount")
    : t("settings.spareCount"),
);
const hasDictionaryFilters = computed(() => Boolean(dictionarySearch.value.trim()));
const formRef = ref<FormInstance>();
const dictionaryFormRules = computed<FormRules>(() => ({
  name: [
    { required: true, whitespace: true, message: t("overlay.enterName"), trigger: "blur" },
    { max: 120, message: t("overlay.nameMax"), trigger: "blur" },
  ],
  code: dictionarySection.value === "manufacturers"
    ? [{ max: 80, message: t("overlay.manufacturerCodeMax"), trigger: "blur" }]
    : [
        { required: true, whitespace: true, message: t("overlay.enterSpareCategoryCode"), trigger: "blur" },
        { max: 80, message: t("overlay.spareCategoryCodeMax"), trigger: "blur" },
      ],
}));

function normalizeRouteSection(value: unknown) {
  return value === "spare-categories" ? "spare-categories" : "manufacturers";
}

function syncRouteSection() {
  if (route.query.tab === "device-types") {
    void router.replace({ name: "asset-configuration", query: { tab: "device-types" } });
    return;
  }
  const section = normalizeRouteSection(route.query.tab);
  if (section !== dictionarySection.value) {
    void changeDictionarySection(section);
  }
}

function updateRouteSection(value: string) {
  if (value !== "manufacturers" && value !== "spare-categories") return;
  void changeDictionarySection(value);
  void router.replace({
    query: { ...route.query, tab: value },
  });
}

function clearDictionarySearch() {
  dictionarySearch.value = "";
  return searchDictionaries();
}

async function submitDictionary() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (valid !== true) return;
  await saveDictionary();
}

watch(() => route.query.tab, syncRouteSection, { immediate: true });
onMounted(() => {
  if (!dictionaryLoading.value && canView()) void loadDictionaries();
});
</script>

<template>
  <PageContainer>
    <template #subnav>
      <PageTabs
        v-model="dictionarySection"
        :items="dictionaryTabs"
        @update:model-value="updateRouteSection"
      />
    </template>
    <PageContent surface>
      <PageToolbar class="settings-list-toolbar">
        <template #search>
          <SearchField
            v-model="dictionarySearch"
            :loading="dictionaryLoading"
            :placeholder="t('settings.searchDictionary', { item: localizedDictionaryLabel })"
            :aria-label="t('settings.searchDictionary', { item: localizedDictionaryLabel })"
            @search="searchDictionaries"
          />
        </template>
        <template #primary>
          <el-button
            v-if="canManage()"
            class="page-primary-action"
            type="primary"
            :loading="dictionarySaving"
            :disabled="dictionarySaving"
            @click="openDictionaryModal()"
          >
            {{ dictionaryPrimaryLabel }}
          </el-button>
        </template>
      </PageToolbar>

      <el-alert v-if="dictionaryError" :title="t('settings.dictionaryLoadFailed')" type="error" show-icon :closable="false">
        <template #default>
          <span>{{ dictionaryError }}</span>
          <el-button link type="danger" :loading="dictionaryLoading" @click="retryDictionaries">
            {{ t("common.retry") }}
          </el-button>
        </template>
      </el-alert>

      <PagedTable
        v-else
        v-model:current-page="dictionaryPage"
        v-model:page-size="dictionaryPageSize"
        :total="dictionaryCount"
        @update:current-page="changeDictionaryPage"
        @update:page-size="changeDictionaryPageSize"
      >
        <el-table
          :key="`dictionary-table-${dictionarySection}`"
          class="settings-dictionary-table"
          v-loading="dictionaryLoading"
          :data="currentDictionaryItems"
          table-layout="fixed"
        >
          <template #empty>
            <el-empty
              :image-size="56"
              :description="hasDictionaryFilters ? t('settings.noMatchingDictionary', { item: localizedDictionaryLabel }) : t('settings.noDictionary', { item: localizedDictionaryLabel })"
            >
              <el-button v-if="hasDictionaryFilters" link type="primary" @click="clearDictionarySearch">
                {{ t("common.clearFilters") }}
              </el-button>
            </el-empty>
          </template>
          <el-table-column prop="name" :label="localizedDictionaryLabel" min-width="220" />
          <el-table-column :label="dictionaryAttributeLabel" width="160">
            <template #default="{ row }">{{ row.code || "—" }}</template>
          </el-table-column>
          <el-table-column :label="t('common.status')" width="100">
            <template #default="{ row }">
              <StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" />
            </template>
          </el-table-column>
          <el-table-column :label="dictionaryCountLabel" width="110">
            <template #default="{ row }">
              {{ dictionarySection === "manufacturers" ? (row.assets_count || 0) : (row.spare_parts_count || 0) }}
            </template>
          </el-table-column>
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="licenses_count" :label="t('settings.licenseCount')" width="110" />
          <el-table-column v-if="dictionarySection === 'manufacturers'" prop="spare_parts_count" :label="t('settings.spareCount')" width="110" />
          <el-table-column v-if="canManage()" :label="t('common.operation')" width="116" fixed="right">
            <template #default="{ row }">
              <div class="ep-table-actions">
                <el-button-group>
                  <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="dictionaryActionId === row.id" @click="openDictionaryModal(row)" />
                  <TableIconButton :icon="row.is_active ? CircleClose : CircleCheck" :label="row.is_active ? t('status.inactive') : t('status.active')" :disabled="dictionaryActionId === row.id" @click="toggleDictionary(row)" />
                  <TableIconButton :icon="Delete" :label="t('common.delete')" type="danger" :disabled="dictionaryActionId === row.id || dictionaryItemUsed(row)" @click="deleteDictionary(row)" />
                </el-button-group>
              </div>
            </template>
          </el-table-column>
        </el-table>
      </PagedTable>
    </PageContent>
  </PageContainer>

  <FormDialogShell
    v-model="showDictionaryModal"
    :title="`${editingDictionary ? t('common.edit') : t('common.add')}${localizedDictionaryLabel}`"
    :description="dictionarySection === 'manufacturers' ? '' : t('overlay.dictionaryDialogDescription')"
    size="small"
    :saving="dictionarySaving"
    :show-close="!dictionarySaving"
    :close-on-click-modal="!dictionarySaving"
    :close-on-press-escape="!dictionarySaving"
    :close-disabled="dictionarySaving"
  >
    <el-form ref="formRef" class="horizontal-form" :model="dictionaryForm" :rules="dictionaryFormRules" label-position="right" :validate-on-rule-change="false" @submit.prevent="submitDictionary">
      <section class="form-dialog__section">
        <h3 class="form-dialog__section-title">{{ t("overlay.basicInformation") }}</h3>
        <div class="horizontal-form__rows">
          <el-form-item :label="`${localizedDictionaryLabel}${t('overlay.nameSuffix')}`" prop="name" required :error="dictionaryFormErrors.name">
            <el-input v-model="dictionaryForm.name" maxlength="120" />
          </el-form-item>
          <el-form-item :label="dictionaryAttributeLabel" prop="code" :error="dictionaryFormErrors.code">
            <el-input v-model="dictionaryForm.code" maxlength="80" />
          </el-form-item>
          <el-form-item :label="t('common.status')">
            <el-select v-model="dictionaryForm.is_active" :aria-label="t('common.status')">
              <el-option :label="t('status.active')" :value="true" />
              <el-option :label="t('status.inactive')" :value="false" />
            </el-select>
            <FieldHelp :text="t('overlay.dictionaryStatusHelp')" />
          </el-form-item>
        </div>
      </section>
    </el-form>
    <template #footer>
      <el-button :disabled="dictionarySaving" @click="closeDictionaryModal">{{ t("common.cancel") }}</el-button>
      <el-button type="primary" :loading="dictionarySaving" :disabled="dictionarySaving" @click="submitDictionary">
        {{ editingDictionary ? t("common.save") : t("common.create") }}
      </el-button>
    </template>
  </FormDialogShell>
</template>
