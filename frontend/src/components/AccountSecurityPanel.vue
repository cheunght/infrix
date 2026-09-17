<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { CopyDocument, Delete, Refresh } from "@element-plus/icons-vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import QRCode from "qrcode";
import { normalizeApiError } from "../error-handling";
import { formatSystemDateTime } from "../system-settings";
import type { RequestFn } from "../page-context";

type TwoFactorStatus = {
  enabled: boolean;
  configured: boolean;
};

type TwoFactorSetupResponse = TwoFactorStatus & {
  secret: string;
  provisioning_uri: string;
};

type ApiToken = {
  id: number;
  name: string;
  token_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  status: "active" | "expired" | "revoked";
  created_at: string;
};

type CreatedApiToken = ApiToken & { token: string };

const props = defineProps<{
  request: RequestFn;
  active: boolean;
}>();

const { t } = useI18n();
const status = ref<TwoFactorStatus>({ enabled: false, configured: false });
const loading = ref(false);
const loadError = ref("");
const setupSecret = ref("");
const setupQr = ref("");
const setupCode = ref("");
const setupBusy = ref(false);
const disableBusy = ref(false);
const disableCode = ref("");
const twoFactorExpanded = ref(false);
const tokens = ref<ApiToken[]>([]);
const tokenLoading = ref(false);
const tokenError = ref("");
const tokenName = ref("");
const tokenExpires = ref<string | null>(null);
const tokenNeverExpires = ref(false);
const tokenCreateBusy = ref(false);
const tokenListExpanded = ref(false);
const tokenCreateExpanded = ref(false);
const oneTimeToken = ref("");
let loadRequestId = 0;

function errorText(error: unknown, fallback: string): string {
  const normalized = normalizeApiError(error);
  const localizedErrorKeys: Record<string, string> = {
    invalid_two_factor_code: "security.twoFactorInvalidCode",
    two_factor_unavailable: "security.twoFactorUnavailable",
    two_factor_not_configured: "security.twoFactorNotConfigured",
    two_factor_already_enabled: "security.twoFactorAlreadyEnabled",
  };
  const localizedKey = normalized.code ? localizedErrorKeys[normalized.code] : undefined;
  if (localizedKey && t(localizedKey) !== localizedKey) return String(t(localizedKey));
  return normalized.kind === "unknown" ? fallback : normalized.message;
}

async function loadTokens() {
  tokenLoading.value = true;
  tokenError.value = "";
  try {
    tokens.value = await props.request<ApiToken[]>("/auth/api-tokens/");
  } catch (error) {
    tokenError.value = errorText(error, t("security.apiTokenLoadFailed"));
  } finally {
    tokenLoading.value = false;
  }
}

async function load() {
  if (!props.active || loading.value) return;
  const requestId = ++loadRequestId;
  loading.value = true;
  loadError.value = "";
  try {
    const [nextStatus, nextTokens] = await Promise.all([
      props.request<TwoFactorStatus>("/auth/2fa/status/"),
      props.request<ApiToken[]>("/auth/api-tokens/"),
    ]);
    if (requestId !== loadRequestId) return;
    status.value = nextStatus;
    tokens.value = nextTokens;
    tokenError.value = "";
  } catch (error) {
    if (requestId !== loadRequestId) return;
    loadError.value = errorText(error, t("security.securityLoadFailed"));
  } finally {
    if (requestId === loadRequestId) loading.value = false;
  }
}

function resetSetup() {
  setupSecret.value = "";
  setupQr.value = "";
  setupCode.value = "";
  disableCode.value = "";
}

async function startTwoFactorSetup() {
  if (setupBusy.value) return;
  twoFactorExpanded.value = true;
  setupBusy.value = true;
  try {
    const response = await props.request<TwoFactorSetupResponse>("/auth/2fa/setup/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    setupSecret.value = response.secret;
    setupQr.value = await QRCode.toDataURL(response.provisioning_uri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180,
    });
    setupCode.value = "";
    status.value = response;
  } catch (error) {
    ElMessage.error(errorText(error, t("security.securitySetupFailed")));
  } finally {
    setupBusy.value = false;
  }
}

