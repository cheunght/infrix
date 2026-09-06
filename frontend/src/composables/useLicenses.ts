import { computed, ref, watch, type Ref } from "vue";
import type { LocationQuery } from "vue-router";
import { buildExportQuery, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import type { DictionaryItem, LicenseStatus, SoftwareLicense } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { LICENSE_STATUS_OPTIONS } from "../business-enums";
import { i18n } from "../i18n";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

const LICENSE_FORM_FIELDS = [
  "name",
  "manufacturer_id",
  "license_type",
  "authorized_count",
  "used_count",
  "expiry_date",
  "notes",
] as const;
const LICENSE_FORM_FIELD_SET = new Set<string>(LICENSE_FORM_FIELDS);

export interface LicensesDeps {
  can: CapabilityFn;
  request: RequestFn;
  download: (path: string, filename?: string) => Promise<void>;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  manufacturers: Ref<DictionaryItem[]>;
  clearRouteQuery?: (keys: string[]) => boolean;
}

export function useLicenses(deps: LicensesDeps) {
  const licenses = ref<SoftwareLicense[]>([]);
  const licenseCount = ref(0);
  const licensePage = ref(1);
  const licensePageSize = ref(50);
  const licenseKeyword = ref("");
  const licenseStatus = ref<LicenseStatus | "">("");
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
  const licenseFormError = ref("");
  const licenseFormErrors = ref<Record<string, string>>({});

  function totalPages(total: number) {
    return Math.max(1, Math.ceil(total / licensePageSize.value));
  }

  const licenseManufacturerOptions = computed(() => {
    const currentId = licenseForm.value.manufacturer_id;
    return deps.manufacturers.value.filter((item) => item.is_active || String(item.id) === currentId);
  });
  const licenseManufacturerFilterOptions = computed(() => deps.manufacturers.value);

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }

  function safeErrorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function extractFormError(
    error: unknown,
    fallback: string,
  ): { fields: Record<string, string>; message: string } {
    const normalized = normalizeApiError(error);
    const fields = fieldErrorsToText(normalized.fieldErrors, LICENSE_FORM_FIELDS);
    const hasUnknownField = Object.keys(normalized.fieldErrors).some(
      (field) => !LICENSE_FORM_FIELD_SET.has(field),
    );
    const message = normalized.kind === "field-validation" && !hasUnknownField
      ? ""
      : normalized.kind === "unknown"
        ? fallback
        : normalized.message;
    return { fields, message };
  }

  function clearLicenseFormErrors() {
    licenseFormError.value = "";
    licenseFormErrors.value = {};
  }

  for (const field of LICENSE_FORM_FIELDS) {
    watch(
      () => (licenseForm.value as Record<string, unknown>)[field],
      () => {
        if (licenseFormErrors.value[field]) {
          licenseFormErrors.value = clearFieldError(licenseFormErrors.value, field);
        }
      },
    );
  }

  async function loadLicenses(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("licenses.view")) return false;
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
        licenseListError.value = safeErrorMessage(error, tr("license.dataLoadFailed"));
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
    licenseKeyword.value = queryValue(query, "search");
    licenseStatus.value = LICENSE_STATUS_OPTIONS.find((option) => option.value === status)?.value || "";
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
    if (!deps.can("licenses.export")) return;
    if (exportingLicenses.value) return;
    exportingLicenses.value = true;
    const query = buildExportQuery(licenseFilterParams());
    try {
      await deps.download(`/reports/licenses/export/${query ? `?${query}` : ""}`, "software-licenses.xlsx");
    } catch (error) {
      const normalized = normalizeApiError(error);
      deps.actionMessageType.value = "error";
      deps.actionMessage.value = normalized.kind === "unknown" ? tr("license.exportFailed") : normalized.message;
    } finally {
      exportingLicenses.value = false;
    }
  }

  function retryLicenseList() {
    void loadLicenses();
  }

  function openLicenseModal(license?: SoftwareLicense) {
    if (!deps.can("licenses.manage")) return;
    clearLicenseFormErrors();
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
    if (!deps.can("licenses.manage")) return false;
    if (licenseSaving.value) return false;
    clearLicenseFormErrors();
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
      const parsed = extractFormError(error, tr("license.saveFailed"));
      licenseFormErrors.value = parsed.fields;
      licenseFormError.value = parsed.message;
      return false;
    } finally {
      licenseSaving.value = false;
    }

    showLicenseModal.value = false;
    editingLicense.value = null;
    setActionMessage(tr("license.saved"));
    const refreshed = await loadLicenses();
    if (!refreshed && licenseListError.value)
      setActionMessage(tr("license.savedRefreshFailed"), "error");
    return true;
  }

  async function deleteLicense(license: SoftwareLicense): Promise<void> {
    if (!deps.can("licenses.manage")) return;
    if (deletingLicenseId.value === license.id) return;
    deletingLicenseId.value = license.id;
    try {
      if (!(await deps.confirmAction(tr("license.deleteConfirm", { name: license.name })))) return;
      await deps.request(`/licenses/${license.id}/`, { method: "DELETE" });
      setActionMessage(tr("license.deleted"));
      const refreshed = await loadLicenses();
      if (!refreshed && licenseListError.value)
        setActionMessage(tr("license.deletedRefreshFailed"), "error");
    } catch (error) {
      setActionMessage(safeErrorMessage(error, tr("license.deleteFailed")), "error");
    } finally {
      deletingLicenseId.value = null;
    }
  }

  return {
    licenses, licenseCount, licensePage, licensePageSize, licenseKeyword, licenseStatus, licenseManufacturer,
    licenseManufacturerOptions, licenseManufacturerFilterOptions,
    licenseListLoading, licenseListError, exportingLicenses, licenseSaving, deletingLicenseId,
    showLicenseModal, editingLicense, licenseForm, licenseFormError, licenseFormErrors,
    loadLicenses, searchLicenses, changeLicensePage, changeLicensePageSize,
    resetLicenseFilters, retryLicenseList, syncFiltersFromQuery, openLicenseModal, clearLicenseFormErrors, saveLicense, deleteLicense, exportLicenses,
  };
}
