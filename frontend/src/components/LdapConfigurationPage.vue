<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import PageContent from "./page/PageContent.vue";
import StatusTag from "./StatusTag.vue";
import type { SettingsContext } from "../page-context";

const props = defineProps<{ context: SettingsContext }>();
const { t, locale } = useI18n();
const {
  ldapConfiguration,
  ldapConfigurationForm,
  ldapConfigurationLoading,
  ldapConfigurationSaving,
  ldapConfigurationError,
  ldapConfigurationFormErrors,
  ldapConfigurationDirty,
  ldapDiagnosticLoading,
  ldapDiagnosticResult,
  ldapDiagnosticError,
  retryLdapConfiguration,
  resetLdapConfigurationForm,
  saveLdapConfiguration,
  runLdapDiagnostics,
} = props.context;

const ldapPasswordEditing = ref(false);
const ldapPrimaryPortTouched = ref(false);
const ldapSecondaryPortTouched = ref(false);

function ldapCheckLabel(name: string) {
  return t(`settings.ldapChecks.${name}`);
}

function ldapCheckTone(status: string) {
  if (status === "success") return "success" as const;
  if (status === "error") return "danger" as const;
  return "info" as const;
}

function ldapCheckStatusLabel(status: string) {
  if (status === "success") return t("settings.ldapCheckSuccess");
  if (status === "disabled") return t("settings.ldapCheckDisabled");
  return t("settings.ldapCheckFailed");
}

function ldapSecurityModeLabel(value: string) {
  if (value === "ldaps") return t("settings.ldapSecurityLdaps");
  if (value === "starttls") return t("settings.ldapSecurityStarttls");
  return t("settings.ldapSecurityNone");
}

function applyLdapSecurityDefaults() {
  const port = ldapConfigurationForm.value.security_mode === "ldaps" ? 636 : 389;
  if (!ldapPrimaryPortTouched.value) ldapConfigurationForm.value.primary_port = port;
  if (!ldapSecondaryPortTouched.value && ldapConfigurationForm.value.secondary_host) {
    ldapConfigurationForm.value.secondary_port = port;
  }
}

watch(
  ldapConfiguration,
  (value) => {
    if (!value) return;
    ldapPasswordEditing.value = !value.bind_password_configured;
    const defaultPort = value.security_mode === "ldaps" ? 636 : 389;
    ldapPrimaryPortTouched.value = value.primary_port !== null && value.primary_port !== defaultPort;
    ldapSecondaryPortTouched.value = value.secondary_port !== null && value.secondary_port !== defaultPort;
  },
  { immediate: true },
);

watch(
  () => ldapConfigurationForm.value.directory_type,
  (value) => {
    if (value === "active_directory") {
      ldapConfigurationForm.value.external_id_attribute = "objectGUID";
    }
  },
);

const savedConfigurationStatus = computed(() => {
  if (ldapConfiguration.value?.configured) {
    return { tone: "success" as const, label: t("settings.ldapConfigurationComplete") };
  }
  return { tone: "warning" as const, label: t("settings.ldapConfigurationIncomplete") };
});

const runtimeStatus = computed(() => ldapConfiguration.value?.enabled
  ? { tone: "success" as const, label: t("settings.ldapServiceEnabled") }
  : { tone: "info" as const, label: t("settings.ldapServiceDisabled") });

const draftRuntimeStatus = computed(() => ldapConfigurationForm.value.enabled
  ? { tone: "success" as const, label: t("settings.ldapServiceEnabled") }
  : { tone: "info" as const, label: t("settings.ldapServiceDisabled") });

const connectionStatus = computed(() => {
  const configuration = ldapConfiguration.value;
  if (!configuration?.last_diagnostic_at) {
    return { tone: "info" as const, label: t("settings.ldapConnectionNotTested") };
  }
  return configuration.last_diagnostic_success
    ? { tone: "success" as const, label: t("settings.ldapDiagnosticSuccess") }
    : { tone: "danger" as const, label: t("settings.ldapDiagnosticFailed") };
});

const secretStatus = computed(() => {
  const configuration = ldapConfiguration.value;
  if (configuration?.secret_error) {
    return { tone: "danger" as const, label: t("settings.ldapSecretUnavailable") };
  }
  if (configuration?.bind_password_configured && configuration.secret_available) {
    return { tone: "success" as const, label: t("settings.ldapSecretConfigured") };
  }
  return { tone: "warning" as const, label: t("settings.ldapSecretMissing") };
});