async function confirmTwoFactor() {
  if (setupBusy.value || setupCode.value.trim().length !== 6) return;
  setupBusy.value = true;
  try {
    const response = await props.request<TwoFactorStatus>("/auth/2fa/confirm/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: setupCode.value.trim() }),
    });
    status.value = response;
    resetSetup();
    twoFactorExpanded.value = false;
    ElMessage.success(t("security.twoFactorEnabledMessage"));
  } catch (error) {
    ElMessage.error(errorText(error, t("security.securityConfirmFailed")));
  } finally {
    setupBusy.value = false;
  }
}

async function disableTwoFactor() {
  if (disableBusy.value || disableCode.value.trim().length !== 6) return;
  disableBusy.value = true;
  try {
    const response = await props.request<TwoFactorStatus>("/auth/2fa/disable/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: disableCode.value.trim() }),
    });
    status.value = response;
    resetSetup();
    twoFactorExpanded.value = false;
    ElMessage.success(t("security.twoFactorDisabledMessage"));
  } catch (error) {
    ElMessage.error(errorText(error, t("security.securityDisableFailed")));
  } finally {
    disableBusy.value = false;
  }
}

async function toggleTwoFactor() {
  if (twoFactorExpanded.value) {
    twoFactorExpanded.value = false;
    return;
  }
  if (status.value.enabled || setupSecret.value) {
    twoFactorExpanded.value = true;
    return;
  }
  await startTwoFactorSetup();
}

function formatDateTime(value: string | null): string {
  if (!value) return t("security.apiTokenNeverUsed");
  return formatSystemDateTime(value) || value;
}

function tokenExpiryLabel(value: string | null): string {
  return value || t("security.apiTokenNeverExpires");
}

function tokenStatusLabel(value: ApiToken["status"]): string {
  return t(`security.apiToken${value[0].toUpperCase()}${value.slice(1)}`);
}

function disableTokenExpiryDate(date: Date): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date.getTime() <= today.getTime();
}

async function createToken() {
  const name = tokenName.value.trim();
  if (tokenCreateBusy.value || !name) return;
  tokenCreateBusy.value = true;
  tokenError.value = "";
  try {
    const expiry = tokenNeverExpires.value
      ? { expires_at: null }
      : tokenExpires.value
        ? { expires_at: tokenExpires.value }
        : {};
    const response = await props.request<CreatedApiToken>("/auth/api-tokens/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        ...expiry,
      }),
    });
    oneTimeToken.value = response.token;
    tokenName.value = "";
    tokenExpires.value = null;
    tokenNeverExpires.value = false;
    tokenCreateExpanded.value = true;
    tokenListExpanded.value = true;
    await loadTokens();
    ElMessage.success(t("security.apiTokenCreated"));
  } catch (error) {
    tokenError.value = errorText(error, t("security.apiTokenCreateFailed"));
  } finally {
    tokenCreateBusy.value = false;
  }
}

function cancelTokenCreate() {
  if (tokenCreateBusy.value) return;
  tokenName.value = "";
  tokenExpires.value = null;
  tokenNeverExpires.value = false;
  tokenError.value = "";
  tokenCreateExpanded.value = false;
}

function toggleTokenCreate() {
  if (tokenCreateBusy.value) return;
  if (tokenCreateExpanded.value) {
    cancelTokenCreate();
  } else {
    tokenError.value = "";
    tokenCreateExpanded.value = true;
  }
}

function toggleTokenList() {
  tokenListExpanded.value = !tokenListExpanded.value;
}

async function revokeToken(token: ApiToken) {
  if (token.revoked_at) return;
  try {
    await ElMessageBox.confirm(
      t("security.apiTokenRevokeConfirm", { name: token.name }),
      t("security.apiTokenRevokeTitle"),
      { type: "warning", confirmButtonText: t("security.apiTokenRevoke"), cancelButtonText: t("common.cancel") },
    );
  } catch {
    return;
  }
  try {
    await props.request(`/auth/api-tokens/${token.id}/`, { method: "DELETE" });
    await loadTokens();
  } catch (error) {
    tokenError.value = errorText(error, t("security.apiTokenRevokeFailed"));
  }
}

async function copyValue(value: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      const input = document.createElement("textarea");
      input.value = value;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.appendChild(input);
      input.focus();
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    ElMessage.success(t("common.copied"));
  } catch {
    ElMessage.error(t("security.apiTokenCopyFailed"));
  }
}

