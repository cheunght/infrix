import type { App, Component } from "vue";
import { ElAlert } from "element-plus/es/components/alert/index.mjs";
import { ElAvatar } from "element-plus/es/components/avatar/index.mjs";
import { ElBadge } from "element-plus/es/components/badge/index.mjs";
import { ElButton } from "element-plus/es/components/button/index.mjs";
import { ElConfigProvider } from "element-plus/es/components/config-provider/index.mjs";
import { ElAside, ElContainer, ElHeader, ElMain } from "element-plus/es/components/container/index.mjs";
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from "element-plus/es/components/dropdown/index.mjs";
import { ElForm, ElFormItem } from "element-plus/es/components/form/index.mjs";
import { ElIcon } from "element-plus/es/components/icon/index.mjs";
import { ElInput } from "element-plus/es/components/input/index.mjs";
import { ElMenu, ElMenuItem, ElSubMenu } from "element-plus/es/components/menu/index.mjs";
import { ElPopover } from "element-plus/es/components/popover/index.mjs";
import { ElResult } from "element-plus/es/components/result/index.mjs";
import { ElLoading } from "element-plus/es/components/loading/index.mjs";
import { ElTooltip } from "element-plus/es/components/tooltip/index.mjs";

export type ElementPlusComponentName =
  | "ElAlert"
  | "ElAside"
  | "ElAvatar"
  | "ElBadge"
  | "ElButton"
  | "ElCard"
  | "ElCheckbox"
  | "ElCollapse"
  | "ElCollapseItem"
  | "ElColorPicker"
  | "ElConfigProvider"
  | "ElContainer"
  | "ElDatePicker"
  | "ElDescriptions"
  | "ElDescriptionsItem"
  | "ElDialog"
  | "ElDivider"
  | "ElDrawer"
  | "ElDropdown"
  | "ElDropdownItem"
  | "ElDropdownMenu"
  | "ElEmpty"
  | "ElForm"
  | "ElFormItem"
  | "ElHeader"
  | "ElIcon"
  | "ElInput"
  | "ElInputNumber"
  | "ElMain"
  | "ElMenu"
  | "ElMenuItem"
  | "ElOption"
  | "ElPagination"
  | "ElPopover"
  | "ElProgress"
  | "ElRadioButton"
  | "ElRadioGroup"
  | "ElResult"
  | "ElSelect"
  | "ElSkeleton"
  | "ElStatistic"
  | "ElStep"
  | "ElSteps"
  | "ElSubMenu"
  | "ElSwitch"
  | "ElTabPane"
  | "ElTable"
  | "ElTableColumn"
  | "ElTabs"
  | "ElTag"
  | "ElText"
  | "ElTooltip"
  | "ElUpload";

const shellComponents: Record<string, Component> = {
  ElAlert,
  ElAside,
  ElAvatar,
  ElBadge,
  ElButton,
  ElConfigProvider,
  ElContainer,
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElForm,
  ElFormItem,
  ElHeader,
  ElIcon,
  ElInput,
  ElMain,
  ElMenu,
  ElMenuItem,
  ElPopover,
  ElResult,
  ElSubMenu,
  ElTooltip,
};

