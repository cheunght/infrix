import { ref, type Ref } from "vue";
import { pageItems, pageTotal, type PageResult } from "../api";
import type { SoftwareLicense } from "../types";
import type { RequestFn } from "../types/page-context";

export interface LicensesDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  actionMessage: Ref<string>;
}

export function useLicenses(deps: LicensesDeps) {
  const licenses = ref<SoftwareLicense[]>([]);
  const licenseCount = ref(0);
  const licensePage = ref(1);
  const licensePageSize = ref(50);
  const licenseKeyword = ref("");
  const licenseStatus = ref("");
  const showLicenseModal = ref(false);
  const editingLicense = ref<SoftwareLicense | null>(null);
  const licenseForm = ref({
    name: "",
    vendor: "",
    license_type: "",
    authorized_count: "0",
    used_count: "0",
    expiry_date: "",
    notes: "",
  });

  async function loadLicenses(version = deps.beginLoad()) {
    const params = new URLSearchParams({
      page: String(licensePage.value),
      page_size: String(licensePageSize.value),
    });
    if (licenseKeyword.value.trim()) params.set("search", licenseKeyword.value.trim());
    if (licenseStatus.value) params.set("status", licenseStatus.value);
    const result = await deps.request<PageResult<SoftwareLicense> | SoftwareLicense[]>(`/licenses/?${params.toString()}`);
    if (!deps.isCurrentLoad(version)) return;
    licenses.value = pageItems(result);
    licenseCount.value = pageTotal(result);
  }

  function searchLicenses() {
    licensePage.value = 1;
    void loadLicenses();
  }
  function changeLicensePage(page: number) {
    licensePage.value = Math.max(1, page);
    void loadLicenses();
  }
  function changeLicensePageSize(size: number) {
    licensePageSize.value = size;
    licensePage.value = 1;
    void loadLicenses();
  }
  function openLicenseModal(license?: SoftwareLicense) {
    editingLicense.value = license || null;
    licenseForm.value = license
      ? {
          name: license.name,
          vendor: license.vendor || "",
          license_type: license.license_type || "",
          authorized_count: String(license.authorized_count ?? 0),
          used_count: String(license.used_count ?? 0),
          expiry_date: license.expiry_date || "",
          notes: license.notes || "",
        }
      : {
          name: "",
          vendor: "",
          license_type: "",
          authorized_count: "0",
          used_count: "0",
          expiry_date: "",
          notes: "",
        };
    showLicenseModal.value = true;
  }
  async function saveLicense() {
    try {
      const method = editingLicense.value ? "PATCH" : "POST";
      const path = editingLicense.value ? `/licenses/${editingLicense.value.id}/` : "/licenses/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...licenseForm.value,
          authorized_count: Number(licenseForm.value.authorized_count),
          used_count: Number(licenseForm.value.used_count),
          expiry_date: licenseForm.value.expiry_date || null,
        }),
      });
      showLicenseModal.value = false;
      editingLicense.value = null;
      deps.actionMessage.value = "许可证已保存";
      await loadLicenses();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "许可证保存失败";
    }
  }
  async function deleteLicense(license: SoftwareLicense) {
    if (!(await deps.confirmAction(`确定删除许可证“${license.name}”吗？`))) return;
    try {
      await deps.request(`/licenses/${license.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "许可证已删除";
      await loadLicenses();
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "许可证删除失败";
    }
  }

  return {
    licenses, licenseCount, licensePage, licensePageSize, licenseKeyword, licenseStatus,
    showLicenseModal, editingLicense, licenseForm,
    loadLicenses, searchLicenses, changeLicensePage, changeLicensePageSize,
    openLicenseModal, saveLicense, deleteLicense,
  };
}