watch(() => props.active, (active) => {
  if (active) void load();
}, { immediate: true });
</script>

<template>
  <div class="account-security-panel">
    <div v-if="loading" class="account-security-panel__state" role="status">
      <el-icon class="is-loading" aria-hidden="true"><Refresh /></el-icon>
      <span>{{ t('security.securityLoading') }}</span>
    </div>
    <div v-else-if="loadError" class="account-security-panel__state account-security-panel__state--error" role="alert">
      <span>{{ loadError }}</span>
      <el-button type="primary" link @click="load">{{ t('common.retry') }}</el-button>
    </div>
    <template v-else>
      <div class="account-security-settings-list">
        <section class="account-security-setting">
          <div class="account-security-setting__content">
            <h4 class="account-security-setting__title">{{ t('security.twoFactorTitle') }}</h4>
            <p class="account-security-setting__description">{{ t('security.twoFactorDescription') }}</p>
          </div>
          <div class="account-security-setting__actions">
            <el-tag :type="status.enabled ? 'success' : 'info'" effect="light">
              {{ status.enabled ? t('security.twoFactorEnabled') : t('security.twoFactorDisabled') }}
            </el-tag>
            <el-button
              text
              type="primary"
              :loading="setupBusy"
              :disabled="disableBusy"
              :aria-expanded="twoFactorExpanded"
              aria-controls="account-security-two-factor-details"
              @click="toggleTwoFactor"
            >
              {{ twoFactorExpanded ? t('security.collapseSecurity') : status.enabled ? t('security.manageTwoFactor') : t('security.setupTwoFactor') }}
            </el-button>
          </div>
        </section>

        <div v-if="twoFactorExpanded" id="account-security-two-factor-details" class="account-security-expanded account-security-expanded--two-factor">
          <template v-if="status.enabled">
            <p class="account-security-help">{{ t('security.twoFactorDisableHelp') }}</p>
            <div class="account-security-inline-form account-security-inline-form--confirm">
              <el-input
                v-model="disableCode"
                class="account-security-code"
                maxlength="6"
                inputmode="numeric"
                autocomplete="one-time-code"
                :placeholder="t('auth.twoFactorCodePlaceholder')"
                :aria-label="t('auth.twoFactorCode')"
              />
              <el-button :disabled="disableBusy" @click="resetSetup">{{ t('common.cancel') }}</el-button>
              <el-button type="danger" plain :loading="disableBusy" :disabled="disableCode.trim().length !== 6" @click="disableTwoFactor">
                {{ t('security.disableTwoFactor') }}
              </el-button>
            </div>
          </template>
          <div v-else-if="setupSecret" class="account-security-setup">
            <div class="account-security-setup__qr">
              <img v-if="setupQr" :src="setupQr" :alt="t('security.twoFactorQrAlt')" />
            </div>
            <div class="account-security-setup__copy">
              <strong>{{ t('security.scanTwoFactorQr') }}</strong>
              <p>{{ t('security.manualTwoFactorSecret') }}</p>
              <div class="account-security-secret">
                <code>{{ setupSecret }}</code>
                <el-button text type="primary" :icon="CopyDocument" :aria-label="t('security.copySecret')" @click="copyValue(setupSecret)">
                  {{ t('security.copySecret') }}
                </el-button>
              </div>
              <div class="account-security-inline-form account-security-inline-form--confirm">
                <el-input
                  v-model="setupCode"
                  class="account-security-code"
                  maxlength="6"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  :placeholder="t('auth.twoFactorCodePlaceholder')"
                  :aria-label="t('auth.twoFactorCode')"
                />
                <el-button type="primary" :loading="setupBusy" :disabled="setupCode.trim().length !== 6" @click="confirmTwoFactor">
                  {{ t('security.confirmTwoFactor') }}
                </el-button>
              </div>
            </div>
          </div>
          <p v-else class="account-security-help">{{ t('security.twoFactorDisabledHelp') }}</p>
        </div>

        <section class="account-security-setting">
          <div class="account-security-setting__content">
            <h4 class="account-security-setting__title">{{ t('security.apiTokensTitle') }}</h4>
            <p class="account-security-setting__description">{{ t('security.apiTokensDescription') }} {{ t('security.apiTokenCount', { count: tokens.length }) }}</p>
          </div>
          <div class="account-security-setting__actions">
            <el-button
              v-if="tokens.length"
              text
              type="primary"
              :aria-expanded="tokenListExpanded"
              aria-controls="account-security-token-list"
              @click="toggleTokenList"
            >
              {{ tokenListExpanded ? t('security.collapseSecurity') : t('security.apiTokenManage') }}
            </el-button>
            <el-button
              type="primary"
              plain
              :loading="tokenCreateBusy"
              :aria-expanded="tokenCreateExpanded"
              aria-controls="account-security-token-create"
              @click="toggleTokenCreate"
            >
              {{ tokenCreateExpanded ? t('security.collapseSecurity') : t('security.apiTokenCreate') }}
            </el-button>
          </div>
        </section>

        <div v-if="tokenListExpanded && tokens.length" id="account-security-token-list" class="account-security-expanded account-security-expanded--tokens">
          <div v-if="tokenLoading" class="account-security-panel__muted" role="status">{{ t('security.securityLoading') }}</div>
          <div v-else-if="tokens.length" class="account-security-token-list">
            <div v-for="token in tokens" :key="token.id" class="account-security-token-row">
              <div class="account-security-token-row__main">
                <strong>{{ token.name }}</strong>
                <span><code>{{ token.token_prefix }}••••</code> · {{ tokenStatusLabel(token.status) }}</span>
              </div>
              <div class="account-security-token-row__meta">
                <span>{{ t('security.apiTokenCreatedAt') }} {{ formatDateTime(token.created_at) }}</span>
                <span>{{ t('security.apiTokenExpires') }} {{ tokenExpiryLabel(token.expires_at) }}</span>
                <span>{{ t('security.apiTokenLastUsed') }} {{ formatDateTime(token.last_used_at) }}</span>
              </div>
              <el-button
                v-if="!token.revoked_at"
                text
                type="danger"
                :icon="Delete"
                :aria-label="`${t('security.apiTokenRevoke')}: ${token.name}`"
                @click="revokeToken(token)"
              >{{ t('security.apiTokenRevoke') }}</el-button>
            </div>
          </div>
        </div>

        <div v-if="tokenCreateExpanded" id="account-security-token-create" class="account-security-expanded account-security-expanded--token-create">
          <el-alert
            v-if="oneTimeToken"
            type="warning"
            :closable="false"
            show-icon
            class="account-security-token-alert"
            :title="t('security.apiTokenOneTimeWarning')"
          >
            <div class="account-security-token-alert__value">
              <code>{{ oneTimeToken }}</code>
              <el-button type="primary" text :icon="CopyDocument" @click="copyValue(oneTimeToken)">{{ t('security.apiTokenCopy') }}</el-button>
            </div>
          </el-alert>

          <div class="account-security-token-form">
            <el-input v-model="tokenName" :placeholder="t('security.apiTokenNamePlaceholder')" :aria-label="t('security.apiTokenName')" maxlength="80" />
            <el-date-picker
              v-model="tokenExpires"
              type="date"
              value-format="YYYY-MM-DD"
              clearable
              :disabled="tokenNeverExpires"
              :disabled-date="disableTokenExpiryDate"
              :placeholder="t('security.apiTokenExpires')"
              :aria-label="t('security.apiTokenExpires')"
            />
          </div>
          <div class="account-security-token-expiry-options">
            <el-checkbox v-model="tokenNeverExpires">{{ t('security.apiTokenNeverExpiresOption') }}</el-checkbox>
            <p class="account-security-help">{{ t('security.apiTokenDefaultExpiryHelp') }}</p>
          </div>
          <div v-if="tokenError" class="account-security-panel__inline-error" role="alert">{{ tokenError }}</div>
          <div class="account-security-token-form__actions">
            <el-button :disabled="tokenCreateBusy" @click="cancelTokenCreate">{{ t('common.cancel') }}</el-button>
            <el-button type="primary" :loading="tokenCreateBusy" :disabled="!tokenName.trim()" @click="createToken">{{ t('security.apiTokenCreate') }}</el-button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.account-security-panel {
  min-width: 0;
}

