import { watch, type Ref } from "vue";
import { ApiError, isAbortError } from "../api";
import {
  fieldErrorsToText,
  normalizeApiError,
  clearFieldError,
  type ActionMessageType,
} from "../error-handling";
import type { RequestFn } from "../page-context";
import { i18n, normalizeLocale, type Locale } from "../i18n";
import type { AuthSource } from "../types";
import { roleLabel } from "../business-enums";
import { hasCapability } from "../permissions";

export interface AuthDeps {
  request: RequestFn;
  loadCsrf: (signal?: AbortSignal) => Promise<void>;
  routerReplace: (location: string) => Promise<unknown>;
  syncRouteState: () => void;
  ensureRouteAccess: () => boolean;
  bootstrapApplication: () => Promise<void>;
  bootstrapError: Ref<boolean>;
  resetBootstrap: () => void;
  authenticated: Ref<boolean>;
  authChecked: Ref<boolean>;
  passwordChangeRequired: Ref<boolean>;
  authSource: Ref<AuthSource>;
  isAdmin: Ref<boolean>;
  roleCode: Ref<string>;
  permissions: Ref<string[]>;
  userName: Ref<string>;
  username: Ref<string>;
  password: Ref<string>;
  loginError: Ref<string>;
  showPasswordModal: Ref<boolean>;
  passwordForm: Ref<{ old_password: string; new_password: string; confirm_password: string }>;
  passwordSaving: Ref<boolean>;
  passwordError: Ref<string>;
  passwordFormErrors: Ref<Record<string, string>>;
  showProfileModal: Ref<boolean>;
  profileForm: Ref<{ first_name: string; last_name: string; email: string; locale: Locale }>;
  profileLoading: Ref<boolean>;
  profileSaving: Ref<boolean>;
  profileError: Ref<string>;
  profileFormErrors: Ref<Record<string, string>>;
  roleName: Ref<string>;
  userIsActive: Ref<boolean>;
  lastLogin: Ref<string | null>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  settingsSection: Ref<string>;
  locale: Ref<Locale>;
  setLocale: (value: unknown, persist?: boolean) => Locale;
}

type AuthPayload = {
  username: string;
  display_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_staff: boolean;
  is_admin?: boolean;
  is_active?: boolean;
  role_code?: string | null;
  role_name?: string;
  permissions: string[];
  auth_source?: AuthSource;
  directory_provider?: string | null;
  directory_login_identifier?: string | null;
  directory_last_seen_at?: string | null;
  password_change_required: boolean;
  last_login?: string | null;
  locale?: string;
};

