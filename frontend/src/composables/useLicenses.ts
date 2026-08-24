import { computed, ref, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { DictionaryItem, SoftwareLicense } from "../types";
import type { RequestFn } from "../types/page-context";

export interface LicensesDeps {
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  actionMessage: Ref<string>;
  manufacturers: Ref<DictionaryItem[]>;
  clearRouteQuery?: (keys: string[]) => boolean;
}

export function useLicenses(deps: LicensesDeps) {
  const licenses = ref<SoftwareLicense[]>([]);
  const licenseCount = ref(0);
  const licensePage = ref(1);
  const licensePageSize = ref(50);
  const licenseKeyword = ref("");
  const licenseStatus = ref("");
  const licenseManufacturer = ref("");
  const licenseListLoading = ref(false);
  const licenseListError = ref("");
  const exportingLicenses = ref(false);
  const licenseRequestId = ref(0);
  const licenseSaving = ref(false);
  const deletingLicenseId = ref<number | null>(null);
  const showLicenseModal = ref(false);
  const editingLicense = ref<SoftwareLicense | null>(null);
  const licenseForm = ref({
    name: "",
    manufacturer_id: "",
    license_type: "",
    authorized_count: "0",
    used_count: "0",
    expiry_date: "",
    notes: "",
  });

  function totalPages(total: number) {
    return Math.max(1, Math.ceil(total / licensePageSize.value));
  }

  const licenseManufacturerOptions = computed(() => {
    const currentId = licenseForm.value.manufacturer_id;
    return deps.manufacturers.value.filter((item) => item.is_active || String(item.id) === currentId);
  });
  const licenseManufacturerFilterOptions = computed(() => deps.manufacturers.value);

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
    if (licenseManufacturer.value) params.set("manufacturer", licenseManufacturer.value);
    licenseListLoading.value = true;
    licenseListError.value = "";

    try {
      const result = await deps.request<PageResult<SoftwareLicense> | SoftwareLicense[]>(`/licenses/?${params.toString()}`);
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
      if (requestId === licenseRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
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

  function queryValue(query: LocationQuery, key: string): string {
    const value = query[key];
    return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
  }

  function syncFiltersFromQuery(query: LocationQuery) {
    const status = queryValue(query, "status");
    const validStatuses = new Set(["normal", "expiring", "expired", "over_limit"]);
    licenseKeyword.value = queryValue(query, "search");
    licenseStatus.value = validStatuses.has(status) ? status : "";
    const manufacturer = queryValue(query, "manufacturer");
    licenseManufacturer.value = /^\d+$/.test(manufacturer) ? manufacturer : "";
    licensePage.value = 1;
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
    licenseManufacturer.value = "";
    licensePage.value = 1;
    if (deps.clearRouteQuery?.(["status", "search", "manufacturer"])) return;
    void loadLicenses();
  }

  function licenseFilterParams() {
    const params = new URLSearchParams();
    if (licenseKeyword.value.trim()) params.set("search", licenseKeyword.value.trim());
    if (licenseStatus.value) params.set("status", licenseStatus.value);
    if (licenseManufacturer.value) params.set("manufacturer", licenseManufacturer.value);
    return params;
  }

  async function exportLicenses() {
    if (exportingLicenses.value) return;
    exportingLicenses.value = true;
    const query = buildExportQuery(licenseFilterParams());
    try {
      await deps.download(`/reports/licenses/export/${query ? `?${query}` : ""}`, "软件许可.xlsx");
    } catch (error) {
      deps.actionMessage.value = errorMessage(error, "导出失败，请稍后重试");
    } finally {
      exportingLicenses.value = false;
    }
  }

  function retryLicenseList() {
    void loadLicenses();
  }

  function openLicenseModal(license?: SoftwareLicense) {
    editingLicense.value = license || null;
    licenseForm.value = license
      ? {
          name: license.name,
          manufacturer_id: license.manufacturer ? String(license.manufacturer.id) : "",
          license_type: license.license_type || "",
          authorized_count: String(license.authorized_count ?? 0),
          used_count: String(license.used_count ?? 0),
          expiry_date: license.expiry_date || "",
          notes: license.notes || "",
        }
      : {
          name: "",
          manufacturer_id: "",
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
          manufacturer_id: licenseForm.value.manufacturer_id ? Number(licenseForm.value.manufacturer_id) : null,
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
    licenses, licenseCount, licensePage, licensePageSize, licenseKeyword, licenseStatus, licenseManufacturer,
    licenseManufacturerOptions, licenseManufacturerFilterOptions,
    licenseListLoading, licenseListError, exportingLicenses, licenseSaving, deletingLicenseId,
    showLicenseModal, editingLicense, licenseForm,
    loadLicenses, searchLicenses, changeLicensePage, changeLicensePageSize,
    resetLicenseFilters, retryLicenseList, syncFiltersFromQuery, openLicenseModal, saveLicense, deleteLicense, exportLicenses,
  };
}