.account-security-settings-list {
  display: grid;
  min-width: 0;
}

.account-security-setting {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 14px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.account-security-setting__content {
  min-width: 0;
}

.account-security-setting__title {
  margin: 0;
  color: var(--el-text-color-primary);
  font-size: var(--el-font-size-base);
  font-weight: 600;
  line-height: 22px;
}

.account-security-setting__description,
.account-security-help,
.account-security-setup__copy p {
  margin: 3px 0 0;
  color: var(--el-text-color-secondary);
  font-size: var(--el-font-size-small);
  line-height: 20px;
  overflow-wrap: anywhere;
}

.account-security-setting__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-shrink: 0;
  gap: 8px;
  min-width: 0;
}

.account-security-expanded {
  min-width: 0;
  padding: 0 0 14px;
  border-top: 0;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.account-security-expanded__actions {
  display: flex;
  justify-content: flex-end;
}

.account-security-inline-form,
.account-security-secret,
.account-security-token-alert__value {
  display: flex;
  align-items: center;
  gap: 10px;
}

.account-security-inline-form {
  flex-wrap: wrap;
  margin-top: 16px;
}

.account-security-inline-form--confirm {
  margin-top: 16px;
}

.account-security-code {
  max-width: 190px;
}

.account-security-setup {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  align-items: flex-start;
  gap: 18px;
  padding: 14px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.account-security-setup__qr {
  flex: 0 0 180px;
  width: 180px;
  height: 180px;
}

.account-security-setup__qr img {
  display: block;
  width: 180px;
  height: 180px;
}

.account-security-setup__copy {
  min-width: 0;
}

.account-security-secret {
  justify-content: space-between;
  max-width: 360px;
  margin-top: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--el-fill-color-light);
}

.account-security-secret code,
.account-security-token-alert code,
.account-security-token-row code {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.account-security-token-alert {
  margin: 0 0 14px;
}

.account-security-token-alert__value {
  justify-content: space-between;
  min-width: 0;
  flex-wrap: wrap;
  margin-top: 6px;
}

.account-security-token-alert__value code {
  min-width: 0;
  flex: 1 1 240px;
}

.account-security-token-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(150px, 180px);
  align-items: center;
  min-width: 0;
  gap: 10px;
}

.account-security-token-form .el-input,
.account-security-token-form .el-date-editor {
  width: 100%;
  min-width: 0;
}

.account-security-token-form__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.account-security-token-expiry-options {
  margin-top: 8px;
}

.account-security-panel__inline-error {
  margin-top: 10px;
  color: var(--el-color-danger);
}

.account-security-panel__muted,
.account-security-panel__state {
  color: var(--el-text-color-secondary);
}

.account-security-panel__state {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 100px;
}

.account-security-panel__state--error {
  justify-content: space-between;
  color: var(--el-color-danger);
}

.account-security-token-list {
  display: grid;
}

.account-security-token-row {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) auto;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--el-border-color-lighter);
}

