import { computed, nextTick, ref, type Ref } from "vue";
import type { FormInstance, FormRules } from "element-plus";
import { revisionHeaders } from "../revision";
import { fieldErrorsToText, normalizeApiError, type ActionMessageType } from "../error-handling";
import { i18n } from "../i18n";
import { systemSettingsState } from "../system-settings";
import type { ManagedUser } from "../types";
import type { OrganizationSettingsDeps } from "./useOrganizationSettings";
const tr = (key: string, params?: Record<string, unknown>): string => String(params ? i18n.global.t(key, params) : i18n.global.t(key));
type FormErrors = Record<string, string>;
const extractFieldErrors = (error: unknown, fields: readonly string[]) => fieldErrorsToText(normalizeApiError(error).fieldErrors, fields);
interface AccountEditorDeps extends OrganizationSettingsDeps {
  refreshUsers: () => Promise<boolean>;
  userListError: Ref<string>;
  notify: (message: string, type?: ActionMessageType) => void;
  notifyError: (error: unknown, fallback: string) => unknown;
}
export function useAccountEditor(deps: AccountEditorDeps) {
  let editorSequence = 0;
  const showUserModal = ref(false);
  const editingUser = ref<ManagedUser | null>(null);
  const userForm = ref({
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_password: "",
    is_active: true,
    role_code: "auditor",
    person_id: "",
  });
  const userFormRef = ref<FormInstance>();

  const userSaving = ref(false);
  const userFormErrors = ref<FormErrors>({});

  const userFormRules = computed<FormRules>(() => ({
    username: [{ required: true, message: tr("settings.usernameRequired"), trigger: "blur" }],
    last_name: [{ required: true, message: tr("settings.lastNameRequired"), trigger: "blur" }],
    first_name: [{ required: true, message: tr("settings.firstNameRequired"), trigger: "blur" }],
    email: [{ type: "email", message: tr("validation.invalidEmail"), trigger: ["blur", "change"] }],
    role_code: [{ required: true, message: tr("settings.roleRequired"), trigger: "change" }],
    password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(value || "");
          if (!editingUser.value && !password) callback(new Error(tr("settings.passwordRequired")));
          else if (password && password.length < systemSettingsState.passwordMinLength) {
            callback(new Error(tr("validation.passwordMin", { min: systemSettingsState.passwordMinLength })));
          }
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
    confirm_password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(userForm.value.password || "");
          const confirmation = String(value || "");
          if (editingUser.value && !password && !confirmation) callback();
          else if (!confirmation) callback(new Error(tr("settings.confirmPasswordRequired")));
          else if (confirmation !== password) callback(new Error(tr("validation.passwordMismatch")));
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
  }));

  function openUserModal(user?: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    editorSequence += 1;
    editingUser.value = user ? {...user} : null;
    userFormErrors.value = {};
    userForm.value = user
      ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          password: "",
          confirm_password: "",
          is_active: user.is_active,
          role_code: user.primary_role_code || user.roles[0]?.code || "",
          person_id: user.person?.id ? String(user.person.id) : "",
        }
      : {
          username: "",
          first_name: "",
          last_name: "",
          email: "",
          password: "",
          confirm_password: "",
          is_active: true,
          role_code: "auditor",
          person_id: "",
        };
    showUserModal.value = true;
    nextTick(() => userFormRef.value?.clearValidate());
  }


  function userProtectionReason(user: ManagedUser): string {
    if (user.is_superuser) return tr("settings.superuserProtected");
    if (user.username === deps.currentUsername.value) return tr("settings.currentUserProtected");
    return "";
  }


  function userDeleteProtectionReason(user: ManagedUser): string {
    if (user.auth_source === "ldap") return tr("settings.directoryUserProtected");
    return userProtectionReason(user);
  }


  function canChangeUserRole(user: ManagedUser): boolean {
    return !user.is_superuser && user.username !== deps.currentUsername.value;
  }


  async function saveUser() {
    if (!deps.can("organization.manage")) return;
    if (userSaving.value) return;
    const editor = editorSequence;
    const target = editingUser.value ? { ...editingUser.value } : null;
    const form = { ...userForm.value };
    userSaving.value = true;
    let saved = false;
    try {
      const valid = await userFormRef.value?.validate().then(() => true).catch(() => false);
      if (!valid || editor !== editorSequence) return;
      const normalizingMultipleRoles = Boolean(
        target?.role_anomaly === "multiple",
      );
      if (
        normalizingMultipleRoles
        && !(await deps.confirmAction(tr("settings.normalizeRolesConfirm")))
      ) return;
      if (editor !== editorSequence) return;
      const method = target ? "PATCH" : "POST";
      const path = target ? `/users/${target.id}/` : "/users/";
      await deps.request(path, {
        method,
        headers: revisionHeaders(target),
        body: JSON.stringify({
          ...(!target ? { username: form.username } : {}),
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          is_active: form.is_active,
          role_code: form.role_code,
          ...(normalizingMultipleRoles ? { normalize_roles: true } : {}),
          ...(!target && form.person_id
            ? { person_id: Number(form.person_id) }
            : {}),
          ...(!target && form.password ? { password: form.password } : {}),
        }),
      });
      saved = true;
    } catch (error) {
      if (editor !== editorSequence) return;
      userFormErrors.value = extractFieldErrors(error, [
        "username",
        "first_name",
        "last_name",
        "email",
        "role_code",
        "person_id",
        "password",
      ]);
      deps.notifyError(error, tr("settings.userSaveFailed"));
    } finally {
      userSaving.value = false;
    }
    if (!saved) return;
    if (editor === editorSequence) showUserModal.value = false;
    deps.notify(tr("settings.userSaved"));
    const refreshed = await deps.refreshUsers();
    if (!refreshed && deps.userListError.value) deps.notify(tr("settings.userSavedRefreshFailed"), "error");
  }


  return { showUserModal, editingUser, userForm, userFormRef, userFormRules, userSaving, userFormErrors, openUserModal, saveUser, userProtectionReason, userDeleteProtectionReason, canChangeUserRole };
}
