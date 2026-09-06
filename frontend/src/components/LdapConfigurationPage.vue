<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import PageContent from "./page/PageContent.vue";
import StatusTag from "./StatusTag.vue";
import type { SettingsContext } from "../page-context";

const props = defineProps<{ context: SettingsContext }>();
const { t } = useI18n();
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

const ldapPasswordEditing = ref(false);
const ldapPrimaryPortTouched = ref(false);
const ldapSecondaryPortTouched = ref(false);

function ldapDirectoryTypeLabel(value: string) {
  return value === "active_directory"
    ? t("settings.ldapActiveDirectory")
    : t("settings.ldapGenericDirectory");
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
  () => ldapConfigurationForm.value.directory_type,
  (value) => {
    if (value === "active_directory") {
      ldapConfigurationForm.value.external_id_attribute = "objectGUID";
    }
  },
);
</script>

<template>
  <PageContent surface>
    <section class="settings-ldap-panel settings-ldap-panel--page">
      <div class="settings-ldap-panel__heading">
        <div>
          <div class="settings-ldap-panel__eyebrow">{{ t('settings.ldapIntegration') }}</div>
          <h2>{{ t('settings.ldapConfigurationTitle') }}</h2>
          <p>{{ t('settings.ldapIntegrationDescription') }}</p>
        </div>
        <div class="settings-ldap-panel__actions">
          <el-button
            :loading="ldapDiagnosticLoading"
            :disabled="ldapDiagnosticLoading || ldapConfigurationLoading"
            @click="runLdapDiagnostics"
          >
            {{ t('settings.ldapTestConnection') }}
          </el-button>
          <el-button
            type="primary"
            :loading="ldapConfigurationSaving"
            :disabled="!ldapConfigurationDirty || ldapConfigurationSaving"
            @click="saveLdapConfiguration"
          >
            {{ t('settings.ldapSaveConfiguration') }}
          </el-button>
        </div>
      </div>

      <el-skeleton v-if="ldapConfigurationLoading" :rows="8" animated />
      <el-alert
        v-else-if="ldapConfigurationError"
        :title="t('settings.ldapConfigurationLoadFailed')"
        :description="ldapConfigurationError"
        type="error"
        show-icon
        :closable="false"
      >
        <el-button link type="danger" @click="retryLdapConfiguration">{{ t('common.retry') }}</el-button>
      </el-alert>
      <template v-else-if="ldapConfiguration">
        <el-alert
          v-if="ldapConfiguration.source === 'environment'"
          :title="t('settings.ldapBootstrapConfiguration')"
          :description="t('settings.ldapBootstrapConfigurationDescription')"
          type="info"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="ldapConfigurationForm.security_mode === 'none'"
          :title="t('settings.ldapSecurityNoneWarning')"
          :description="t('settings.ldapSecurityNoneWarningDescription')"
          type="warning"
          show-icon
          :closable="false"
        />
        <el-alert
          v-if="ldapConfiguration.identity_anchor_locked"
          :title="t('settings.ldapIdentityAnchorLocked')"
          :description="t('settings.ldapIdentityAnchorLockedDescription', { count: ldapConfiguration.directory_identity_count })"
          type="info"
          show-icon
          :closable="false"
        />

        <el-form
          class="settings-ldap-panel__form"
          label-position="top"
          @submit.prevent="saveLdapConfiguration"
        >
          <div class="settings-ldap-panel__summary">
            <div>
              <span>{{ t('settings.ldapStatus') }}</span>
              <StatusTag
                :tone="ldapConfigurationForm.enabled ? (ldapConfiguration.configured ? 'success' : 'warning') : 'info'"
                :label="ldapConfigurationForm.enabled ? (ldapConfiguration.configured ? t('settings.ldapEnabled') : t('settings.ldapConfigurationInvalid')) : t('settings.ldapDisabled')"
              />
            </div>
            <div>
              <span>{{ t('settings.ldapDirectoryType') }}</span>
              <strong>{{ ldapDirectoryTypeLabel(ldapConfigurationForm.directory_type) }}</strong>
            </div>
            <div>
              <span>{{ t('settings.ldapSecretStatus') }}</span>
              <strong>{{ ldapConfiguration.bind_password_configured && ldapConfiguration.secret_available ? t('settings.ldapSecretConfigured') : t('settings.ldapSecretMissing') }}</strong>
            </div>
            <div v-if="ldapConfiguration.last_diagnostic_at">
              <span>{{ t('settings.ldapLastDiagnostic') }}</span>
              <strong>{{ ldapConfiguration.last_diagnostic_success ? t('settings.ldapDiagnosticSuccess') : t('settings.ldapDiagnosticFailed') }}</strong>
            </div>
          </div>

          <div class="settings-ldap-panel__grid">
            <el-form-item :label="t('settings.ldapEnabledToggle')" :error="ldapConfigurationFormErrors.enabled">
              <el-switch v-model="ldapConfigurationForm.enabled" :active-text="t('settings.ldapEnabled')" :inactive-text="t('settings.ldapDisabled')" />
            </el-form-item>
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
            <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapPrimaryServer')" :error="ldapConfigurationFormErrors.primary_host">
              <div class="settings-ldap-panel__host-port">
                <el-input v-model="ldapConfigurationForm.primary_host" :placeholder="t('settings.ldapHostPlaceholder')" :disabled="ldapConfigurationSaving" />
                <el-form-item :error="ldapConfigurationFormErrors.primary_port">
                  <el-input-number v-model="ldapConfigurationForm.primary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapPrimaryPortTouched = true" />
                </el-form-item>
              </div>
            </el-form-item>
            <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapSecondaryServer')" :error="ldapConfigurationFormErrors.secondary_host">
              <div class="settings-ldap-panel__host-port">
                <el-input v-model="ldapConfigurationForm.secondary_host" :placeholder="t('settings.ldapOptional')" :disabled="ldapConfigurationSaving" />
                <el-form-item :error="ldapConfigurationFormErrors.secondary_port">
                  <el-input-number v-model="ldapConfigurationForm.secondary_port" :min="1" :max="65535" controls-position="right" :disabled="ldapConfigurationSaving" @change="ldapSecondaryPortTouched = true" />
                </el-form-item>
              </div>
            </el-form-item>
            <el-form-item class="settings-ldap-panel__span-2" :label="t('settings.ldapBaseDn')" :error="ldapConfigurationFormErrors.base_dn">
              <el-input v-model="ldapConfigurationForm.base_dn" :placeholder="t('settings.ldapBaseDnPlaceholder')" :disabled="ldapConfigurationSaving" />
            </el-form-item>
            <el-form-item :label="t('settings.ldapBindAccount')" :error="ldapConfigurationFormErrors.bind_dn">
              <el-input v-model="ldapConfigurationForm.bind_dn" :placeholder="t('settings.ldapBindAccountPlaceholder')" :disabled="ldapConfigurationSaving" />
              <div class="settings-ldap-panel__help">{{ t('settings.ldapBindAccountHelp') }}</div>
            </el-form-item>
            <el-form-item :label="t('settings.ldapBindPassword')" :error="ldapConfigurationFormErrors.bind_password">
              <div v-if="!ldapPasswordEditing" class="settings-ldap-panel__secret-control">
                <el-input :model-value="ldapConfiguration.bind_password_configured ? '••••••••' : ''" readonly :placeholder="t('settings.ldapPasswordNotConfigured')" />
                <el-button link type="primary" @click="ldapPasswordEditing = true">{{ t('settings.ldapUpdatePassword') }}</el-button>
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
              <div class="settings-ldap-panel__help">{{ t('settings.ldapBindPasswordHelp') }}</div>
            </el-form-item>
          </div>

          <el-collapse class="settings-ldap-panel__advanced">
            <el-collapse-item :title="t('settings.ldapAdvancedTitle')" name="advanced">
              <div class="settings-ldap-panel__grid">
                <el-form-item :label="t('settings.ldapUserSearchBase')" :error="ldapConfigurationFormErrors.user_search_base">
                  <el-input v-model="ldapConfigurationForm.user_search_base" :placeholder="t('settings.ldapUseBaseDn')" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapLoginAttribute')" :error="ldapConfigurationFormErrors.user_login_attribute">
                  <el-input v-model="ldapConfigurationForm.user_login_attribute" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapIdentityAttribute')" :error="ldapConfigurationFormErrors.external_id_attribute">
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
                  <div class="settings-ldap-panel__help">{{ t('settings.ldapUserFilterHelp') }}</div>
                </el-form-item>
                <el-form-item :label="t('settings.ldapTlsServerName')" :error="ldapConfigurationFormErrors.tls_server_name">
                  <el-input v-model="ldapConfigurationForm.tls_server_name" :placeholder="t('settings.ldapTlsServerNamePlaceholder')" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapCaCertFile')" :error="ldapConfigurationFormErrors.ca_cert_file">
                  <el-input v-model="ldapConfigurationForm.ca_cert_file" :placeholder="t('settings.ldapCaCertFilePlaceholder')" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapConnectTimeout')" :error="ldapConfigurationFormErrors.connect_timeout">
                  <el-input-number v-model="ldapConfigurationForm.connect_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                </el-form-item>
                <el-form-item :label="t('settings.ldapOperationTimeout')" :error="ldapConfigurationFormErrors.operation_timeout">
                  <el-input-number v-model="ldapConfigurationForm.operation_timeout" :min="1" :max="300" controls-position="right" :disabled="ldapConfigurationSaving" />
                </el-form-item>
              </div>
            </el-collapse-item>
          </el-collapse>

          <div class="settings-ldap-panel__footer">
            <el-button :disabled="!ldapConfigurationDirty || ldapConfigurationSaving" @click="resetLdapConfigurationForm">{{ t('settings.restoreUnsaved') }}</el-button>
            <span>{{ t('settings.ldapUnsavedHint') }}</span>
          </div>
        </el-form>

        <el-alert
          v-if="ldapDiagnosticError"
          class="settings-ldap-panel__diagnostic-error"
          :title="t('settings.ldapDiagnosticRequestFailed')"
          :description="ldapDiagnosticError"
          type="error"
          show-icon
          :closable="false"
        />
        <div v-if="ldapDiagnosticResult" class="settings-ldap-panel__diagnostic">
          <el-alert
            :title="ldapDiagnosticResult.success ? t('settings.ldapDiagnosticSuccess') : t('settings.ldapDiagnosticFailed')"
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
        </div>
      </template>
    </section>
  </PageContent>
</template>
