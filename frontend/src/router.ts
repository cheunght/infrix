import { defineComponent, h, type Component } from "vue";
import { createWebHistory, createRouter, type RouteLocationRaw, type RouteRecordRaw } from "vue-router";
import type { Page } from "./types";
import {
  ensureElementPlusComponents,
  type ElementPlusComponentName,
} from "./element-plus-components";

export type SettingsSection =
  | "system"
  | "dictionaries"
  | "organization"
  | "audit"
  | "custom-fields"
  | "tags"
  | "maintenance";
export type AssetConfigSection = "custom-fields" | "tags";
export type OrganizationTab = "users" | "roles" | "ldap" | "departments" | "people";
export type SystemSettingsTab = "general" | "localization" | "security" | "smtp" | "notifications" | "branding";

export type RackSection = "locations" | "view";
export type LocationTypeFilter = "" | "data-center" | "room";
export type LocationStatusFilter = "" | "active" | "inactive";

// App.vue owns the shell and page data context; routed records select the page
// component while their meta remains the source of truth for navigation state.
const RoutePlaceholder = defineComponent({
  name: "RoutePlaceholder",
  setup() {
    return () => h("span");
  },
});

const lazyPage = (
  loader: () => Promise<Component>,
  elementComponents: readonly ElementPlusComponentName[],
) => async () => {
  await ensureElementPlusComponents(elementComponents);
  return loader();
};

