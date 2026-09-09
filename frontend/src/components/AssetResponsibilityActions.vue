<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetResponsibilityContext } from "../page-context";
import type { AssetDetail, Person } from "../types";
import { normalizeApiError } from "../error-handling";

type ResponsibilityAction = "assign" | "transfer" | "return";

const props = defineProps<{
  asset: AssetDetail | null;
  context: AssetResponsibilityContext;
}>();

const { t } = useI18n();
const action = ref<ResponsibilityAction | null>(null);
const targetPersonId = ref("");
const reason = ref("");
const actionFormModel = computed(() => ({
  target_person: targetPersonId.value,
  reason: reason.value,
}));
const actionFormRules = computed(() => ({
  target_person: [{ required: true, message: t("asset.selectPerson"), trigger: "change" }],
}));
const dialogError = ref("");
const actionAttempted = ref(false);

const canManage = computed(() => props.context.can("assets.manage"));
const dialogOpen = computed(() => action.value !== null);
const showTargetPerson = computed(
  () => action.value === "assign" || action.value === "transfer",
);
const targetPeople = computed(() => props.context.responsibilitySubjects.value);
const peopleListError = computed(
  () => props.context.responsibilitySubjectsError.value,
);
const saving = computed(() => props.context.responsibilityActionSaving.value);
const actionError = computed(() =>
  actionAttempted.value
    ? dialogError.value || props.context.responsibilityActionError.value
    : dialogError.value,
);
const dialogTitle = computed(() =>
  action.value ? t(`asset.${action.value}Asset`) : "",
);
const dialogDescription = computed(() =>
  action.value ? t(`asset.${action.value}Description`) : "",
);
const targetPersonLabel = computed(() =>
  action.value === "transfer"
    ? t("asset.transferPerson")
    : t("asset.assignPerson"),
);
const targetPersonFieldError = computed(() => {
  const error = props.context.responsibilityActionFieldErrors.value.target_person;
  return error && /(?:required|必填|choose|select|选择)/i.test(error)
    ? t("asset.selectPerson")
    : error;
});
const assetId = computed(() => props.asset?.id ?? null);
const selectedTargetPersonId = computed(() => normalizePersonId(targetPersonId.value));
const targetPersonValid = computed(() => {
  if (!showTargetPerson.value) return true;
  const value = selectedTargetPersonId.value;
  if (value == null) return false;
  return value !== props.asset?.assigned_person?.id;
});
const canSubmit = computed(() =>
  Boolean(
    assetId.value && action.value && !saving.value && targetPersonValid.value,
  ),
);

function personLabel(person: Person): string {
  return person.display_name || person.name;
}

function personMeta(person: Person): string {
  return [person.employee_no, person.department_name, person.organization, person.contact]
    .filter((value) => Boolean(value && value.trim()))
    .join(" · ");
}

