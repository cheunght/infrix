import type { Ref } from "vue";
import { ApiError, flattenError, isAbortError } from "../api";
import type { RequestFn } from "../page-context";
import { i18n, normalizeLocale, type Locale } from "../i18n";
import { roleLabel } from "../business-enums";
import { hasCapability } from "../permissions";

export interface AuthDeps {
  request: RequestFn;
  loadCsrf: () => Promise<void>;
  routerReplace: (location: string) => Promise<unknown>;
  syncRouteState: () => void;
  ensureRouteAccess: () => boolean;
  bootstrapApplication: () => Promise<void>;
  authenticated: Ref<boolean>;
  authChecked: Ref<boolean>;
  passwordChangeRequired: Ref<boolean>;
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
  password_change_required: boolean;
  last_login?: string | null;
  locale?: string;
};

export function useAuth(deps: AuthDeps) {
  function resetPasswordState() {
    deps.passwordForm.value = { old_password: "", new_password: "", confirm_password: "" };
    deps.passwordError.value = "";
    deps.passwordFormErrors.value = {};
  }

  function openPasswordModal() {
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
    deps.passwordChangeRequired.value = Boolean(user.password_change_required);
  }

  async function checkAuth() {
    try {
      const user = await deps.request<AuthPayload & { username: string }>("/auth/me/");
      applyAuthPayload(user);
      deps.syncRouteState();
      deps.ensureRouteAccess();
      if (deps.passwordChangeRequired.value) openPasswordModal();
      if (!hasCapability(deps.permissions.value, "organization.manage") && deps.settingsSection.value === "organization") {
        deps.settingsSection.value = "system";
      }
    } catch (error) {
      if (isAbortError(error)) return;
      deps.authenticated.value = false;
      deps.isAdmin.value = false;
      deps.roleCode.value = "";
      deps.permissions.value = [];
      deps.passwordChangeRequired.value = false;
      deps.showPasswordModal.value = false;
    } finally {
      deps.authChecked.value = true;
    }
  }

  async function login() {
    deps.loginError.value = "";
    try {
      const user = await deps.request<AuthPayload>("/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: deps.username.value, password: deps.password.value }),
      });
      applyAuthPayload(user);
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
      await deps.bootstrapApplication();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const details = error.details as { retry_after?: number } | undefined;
        const retryAfter = Number(details?.retry_after || 0);
        const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 0;
        deps.loginError.value = minutes
          ? `${error.message} ${i18n.global.t("auth.loginRetryAfter", { minutes })}`
          : error.message;
      } else {
        deps.loginError.value = error instanceof Error ? error.message : i18n.global.t("auth.loginFailed");
      }
    }
  }

  async function logout() {
    try {
      await deps.request("/auth/logout/", { method: "POST" });
    } finally {
      deps.authenticated.value = false;
      deps.isAdmin.value = false;
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
      deps.profileError.value = error instanceof Error ? error.message : i18n.global.t("auth.profileLoadFailed");
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
      deps.actionMessage.value = i18n.global.t("auth.profileSaved");
      return true;
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
      const source = details && typeof details === "object" && !Array.isArray(details)
        ? details as Record<string, unknown>
        : {};
      deps.profileFormErrors.value = Object.fromEntries(
        ["first_name", "last_name", "email"]
          .map((field) => [field, flattenError(source[field])] as const)
          .filter(([, message]) => Boolean(message)),
      );
      deps.actionMessage.value = error instanceof Error ? error.message : i18n.global.t("auth.profileSaveFailed");
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
      deps.actionMessage.value = i18n.global.t("auth.passwordChanged");
      if (wasRequired) await deps.bootstrapApplication();
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
      const source = details && typeof details === "object" && !Array.isArray(details)
        ? details as Record<string, unknown>
        : {};
      const fieldErrors: Record<string, string> = {};
      if (source.old_password) fieldErrors.old_password = flattenError(source.old_password);
      if (source.new_password) fieldErrors.new_password = flattenError(source.new_password);
      if (source.confirm_password) fieldErrors.confirm_password = flattenError(source.confirm_password);
      if (source.detail && !fieldErrors.old_password && !fieldErrors.new_password) {
        fieldErrors.old_password = flattenError(source.detail);
      }
      deps.passwordFormErrors.value = fieldErrors;
      deps.passwordError.value = error instanceof Error ? error.message : i18n.global.t("auth.passwordChangeFailed");
      deps.actionMessage.value = deps.passwordError.value;
    } finally {
      deps.passwordSaving.value = false;
    }
  }

  return { checkAuth, login, logout, loadProfile, saveProfile, changePassword, openPasswordModal };
}
