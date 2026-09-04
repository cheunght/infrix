<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { AssetResponsibilityContext } from "../page-context";
import type { AssetDetail, AssetResponsibilityUser } from "../types";

type ResponsibilityAction = "assign" | "transfer" | "return";

const props = defineProps<{
  asset: AssetDetail | null;
  context: AssetResponsibilityContext;
}>();

const { t } = useI18n();
const action = ref<ResponsibilityAction | null>(null);
const targetUserId = ref<number | null>(null);
const reason = ref("");
const dialogError = ref("");
const actionAttempted = ref(false);

const canManage = computed(() => props.context.can("assets.manage"));
const dialogOpen = computed(() => action.value !== null);
const showTargetUser = computed(
  () => action.value === "assign" || action.value === "transfer",
);
const targetUsers = computed(() => props.context.responsibilityUsers.value);
const userListError = computed(
  () => props.context.responsibilityUsersError.value,
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
const assetId = computed(() => props.asset?.id ?? null);
const targetUserValid = computed(() => {
  if (!showTargetUser.value) return true;
  if (targetUserId.value == null) return false;
  return targetUserId.value !== props.asset?.responsible_user;
});
const canSubmit = computed(() =>
  Boolean(
    assetId.value && action.value && !saving.value && targetUserValid.value,
  ),
);

function targetUserLabel(user: AssetResponsibilityUser): string {
  return user.display_name || user.username;
}

function isCurrentTarget(user: AssetResponsibilityUser): boolean {
  return (
    props.asset?.responsible_user != null &&
    user.id === props.asset.responsible_user
  );
}

function resetDialogState() {
  targetUserId.value = null;
  reason.value = "";
  dialogError.value = "";
  actionAttempted.value = false;
}

function openAction(nextAction: ResponsibilityAction) {
  if (!canManage.value || saving.value || !assetId.value) return;
  resetDialogState();
  action.value = nextAction;
  if (nextAction === "assign" || nextAction === "transfer") {
    void props.context.loadResponsibilityUsers("");
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

function searchUsers(query: string) {
  void props.context.loadResponsibilityUsers(query);
}

function retryUsers() {
  searchUsers("");
}

async function submitAction() {
  const currentAction = action.value;
  const currentAssetId = assetId.value;
  if (!currentAction || !currentAssetId || !canSubmit.value) {
    if (showTargetUser.value && !targetUserValid.value) {
      dialogError.value = t("asset.selectResponsibilityUser");
    }
    return;
  }

  actionAttempted.value = true;
  try {
    const completed =
      currentAction === "assign"
        ? await props.context.assignAsset(
            currentAssetId,
            targetUserId.value!,
            reason.value.trim(),
          )
        : currentAction === "transfer"
          ? await props.context.transferAsset(
              currentAssetId,
              targetUserId.value!,
              reason.value.trim(),
            )
          : await props.context.returnAsset(
              currentAssetId,
              reason.value.trim(),
            );
    if (completed) closeAction();
  } catch (error) {
    dialogError.value =
      error instanceof Error
        ? error.message
        : t("asset.responsibilityActionFailed");
  }
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
        t("asset.responsibleUser")
      }}</span>
      <strong>{{
        asset.responsible_user_name || t("asset.unassigned")
      }}</strong>
    </div>

    <div v-if="canManage" class="asset-responsibility-panel__actions">
      <el-button
        v-if="asset.responsible_user == null"
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
          :title="t('asset.responsibilityActionFailed')"
          :description="actionError"
          type="error"
          :closable="false"
          show-icon
          class="form-dialog__alert"
        />
        <el-alert
          v-if="showTargetUser && userListError"
          :title="t('asset.responsibilityUsersLoadFailed')"
          :description="userListError"
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
            <dt>{{ t("asset.responsibleUser") }}</dt>
            <dd>{{ asset.responsible_user_name || t("asset.unassigned") }}</dd>
          </div>
        </dl>
        <div class="form-dialog__form-container">
          <el-form label-position="top" @submit.prevent="submitAction">
            <el-form-item
              v-if="showTargetUser"
              :label="t('asset.responsibleUser')"
              required
            >
              <el-select
                v-model="targetUserId"
                filterable
                remote
                reserve-keyword
                clearable
                :remote-method="searchUsers"
                :loading="props.context.responsibilityUsersLoading.value"
                :placeholder="t('asset.selectResponsibilityUser')"
                :no-data-text="t('common.noData')"
                :no-match-text="t('common.noData')"
                :aria-label="t('asset.selectResponsibilityUser')"
              >
                <el-option
                  v-for="user in targetUsers"
                  :key="user.id"
                  :label="targetUserLabel(user)"
                  :value="user.id"
                  :disabled="isCurrentTarget(user)"
                >
                  <span>{{ targetUserLabel(user) }}</span>
                  <small
                    v-if="
                      user.display_name && user.username !== user.display_name
                    "
                  >
                    · {{ user.username }}</small
                  >
                </el-option>
              </el-select>
              <div v-if="userListError" class="responsibility-dialog__retry">
                <el-button link type="primary" @click="retryUsers">{{
                  t("common.retry")
                }}</el-button>
              </div>
            </el-form-item>
            <el-form-item :label="t('common.reason')">
              <el-input
                v-model="reason"
                type="textarea"
                :rows="4"
                maxlength="2000"
                show-word-limit
                :placeholder="t('common.reason')"
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