const componentLoaders: Partial<Record<ElementPlusComponentName, () => Promise<Component>>> = {
  ElCard: () => import("element-plus/es/components/card/index.mjs").then((module) => module.ElCard),
  ElCheckbox: () => import("element-plus/es/components/checkbox/index.mjs").then((module) => module.ElCheckbox),
  ElCollapse: () => import("element-plus/es/components/collapse/index.mjs").then((module) => module.ElCollapse),
  ElCollapseItem: () => import("element-plus/es/components/collapse/index.mjs").then((module) => module.ElCollapseItem),
  ElColorPicker: () => import("element-plus/es/components/color-picker/index.mjs").then((module) => module.ElColorPicker),
  ElDatePicker: () => import("element-plus/es/components/date-picker/index.mjs").then((module) => module.ElDatePicker),
  ElDescriptions: () => import("element-plus/es/components/descriptions/index.mjs").then((module) => module.ElDescriptions),
  ElDescriptionsItem: () => import("element-plus/es/components/descriptions/index.mjs").then((module) => module.ElDescriptionsItem),
  ElDialog: () => import("element-plus/es/components/dialog/index.mjs").then((module) => module.ElDialog),
  ElDivider: () => import("element-plus/es/components/divider/index.mjs").then((module) => module.ElDivider),
  ElDrawer: () => import("element-plus/es/components/drawer/index.mjs").then((module) => module.ElDrawer),
  ElEmpty: () => import("element-plus/es/components/empty/index.mjs").then((module) => module.ElEmpty),
  ElInputNumber: () => import("element-plus/es/components/input-number/index.mjs").then((module) => module.ElInputNumber),
  ElOption: () => import("element-plus/es/components/select/index.mjs").then((module) => module.ElOption),
  ElPagination: () => import("element-plus/es/components/pagination/index.mjs").then((module) => module.ElPagination),
  ElProgress: () => import("element-plus/es/components/progress/index.mjs").then((module) => module.ElProgress),
  ElRadioButton: () => import("element-plus/es/components/radio/index.mjs").then((module) => module.ElRadioButton),
  ElRadioGroup: () => import("element-plus/es/components/radio/index.mjs").then((module) => module.ElRadioGroup),
  ElSelect: () => import("element-plus/es/components/select/index.mjs").then((module) => module.ElSelect),
  ElSkeleton: () => import("element-plus/es/components/skeleton/index.mjs").then((module) => module.ElSkeleton),
  ElStatistic: () => import("element-plus/es/components/statistic/index.mjs").then((module) => module.ElStatistic),
  ElStep: () => import("element-plus/es/components/steps/index.mjs").then((module) => module.ElStep),
  ElSteps: () => import("element-plus/es/components/steps/index.mjs").then((module) => module.ElSteps),
  ElSwitch: () => import("element-plus/es/components/switch/index.mjs").then((module) => module.ElSwitch),
  ElTabPane: () => import("element-plus/es/components/tabs/index.mjs").then((module) => module.ElTabPane),
  ElTable: () => import("element-plus/es/components/table/index.mjs").then((module) => module.ElTable),
  ElTableColumn: () => import("element-plus/es/components/table/index.mjs").then((module) => module.ElTableColumn),
  ElTabs: () => import("element-plus/es/components/tabs/index.mjs").then((module) => module.ElTabs),
  ElTag: () => import("element-plus/es/components/tag/index.mjs").then((module) => module.ElTag),
  ElText: () => import("element-plus/es/components/text/index.mjs").then((module) => module.ElText),
  ElUpload: () => import("element-plus/es/components/upload/index.mjs").then((module) => module.ElUpload),
};

let registeredApp: App | null = null;
const componentPromises = new Map<ElementPlusComponentName, Promise<void>>();

export function registerShellElementComponents(app: App) {
  registeredApp = app;
  Object.entries(shellComponents).forEach(([name, component]) => app.component(name, component));
  app.directive("loading", ElLoading.directive);
}

export function ensureElementPlusComponents(
  names: readonly ElementPlusComponentName[],
): Promise<void> {
  if (!registeredApp) {
    return Promise.reject(new Error("Element Plus component registry is not initialized"));
  }

  const uniqueNames = [...new Set(names)];
  return Promise.all(uniqueNames.map((name) => {
    const loader = componentLoaders[name];
    if (!loader || shellComponents[name]) return Promise.resolve();

    const existing = componentPromises.get(name);
    if (existing) return existing;

    const promise = loader()
      .then((component) => {
        registeredApp?.component(name, component);
      })
      .catch((error) => {
        componentPromises.delete(name);
        throw error;
      });
    componentPromises.set(name, promise);
    return promise;
  })).then(() => undefined);
}
