import { computed, ref } from "vue";
import { apiBase } from "./api";
import mark from "./assets/infrix-mark.png";
import wordmark from "./assets/infrix-wordmark.png";

export type Branding = { display_name: string; logo: string | null; compact_logo: string | null; favicon: string | null };
const defaults: Branding = { display_name: "infrix", logo: null, compact_logo: null, favicon: null };
export const branding = ref<Branding>({ ...defaults });
export const brandingLogo = computed(() => branding.value.logo || wordmark);
export const brandingMark = computed(() => branding.value.compact_logo || mark);
let revision = 0;
export function applyBranding(value: Branding) {
  revision += 1;
  branding.value = value;
  document.title = value.display_name;
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = value.favicon || "/platform-icon.png";
}
export function brandingImageFailed(kind: "logo" | "compact_logo") {
  branding.value = { ...branding.value, [kind]: null };
}
export async function loadBranding() {
  const current = ++revision;
  try {
    const response = await fetch(`${apiBase}/branding/`, { credentials: "include" });
    if (!response.ok) return;
    const value = await response.json() as Branding;
    if (current === revision && typeof value.display_name === "string") applyBranding(value);
  } catch {
    // Public display configuration must never block authentication/bootstrap.
  }
}