.account-security-token-row__main,
.account-security-token-row__meta {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.account-security-token-row__main span,
.account-security-token-row__meta {
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.account-security-token-row > .el-button {
  align-self: center;
  margin: 0;
}

@media (max-width: 680px) {
  .account-security-setting {
    grid-template-columns: 1fr;
    align-items: start;
  }

  .account-security-setting__actions,
  .account-security-expanded__actions,
  .account-security-token-alert__value {
    justify-content: flex-start;
    align-items: stretch;
  }

  .account-security-setting__actions,
  .account-security-expanded__actions,
  .account-security-inline-form,
  .account-security-token-alert__value {
    flex-direction: column;
  }

  .account-security-setup,
  .account-security-token-form {
    display: flex;
    flex-direction: column;
    align-items: stretch;
  }

  .account-security-setup__qr {
    align-self: center;
  }

  .account-security-code,
  .account-security-token-form .el-input,
  .account-security-token-form .el-date-editor {
    width: 100%;
    max-width: none;
    flex-basis: auto;
  }

  .account-security-token-alert__value code {
    width: 100%;
    flex-basis: auto;
  }

  .account-security-token-form__actions {
    justify-content: stretch;
  }

  .account-security-token-form__actions .el-button {
    flex: 1 1 0;
  }

  .account-security-token-row {
    grid-template-columns: 1fr;
  }

  .account-security-token-row .el-button {
    justify-self: start;
  }
}
</style>
