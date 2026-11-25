<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetModelImportPreview, DepartmentImportPreview, PeopleImportPreview } from "../types";
import { copyImportReviewErrors, downloadImportReviewErrors, importReviewValue, normalizeImportReviewErrors, type ImportReviewGroup, type ImportReviewOperation, type ImportReviewRow } from "../import-review";
import ImportReviewTable from "./ImportReviewTable.vue";

const props = defineProps<{
  kind: "model" | "department" | "people";
  preview: AssetModelImportPreview | DepartmentImportPreview | PeopleImportPreview;
  disabled?: boolean;
}>();
const { t } = useI18n();
const labels = computed((): Record<string, string> => {
  if (props.kind === "model") return {
  name: t("assetModel.name"), model_number: t("assetModel.modelNumber"),
  manufacturer: t("asset.manufacturer"), device_type: t("asset.deviceType"), fieldset: t("assetModel.fieldset"),
  default_warranty_months: t("assetModel.defaultWarranty"), expected_life_months: t("assetModel.expectedLife"),
  notes: t("common.notes"), is_active: t("common.status"),
  "厂商": t("asset.manufacturer"), "设备类型": t("asset.deviceType"), "字段集": t("assetModel.fieldset"),
  };
  if (props.kind === "department") return {
  code: t("settings.departmentImportCode"), name: t("settings.departmentName"),
  parent_code: t("settings.parentDepartment"), parent: t("settings.parentDepartment"),
  };
  return {
  employee_no: t("settings.peopleImportEmployeeNo"), name: t("settings.personName"),
  department: t("settings.personDepartment"), department_code: t("settings.personDepartment"),
  email: t("settings.personEmail"), organization: t("settings.personOrganization"),
  contact: t("settings.personContact"), is_active: t("common.status"),
  };
});
const groups = computed<ImportReviewGroup[]>(() => [
  { value: "create", label: t("asset.importReviewReady") },
  ...(props.kind === "model" ? [] : [
    { value: "update" as const, label: t("asset.importReviewUpdate") },
    { value: "unchanged" as const, label: t("asset.importReviewUnchanged") },
  ]),
  { value: "error", label: t("asset.importReviewErrors") },
]);
const identityLabel = computed(() => labels.value[props.kind === "model" ? "model_number" : props.kind === "department" ? "code" : "employee_no"]);
const rows = computed<ImportReviewRow[]>(() => {
  const field = (key: string, value: unknown) => ({ label: labels.value[key] || key, value: importReviewValue(value) });
  if (props.kind === "model") {
    return (props.preview as AssetModelImportPreview).rows.map(row => ({
      line: row.line, identity: String(row.values?.model_number ?? ""), name: row.name,
      operation: row.valid ? "create" : "error",
      fields: Object.keys(labels.value).filter(key => !["厂商", "设备类型", "字段集"].includes(key))
        .map(key => field(key, row.values?.[key] ?? (key === "name" ? row.name : ""))),
      changes: [], errors: normalizeImportReviewErrors(row.errors, labels.value),
    }));
  }
  const sourceRows = props.kind === "department"
    ? (props.preview as DepartmentImportPreview).rows
    : (props.preview as PeopleImportPreview).rows;
  return sourceRows.map(row => {
    const department = "code" in row;
    const fields = department ? [field("code", row.code), field("name", row.name), field("parent", [row.parent_code, row.parent].filter(Boolean).join(" / "))]
      : [field("employee_no", row.employee_no), field("name", row.name), field("department", row.values?.department ?? (row.values?.department_code || row.department)),
        ...["email", "organization", "contact", "is_active"].map(key => field(key, row.values?.[key]))];
    const operation: ImportReviewOperation = row.valid && ["create", "update", "unchanged"].includes(row.operation)
      ? row.operation as "create" | "update" | "unchanged" : "error";
    return {
      line: row.line, identity: department ? row.code : row.employee_no, name: row.name, operation, fields,
      changes: (row.change_details || []).map(change => ({ ...change, label: labels.value[change.field] || change.label })),
      changedFields: (row.changes || []).map(key => labels.value[key] || key),
      errors: normalizeImportReviewErrors(row.errors, labels.value),
    };
  });
});
</script>

<template>
  <ImportReviewTable :source="preview" :rows="rows" :groups="groups" :identity-label="identityLabel" :name-label="labels.name" :search-label="t('asset.importReviewReferenceSearch')" :disabled="disabled" @copy-errors="copyImportReviewErrors(rows)" @download-errors="downloadImportReviewErrors(rows, `${kind}-import-errors.csv`)" />
</template>
