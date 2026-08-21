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
  const licenseListLoading = ref(false);
  const licenseListError = ref("");
  const licenseRequestId = ref(0);
  const licenseSaving = ref(false);
  const deletingLicenseId = ref<number | null>(null);
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

  function totalPages(total: number) {
    return Math.max(1, Math.ceil(total / licensePageSize.value));
  }

  function errorMessage(error: unknown, fallback: string) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  async function loadLicenses(version = deps.beginLoad()): Promise<boolean> {
    const requestId = ++licenseRequestId.value;
    const requestedPage = licensePage.value;
    const params = new URLSearchParams({
      page: String(requestedPage),
      page_size: String(licensePageSize.value),
    });
    if (licenseKeyword.value.trim()) params.set("search", licenseKeyword.value.trim());
    if (licenseStatus.value) params.set("status", licenseStatus.value);
    licenseListLoading.value = true;
    licenseListError.value = "";

    try {
      const result = await deps.request<PageResult<SoftwareLicense> | SoftwareLicense[]>(`/licenses/?${params.toString()}`);
      // apiClient returns undefined for an intentionally aborted request. Do
      // not turn that into an empty list or an error state.
      if (result == null) return false;
      if (requestId !== licenseRequestId.value || !deps.isCurrentLoad(version)) return false;

      const nextCount = pageTotal(result);
      const maxPage = totalPages(nextCount);
      if (requestedPage > maxPage) {
        licensePage.value = maxPage;
        // Re-fetch once with the corrected page. The request id changes, so
        // the stale response cannot update rows or loading state.
        return await loadLicenses(version);
      }

      licenses.value = pageItems(result);
      licenseCount.value = nextCount;
      return true;
    } catch (error) {
      if (requestId === licenseRequestId.value && deps.isCurrentLoad(version)) {
        licenseListError.value = errorMessage(error, "许可证数据加载失败");
      }
      return false;
    } finally {
      if (requestId === licenseRequestId.value) licenseListLoading.value = false;
    }
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

  function resetLicenseFilters() {
    licenseKeyword.value = "";
    licenseStatus.value = "";
    licensePage.value = 1;
    void loadLicenses();
  }

  function retryLicenseList() {
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
  async function saveLicense(): Promise<boolean> {
    if (licenseSaving.value) return false;
    licenseSaving.value = true;
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
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "许可证保存失败";
      return false;
    } finally {
      licenseSaving.value = false;
    }

    showLicenseModal.value = false;
    editingLicense.value = null;
    deps.actionMessage.value = "许可证已保存";
    const refreshed = await loadLicenses();
    if (!refreshed && licenseListError.value)
      deps.actionMessage.value = "许可证已保存，但列表刷新失败";
    return true;
  }

  async function deleteLicense(license: SoftwareLicense): Promise<void> {
    if (deletingLicenseId.value === license.id) return;
    deletingLicenseId.value = license.id;
    try {
      if (!(await deps.confirmAction(`确定删除许可证“${license.name}”吗？`))) return;
      await deps.request(`/licenses/${license.id}/`, { method: "DELETE" });
      deps.actionMessage.value = "许可证已删除";
      const refreshed = await loadLicenses();
      if (!refreshed && licenseListError.value)
        deps.actionMessage.value = "许可证已删除，但列表刷新失败";
    } catch (error) {
      deps.actionMessage.value = error instanceof Error ? error.message : "许可证删除失败";
    } finally {
      deletingLicenseId.value = null;
    }
  }

  return {
    licenses, licenseCount, licensePage, licensePageSize, licenseKeyword, licenseStatus,
    licenseListLoading, licenseListError, licenseSaving, deletingLicenseId,
    showLicenseModal, editingLicense, licenseForm,
    loadLicenses, searchLicenses, changeLicensePage, changeLicensePageSize,
    resetLicenseFilters, retryLicenseList, openLicenseModal, saveLicense, deleteLicense,
  };
}
