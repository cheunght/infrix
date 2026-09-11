<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { CircleCheck, CircleClose, Delete, Edit } from "@element-plus/icons-vue";
import PageContent from "./page/PageContent.vue";
import PagedTable from "./PagedTable.vue";
import StatusTag from "./StatusTag.vue";
import TableIconButton from "./TableIconButton.vue";
import SearchableSelect, { type SearchableSelectOption } from "./SearchableSelect.vue";
import type { SettingsContext } from "../page-context";
import type { Department, Person } from "../types";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
const {
  responsibilityDirectorySubjects: subjects,
  responsibilityDirectoryTotal: total,
  responsibilityDirectoryPage: page,
  responsibilityDirectoryPageSize: pageSize,
  responsibilityDirectorySearch: search,
  responsibilityDirectoryType: departmentFilter,
  responsibilityDirectoryActive: activeFilter,
  responsibilityDirectoryLoading: loading,
  responsibilityDirectoryError: error,
  responsibilityDirectorySaving: saving,
  responsibilityDirectoryActionId: actionId,
  responsibilityDirectoryFormErrors: formErrors,
  responsibilityDirectoryForm: form,
  editingResponsibilitySubject: editingSubject,
  showResponsibilitySubjectModal: showModal,
  searchResponsibilityDirectory: searchDirectory,
  retryResponsibilityDirectory: retryDirectory,
  changeResponsibilityDirectoryPage: changePage,
  changeResponsibilityDirectoryPageSize: changePageSize,
  openResponsibilitySubjectModal: openModal,
  saveResponsibilitySubject: saveSubject,
  toggleResponsibilitySubject: toggleSubject,
  deleteResponsibilitySubject: deleteSubject,
  departmentOptions,
} = props.context;

const canManage = computed(() => props.context.can("settings.manage"));
const hasFilters = computed(() => Boolean(search.value.trim() || departmentFilter.value || activeFilter.value !== "true"));
const modalTitle = computed(() =>
  editingSubject.value ? t("settings.editPerson") : t("settings.addPerson"),
);

function mapDepartment(item: Record<string, unknown>): SearchableSelectOption {
  const department = item as unknown as Department;
  return {
    value: department.id,
    label: department.name,
    secondary: department.code || department.parent_name || "",
    data: department,
  };
}

const selectedDepartmentOption = computed<SearchableSelectOption | null>(() => {
  const department = departmentOptions.value.find((item) => String(item.id) === form.value.department);
  return department ? mapDepartment(department as unknown as Record<string, unknown>) : null;
});

function displayName(person: Person): string {
  return person.display_name || person.name || "—";
}

function accountLabel(person: Person): string {
  return person.account_username || person.account_email || t("settings.noLinkedAccount");
}

function emailLabel(person: Person): string {
  return person.email || person.account_email || "—";
}

function deleteLabel(person: Person): string {
  return person.asset_count
    ? t("settings.personInUse")
    : t("common.delete");
}

function clearFilters() {
  search.value = "";
  departmentFilter.value = "";
  activeFilter.value = "true";
  void searchDirectory();
}
</script>

