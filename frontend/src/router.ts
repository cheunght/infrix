import { defineComponent, h, type Component } from "vue";
import { createWebHistory, createRouter, type RouteLocationRaw, type RouteRecordRaw } from "vue-router";
import type { Page } from "./types";

export type SettingsSection =
  | "system"
  | "dictionaries"
  | "organization"
  | "audit"
  | "custom-fields"
  | "tags"
  | "maintenance";
export type AssetConfigSection = "custom-fields" | "tags";

// The old data-center and room sections remain accepted as compatibility input
// for callers and deep links, but both now resolve to the unified locations
// view. Only the locations and rack-view sections are rendered by the app.
export type RackSection = "locations" | "view" | "data-centers" | "rooms";
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

const pageComponents: Partial<Record<Page, () => Promise<Component>>> = {
  dashboard: () => import("./components/DashboardPage.vue"),
  ledger: () => import("./components/AssetLedgerPage.vue"),
  "asset-config": () => import("./components/AssetConfigurationPage.vue"),
  racks: () => import("./components/RackViewPage.vue"),
  repairs: () => import("./components/RepairPage.vue"),
  licenses: () => import("./components/LicensePage.vue"),
  spares: () => import("./components/SparePartPage.vue"),
  inventory: () => import("./components/InventoryPage.vue"),
  settings: () => import("./components/SettingsPage.vue"),
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
  alias: string[] = [],
): RouteRecordRaw => ({
  path,
  name,
  component: pageComponents[page] || RoutePlaceholder,
  alias,
  meta: { page, titleKey, ...extraMeta },
});

export const routes: RouteRecordRaw[] = [
  pageRoute("/", "dashboard", "dashboard", "nav.dashboard", {}, ["/dashboard"]),
  pageRoute("/assets", "assets", "ledger", "asset.title", {}, ["/asset-list", "/ledger"]),
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
    ["/racks-locations"],
  ),
  {
    path: "/racks/data-centers",
    name: "racks-data-centers",
    redirect: (to) => ({ name: "racks-locations", query: to.query }),
    alias: ["/racks-data-centers"],
  },
  {
    path: "/racks/rooms",
    name: "racks-rooms",
    redirect: (to) => ({ name: "racks-locations", query: to.query }),
    alias: ["/racks-rooms"],
  },
  pageRoute(
    "/racks/view",
    "racks-view",
    "racks",
    "nav.rackView",
    { rackSection: "view" },
    ["/racks-view"],
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
    ["/asset-configuration"],
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
    ["/settings-system"],
  ),
  pageRoute(
    "/settings/dictionaries",
    "settings-dictionaries",
    "settings",
    "nav.dictionaries",
    { settingsSection: "dictionaries" },
    ["/settings-dictionaries"],
  ),
  {
    path: "/settings/custom-fields",
    name: "settings-custom-fields",
    redirect: (to) => ({
      name: "asset-configuration",
      query: { ...to.query, tab: "custom-fields" },
    }),
    alias: ["/settings-custom-fields"],
  },
  {
    path: "/settings/tags",
    name: "settings-tags",
    redirect: (to) => ({
      name: "asset-configuration",
      query: { ...to.query, tab: "tags" },
    }),
    alias: ["/settings-tags"],
  },
  pageRoute(
    "/settings/organization",
    "settings-organization",
    "settings",
    "nav.organization",
    { settingsSection: "organization" },
    ["/settings-organization"],
  ),
  pageRoute(
    "/settings/audit",
    "settings-audit",
    "settings",
    "nav.audit",
    { settingsSection: "audit" },
    ["/settings-audit"],
  ),
  pageRoute(
    "/settings/maintenance",
    "settings-maintenance",
    "settings",
    "nav.maintenance",
    { settingsSection: "maintenance" },
    ["/settings-maintenance"],
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
    return { name: `settings-${section}` };
  }
  if (page === "placeholder") return { name: "dashboard" };
  return { name: page };
}