const hasFormErrors = computed(() => Object.keys(ldapConfigurationFormErrors.value).length > 0);
const isBusy = computed(() => ldapConfigurationLoading.value || ldapConfigurationSaving.value);

function statusDotClass(status: { tone: "success" | "warning" | "danger" | "info" }) {
  return `settings-ldap-panel__status-dot--${status.tone}`;
}

function formatLdapDiagnosticAt(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale.value, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
</script>

<template>
  <PageContent surface>
    <section class="settings-ldap-panel settings-ldap-panel--page">
      <header class="settings-ldap-panel__heading">
        <div class="settings-ldap-panel__heading-copy">
          <h2>{{ t("settings.ldapConfigurationTitle") }}</h2>
        </div>
        <div class="settings-ldap-panel__heading-side">
          <div class="settings-ldap-panel__service-control">
            <div class="settings-ldap-panel__service-row">
              <span class="settings-ldap-panel__service-label">{{ t("settings.ldapEnabledToggle") }}</span>
              <el-switch
                v-model="ldapConfigurationForm.enabled"
                :disabled="isBusy || !ldapConfiguration"
                :aria-label="t('settings.ldapEnabledToggle')"
              />
              <el-text class="settings-ldap-panel__draft-status" :type="draftRuntimeStatus.tone">
                {{ draftRuntimeStatus.label }}
              </el-text>
            </div>
            <span class="settings-ldap-panel__service-hint">{{ t("settings.ldapEnableDraftHint") }}</span>
          </div>
        </div>
      </header>

      <el-skeleton v-if="ldapConfigurationLoading" :rows="8" animated />
      <el-alert
        v-else-if="ldapConfigurationError"
        :title="t('settings.ldapConfigurationLoadFailed')"
        :description="ldapConfigurationError"
        type="error"
        show-icon
        :closable="false"
      >
        <el-button link type="danger" @click="retryLdapConfiguration">{{ t("common.retry") }}</el-button>
      </el-alert>
      <template v-else-if="ldapConfiguration">
        <el-alert
          v-if="ldapConfigurationDirty"
          class="settings-ldap-panel__draft-alert"
          :title="t('settings.ldapUnsavedChanges')"
          :description="t('settings.ldapUnsavedHint')"
          type="info"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="hasFormErrors"
          class="settings-ldap-panel__draft-alert"
          :title="t('settings.ldapConfigurationInvalid')"
          :description="t('settings.ldapConfigurationInvalidDescription')"
          type="warning"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="ldapConfiguration.secret_error"
          class="settings-ldap-panel__draft-alert"
          :title="t('settings.ldapSecretUnavailable')"
          :description="t('settings.ldapSecretUnavailableDescription')"
          type="error"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="ldapConfigurationForm.security_mode === 'none'"
          class="settings-ldap-panel__draft-alert"
          :title="t('settings.ldapSecurityNoneWarning')"
          :description="t('settings.ldapSecurityNoneWarningDescription')"
          type="warning"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="ldapConfiguration.identity_anchor_locked"
          class="settings-ldap-panel__draft-alert"
          :title="t('settings.ldapIdentityAnchorLocked')"
          :description="t('settings.ldapIdentityAnchorLockedDescription', { count: ldapConfiguration.directory_identity_count })"
          type="info"
          show-icon
          :closable="false"
        />

        <div class="settings-ldap-panel__workspace">
          <div class="settings-ldap-panel__main">
            <div class="settings-ldap-panel__form-shell">
              <el-form
                class="settings-ldap-panel__form"
                label-position="top"
                @submit.prevent="saveLdapConfiguration"
              >
          <section class="settings-ldap-panel__section">
            <div class="settings-ldap-panel__section-heading">
              <div>
                <h3>{{ t("settings.ldapSectionConnection") }}</h3>
                <p>{{ t("settings.ldapSectionConnectionDescription") }}</p>
              </div>
            </div>
            <div class="settings-ldap-panel__grid">
              <el-form-item :label="t('settings.ldapDirectoryType')" :error="ldapConfigurationFormErrors.directory_type">
                <el-select v-model="ldapConfigurationForm.directory_type" class="settings-ldap-panel__control" :disabled="ldapConfigurationSaving || ldapConfiguration.identity_anchor_locked">
                  <el-option value="active_directory" :label="t('settings.ldapActiveDirectory')" />
                  <el-option value="generic_ldap" :label="t('settings.ldapGenericDirectory')" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('settings.ldapSecurityMode')" :error="ldapConfigurationFormErrors.security_mode">
                <el-select v-model="ldapConfigurationForm.security_mode" class="settings-ldap-panel__control" :disabled="ldapConfigurationSaving" @change="applyLdapSecurityDefaults">
                  <el-option value="ldaps" :label="ldapSecurityModeLabel('ldaps')" />
                  <el-option value="starttls" :label="ldapSecurityModeLabel('starttls')" />
                  <el-option value="none" :label="ldapSecurityModeLabel('none')" />
                </el-select>
              </el-form-item>
              <el-form-item :label="t('settings.ldapPrimaryServer')" :error="ldapConfigurationFormErrors.primary_host">
                <div class="settings-ldap-panel__host-port">
                  <el-input v-model="ldapConfigurationForm.primary_host" :placeholder="t('settings.ldapHostPlaceholder')" :disabled="ldapConfigurationSaving" />
                  <el-form-item :error="ldapConfigurationFormErrors.primary_port">
                    <el-input-number v-model="ldapConfigurationForm.primary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapPrimaryPortTouched = true" />
                  </el-form-item>
                </div>
              </el-form-item>
              <el-form-item :label="t('settings.ldapSecondaryServer')" :error="ldapConfigurationFormErrors.secondary_host">
                <div class="settings-ldap-panel__host-port">
                  <el-input v-model="ldapConfigurationForm.secondary_host" :placeholder="t('settings.ldapOptional')" :disabled="ldapConfigurationSaving" />
                  <el-form-item :error="ldapConfigurationFormErrors.secondary_port">
                    <el-input-number v-model="ldapConfigurationForm.secondary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapSecondaryPortTouched = true" />
                  </el-form-item>
                </div>
              </el-form-item>
            </div>
          </section>

          <section class="settings-ldap-panel__section">
            <div class="settings-ldap-panel__section-heading">
              <div>
                <h3>{{ t("settings.ldapSectionServiceAccount") }}</h3>
                <p>{{ t("settings.ldapSectionServiceAccountDescription") }}</p>
              </div>
            </div>
            <div class="settings-ldap-panel__grid">
              <el-form-item :label="t('settings.ldapBindAccount')" :error="ldapConfigurationFormErrors.bind_dn">
                <el-input v-model="ldapConfigurationForm.bind_dn" :placeholder="t('settings.ldapBindAccountPlaceholder')" :disabled="ldapConfigurationSaving" />
                <div class="settings-ldap-panel__help">{{ t("settings.ldapBindAccountHelp") }}</div>
              </el-form-item>
              <el-form-item :label="t('settings.ldapBindPassword')" :error="ldapConfigurationFormErrors.bind_password">
                <div v-if="!ldapPasswordEditing" class="settings-ldap-panel__secret-control">
                  <el-input :model-value="ldapConfiguration.bind_password_configured ? '••••••••' : ''" readonly :placeholder="t('settings.ldapPasswordNotConfigured')" />
                  <el-button link type="primary" @click="ldapPasswordEditing = true">{{ t("settings.ldapUpdatePassword") }}</el-button>
                </div>
                <el-input
                  v-else
                  v-model="ldapConfigurationForm.bind_password"
                  type="password"
                  show-password
                  autocomplete="new-password"
                  :placeholder="t('settings.ldapPasswordPlaceholder')"
                  :disabled="ldapConfigurationSaving"
                />
                <div class="settings-ldap-panel__help">{{ t("settings.ldapBindPasswordHelp") }}</div>
              </el-form-item>
            </div>
          </section>

          <section class="settings-ldap-panel__section">
            <div class="settings-ldap-panel__section-heading">
              <div>
                <h3>{{ t("settings.ldapSectionUserDirectory") }}</h3>
                <p>{{ t("settings.ldapSectionUserDirectoryDescription") }}</p>
              </div>
            </div>
            <div class="settings-ldap-panel__grid">
              <el-form-item :label="t('settings.ldapBaseDn')" :error="ldapConfigurationFormErrors.base_dn">
                <el-input v-model="ldapConfigurationForm.base_dn" :placeholder="t('settings.ldapBaseDnPlaceholder')" :disabled="ldapConfigurationSaving" />
              </el-form-item>
              <el-form-item :label="t('settings.ldapUserSearchBase')" :error="ldapConfigurationFormErrors.user_search_base">
                <el-input v-model="ldapConfigurationForm.user_search_base" :placeholder="t('settings.ldapUseBaseDn')" :disabled="ldapConfigurationSaving" />
              </el-form-item>
              <el-form-item class="settings-ldap-panel__attribute-field" :label="t('settings.ldapLoginAttribute')" :error="ldapConfigurationFormErrors.user_login_attribute">
                <el-input v-model="ldapConfigurationForm.user_login_attribute" :disabled="ldapConfigurationSaving" />
              </el-form-item>
              <el-form-item class="settings-ldap-panel__attribute-field" :label="t('settings.ldapIdentityAttribute')" :error="ldapConfigurationFormErrors.external_id_attribute">
                <el-input
                  v-model="ldapConfigurationForm.external_id_attribute"
                  :disabled="ldapConfigurationSaving || ldapConfiguration.identity_anchor_locked || ldapConfigurationForm.directory_type === 'active_directory'"
                />
                <div class="settings-ldap-panel__help">
                  {{ ldapConfigurationForm.directory_type === 'active_directory'
                    ? t('settings.ldapIdentityAttributeAdHelp')
                    : ldapConfiguration.identity_anchor_locked
                      ? t('settings.ldapIdentityAttributeLockedHelp')
                      : t('settings.ldapIdentityAttributeGenericHelp') }}
                </div>
              </el-form-item>
              <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapUserFilter')" :error="ldapConfigurationFormErrors.user_filter">
                <el-input v-model="ldapConfigurationForm.user_filter" :disabled="ldapConfigurationSaving" />
                <div class="settings-ldap-panel__help">{{ t("settings.ldapUserFilterHelp") }}</div>
              </el-form-item>
            </div>
          </section>

          <el-collapse class="settings-ldap-panel__advanced">
            <el-collapse-item :title="t('settings.ldapAdvancedTitle')" name="advanced">
              <div class="settings-ldap-panel__advanced-intro">{{ t("settings.ldapAdvancedDescription") }}</div>
              <div class="settings-ldap-panel__grid">
                <el-form-item :label="t('settings.ldapEmailAttribute')" :error="ldapConfigurationFormErrors.email_attribute">
                  <el-input v-model="ldapConfigurationForm.email_attribute" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapFirstNameAttribute')" :error="ldapConfigurationFormErrors.first_name_attribute">
                  <el-input v-model="ldapConfigurationForm.first_name_attribute" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapLastNameAttribute')" :error="ldapConfigurationFormErrors.last_name_attribute">
                  <el-input v-model="ldapConfigurationForm.last_name_attribute" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapAccountControlAttribute')" :error="ldapConfigurationFormErrors.account_control_attribute">
                  <el-input v-model="ldapConfigurationForm.account_control_attribute" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapTlsServerName')" :error="ldapConfigurationFormErrors.tls_server_name">
                  <el-input v-model="ldapConfigurationForm.tls_server_name" :placeholder="t('settings.ldapTlsServerNamePlaceholder')" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapCaCertFile')" :error="ldapConfigurationFormErrors.ca_cert_file">
                  <el-input v-model="ldapConfigurationForm.ca_cert_file" :placeholder="t('settings.ldapCaCertFilePlaceholder')" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item class="settings-ldap-panel__compact-field" :label="t('settings.ldapConnectTimeout')" :error="ldapConfigurationFormErrors.connect_timeout">
                  <el-input-number v-model="ldapConfigurationForm.connect_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item class="settings-ldap-panel__compact-field" :label="t('settings.ldapOperationTimeout')" :error="ldapConfigurationFormErrors.operation_timeout">
                  <el-input-number v-model="ldapConfigurationForm.operation_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                </el-form-item>
              </div>
            </el-collapse-item>
          </el-collapse>

                <div class="settings-ldap-panel__action-bar">
                  <div class="settings-ldap-panel__action-test">
                    <el-button
                      :loading="ldapDiagnosticLoading"
                      :disabled="ldapDiagnosticLoading || ldapConfigurationLoading || ldapConfigurationSaving || !ldapConfiguration"
                      @click="runLdapDiagnostics"
                    >
                      {{ t("settings.ldapTestConnection") }}
                    </el-button>
                    <span>{{ t("settings.ldapUnsavedHint") }}</span>
                  </div>
                  <div class="settings-ldap-panel__action-save">
                    <el-button :disabled="!ldapConfigurationDirty || ldapConfigurationSaving" @click="resetLdapConfigurationForm">
                      {{ t("settings.ldapRestoreConfiguration") }}
                    </el-button>
                    <el-button
                      type="primary"
                      :loading="ldapConfigurationSaving"
                      :disabled="!ldapConfigurationDirty || ldapConfigurationSaving || !ldapConfiguration"
                      @click="saveLdapConfiguration"
                    >
                      {{ t("settings.ldapSaveConfiguration") }}
                    </el-button>
                  </div>
                </div>
              </el-form>
            </div>
          </div>

          <aside class="settings-ldap-panel__sidebar">
            <section class="settings-ldap-panel__sidebar-section" aria-live="polite">
              <h3>{{ t("settings.ldapCurrentStatus") }}</h3>
              <div class="settings-ldap-panel__status-list">
                <div class="settings-ldap-panel__status-row">
                  <span class="settings-ldap-panel__status-dot" :class="statusDotClass(runtimeStatus)" aria-hidden="true" />
                  <span>{{ t("settings.ldapRuntimeStatus") }}</span>
                  <el-text :type="runtimeStatus.tone">{{ runtimeStatus.label }}</el-text>
                </div>
                <div class="settings-ldap-panel__status-row">
                  <span class="settings-ldap-panel__status-dot" :class="statusDotClass(savedConfigurationStatus)" aria-hidden="true" />
                  <span>{{ t("settings.ldapConfigurationStatus") }}</span>
                  <el-text :type="savedConfigurationStatus.tone">{{ savedConfigurationStatus.label }}</el-text>
                </div>
                <div class="settings-ldap-panel__status-row">
                  <span class="settings-ldap-panel__status-dot" :class="statusDotClass(connectionStatus)" aria-hidden="true" />
                  <span>{{ t("settings.ldapConnectionStatus") }}</span>
                  <el-text :type="connectionStatus.tone">{{ connectionStatus.label }}</el-text>
                </div>
                <div class="settings-ldap-panel__status-row">
                  <span class="settings-ldap-panel__status-dot" :class="statusDotClass(secretStatus)" aria-hidden="true" />
                  <span>{{ t("settings.ldapSecretStatus") }}</span>
                  <el-text :type="secretStatus.tone">{{ secretStatus.label }}</el-text>
                </div>
              </div>
            </section>

            <el-divider />

            <section class="settings-ldap-panel__sidebar-section" aria-live="polite">
              <h3>{{ t("settings.ldapRecentTest") }}</h3>
              <el-alert
                v-if="ldapDiagnosticError"
                class="settings-ldap-panel__recent-alert"
                :title="t('settings.ldapDiagnosticConnectionFailed')"
                :description="ldapDiagnosticError"
                type="error"
                show-icon
                :closable="false"
              />
              <template v-else-if="ldapDiagnosticResult">
                <el-alert
                  class="settings-ldap-panel__recent-alert"
                  :title="ldapDiagnosticResult.success ? t('settings.ldapDiagnosticSuccess') : t('settings.ldapDiagnosticConnectionFailed')"
                  :description="ldapDiagnosticResult.success ? t('settings.ldapDiagnosticComplete') : (ldapDiagnosticResult.message || t('settings.ldapDiagnosticRequestFailed'))"
                  :type="ldapDiagnosticResult.success ? 'success' : 'error'"
                  show-icon
                  :closable="false"
                />
                <div class="settings-ldap-panel__checks">
                  <div v-for="check in ldapDiagnosticResult.checks" :key="check.name" class="settings-ldap-panel__check">
                    <span>{{ ldapCheckLabel(check.name) }}</span>
                    <StatusTag :tone="ldapCheckTone(check.status)" :label="ldapCheckStatusLabel(check.status)" size="small" />
                  </div>
                </div>
              </template>
              <div v-else-if="ldapConfiguration.last_diagnostic_at" class="settings-ldap-panel__recent-summary">
                <div class="settings-ldap-panel__recent-summary-heading">
                  <span class="settings-ldap-panel__status-dot" :class="statusDotClass(connectionStatus)" aria-hidden="true" />
                  <el-text :type="connectionStatus.tone">{{ connectionStatus.label }}</el-text>
                  <span>{{ formatLdapDiagnosticAt(ldapConfiguration.last_diagnostic_at) }}</span>
                </div>
                <p>
                  {{ ldapConfiguration.last_diagnostic_success
                    ? t("settings.ldapSavedDiagnosticSuccess")
                    : t("settings.ldapSavedDiagnosticFailed") }}
                </p>
              </div>
              <div v-else class="settings-ldap-panel__diagnostic-empty">
                <span>{{ t("settings.ldapConnectionNotTestedDescription") }}</span>
                <el-text type="info">{{ connectionStatus.label }}</el-text>
              </div>
            </section>

          </aside>
        </div>
      </template>
    </section>
  </PageContent>
</template>
