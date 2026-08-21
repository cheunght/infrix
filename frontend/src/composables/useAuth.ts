import type { Ref } from "vue";
import { ApiError } from "../api";
import type { RequestFn } from "../types/page-context";

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
  passwordForm: Ref<{ old_password: string; new_password: string }>;
  actionMessage: Ref<string>;
  settingsSection: Ref<string>;
}

type AuthPayload = {
  username: string;
  display_name: string;
  is_staff: boolean;
  role_code: string;
  permissions: string[];
  password_change_required: boolean;
};

export function useAuth(deps: AuthDeps) {
  async function checkAuth() {
    try {
      const user = await deps.request<AuthPayload & { username: string }>("/auth/me/");
      deps.authenticated.value = true;
      deps.username.value = user.username;
      deps.userName.value = user.display_name;
      deps.isAdmin.value = user.is_staff;
      deps.roleCode.value = user.role_code;
      deps.permissions.value = user.permissions;
      deps.passwordChangeRequired.value = Boolean(user.password_change_required);
      deps.syncRouteState();
      deps.ensureRouteAccess();
      if (deps.passwordChangeRequired.value) deps.showPasswordModal.value = true;
      if (!deps.isAdmin.value && deps.settingsSection.value === "organization") {
        deps.settingsSection.value = "dictionaries";
      }
    } catch {
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
      deps.authenticated.value = true;
      deps.username.value = user.username;
      deps.userName.value = user.display_name;
      deps.isAdmin.value = user.is_staff;
      deps.roleCode.value = user.role_code;
      deps.permissions.value = user.permissions;
      deps.passwordChangeRequired.value = Boolean(user.password_change_required);
      deps.syncRouteState();
      deps.ensureRouteAccess();
      if (!deps.isAdmin.value && deps.settingsSection.value === "organization") {
        deps.settingsSection.value = "dictionaries";
      }
      deps.password.value = "";
      await deps.loadCsrf();
      if (deps.passwordChangeRequired.value) {
        deps.showPasswordModal.value = true;
        return;
      }
      await deps.bootstrapApplication();
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        const details = error.details as { retry_after?: number } | undefined;
        const retryAfter = Number(details?.retry_after || 0);
        const minutes = retryAfter ? Math.ceil(retryAfter / 60) : 0;
        deps.loginError.value = minutes
          ? `${error.message}（约 ${minutes} 分钟后重试）`
          : error.message;
      } else {
        deps.loginError.value = error instanceof Error ? error.message : "登录失败";
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
      await deps.routerReplace("/");
    }
  }

  async function changePassword() {
    try {
      const wasRequired = deps.passwordChangeRequired.value;
      await deps.request("/auth/change-password/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(deps.passwordForm.value),
      });
      deps.showPasswordModal.value = false;
      deps.passwordChangeRequired.value = false;
      deps.passwordForm.value = { old_password: "", new_password: "" };
      deps.actionMessage.value = "密码已修改，请妥善保存";
      if (wasRequired) await deps.bootstrapApplication();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "修改失败";
    }
  }

  return { checkAuth, login, logout, changePassword };
}