const pageComponents: Partial<Record<Page, () => Promise<Component>>> = {
  dashboard: lazyPage(() => import("./components/DashboardPage.vue"), [
    "ElCard",
    "ElEmpty",
    "ElSkeleton",
    "ElTag",
  ]),
  ledger: lazyPage(() => import("./components/AssetLedgerPage.vue"), [
    "ElCard",
    "ElCheckbox",
    "ElDialog",
    "ElEmpty",
    "ElOption",
    "ElPagination",
    "ElPopover",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  "asset-config": lazyPage(() => import("./components/AssetConfigurationPage.vue"), [
    "ElCard",
    "ElCheckbox",
    "ElDatePicker",
    "ElDialog",
    "ElEmpty",
    "ElInputNumber",
    "ElOption",
    "ElPagination",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  racks: lazyPage(() => import("./components/RackViewPage.vue"), [
    "ElCard",
    "ElDescriptions",
    "ElDescriptionsItem",
    "ElDialog",
    "ElDrawer",
    "ElEmpty",
    "ElInputNumber",
    "ElOption",
    "ElPagination",
    "ElProgress",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  repairs: lazyPage(() => import("./components/RepairPage.vue"), [
    "ElCard",
    "ElEmpty",
    "ElOption",
    "ElPagination",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  licenses: lazyPage(() => import("./components/LicensePage.vue"), [
    "ElCard",
    "ElEmpty",
    "ElOption",
    "ElPagination",
    "ElProgress",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  spares: lazyPage(() => import("./components/SparePartPage.vue"), [
    "ElCard",
    "ElDatePicker",
    "ElDialog",
    "ElDrawer",
    "ElInputNumber",
    "ElOption",
    "ElPagination",
    "ElSelect",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTag",
    "ElTooltip",
  ]),
  inventory: lazyPage(() => import("./components/InventoryPage.vue"), [
    "ElCard",
    "ElDatePicker",
    "ElDialog",
    "ElEmpty",
    "ElInputNumber",
    "ElPagination",
    "ElPopover",
    "ElProgress",
    "ElSelect",
    "ElOption",
    "ElSkeleton",
    "ElTable",
    "ElTableColumn",
    "ElTooltip",
  ]),
  settings: lazyPage(() => import("./components/SettingsPage.vue"), [
    "ElCard",
    "ElCheckbox",
    "ElCollapse",
    "ElCollapseItem",
    "ElDatePicker",
    "ElDescriptions",
    "ElDescriptionsItem",
    "ElDialog",
    "ElDivider",
    "ElDrawer",
    "ElEmpty",
    "ElForm",
    "ElFormItem",
    "ElInput",
    "ElInputNumber",
    "ElOption",
    "ElPagination",
    "ElSelect",
    "ElSkeleton",
    "ElSwitch",
    "ElTabPane",
    "ElTable",
    "ElTableColumn",
    "ElTabs",
    "ElUpload",
    "ElTag",
    "ElText",
    "ElTooltip",
  ]),
};

declare module "vue-router" {
  interface RouteMeta {
    page?: Page;
    title?: string;
    titleKey?: string;
    settingsSection?: SettingsSection;
    assetConfigSection?: AssetConfigSection;
    rackSection?: RackSection;
  }
}

const pageRoute = (
  path: string,
  name: string,
  page: Page,
  titleKey: string,
  extraMeta: Record<string, unknown> = {},
): RouteRecordRaw => ({
  path,
  name,
  component: pageComponents[page] || RoutePlaceholder,
  meta: { page, titleKey, ...extraMeta },
});

export const routes: RouteRecordRaw[] = [
  pageRoute("/", "dashboard", "dashboard", "nav.dashboard"),
  pageRoute("/assets", "assets", "ledger", "asset.title"),
  {
    path: "/racks",
    name: "racks",
    redirect: { name: "racks-locations" },
  },
  pageRoute(
    "/racks/locations",
    "racks-locations",
    "racks",
    "nav.locations",
    { rackSection: "locations" },
  ),
  pageRoute(
    "/racks/view",
    "racks-view",
    "racks",
    "nav.rackView",
    { rackSection: "view" },
  ),
  pageRoute("/licenses", "licenses", "licenses", "license.title"),
  pageRoute("/inventory", "inventory", "inventory", "inventory.title"),
  pageRoute("/repairs", "repairs", "repairs", "nav.repairs"),
  pageRoute("/spares", "spares", "spares", "spare.title"),
  pageRoute(
    "/assets/configuration",
    "asset-configuration",
    "asset-config",
    "nav.customFields",
    { assetConfigSection: "custom-fields" },
  ),
  {
    path: "/settings",
    name: "settings",
    redirect: { name: "settings-system" },
  },
  pageRoute(
    "/settings/system",
    "settings-system",
    "settings",
    "nav.system",
    { settingsSection: "system" },
  ),
  pageRoute(
    "/settings/dictionaries",
    "settings-dictionaries",
    "settings",
    "nav.dictionaries",
    { settingsSection: "dictionaries" },
  ),
  pageRoute(
    "/settings/organization",
    "settings-organization",
    "settings",
    "nav.organization",
    { settingsSection: "organization" },
  ),
  pageRoute(
    "/settings/audit",
    "settings-audit",
    "settings",
    "nav.audit",
    { settingsSection: "audit" },
  ),
  pageRoute(
    "/settings/maintenance",
    "settings-maintenance",
    "settings",
    "nav.maintenance",
    { settingsSection: "maintenance" },
  ),
  {
    path: "/:pathMatch(.*)*",
    redirect: { name: "dashboard" },
  },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ left: 0, top: 0 }),
});

export function routeForPage(
  page: Page,
  options: {
    settingsSection?: SettingsSection;
    organizationTab?: OrganizationTab;
    systemSettingsTab?: SystemSettingsTab;
    assetConfigSection?: AssetConfigSection;
    rackSection?: RackSection;
  } = {},
): RouteLocationRaw {
  if (page === "ledger") return { name: "assets" };
  if (page === "asset-config") {
    return {
      name: "asset-configuration",
      query: { tab: options.assetConfigSection || "custom-fields" },
    };
  }
  if (page === "racks") {
    return {
      name: options.rackSection === "view"
        ? "racks-view"
        : "racks-locations",
    };
  }
  if (page === "settings") {
    const section = options.settingsSection || "system";
    if (section === "custom-fields" || section === "tags") {
      return routeForPage("asset-config", { assetConfigSection: section });
    }
    if (section === "organization" && options.organizationTab && options.organizationTab !== "users") {
      return { name: `settings-${section}`, query: { tab: options.organizationTab } };
    }
    if (section === "system" && options.systemSettingsTab && options.systemSettingsTab !== "general") {
      return { name: `settings-${section}`, query: { tab: options.systemSettingsTab } };
    }
    return { name: `settings-${section}` };
  }
  if (page === "placeholder") return { name: "dashboard" };
  return { name: page };
}