function normalizePersonId(value: unknown): number | null {
  const rawValue =
    value && typeof value === "object" && "id" in value
      ? (value as { id?: unknown }).id
      : value;
  const normalized = typeof rawValue === "number" ? rawValue : Number(rawValue);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function handleTargetPersonChange() {
  clearResponsibilityFieldError("target_person");
}

function isCurrentTarget(person: Person): boolean {
  return (
    props.asset?.assigned_person?.id != null &&
    person.id === props.asset.assigned_person.id
  );
}

function resetDialogState() {
  targetPersonId.value = "";
  reason.value = "";
  dialogError.value = "";
  actionAttempted.value = false;
  props.context.clearResponsibilityActionErrors();
}

function openAction(nextAction: ResponsibilityAction) {
  if (!canManage.value || saving.value || !assetId.value) return;
  resetDialogState();
  action.value = nextAction;
  if (nextAction === "assign" || nextAction === "transfer") {
    void props.context.loadResponsibilitySubjects("");
  }
}

function closeAction() {
  if (saving.value) return;
  action.value = null;
  resetDialogState();
}

function handleDialogUpdate(value: boolean) {
  if (!value) closeAction();
}

function beforeClose(done: () => void) {
  if (saving.value) return;
  closeAction();
  done();
}

function searchPeople(query: string) {
  void props.context.loadResponsibilitySubjects(query);
}

function retryPeople() {
  searchPeople("");
}

async function submitAction() {
  const currentAction = action.value;
  const currentAssetId = assetId.value;
  const currentTargetPersonId = selectedTargetPersonId.value;
  if (!currentAction || !currentAssetId || !canSubmit.value) {
    if (showTargetPerson.value && !targetPersonValid.value) {
      dialogError.value = t("asset.selectPerson");
    }
    return;
  }

  actionAttempted.value = true;
  try {
    const completed =
      currentAction === "assign"
        ? await props.context.assignAsset(
            currentAssetId,
            currentTargetPersonId!,
            reason.value.trim(),
          )
        : currentAction === "transfer"
          ? await props.context.transferAsset(
              currentAssetId,
              currentTargetPersonId!,
              reason.value.trim(),
            )
          : await props.context.returnAsset(
              currentAssetId,
              reason.value.trim(),
            );
    if (completed) closeAction();
  } catch (error) {
    const normalized = normalizeApiError(error);
    dialogError.value = normalized.kind === "unknown"
      ? t("asset.assignmentActionFailed")
      : normalized.message;
  }
}

function clearResponsibilityFieldError(field: string) {
  dialogError.value = "";
  props.context.clearResponsibilityActionFieldError(field);
}

watch(
  () => props.asset?.id,
  () => closeAction(),
);
</script>

<template>
  <div v-if="asset" class="asset-responsibility-panel">
    <div class="asset-responsibility-panel__owner">
      <span class="asset-responsibility-panel__label">{{
        t("asset.assignedPerson")
      }}</span>
      <strong>{{
        asset.assigned_person?.display_name || asset.assigned_person?.name || t("asset.unassigned")
      }}</strong>
      <small v-if="asset.assigned_person" class="asset-responsibility-panel__meta">
        {{ personMeta(asset.assigned_person) }}
      </small>
    </div>

    <div v-if="canManage" class="asset-responsibility-panel__actions">
      <el-button
        v-if="asset.assigned_person == null"
        type="primary"
        :disabled="saving"
        @click="openAction('assign')"
        >{{ t("asset.assignAsset") }}</el-button
      >
      <template v-else>
        <el-button
          type="primary"
          plain
          :disabled="saving"
          @click="openAction('transfer')"
        >
          {{ t("asset.transferAsset") }}
        </el-button>
        <el-button
          type="warning"
          plain
          :disabled="saving"
          @click="openAction('return')"
        >
          {{ t("asset.returnAsset") }}
        </el-button>
      </template>
    </div>

    <el-dialog
      :model-value="dialogOpen"
      class="form-dialog responsibility-dialog"
      width="560px"
      destroy-on-close
      :close-on-click-modal="!saving"
      :close-on-press-escape="!saving"
      :show-close="!saving"
      :before-close="beforeClose"
      @update:model-value="handleDialogUpdate"
    >
      <template #header="{ titleId }">
        <div class="form-dialog__header">
          <div class="form-dialog__heading">
            <span :id="titleId" class="el-dialog__title">{{
              dialogTitle
            }}</span>
            <p class="form-dialog__description">{{ dialogDescription }}</p>
          </div>
        </div>
      </template>

      <div class="form-dialog__body" :aria-busy="saving || undefined">
        <el-alert
          v-if="actionError"
          :title="t('asset.assignmentActionFailed')"
          :description="actionError"
          type="error"
          :closable="false"
          show-icon
          class="form-dialog__alert"
        />
        <el-alert
          v-if="showTargetPerson && peopleListError"
          :title="t('asset.peopleLoadFailed')"
          :description="peopleListError"
          type="error"
          :closable="false"
          show-icon
          class="form-dialog__alert"
        />
        <dl v-if="asset" class="responsibility-dialog__context">
          <div>
            <dt>{{ t("asset.name") }}</dt>
            <dd>{{ asset.name }}</dd>
          </div>
          <div>
            <dt>{{ t("asset.assignedPerson") }}</dt>
            <dd>
              {{ asset.assigned_person?.display_name || asset.assigned_person?.name || t("asset.unassigned") }}
              <small v-if="asset.assigned_person">{{ personMeta(asset.assigned_person) }}</small>
            </dd>
          </div>
        </dl>
        <div class="form-dialog__form-container">
          <el-form :model="actionFormModel" :rules="actionFormRules" label-position="top" @submit.prevent="submitAction">
            <el-form-item
              v-if="showTargetPerson"
              :label="targetPersonLabel"
              prop="target_person"
              required
              :error="targetPersonFieldError"
            >
              <el-select
                v-model="targetPersonId"
                filterable
                remote
                reserve-keyword
                clearable
                :remote-method="searchPeople"
                :loading="props.context.responsibilitySubjectsLoading.value"
                :placeholder="t('asset.selectPerson')"
                :no-data-text="t('common.noData')"
                :no-match-text="t('common.noData')"
                :aria-label="targetPersonLabel"
                @change="handleTargetPersonChange"
              >
                <el-option
                  v-for="person in targetPeople"
                  :key="person.id"
                  :label="personLabel(person)"
                  :value="String(person.id)"
                  :disabled="isCurrentTarget(person)"
                >
                  <span>{{ personLabel(person) }}</span>
                  <small v-if="personMeta(person)"> · {{ personMeta(person) }}</small>
                </el-option>
              </el-select>
              <div v-if="peopleListError" class="responsibility-dialog__retry">
                <el-button link type="primary" @click="retryPeople">{{
                  t("common.retry")
                }}</el-button>
              </div>
            </el-form-item>
            <el-form-item
              :label="t('common.reason')"
              prop="reason"
              :error="props.context.responsibilityActionFieldErrors.value.reason"
            >
              <el-input
                v-model="reason"
                type="textarea"
                :rows="4"
                maxlength="2000"
                show-word-limit
                :placeholder="t('common.reason')"
                @input="clearResponsibilityFieldError('reason')"
              />
            </el-form-item>
          </el-form>
        </div>
      </div>

      <template #footer>
        <div class="form-dialog__footer">
          <el-button :disabled="saving" @click="closeAction">{{
            t("common.cancel")
          }}</el-button>
          <el-button
            type="primary"
            :loading="saving"
            :disabled="!canSubmit"
            @click="submitAction"
            >{{ t("common.confirm") }}</el-button
          >
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.asset-responsibility-panel {
  display: grid;
  gap: 12px;
}

.asset-responsibility-panel__owner {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.asset-responsibility-panel__label {
  color: var(--el-text-color-secondary);
}

.asset-responsibility-panel__owner strong {
  min-width: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-responsibility-panel__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.responsibility-dialog__retry {
  margin-top: 4px;
  line-height: 1;
}

.responsibility-dialog__context {
  display: grid;
  gap: 8px;
  margin: 0 0 16px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
}

.responsibility-dialog__context div {
  display: flex;
  gap: 12px;
  min-width: 0;
}

.responsibility-dialog__context dt {
  flex: 0 0 96px;
  color: var(--el-text-color-secondary);
}

.responsibility-dialog__context dd {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--el-text-color-primary);
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 560px) {
  .asset-responsibility-panel__owner {
    align-items: flex-start;
    flex-direction: column;
    gap: 4px;
  }
}
</style>
