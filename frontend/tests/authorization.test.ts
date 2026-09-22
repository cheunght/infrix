import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { ApiError } from "../src/api";
import { normalizeApiError } from "../src/error-handling";
import {
  emptyAuthorizationSnapshot,
  normalizeAuthorizationSnapshot,
  useAuthorization,
} from "../src/composables/useAuthorization";

describe("authorization contract", () => {
  it("normalizes the nested auth/me payload and exposes capability checks", () => {
    const state = ref(emptyAuthorizationSnapshot());
    const authorization = useAuthorization(state);

    authorization.apply({
      primary_role_code: "asset_admin",
      roles: [
        { code: "asset_admin", name: "资产管理员" },
        { code: "auditor", name: "只读审计员" },
      ],
      capabilities: ["assets.view", "settings.manage"],
      is_system_admin: false,
    });

    expect(authorization.roleCode.value).toBe("asset_admin");
    expect(authorization.permissions.value).toEqual(["assets.view", "settings.manage"]);
    expect(authorization.can("assets.view")).toBe(true);
    expect(authorization.can("organization.manage")).toBe(false);
    expect(authorization.hasBusinessCapability.value).toBe(true);
  });

  it("treats system administrators as wildcard capability holders", () => {
    const state = ref({
      primary_role_code: "system_admin",
      roles: [{ code: "system_admin", name: "系统管理员" }],
      capabilities: ["*"],
      is_system_admin: true,
    });
    const authorization = useAuthorization(state);

    expect(authorization.isAdmin.value).toBe(true);
    expect(authorization.can("organization.manage")).toBe(true);
    expect(authorization.can("anything.new")).toBe(true);
  });

  it("ignores malformed roles and maps 401/403 to different error semantics", () => {
    const normalized = normalizeAuthorizationSnapshot({
      roles: [{ code: "auditor", name: "只读审计员" }, { code: 12 }],
      capabilities: ["audit.view", 12],
    });
    expect(normalized.roles).toEqual([{ code: "auditor", name: "只读审计员" }]);
    expect(normalized.capabilities).toEqual(["audit.view"]);

    expect(normalizeApiError(new ApiError(401, "expired")).kind).toBe("authentication");
    expect(normalizeApiError(new ApiError(403, "forbidden")).kind).toBe("permission");
  });
});
