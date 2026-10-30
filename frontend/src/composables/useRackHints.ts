import {
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  shallowRef,
  type InjectionKey,
} from "vue";

export function createRackHints() {
  const active = shallowRef<symbol | null>(null);
  let pending: symbol | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function hide(owner?: symbol) {
    if (!owner || owner === pending) {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    }
    if (!owner || active.value === owner) active.value = null;
  }
  function show(owner: symbol, delay = 300) {
    if (active.value === owner) return;
    hide();
    pending = owner;
    if (!delay) {
      active.value = owner;
      pending = null;
    } else
      timer = setTimeout(() => {
        active.value = owner;
        pending = null;
        timer = undefined;
      }, delay);
  }
  return { active, show, hide };
}

const RackHintsKey: InjectionKey<ReturnType<typeof createRackHints>> =
  Symbol("rack-hints");
export function provideRackHints() {
  const hints = createRackHints();
  provide(RackHintsKey, hints);
  function dismissOutside(event: Event) {
    if (
      !(event.target instanceof Element) ||
      !event.target.closest(".rack-hint-anchor")
    )
      hints.hide();
  }
  const dismiss = () => hints.hide();
  onMounted(() => {
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("pointerdown", dismiss, true);
    window.addEventListener("pointerover", dismissOutside, true);
    window.addEventListener("focusin", dismissOutside, true);
    document.addEventListener("visibilitychange", dismiss);
  });
  onBeforeUnmount(() => {
    dismiss();
    window.removeEventListener("resize", dismiss);
    window.removeEventListener("blur", dismiss);
    window.removeEventListener("scroll", dismiss, true);
    window.removeEventListener("pointerdown", dismiss, true);
    window.removeEventListener("pointerover", dismissOutside, true);
    window.removeEventListener("focusin", dismissOutside, true);
    document.removeEventListener("visibilitychange", dismiss);
  });
  return hints;
}
export function useRackHints() {
  return inject(RackHintsKey, null) || createRackHints();
}