export function useAuth(deps: AuthDeps) {
  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function setActionError(error: unknown, fallback: string): string {
    const message = errorMessage(error, fallback);
    setActionMessage(message, "error");
    return message;
  }

  function watchFieldErrors<T extends object>(
    form: Ref<T>,
    errors: Ref<Record<string, string>>,
    fields: readonly string[],
  ) {
    for (const field of fields) {
      watch(
        () => (form.value as Record<string, unknown>)[field],
        () => {
          if (errors.value[field]) errors.value = clearFieldError(errors.value, field);
        },
      );
    }
  }

  watchFieldErrors(deps.profileForm, deps.profileFormErrors, ["first_name", "last_name", "email"]);
  watchFieldErrors(deps.passwordForm, deps.passwordFormErrors, ["old_password", "new_password", "confirm_password"]);

  function resetPasswordState() {
    deps.passwordForm.value = { old_password: "", new_password: "", confirm_password: "" };
    deps.passwordError.value = "";
    deps.passwordFormErrors.value = {};
  }

  function openPasswordModal() {
    if (deps.authSource.value === "ldap") return;
    resetPasswordState();
    deps.showPasswordModal.value = true;
  }

  function applyAuthPayload(user: AuthPayload) {
    deps.authenticated.value = true;
    deps.username.value = user.username;
    deps.userName.value = user.display_name;
    deps.profileForm.value = {
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      locale: normalizeLocale(user.locale || deps.locale.value),
    };
    deps.setLocale(user.locale || deps.locale.value);
    const roleCode = user.role_code || "";
    deps.roleName.value = roleLabel(roleCode, user.role_name || roleCode);
    deps.userIsActive.value = user.is_active !== false;
    deps.lastLogin.value = user.last_login || null;
    deps.roleCode.value = roleCode;
    deps.permissions.value = user.permissions;
    deps.isAdmin.value = hasCapability(deps.permissions.value, "organization.manage");
    deps.authSource.value = user.auth_source === "ldap" ? "ldap" : "local";
    deps.passwordChangeRequired.value = Boolean(user.password_change_required);
  }

  function clearSessionIdentity() {
    deps.authenticated.value = false;
    deps.isAdmin.value = false;
    deps.authSource.value = "local";
    deps.roleCode.value = "";
    deps.roleName.value = "";
    deps.permissions.value = [];
    deps.userName.value = "";
    deps.username.value = "";
    deps.userIsActive.value = false;
    deps.lastLogin.value = null;
    deps.passwordChangeRequired.value = false;
    deps.showPasswordModal.value = false;
    deps.showProfileModal.value = false;
    deps.profileForm.value = { first_name: "", last_name: "", email: "", locale: deps.locale.value };
    deps.profileError.value = "";
    deps.profileFormErrors.value = {};
    resetPasswordState();
  }

  async function checkAuth(signal?: AbortSignal) {
    try {
      const user = await deps.request<AuthPayload & { username: string }>(
        "/auth/me/",
        signal ? { signal } : undefined,
      );
      applyAuthPayload(user);
      deps.syncRouteState();
      deps.ensureRouteAccess();
      if (deps.passwordChangeRequired.value) openPasswordModal();
      if (!hasCapability(deps.permissions.value, "organization.manage") && deps.settingsSection.value === "organization") {
        deps.settingsSection.value = "system";
      }
    } catch (error) {
      if (isAbortError(error)) return;
      // DRF's session authentication returns 403 when an unauthenticated
      // request has no authentication challenge header.  `/auth/me/` is the
      // session probe, so both 401 and 403 mean that the browser simply needs
      // to return to the login screen; neither should blank the application
      // behind the bootstrap error page.
      if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) throw error;
      clearSessionIdentity();
    } finally {
      deps.authChecked.value = true;
    }
  }

  async function login() {
    deps.loginError.value = "";
    deps.bootstrapError.value = false;
    let sessionEstablished = false;
    try {
      const user = await deps.request<AuthPayload>("/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: deps.username.value, password: deps.password.value }),
      });
      applyAuthPayload(user);
      sessionEstablished = true;
      deps.syncRouteState();
      deps.ensureRouteAccess();
      if (!hasCapability(deps.permissions.value, "organization.manage") && deps.settingsSection.value === "organization") {
        deps.settingsSection.value = "system";
      }
      deps.password.value = "";
      await deps.loadCsrf();
      if (deps.passwordChangeRequired.value) {
        openPasswordModal();
        return;
      }
      if (deps.permissions.value.length === 0) return;
      await deps.bootstrapApplication();
    } catch (error) {
      if (isAbortError(error)) return;
      if (sessionEstablished) {
        deps.bootstrapError.value = true;
        return;
      }
      const normalized = normalizeApiError(error);
      const loginMessage = normalized.kind === "unknown"
        ? normalized.nonFieldErrors[0] || i18n.global.t("auth.loginFailed")
        : normalized.message;
      if (error instanceof ApiError && error.status === 429) {
        const details = error.details as { retry_after?: number } | undefined;
        const retryAfter = Number(details?.retry_after || 0);
        const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 0;
        deps.loginError.value = minutes
          ? `${loginMessage} ${i18n.global.t("auth.loginRetryAfter", { minutes })}`
          : loginMessage;
      } else {
        deps.loginError.value = loginMessage;
      }
    }
  }

  async function logout() {
    try {
      await deps.request("/auth/logout/", { method: "POST" });
    } finally {
      deps.resetBootstrap();
      deps.authenticated.value = false;
      deps.isAdmin.value = false;
      deps.authSource.value = "local";
      deps.roleCode.value = "";
      deps.permissions.value = [];
      deps.userName.value = "";
      deps.username.value = "";
      deps.passwordChangeRequired.value = false;
      deps.showPasswordModal.value = false;
      resetPasswordState();
      deps.showProfileModal.value = false;
      deps.profileForm.value = { first_name: "", last_name: "", email: "", locale: deps.locale.value };
      deps.roleName.value = "";
      deps.userIsActive.value = false;
      deps.lastLogin.value = null;
      await deps.routerReplace("/");
    }
  }

  async function loadProfile() {
    if (deps.profileLoading.value) return false;
    deps.profileLoading.value = true;
    deps.profileError.value = "";
    try {
      const user = await deps.request<AuthPayload>("/auth/me/");
      applyAuthPayload(user);
      return true;
    } catch (error) {
      if (isAbortError(error)) return false;
      deps.profileError.value = errorMessage(error, i18n.global.t("auth.profileLoadFailed"));
      return false;
    } finally {
      deps.profileLoading.value = false;
    }
  }

  async function saveProfile() {
    if (deps.profileSaving.value) return false;
    deps.profileSaving.value = true;
    deps.profileFormErrors.value = {};
    const form = deps.profileForm.value;
    form.first_name = form.first_name.trim();
    form.last_name = form.last_name.trim();
    form.email = form.email.trim();
    form.locale = normalizeLocale(form.locale);
    try {
      const user = await deps.request<AuthPayload>("/auth/me/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name,
          last_name: form.last_name,
          email: form.email,
          locale: form.locale,
        }),
      });
      applyAuthPayload(user);
      deps.showProfileModal.value = false;
      setActionMessage(i18n.global.t("auth.profileSaved"));
      return true;
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.profileFormErrors.value = fieldErrorsToText(
        normalized.fieldErrors,
        ["first_name", "last_name", "email"],
      );
      setActionError(error, i18n.global.t("auth.profileSaveFailed"));
      return false;
    } finally {
      deps.profileSaving.value = false;
    }
  }

  async function changePassword() {
    if (deps.passwordSaving.value) return;
    deps.passwordSaving.value = true;
    deps.passwordError.value = "";
    deps.passwordFormErrors.value = {};
    try {
      const wasRequired = deps.passwordChangeRequired.value;
      await deps.request("/auth/change-password/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old_password: deps.passwordForm.value.old_password,
          new_password: deps.passwordForm.value.new_password,
          confirm_password: deps.passwordForm.value.confirm_password,
        }),
      });
      deps.showPasswordModal.value = false;
      deps.passwordChangeRequired.value = false;
      deps.passwordError.value = "";
      deps.passwordForm.value = { old_password: "", new_password: "", confirm_password: "" };
      setActionMessage(i18n.global.t("auth.passwordChanged"));
      if (wasRequired) await deps.bootstrapApplication();
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.passwordFormErrors.value = fieldErrorsToText(
        normalized.fieldErrors,
        ["old_password", "new_password", "confirm_password"],
      );
      deps.passwordError.value = errorMessage(error, i18n.global.t("auth.passwordChangeFailed"));
    } finally {
      deps.passwordSaving.value = false;
    }
  }

  return { checkAuth, login, logout, loadProfile, saveProfile, changePassword, openPasswordModal };
}
