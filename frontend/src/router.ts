import { defineComponent, h, type Component } from "vue";
import { createWebHistory, createRouter, type RouteLocationRaw, type RouteRecordRaw } from "vue-router";
import type { Page } from "./types";
import DashboardPage from "./components/DashboardPage.vue";
import AssetLedgerPage from "./components/AssetLedgerPage.vue";
import RackViewPage from "./components/RackViewPage.vue";
import RepairPage from "./components/RepairPage.vue";
import LicensePage from "./components/LicensePage.vue";
import SparePartPage from "./components/SparePartPage.vue";
import InventoryPage from "./components/InventoryPage.vue";
import SettingsPage from "./components/SettingsPage.vue";

export type SettingsSection =
  | "dictionaries"
  | "organization"
  | "audit"
  | "custom-fields"
  | "tags";

export type RackSection = "view" | "rooms";

// App.vue owns the shell and page data context; routed records select the page
// component while their meta remains the source of truth for navigation state.
const RoutePlaceholder = defineComponent({
  name: "RoutePlaceholder",
  setup() {
    return () => h("span");
  },
});

const pageComponents: Partial<Record<Page, Component>> = {
  dashboard: DashboardPage,
  ledger: AssetLedgerPage,
  racks: RackViewPage,
  repairs: RepairPage,
  licenses: LicensePage,
  spares: SparePartPage,
  inventory: InventoryPage,
  settings: SettingsPage,
};

declare module "vue-router" {
  interface RouteMeta {
    page?: Page;
    title?: string;
    settingsSection?: SettingsSection;
    rackSection?: RackSection;
  }
}

const pageRoute = (
  path: string,
  name: string,
  page: Page,
  title: string,
  extraMeta: Record<string, unknown> = {},
  alias: string[] = [],
): RouteRecordRaw => ({
  path,
  name,
  component: pageComponents[page] || RoutePlaceholder,
  alias,
  meta: { page, title, ...extraMeta },
});

export const routes: RouteRecordRaw[] = [
  pageRoute("/", "dashboard", "dashboard", "仪表盘", {}, ["/dashboard"]),
  pageRoute("/assets", "assets", "ledger", "资产台账", {}, ["/asset-list", "/ledger"]),
  {
    path: "/racks",
    name: "racks",
    redirect: { name: "racks-rooms" },
  },
  pageRoute(
    "/racks/rooms",
    "racks-rooms",
    "racks",
    "机房机柜管理",
    { rackSection: "rooms" },
    ["/racks-rooms"],
  ),
  pageRoute(
    "/racks/view",
    "racks-view",
    "racks",
    "机房机柜管理",
    { rackSection: "view" },
    ["/racks-view"],
  ),
  pageRoute("/licenses", "licenses", "licenses", "软件许可"),
  pageRoute("/inventory", "inventory", "inventory", "盘点中心"),
  pageRoute("/repairs", "repairs", "repairs", "事件中心"),
  pageRoute("/spares", "spares", "spares", "资产管理 / 备件管理"),
  {
    path: "/settings",
    name: "settings",
    redirect: { name: "settings-dictionaries" },
  },
  pageRoute(
    "/settings/dictionaries",
    "settings-dictionaries",
    "settings",
    "系统设置 / 数据字典",
    { settingsSection: "dictionaries" },
    ["/settings-dictionaries"],
  ),
  pageRoute(
    "/settings/custom-fields",
    "settings-custom-fields",
    "settings",
    "系统设置 / 自定义字段",
    { settingsSection: "custom-fields" },
    ["/settings-custom-fields"],
  ),
  pageRoute(
    "/settings/tags",
    "settings-tags",
    "settings",
    "系统设置 / 标签管理",
    { settingsSection: "tags" },
    ["/settings-tags"],
  ),
  pageRoute(
    "/settings/organization",
    "settings-organization",
    "settings",
    "系统设置 / 组织权限",
    { settingsSection: "organization" },
    ["/settings-organization"],
  ),
  pageRoute(
    "/settings/audit",
    "settings-audit",
    "settings",
    "系统设置 / 操作日志",
    { settingsSection: "audit" },
    ["/settings-audit"],
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
  options: { settingsSection?: SettingsSection; rackSection?: RackSection } = {},
): RouteLocationRaw {
  if (page === "ledger") return { name: "assets" };
  if (page === "racks") {
    return { name: options.rackSection === "view" ? "racks-view" : "racks-rooms" };
  }
  if (page === "settings") {
    const section = options.settingsSection || "dictionaries";
    return { name: `settings-${section}` };
  }
  if (page === "placeholder") return { name: "dashboard" };
  return { name: page };
}