<template>
  <PageContent surface class="people-settings">
    <el-alert v-if="error" :title="t('settings.peopleDataLoadFailed')" type="error" show-icon :closable="false">
      <template #default>
        <span>{{ error }}</span>
        <el-button link type="danger" :loading="loading" @click="retryDirectory">{{ t("common.retry") }}</el-button>
      </template>
    </el-alert>

    <PagedTable
      v-else
      v-model:current-page="page"
      v-model:page-size="pageSize"
      :total="total"
      :page-sizes="[20, 50, 100]"
      @update:current-page="changePage"
      @update:page-size="changePageSize"
    >
      <el-table v-loading="loading" :data="subjects" table-layout="fixed">
        <template #empty>
          <el-empty :image-size="56" :description="hasFilters ? t('settings.noMatchingPeople') : t('settings.noPeople')">
            <el-button v-if="hasFilters" link type="primary" @click="clearFilters">{{ t("common.clearFilters") }}</el-button>
          </el-empty>
        </template>
        <el-table-column :label="t('settings.personName')" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="person-name-cell">
              <strong>{{ displayName(row) }}</strong>
              <span v-if="row.employee_no" class="form-hint">{{ row.employee_no }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column :label="t('settings.personDepartment')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.department_name || "—" }}</template>
        </el-table-column>
        <el-table-column prop="organization" :label="t('settings.personOrganization')" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.organization || "—" }}</template>
        </el-table-column>
        <el-table-column prop="contact" :label="t('settings.personContact')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ row.contact || "—" }}</template>
        </el-table-column>
        <el-table-column :label="t('settings.personEmail')" min-width="210" show-overflow-tooltip>
          <template #default="{ row }">{{ emailLabel(row) }}</template>
        </el-table-column>
        <el-table-column :label="t('settings.personAccount')" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">{{ accountLabel(row) }}</template>
        </el-table-column>
        <el-table-column prop="asset_count" :label="t('settings.personAssets')" width="90">
          <template #default="{ row }">{{ row.asset_count || 0 }}</template>
        </el-table-column>
        <el-table-column :label="t('common.status')" width="112">
          <template #default="{ row }">
            <StatusTag :tone="row.is_active ? 'success' : 'info'" :label="row.is_active ? t('status.active') : t('status.inactive')" />
          </template>
        </el-table-column>
        <el-table-column v-if="canManage" :label="t('common.operation')" width="132" fixed="right">
          <template #default="{ row }">
            <div class="ep-table-actions">
              <TableIconButton :icon="Edit" :label="t('common.edit')" type="primary" :disabled="actionId === row.id || saving" @click="openModal(row)" />
              <TableIconButton
                :icon="row.is_active ? CircleClose : CircleCheck"
                :label="row.is_active ? t('settings.personDisable') : t('settings.personEnable')"
                :disabled="actionId === row.id || saving"
                @click="toggleSubject(row)"
              />
              <TableIconButton :icon="Delete" :label="deleteLabel(row)" type="danger" :disabled="actionId === row.id || saving || Boolean(row.asset_count)" @click="deleteSubject(row)" />
            </div>
          </template>
        </el-table-column>
      </el-table>
    </PagedTable>

    <el-dialog v-model="showModal" class="form-dialog person-dialog" width="560px" :close-on-click-modal="!saving" :close-on-press-escape="!saving" :show-close="!saving">
      <template #header>
        <div class="form-dialog__header">
          <div class="form-dialog__heading">
            <span class="el-dialog__title">{{ modalTitle }}</span>
            <p class="form-dialog__description">{{ t("settings.personFormHint") }}</p>
          </div>
        </div>
      </template>
      <el-form label-position="top" @submit.prevent="saveSubject">
        <el-form-item :label="t('settings.personName')" required :error="formErrors.name">
          <el-input v-model="form.name" maxlength="160" show-word-limit :disabled="saving" autocomplete="off" />
        </el-form-item>
        <el-form-item :label="t('settings.personEmployeeNo')" :error="formErrors.employee_no">
          <el-input v-model="form.employee_no" maxlength="80" :disabled="saving" autocomplete="off" />
        </el-form-item>
        <el-form-item :label="t('settings.personDepartment')" :error="formErrors.department">
          <SearchableSelect
            v-model="form.department"
            :request="props.context.request"
            endpoint="/departments/"
            :map-option="mapDepartment"
            :selected-option="selectedDepartmentOption"
            :disabled="saving"
            :placeholder="t('settings.personDepartment')"
          />
        </el-form-item>
        <el-form-item :label="t('settings.personEmail')" :error="formErrors.email">
          <el-input v-model="form.email" type="email" maxlength="254" :disabled="saving" autocomplete="email" :placeholder="t('settings.personEmailPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('settings.personOrganization')" :error="formErrors.organization">
          <el-input v-model="form.organization" maxlength="160" :disabled="saving" autocomplete="organization" />
        </el-form-item>
        <el-form-item :label="t('settings.personContact')" :error="formErrors.contact">
          <el-input v-model="form.contact" maxlength="160" :disabled="saving" autocomplete="tel" />
        </el-form-item>
        <el-form-item :label="t('common.status')" :error="formErrors.is_active">
          <el-switch v-model="form.is_active" :active-text="t('status.active')" :inactive-text="t('status.inactive')" :disabled="saving" />
        </el-form-item>
        <div class="form-dialog__actions">
          <el-button :disabled="saving" @click="showModal = false">{{ t("common.cancel") }}</el-button>
          <el-button type="primary" native-type="submit" :loading="saving" :disabled="saving">{{ t("common.save") }}</el-button>
        </div>
      </el-form>
    </el-dialog>
  </PageContent>
</template>

<style scoped>
.person-name-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.person-name-cell strong,
.person-name-cell .form-hint {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.person-dialog :deep(.el-dialog__body) {
  padding-top: 8px;
}

.person-dialog :deep(.el-select),
.person-dialog :deep(.el-input) {
  width: 100%;
}

.form-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
