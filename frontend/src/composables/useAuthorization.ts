import { computed, type ComputedRef, type Ref } from "vue";
import { hasCapability } from "../permissions";
import { roleLabel } from "../business-enums";
import type { AuthorizationSnapshot } from "../types";

export const emptyAuthorizationSnapshot = (): AuthorizationSnapshot => ({
  primary_role_code: null,
  roles: [],
  capabilities: [],
  is_system_admin: false,
});

export function normalizeAuthorizationSnapshot(value: unknown): AuthorizationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAuthorizationSnapshot();
  const source = value as Record<string, unknown>;
  const roles = Array.isArray(source.roles)
    ? source.roles.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const role = item as Record<string, unknown>;
        if (typeof role.code !== "string" || typeof role.name !== "string") return [];
        return [{ code: role.code, name: role.name }];
      })
    : [];
  const capabilities = Array.isArray(source.capabilities)
    ? source.capabilities.filter((item): item is string => typeof item === "string")
    : [];
  const primary = typeof source.primary_role_code === "string" ? source.primary_role_code : null;
  return {
    primary_role_code: primary,
    roles,
    capabilities,
    is_system_admin: Boolean(source.is_system_admin),
  };
}

export interface AuthorizationController {
  authorization: Ref<AuthorizationSnapshot>;
  permissions: ComputedRef<string[]>;
  roleCode: ComputedRef<string>;
  roleName: ComputedRef<string>;
  isAdmin: ComputedRef<boolean>;
  hasBusinessCapability: ComputedRef<boolean>;
  can: (capability: string) => boolean;
  apply: (value: unknown) => void;
  clear: () => void;
}

export function useAuthorization(snapshot: Ref<AuthorizationSnapshot>): AuthorizationController {
  const permissions = computed(() => snapshot.value.capabilities);
  const roleCode = computed(() => snapshot.value.primary_role_code || "");
  const roleName = computed(() => {
    const role = snapshot.value.roles.find((item) => item.code === snapshot.value.primary_role_code);
    return role ? roleLabel(role.code, role.name) : "";
  });
  const isAdmin = computed(() => snapshot.value.is_system_admin || hasCapability(permissions.value, "organization.manage"));
  const hasBusinessCapability = computed(() => snapshot.value.is_system_admin || permissions.value.length > 0);
  const can = (capability: string) => snapshot.value.is_system_admin || hasCapability(permissions.value, capability);

  function apply(value: unknown) {
    snapshot.value = normalizeAuthorizationSnapshot(value);
  }

  function clear() {
    snapshot.value = emptyAuthorizationSnapshot();
  }

  return {
    authorization: snapshot,
    permissions,
    roleCode,
    roleName,
    isAdmin,
    hasBusinessCapability,
    can,
    apply,
    clear,
  };
}
