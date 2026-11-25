import type { MenuInstance } from "element-plus";
import { nextTick, onBeforeUnmount, onMounted, watchPostEffect, type Ref } from "vue";

const menuItemSelector = 'li[role="menuitem"]';
const popupSelector = ".el-menu--popup";

export function useSidebarKeyboard(
  menu: Ref<MenuInstance | undefined>,
  collapsed: Ref<boolean>,
  activeMenu: Readonly<Ref<string>>,
) {
  const root = () => menu.value?.$el as HTMLElement | undefined;
  const items = (list: Element | null | undefined) => Array.from(
    list?.querySelectorAll<HTMLElement>(`:scope > ${menuItemSelector}:not(.is-disabled)`) || [],
  );

  function parentItem(list: HTMLElement): HTMLElement | null {
    const inlineParent = list.parentElement?.closest<HTMLElement>("li.el-sub-menu");
    const popup = list.closest<HTMLElement>(".el-popper.ep-sidebar-popup");
    const group = popup?.className.match(/\bep-sidebar-group-([\w-]+)\b/)?.[1];
    return inlineParent ?? (group ? document.getElementById(`sidebar-group-${group}`) : null);
  }

  function topItem(item: HTMLElement): HTMLElement {
    let current = item;
    while (current.parentElement && current.parentElement !== root()) {
      const parent = parentItem(current.parentElement);
      if (!parent || parent === current) break;
      current = parent;
    }
    return current;
  }

  function setTabStop(item?: HTMLElement) {
    for (const sibling of items(root())) sibling.tabIndex = sibling === item ? 0 : -1;
  }

  watchPostEffect(() => {
    // Element Plus replaces the vertical menu DOM on collapse and sets menuitem tabindex to -1.
    const top = items(root());
    const current = document.activeElement?.closest<HTMLElement>(menuItemSelector);
    const active = activeMenu.value;
    const expanded = !collapsed.value;
    const currentTop = current && topItem(current);
    const activeGroup = active.startsWith("asset-") || active === "spares" ? "asset-menu"
      : active.startsWith("racks-") ? "racks-menu"
      : active.startsWith("settings-") ? "settings" : undefined;
    const activeTop = top.find(item => item.dataset.sidebarItem === active || item.id === `sidebar-group-${activeGroup}`);
    setTabStop((expanded && currentTop && top.includes(currentTop) ? currentTop : undefined)
      || activeTop || top[0]);
  });

  function focusItem(item?: HTMLElement | null) {
    if (!item) return;
    setTabStop(topItem(item));
    item.focus();
  }

  function groupKey(item: HTMLElement) { return item.id.replace(/^sidebar-group-/, ""); }

  async function openGroup(item: HTMLElement) {
    const key = groupKey(item);
    menu.value?.open(key);
    await nextTick();
    if (document.activeElement !== item) return;
    const list = collapsed.value
      ? document.querySelector(`.el-popper.ep-sidebar-group-${key} ${popupSelector}`)
      : item.querySelector(":scope > ul");
    focusItem(items(list)[0]);
  }

  function closeToParent(item: HTMLElement) {
    focusItem(item);
    menu.value?.close(groupKey(item));
  }

  function handleKey(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || !(event.target instanceof HTMLElement)) return;
    const item = event.target.closest<HTMLElement>(menuItemSelector);
    const list = item?.parentElement;
    if (!item || !list || (!root()?.contains(item) && !item.closest(".el-popper.ep-sidebar-popup"))) return;

    const siblings = items(list);
    const index = siblings.indexOf(item);
    const group = item.classList.contains("el-sub-menu");
    const parent = parentItem(list);
    const opened = group && item.getAttribute("aria-expanded") === "true";
    switch (event.key) {
      case "ArrowDown": focusItem(siblings[(index + 1) % siblings.length]); break;
      case "ArrowUp": focusItem(siblings[(index - 1 + siblings.length) % siblings.length]); break;
      case "Home": focusItem(siblings[0]); break;
      case "End": focusItem(siblings[siblings.length - 1]); break;
      case "ArrowRight":
        if (group) void openGroup(item);
        else return;
        break;
      case "ArrowLeft":
      case "Escape":
        if (opened) closeToParent(item);
        else if (parent) closeToParent(parent);
        else return;
        break;
      case "Enter":
      case " ":
        if (group) void openGroup(item);
        else {
          if (collapsed.value) focusItem(topItem(item));
          item.click();
        }
        break;
      case "Tab":
        if (collapsed.value && parent) {
          const top = topItem(item);
          if (parent !== top) menu.value?.close(groupKey(parent));
          closeToParent(top);
        } else if (collapsed.value && opened) closeToParent(item);
        return;
      default: return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  onMounted(() => document.addEventListener("keydown", handleKey, true));
  onBeforeUnmount(() => document.removeEventListener("keydown", handleKey, true));
}
