import { computed, nextTick, ref, watch, type Ref } from "vue";
import { type FormInstance, type FormRules } from "element-plus";
import { ApiError, isAbortError, pageItems, pageTotal, type PageResult } from "../api";
import {
  clearFieldError,
  fieldErrorsToText,
  normalizeApiError,
  type ActionMessageType,
} from "../error-handling";
import type {
  Department,
  LdapDiagnosticCheck,
  LdapDiagnosticResult,
  LdapConfiguration,
  LdapConfigurationForm,
  LdapStatus,
  ManagedUser,
  Person,
  PersonFormState,
  PersonOption,
  Role,
  UserBatchStatusResponse,
} from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { systemSettingsState } from "../system-settings";
import { i18n } from "../i18n";

const tr = (key: string, params?: Record<string, unknown>): string =>
  String(params ? i18n.global.t(key, params) : i18n.global.t(key));

export interface OrganizationSettingsDeps {
  request: RequestFn;
  beginLoad: () => number;
  isCurrentLoad: (version: number) => boolean;
  confirmAction: (message: string) => Promise<boolean>;
  can: CapabilityFn;
  currentUsername: Ref<string>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
}

type FormErrors = Record<string, string>;

const LDAP_CONFIGURATION_FIELDS = [
  "enabled", "directory_type", "primary_host", "primary_port", "secondary_host", "secondary_port",
  "base_dn", "bind_dn", "bind_password", "security_mode", "tls_server_name", "ca_cert_file",
  "user_search_base", "user_login_attribute", "user_filter", "external_id_attribute",
  "email_attribute", "first_name_attribute", "last_name_attribute", "account_control_attribute",
  "connect_timeout", "operation_timeout",
] as const;

function extractFieldErrors(error: unknown, allowedFields: readonly string[]): FormErrors {
  return fieldErrorsToText(normalizeApiError(error).fieldErrors, allowedFields);
}

export function useOrganizationSettings(deps: OrganizationSettingsDeps) {
  const users = ref<ManagedUser[]>([]);
  const roles = ref<Role[]>([]);
  const userSearch = ref("");
  const userPage = ref(1);
  const userPageSize = ref(20);
  const userCount = ref(0);
  const selectedUserIds = ref<number[]>([]);
  const userBatchSaving = ref(false);
  const userBatchResult = ref<UserBatchStatusResponse | null>(null);
  const showUserBatchResult = ref(false);
  const showUserModal = ref(false);
  const editingUser = ref<ManagedUser | null>(null);
  const userForm = ref({
    username: "",
    first_name: "",
    last_name: "",
    email: "",
    password: "",
    confirm_password: "",
    is_active: true,
    role_code: "auditor",
    person_id: "",
  });
  const userFormRef = ref<FormInstance>();
  const organizationLoading = ref(false);
  const userListError = ref("");
  const roleListError = ref("");
  const organizationRequestId = ref(0);
  const userRequestId = ref(0);
  const userSaving = ref(false);
  const userPendingId = ref<number | null>(null);
  const userFormErrors = ref<FormErrors>({});
  const unlinkedPeople = ref<PersonOption[]>([]);
  const unlinkedPeopleLoading = ref(false);
  const unlinkedPeopleError = ref("");
  const unlinkedPeopleRequestId = ref(0);
  const userFormRules = computed<FormRules>(() => ({
    username: [{ required: true, message: tr("settings.usernameRequired"), trigger: "blur" }],
    last_name: [{ required: true, message: tr("settings.lastNameRequired"), trigger: "blur" }],
    first_name: [{ required: true, message: tr("settings.firstNameRequired"), trigger: "blur" }],
    email: [{ type: "email", message: tr("validation.invalidEmail"), trigger: ["blur", "change"] }],
    role_code: [{ required: true, message: tr("settings.roleRequired"), trigger: "change" }],
    password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(value || "");
          if (!editingUser.value && !password) callback(new Error(tr("settings.passwordRequired")));
          else if (password && password.length < systemSettingsState.passwordMinLength) {
            callback(new Error(tr("validation.passwordMin", { min: systemSettingsState.passwordMinLength })));
          }
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
    confirm_password: [
      {
        validator: (_rule, value, callback) => {
          const password = String(userForm.value.password || "");
          const confirmation = String(value || "");
          if (editingUser.value && !password && !confirmation) callback();
          else if (!confirmation) callback(new Error(tr("settings.confirmPasswordRequired")));
          else if (confirmation !== password) callback(new Error(tr("validation.passwordMismatch")));
          else callback();
        },
        trigger: ["blur", "change"],
      },
    ],
  }));
  const departments = ref<Department[]>([]);
  const departmentOptions = ref<Department[]>([]);
  const departmentTotal = ref(0);
  const departmentPage = ref(1);
  const departmentPageSize = ref(50);
  const departmentSearch = ref("");
  const departmentLoading = ref(false);
  const departmentError = ref("");
  const departmentRequestId = ref(0);
  let departmentController: AbortController | null = null;
  const departmentSaving = ref(false);
  const departmentActionId = ref<number | null>(null);
  const departmentFormErrors = ref<FormErrors>({});
  const showDepartmentModal = ref(false);
  const editingDepartment = ref<Department | null>(null);
  const departmentForm = ref({ name: "", code: "", parent: "" });

  const responsibilityDirectorySubjects = ref<Person[]>([]);
  const responsibilityDirectoryTotal = ref(0);
  const responsibilityDirectoryPage = ref(1);
  const responsibilityDirectoryPageSize = ref(20);
  const responsibilityDirectorySearch = ref("");
  const responsibilityDirectoryType = ref("");
  const responsibilityDirectoryActive = ref("true");
  const responsibilityDirectoryLoading = ref(false);
  const responsibilityDirectoryError = ref("");
  const responsibilityDirectorySaving = ref(false);
  const responsibilityDirectoryActionId = ref<number | null>(null);
  const responsibilityDirectoryFormErrors = ref<FormErrors>({});
  const responsibilityDirectoryForm = ref<PersonFormState>({
    name: "",
    employee_no: "",
    department: "",
    email: "",
    organization: "",
    contact: "",
    is_active: true,
  });
  const editingResponsibilitySubject = ref<Person | null>(null);
  const showResponsibilitySubjectModal = ref(false);
  const responsibilityDirectoryRequestId = ref(0);
  let responsibilityDirectoryController: AbortController | null = null;

  const ldapStatus = ref<LdapStatus | null>(null);
  const ldapConfiguration = ref<LdapConfiguration | null>(null);
  const ldapConfigurationForm = ref<LdapConfigurationForm>({
    enabled: false,
    directory_type: "generic_ldap",
    primary_host: "",
    primary_port: 636,
    secondary_host: "",
    secondary_port: null,
    base_dn: "",
    bind_dn: "",
    bind_password: "",
    security_mode: "ldaps",
    tls_server_name: "",
    ca_cert_file: "",
    user_search_base: "",
    user_login_attribute: "uid",
    user_filter: "(&(objectClass=inetOrgPerson)(uid={username}))",
    external_id_attribute: "entryUUID",
    email_attribute: "mail",
    first_name_attribute: "givenName",
    last_name_attribute: "sn",
    account_control_attribute: "",
    connect_timeout: 5,
    operation_timeout: 5,
  });
  const ldapConfigurationLoading = ref(false);
  const ldapConfigurationSaving = ref(false);
  const ldapConfigurationError = ref("");
  const ldapConfigurationFormErrors = ref<FormErrors>({});
  const ldapConfigurationRequestId = ref(0);
  const ldapStatusLoading = ref(false);
  const ldapStatusError = ref("");
  const ldapStatusRequestId = ref(0);
  const ldapDiagnosticLoading = ref(false);
  const ldapDiagnosticResult = ref<LdapDiagnosticResult | null>(null);
  const ldapDiagnosticError = ref("");
  const organizationError = computed(() => userListError.value || roleListError.value);

  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }


  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }

  function setActionError(error: unknown, fallback: string): string {
    const message = errorMessage(error, fallback);
    setActionMessage(message, "error");
    return message;
  }

  function watchFormFieldErrors<T extends object>(
    form: Ref<T>,
    errors: Ref<FormErrors>,
    fields: readonly string[],
  ) {
    for (const field of fields) {
      watch(
        () => (form.value as Record<string, unknown>)[field],
        () => {
          if (errors.value[field]) errors.value = clearFieldError(errors.value, field);
        },
      );
    }
  }

  function totalPages(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / pageSize));
  }

  type PagedPayload<T> = PageResult<T> | T[];
  const referencePageSize = 50;

  async function loadAllPages<T>(
    basePath: string,
    version: number,
    isCurrentRequest: () => boolean,
    signal: AbortSignal,
  ): Promise<T[] | null> {
    const rows: T[] = [];
    let page = 1;
    while (deps.isCurrentLoad(version) && isCurrentRequest() && !signal.aborted) {
      const separator = basePath.includes("?") ? "&" : "?";
      const result = await deps.request<PagedPayload<T>>(
        `${basePath}${separator}page=${page}`,
        { signal },
      );
      if (!deps.isCurrentLoad(version) || !isCurrentRequest() || signal.aborted) return null;
      if (Array.isArray(result)) {
        rows.push(...result);
        return rows;
      }
      const pageRows = result.results || [];
      rows.push(...pageRows);
      const hasMore = result.next !== undefined
        ? Boolean(result.next)
        : typeof result.count === "number"
          ? rows.length < result.count
          : pageRows.length >= referencePageSize;
      if (!pageRows.length || !hasMore) return rows;
      page += 1;
    }
    return null;
  }

  function syncLdapConfigurationForm(value: LdapConfiguration): void {
    ldapConfigurationForm.value = {
      enabled: value.enabled,
      directory_type: value.directory_type,
      primary_host: value.primary_host,
      primary_port: value.primary_port,
      secondary_host: value.secondary_host,
      secondary_port: value.secondary_port,
      base_dn: value.base_dn,
      bind_dn: value.bind_dn,
      bind_password: "",
      security_mode: value.security_mode,
      tls_server_name: value.tls_server_name,
      ca_cert_file: value.ca_cert_file,
      user_search_base: value.user_search_base,
      user_login_attribute: value.user_login_attribute,
      user_filter: value.user_filter,
      external_id_attribute: value.external_id_attribute,
      email_attribute: value.email_attribute,
      first_name_attribute: value.first_name_attribute,
      last_name_attribute: value.last_name_attribute,
      account_control_attribute: value.account_control_attribute,
      connect_timeout: value.connect_timeout,
      operation_timeout: value.operation_timeout,
    };
  }

  const ldapConfigurationDirty = computed(() => {
    if (!ldapConfiguration.value) return Boolean(ldapConfigurationForm.value.bind_password);
    const form = ldapConfigurationForm.value;
    const value = ldapConfiguration.value;
    return Boolean(form.bind_password) || Object.entries(form).some(([key, current]) => {
      if (key === "bind_password") return false;
      return current !== value[key as keyof LdapConfiguration] as unknown;
    });
  });

  function ldapConfigurationPayload() {
    const form = ldapConfigurationForm.value;
    const payload: Record<string, unknown> = {
      enabled: form.enabled,
      directory_type: form.directory_type,
      primary_host: form.primary_host,
      primary_port: form.primary_port,
      secondary_host: form.secondary_host,
      secondary_port: form.secondary_port,
      base_dn: form.base_dn,
      bind_dn: form.bind_dn,
      security_mode: form.security_mode,
      tls_server_name: form.tls_server_name,
      ca_cert_file: form.ca_cert_file,
      user_search_base: form.user_search_base,
      user_login_attribute: form.user_login_attribute,
      user_filter: form.user_filter,
      external_id_attribute: form.external_id_attribute,
      email_attribute: form.email_attribute,
      first_name_attribute: form.first_name_attribute,
      last_name_attribute: form.last_name_attribute,
      account_control_attribute: form.account_control_attribute,
      connect_timeout: form.connect_timeout,
      operation_timeout: form.operation_timeout,
    };
    if (form.bind_password) payload.bind_password = form.bind_password;
    return payload;
  }

  function normalizeLdapDiagnosticResult(value: unknown): LdapDiagnosticResult | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const stages = ["configuration", "connection", "tls", "service_bind", "search"] as const;
    const stage = stages.includes(source.stage as typeof stages[number])
      ? source.stage as LdapDiagnosticResult["stage"]
      : "configuration";
    const checks = Array.isArray(source.checks)
      ? source.checks.flatMap((check): LdapDiagnosticCheck[] => {
          if (!check || typeof check !== "object" || Array.isArray(check)) return [];
          const item = check as Record<string, unknown>;
          const names = ["configuration", "connection", "tls", "service_bind", "search"] as const;
          const statuses = ["success", "error", "disabled"] as const;
          if (!names.includes(item.name as typeof names[number]) || !statuses.includes(item.status as typeof statuses[number])) return [];
          return [{
            name: item.name as LdapDiagnosticCheck["name"],
            status: item.status as LdapDiagnosticCheck["status"],
          }];
        })
      : [];
    const code = typeof source.code === "string" ? source.code : undefined;
    const message = typeof source.message === "string" ? source.message : undefined;
    return {
      success: Boolean(source.success),
      stage,
      checks,
      ...(code ? { code } : {}),
      ...(message ? { message } : {}),
    };
  }

  async function loadLdapStatus(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) {
      ldapStatus.value = null;
      ldapStatusError.value = "";
      return false;
    }
    const requestId = ++ldapStatusRequestId.value;
    ldapStatusLoading.value = true;
    ldapStatusError.value = "";
    try {
      const result = await deps.request<LdapStatus>("/auth/ldap/status/");
      if (result == null || requestId !== ldapStatusRequestId.value || !deps.isCurrentLoad(version)) return false;
      ldapStatus.value = result;
      return true;
    } catch (error) {
      if (requestId === ldapStatusRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        ldapStatusError.value = tr("settings.ldapStatusLoadFailed");
      }
      return false;
    } finally {
      if (requestId === ldapStatusRequestId.value) ldapStatusLoading.value = false;
    }
  }

  async function loadLdapConfiguration(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) {
      ldapConfiguration.value = null;
      ldapConfigurationError.value = "";
      return false;
    }
    const requestId = ++ldapConfigurationRequestId.value;
    ldapConfigurationLoading.value = true;
    ldapConfigurationError.value = "";
    try {
      const result = await deps.request<LdapConfiguration>("/auth/ldap/config/");
      if (result == null || requestId !== ldapConfigurationRequestId.value || !deps.isCurrentLoad(version)) return false;
      ldapConfiguration.value = result;
      syncLdapConfigurationForm(result);
      return true;
    } catch (error) {
      if (requestId === ldapConfigurationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        ldapConfigurationError.value = errorMessage(error, tr("settings.ldapConfigurationLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === ldapConfigurationRequestId.value) ldapConfigurationLoading.value = false;
    }
  }

  function resetLdapConfigurationForm(): void {
    if (ldapConfiguration.value) syncLdapConfigurationForm(ldapConfiguration.value);
    ldapConfigurationFormErrors.value = {};
  }

  async function saveLdapConfiguration(): Promise<boolean> {
    if (ldapConfigurationSaving.value || !deps.can("organization.manage")) return false;
    ldapConfigurationSaving.value = true;
    ldapConfigurationError.value = "";
    ldapConfigurationFormErrors.value = {};
    try {
      const result = await deps.request<LdapConfiguration>("/auth/ldap/config/", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ldapConfigurationPayload()),
      });
      ldapConfiguration.value = result;
      syncLdapConfigurationForm(result);
      await loadLdapStatus();
      setActionMessage(tr("settings.ldapConfigurationSaved"));
      return true;
    } catch (error) {
      const fieldErrors = extractFieldErrors(error, LDAP_CONFIGURATION_FIELDS);
      ldapConfigurationFormErrors.value = fieldErrors;
      const status = error instanceof ApiError ? error.status : undefined;
      const hasFieldErrors = Object.keys(fieldErrors).length > 0;
      if (status === 403) {
        setActionMessage(tr("settings.ldapConfigurationPermissionDenied"), "error");
      } else if (status === 400 || (status === undefined && hasFieldErrors)) {
        setActionMessage(tr("settings.ldapConfigurationValidationFailed"), "error");
      } else {
        setActionMessage(tr("settings.ldapConfigurationSaveFailed"), "error");
      }
      return false;
    } finally {
      ldapConfigurationSaving.value = false;
    }
  }

  async function runLdapDiagnostics(): Promise<boolean> {
    if (!deps.can("organization.manage") || ldapDiagnosticLoading.value) return false;
    ldapDiagnosticLoading.value = true;
    ldapDiagnosticError.value = "";
    ldapDiagnosticResult.value = null;
    try {
      const result = await deps.request<LdapDiagnosticResult>("/auth/ldap/diagnostics/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ldapConfigurationPayload()),
      });
      const normalized = normalizeLdapDiagnosticResult(result);
      if (!normalized) {
        ldapDiagnosticError.value = tr("settings.ldapDiagnosticRequestFailed");
        return false;
      }
      ldapDiagnosticResult.value = normalized;
      return normalized.success;
    } catch (error) {
      const details = error && typeof error === "object" && "details" in error
        ? (error as { details?: unknown }).details
        : undefined;
      const normalized = normalizeLdapDiagnosticResult(details);
      if (normalized) {
        ldapDiagnosticResult.value = normalized;
      } else if (!isAbortError(error)) {
        ldapDiagnosticError.value = tr("settings.ldapDiagnosticRequestFailed");
      }
      return false;
    } finally {
      ldapDiagnosticLoading.value = false;
    }
  }

  async function loadDepartments(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("settings.view") && !deps.can("settings.manage")) return false;
    const requestId = ++departmentRequestId.value;
    departmentController?.abort();
    const controller = new AbortController();
    departmentController = controller;
    const params = new URLSearchParams({
      page: String(departmentPage.value),
      page_size: String(departmentPageSize.value),
      ordering: "name",
    });
    if (departmentSearch.value.trim()) params.set("search", departmentSearch.value.trim());
    departmentLoading.value = true;
    departmentError.value = "";
    try {
      const [result, options] = await Promise.all([
        deps.request<PageResult<Department> | Department[]>(`/departments/?${params.toString()}`, { signal: controller.signal }),
        loadAllPages<Department>(
          "/departments/?page_size=100&ordering=name",
          version,
          () => requestId === departmentRequestId.value,
          controller.signal,
        ),
      ]);
      if (
        result == null ||
        options == null ||
        requestId !== departmentRequestId.value ||
        !deps.isCurrentLoad(version) ||
        controller.signal.aborted
      ) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, departmentPageSize.value);
      if (departmentPage.value > maxPage && allowPageClamp) {
        departmentPage.value = maxPage;
        return await loadDepartments(version, false);
      }
      departments.value = pageItems(result);
      departmentOptions.value = options;
      departmentTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === departmentRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        departmentError.value = errorMessage(error, tr("settings.departmentDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === departmentRequestId.value) {
        departmentLoading.value = false;
        if (departmentController === controller) departmentController = null;
      }
    }
  }

  function retryDepartments() {
    return loadDepartments();
  }

  async function searchDepartments() {
    departmentPage.value = 1;
    await loadDepartments();
  }

  async function changeDepartmentPage(page: number) {
    departmentPage.value = Math.min(
      Math.max(page, 1),
      totalPages(departmentTotal.value, departmentPageSize.value),
    );
    await loadDepartments();
  }

  async function changeDepartmentPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    departmentPageSize.value = size;
    departmentPage.value = 1;
    await loadDepartments();
  }

  async function loadResponsibilityDirectory(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("settings.manage") && !deps.can("settings.view")) return false;
    responsibilityDirectoryController?.abort();
    const controller = new AbortController();
    responsibilityDirectoryController = controller;
    const requestId = ++responsibilityDirectoryRequestId.value;
    responsibilityDirectoryLoading.value = true;
    responsibilityDirectoryError.value = "";
    const params = new URLSearchParams({
      page: String(responsibilityDirectoryPage.value),
      page_size: String(responsibilityDirectoryPageSize.value),
    });
    if (responsibilityDirectorySearch.value.trim()) params.set("search", responsibilityDirectorySearch.value.trim());
    if (responsibilityDirectoryType.value) params.set("department", responsibilityDirectoryType.value);
    if (responsibilityDirectoryActive.value && responsibilityDirectoryActive.value !== "all") {
      params.set("is_active", responsibilityDirectoryActive.value);
    }
    try {
      const result = await deps.request<PageResult<Person> | Person[]>(
        `/people/?${params.toString()}`,
        { signal: controller.signal },
      );
      if (result == null || requestId !== responsibilityDirectoryRequestId.value || controller.signal.aborted || !deps.isCurrentLoad(version)) return false;
      const nextTotal = pageTotal(result);
      const maxPage = totalPages(nextTotal, responsibilityDirectoryPageSize.value);
      if (responsibilityDirectoryPage.value > maxPage && allowPageClamp) {
        responsibilityDirectoryPage.value = maxPage;
        return await loadResponsibilityDirectory(version, false);
      }
      responsibilityDirectorySubjects.value = pageItems(result);
      responsibilityDirectoryTotal.value = nextTotal;
      return true;
    } catch (error) {
      if (requestId === responsibilityDirectoryRequestId.value && !isAbortError(error) && deps.isCurrentLoad(version)) {
        responsibilityDirectoryError.value = errorMessage(error, tr("settings.peopleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === responsibilityDirectoryRequestId.value) {
        responsibilityDirectoryLoading.value = false;
        if (responsibilityDirectoryController === controller) responsibilityDirectoryController = null;
      }
    }
  }

  function retryResponsibilityDirectory() {
    return loadResponsibilityDirectory();
  }

  async function searchResponsibilityDirectory() {
    responsibilityDirectoryPage.value = 1;
    await loadResponsibilityDirectory();
  }

  async function changeResponsibilityDirectoryPage(page: number) {
    responsibilityDirectoryPage.value = Math.max(1, page);
    await loadResponsibilityDirectory();
  }

  async function changeResponsibilityDirectoryPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    responsibilityDirectoryPageSize.value = size;
    responsibilityDirectoryPage.value = 1;
    await loadResponsibilityDirectory();
  }

  function openResponsibilitySubjectModal(subject?: Person) {
    if (!deps.can("settings.manage")) return;
    if (departmentOptions.value.length === 0 && !departmentLoading.value) {
      void loadDepartments();
    }
    editingResponsibilitySubject.value = subject || null;
    responsibilityDirectoryFormErrors.value = {};
    responsibilityDirectoryForm.value = subject
      ? {
          name: subject.name || subject.display_name || "",
          employee_no: subject.employee_no || "",
          department: subject.department ? String(subject.department) : "",
          email: subject.email || "",
          organization: subject.organization || "",
          contact: subject.contact || "",
          is_active: subject.is_active,
        }
      : { name: "", employee_no: "", department: "", email: "", organization: "", contact: "", is_active: true };
    showResponsibilitySubjectModal.value = true;
  }

  async function saveResponsibilitySubject() {
    if (!deps.can("settings.manage") || responsibilityDirectorySaving.value) return;
    const name = responsibilityDirectoryForm.value.name.trim();
    if (!name) {
      responsibilityDirectoryFormErrors.value = { name: tr("settings.personNameRequired") };
      return;
    }
    responsibilityDirectorySaving.value = true;
    responsibilityDirectoryFormErrors.value = {};
    const editingId = editingResponsibilitySubject.value?.id;
    try {
      await deps.request(editingId ? `/people/${editingId}/` : "/people/", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          employee_no: responsibilityDirectoryForm.value.employee_no.trim() || null,
          department: responsibilityDirectoryForm.value.department ? Number(responsibilityDirectoryForm.value.department) : null,
          email: responsibilityDirectoryForm.value.email.trim(),
          organization: responsibilityDirectoryForm.value.organization.trim(),
          contact: responsibilityDirectoryForm.value.contact.trim(),
          is_active: responsibilityDirectoryForm.value.is_active,
        }),
      });
      showResponsibilitySubjectModal.value = false;
      editingResponsibilitySubject.value = null;
      setActionMessage(tr("settings.personSaved"));
      await loadResponsibilityDirectory();
    } catch (error) {
      responsibilityDirectoryFormErrors.value = extractFieldErrors(error, ["name", "employee_no", "department", "email", "organization", "contact", "is_active"]);
      setActionError(error, tr("settings.personSaveFailed"));
    } finally {
      responsibilityDirectorySaving.value = false;
    }
  }

  async function toggleResponsibilitySubject(subject: Person) {
    if (!deps.can("settings.manage") || responsibilityDirectoryActionId.value === subject.id) return;
    responsibilityDirectoryActionId.value = subject.id;
    try {
      await deps.request(`/people/${subject.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !subject.is_active }),
      });
      setActionMessage(subject.is_active ? tr("settings.personDisabled") : tr("settings.personEnabled"));
      await loadResponsibilityDirectory();
    } catch (error) {
      setActionError(error, tr("settings.personStatusFailed"));
    } finally {
      responsibilityDirectoryActionId.value = null;
    }
  }

  async function deleteResponsibilitySubject(subject: Person) {
    if (!deps.can("settings.manage") || responsibilityDirectoryActionId.value === subject.id) return;
    if ((subject.asset_count || 0) > 0) {
      setActionMessage(tr("settings.personInUse"), "error");
      return;
    }
    if (!(await deps.confirmAction(tr("settings.personDeleteConfirm", { name: subject.display_name || subject.name })))) return;
    responsibilityDirectoryActionId.value = subject.id;
    try {
      await deps.request(`/people/${subject.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.personDeleted"));
      await loadResponsibilityDirectory();
    } catch (error) {
      setActionError(error, tr("settings.personDeleteFailed"));
    } finally {
      responsibilityDirectoryActionId.value = null;
    }
  }

  function openDepartmentModal(department?: Department) {
    if (!deps.can("settings.manage")) return;
    editingDepartment.value = department || null;
    departmentFormErrors.value = {};
    departmentForm.value = department
      ? {
          name: department.name,
          code: department.code,
          parent: department.parent ? String(department.parent) : "",
        }
      : { name: "", code: "", parent: "" };
    showDepartmentModal.value = true;
  }

  async function saveDepartment() {
    if (!deps.can("settings.manage") || departmentSaving.value) return;
    departmentSaving.value = true;
    departmentFormErrors.value = {};
    const editingId = editingDepartment.value?.id;
    try {
      const payload = {
        name: departmentForm.value.name.trim(),
        code: departmentForm.value.code.trim(),
        parent: departmentForm.value.parent ? Number(departmentForm.value.parent) : null,
      };
      await deps.request(editingId ? `/departments/${editingId}/` : "/departments/", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      showDepartmentModal.value = false;
      editingDepartment.value = null;
      setActionMessage(tr("settings.departmentSaved"));
      await loadDepartments();
    } catch (error) {
      departmentFormErrors.value = extractFieldErrors(error, ["name", "code", "parent"]);
      setActionError(error, tr("settings.departmentSaveFailed"));
    } finally {
      departmentSaving.value = false;
    }
  }

  async function deleteDepartment(department: Department) {
    if (!deps.can("settings.manage") || departmentActionId.value === department.id) return;
    if ((department.people_count || 0) > 0) {
      setActionMessage(tr("settings.departmentInUse"), "error");
      return;
    }
    if (!(await deps.confirmAction(tr("settings.departmentDeleteConfirm", { name: department.name })))) return;
    departmentActionId.value = department.id;
    try {
      await deps.request(`/departments/${department.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.departmentDeleted"));
      await loadDepartments();
    } catch (error) {
      setActionError(error, tr("settings.departmentDeleteFailed"));
    } finally {
      departmentActionId.value = null;
    }
  }

  async function loadOrganization(version = deps.beginLoad()): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    clearUserSelection();
    const requestId = ++organizationRequestId.value;
    const userRequestIdAtStart = ++userRequestId.value;
    organizationLoading.value = true;
    userListError.value = "";
    roleListError.value = "";
    const userParams = new URLSearchParams({
      page: String(userPage.value),
      page_size: String(userPageSize.value),
    });
    if (userSearch.value.trim()) userParams.set("search", userSearch.value.trim());
    try {
      const [userResult, roleResult] = await Promise.allSettled([
        deps.request<PageResult<ManagedUser> | ManagedUser[]>("/users/?" + userParams.toString()),
        deps.request<PageResult<Role> | Role[]>("/roles/?page_size=100"),
      ]);
      if (requestId !== organizationRequestId.value || !deps.isCurrentLoad(version)) return false;
      let refreshed = true;
      if (userResult.status === "fulfilled" && userResult.value != null && userRequestIdAtStart === userRequestId.value) {
        const nextCount = pageTotal(userResult.value);
        const maxPage = totalPages(nextCount, userPageSize.value);
        userCount.value = nextCount;
        if (userPage.value > maxPage) {
          userPage.value = maxPage;
          if (roleResult.status === "fulfilled" && roleResult.value != null) {
            roles.value = pageItems(roleResult.value);
          }
          return await loadUsers(version, false);
        }
        users.value = pageItems(userResult.value);
      } else {
        refreshed = false;
        const userError = userResult.status === "rejected" ? userResult.reason : undefined;
        if (!isAbortError(userError) && userRequestIdAtStart === userRequestId.value) {
          userListError.value = userResult.status === "rejected"
            ? errorMessage(userResult.reason, tr("settings.userDataLoadFailed"))
            : tr("settings.userDataLoadFailed");
        }
      }
      if (roleResult.status === "fulfilled" && roleResult.value != null) {
        roles.value = pageItems(roleResult.value);
      } else {
        refreshed = false;
        const roleError = roleResult.status === "rejected" ? roleResult.reason : undefined;
        if (!isAbortError(roleError)) {
          roleListError.value = roleResult.status === "rejected"
            ? errorMessage(roleResult.reason, tr("settings.roleDataLoadFailed"))
            : tr("settings.roleDataLoadFailed");
        }
      }
      return refreshed;
    } catch (error) {
      if (requestId === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, tr("settings.userDataLoadFailed"));
        roleListError.value = errorMessage(error, tr("settings.roleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === organizationRequestId.value) organizationLoading.value = false;
    }
  }

  async function loadUsers(version = deps.beginLoad(), allowPageClamp = true): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    clearUserSelection();
    const organizationRequest = ++organizationRequestId.value;
    const requestId = ++userRequestId.value;
    organizationLoading.value = true;
    userListError.value = "";
    const params = new URLSearchParams({
      page: String(userPage.value),
      page_size: String(userPageSize.value),
    });
    if (userSearch.value.trim()) params.set("search", userSearch.value.trim());
    try {
      const result = await deps.request<PageResult<ManagedUser> | ManagedUser[]>(
        "/users/?" + params.toString(),
      );
      if (result == null || requestId !== userRequestId.value || organizationRequest !== organizationRequestId.value || !deps.isCurrentLoad(version)) {
        return false;
      }
      const nextCount = pageTotal(result);
      const maxPage = totalPages(nextCount, userPageSize.value);
      if (userPage.value > maxPage && allowPageClamp) {
        userPage.value = maxPage;
        return await loadUsers(version, false);
      }
      users.value = pageItems(result);
      clearUserSelection();
      userCount.value = nextCount;
      return true;
    } catch (error) {
      if (requestId === userRequestId.value && organizationRequest === organizationRequestId.value && deps.isCurrentLoad(version) && !isAbortError(error)) {
        userListError.value = errorMessage(error, tr("settings.userDataLoadFailed"));
      }
      return false;
    } finally {
      if (organizationRequest === organizationRequestId.value) organizationLoading.value = false;
    }
  }


  function openUserModal(user?: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    editingUser.value = user || null;
    userFormErrors.value = {};
    userForm.value = user
      ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name,
          email: user.email,
          password: "",
          confirm_password: "",
          is_active: user.is_active,
          role_code: user.primary_role_code || user.roles[0]?.code || "",
          person_id: user.person?.id ? String(user.person.id) : "",
        }
      : {
          username: "",
          first_name: "",
          last_name: "",
          email: "",
          password: "",
          confirm_password: "",
          is_active: true,
          role_code: "auditor",
          person_id: "",
        };
    showUserModal.value = true;
    nextTick(() => userFormRef.value?.clearValidate());
  }

  async function loadUnlinkedPeople(): Promise<boolean> {
    if (!deps.can("organization.manage")) return false;
    const requestId = ++unlinkedPeopleRequestId.value;
    unlinkedPeopleLoading.value = true;
    unlinkedPeopleError.value = "";
    try {
      const result = await deps.request<PageResult<PersonOption> | PersonOption[]>(
        "/people/?page=1&page_size=100&is_active=true&account=unlinked&compact=1",
      );
      if (requestId !== unlinkedPeopleRequestId.value || result == null) return false;
      unlinkedPeople.value = pageItems(result);
      return true;
    } catch (error) {
      if (requestId === unlinkedPeopleRequestId.value) {
        unlinkedPeopleError.value = errorMessage(error, tr("settings.peopleDataLoadFailed"));
      }
      return false;
    } finally {
      if (requestId === unlinkedPeopleRequestId.value) unlinkedPeopleLoading.value = false;
    }
  }

  function userProtectionReason(user: ManagedUser): string {
    if (user.is_superuser) return tr("settings.superuserProtected");
    if (user.username === deps.currentUsername.value) return tr("settings.currentUserProtected");
    return "";
  }

  function userDeleteProtectionReason(user: ManagedUser): string {
    if (user.auth_source === "ldap") return tr("settings.directoryUserProtected");
    return userProtectionReason(user);
  }

  function handleUserSelection(rows: ManagedUser[]) {
    selectedUserIds.value = rows.map((user) => user.id);
  }

  function clearUserSelection() {
    selectedUserIds.value = [];
  }

  function canChangeUserRole(user: ManagedUser): boolean {
    return !user.is_superuser && user.username !== deps.currentUsername.value;
  }

  async function saveUser() {
    if (!deps.can("organization.manage")) return;
    if (userSaving.value) return;
    userSaving.value = true;
    let saved = false;
    try {
      const valid = await userFormRef.value?.validate().then(() => true).catch(() => false);
      if (!valid) return;
      const normalizingMultipleRoles = Boolean(
        editingUser.value?.role_anomaly === "multiple",
      );
      if (
        normalizingMultipleRoles
        && !(await deps.confirmAction(tr("settings.normalizeRolesConfirm")))
      ) return;
      const method = editingUser.value ? "PATCH" : "POST";
      const path = editingUser.value ? `/users/${editingUser.value.id}/` : "/users/";
      await deps.request(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(!editingUser.value ? { username: userForm.value.username } : {}),
          first_name: userForm.value.first_name,
          last_name: userForm.value.last_name,
          email: userForm.value.email,
          is_active: userForm.value.is_active,
          role_code: userForm.value.role_code,
          ...(normalizingMultipleRoles ? { normalize_roles: true } : {}),
          ...(!editingUser.value && userForm.value.person_id
            ? { person_id: Number(userForm.value.person_id) }
            : {}),
          ...(!editingUser.value && userForm.value.password ? { password: userForm.value.password } : {}),
        }),
      });
      saved = true;
    } catch (error) {
      userFormErrors.value = extractFieldErrors(error, [
        "username",
        "first_name",
        "last_name",
        "email",
        "role_code",
        "person_id",
        "password",
      ]);
      setActionError(error, tr("settings.userSaveFailed"));
    } finally {
      userSaving.value = false;
    }
    if (!saved) return;
    showUserModal.value = false;
    setActionMessage(tr("settings.userSaved"));
    const refreshed = await loadUsers();
    if (!refreshed && userListError.value) setActionMessage(tr("settings.userSavedRefreshFailed"), "error");
  }

  async function toggleUser(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (userProtectionReason(user)) {
      setActionMessage(userProtectionReason(user), "error");
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      await deps.request(`/users/${user.id}/`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !user.is_active }),
      });
      setActionMessage(user.is_active ? tr("settings.userDisabled") : tr("settings.userEnabled"));
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) setActionMessage(tr("settings.userStatusRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("settings.userStatusFailed"));
    } finally {
      userPendingId.value = null;
    }
  }

  async function batchUpdateUserStatus(isActive: boolean) {
    if (!deps.can("organization.manage")) return;
    const ids = [...selectedUserIds.value];
    if (!ids.length || userBatchSaving.value) return;
    const actionLabel = isActive ? tr("status.enabled") : tr("status.disabled");
    if (!(await deps.confirmAction(tr("settings.batchUserStatusConfirm", { action: actionLabel, count: ids.length })))) return;
    userBatchSaving.value = true;
    userBatchResult.value = null;
    showUserBatchResult.value = false;
    clearUserSelection();
    try {
      const result = await deps.request<UserBatchStatusResponse>("/users/batch-status/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, is_active: isActive }),
      });
      userBatchResult.value = result;
      const mutationMessage = result.failed
        ? tr("settings.batchUserStatusSummary", { action: actionLabel, succeeded: result.succeeded, failed: result.failed })
        : tr("settings.batchUserStatusSuccess", { action: actionLabel, count: result.succeeded });
      setActionMessage(mutationMessage, result.failed ? "error" : "success");
      const refreshed = await loadUsers();
      if (!refreshed) {
        setActionMessage(`${mutationMessage}; ${tr("common.refreshFailed")}. ${tr("common.retry")}.`, "error");
      }
      if (result.failed) showUserBatchResult.value = true;
    } catch (error) {
      setActionError(error, tr("settings.batchUserStatusFailed", { action: actionLabel }));
    } finally {
      userBatchSaving.value = false;
    }
  }

  function closeUserBatchResult() {
    if (userBatchSaving.value) return;
    showUserBatchResult.value = false;
    userBatchResult.value = null;
  }

  async function deleteUser(user: ManagedUser) {
    if (!deps.can("organization.manage")) return;
    if (user.auth_source === "ldap") {
      setActionMessage(tr("settings.directoryUserProtected"), "error");
      return;
    }
    if (userProtectionReason(user)) {
      setActionMessage(userProtectionReason(user), "error");
      return;
    }
    if (userPendingId.value === user.id) return;
    userPendingId.value = user.id;
    try {
      if (!(await deps.confirmAction(tr("settings.userDeleteConfirm", { username: user.username })))) return;
      await deps.request(`/users/${user.id}/`, { method: "DELETE" });
      setActionMessage(tr("settings.userDeleted"));
      const refreshed = await loadUsers();
      if (!refreshed && userListError.value) setActionMessage(tr("settings.userDeletedRefreshFailed"), "error");
    } catch (error) {
      setActionError(error, tr("settings.userDeleteFailed"));
    } finally {
      userPendingId.value = null;
    }
  }



  function retryOrganization() {
    return loadOrganization();
  }

  function retryUserList() {
    return loadUsers();
  }

  async function changeUserPage(page: number) {
    clearUserSelection();
    userPage.value = Math.max(1, page);
    await loadUsers();
  }

  async function changeUserPageSize(size: number) {
    if (![20, 50, 100].includes(size)) return;
    clearUserSelection();
    userPageSize.value = size;
    userPage.value = 1;
    await loadUsers();
  }

  async function searchUsers() {
    clearUserSelection();
    userPage.value = 1;
    await loadUsers();
  }

  return {
    ldapStatus,
    ldapConfiguration,
    ldapConfigurationForm,
    ldapConfigurationLoading,
    ldapConfigurationSaving,
    ldapConfigurationError,
    ldapConfigurationFormErrors,
    ldapConfigurationDirty,
    ldapStatusLoading,
    ldapStatusError,
    ldapDiagnosticLoading,
    ldapDiagnosticResult,
    ldapDiagnosticError,
    loadLdapStatus,
    retryLdapStatus: () => loadLdapStatus(),
    loadLdapConfiguration,
    retryLdapConfiguration: () => loadLdapConfiguration(),
    saveLdapConfiguration,
    resetLdapConfigurationForm,
    runLdapDiagnostics,
    users,
    roles,
    userSearch,
    userPage,
    userPageSize,
    userCount,
    selectedUserIds,
    userBatchSaving,
    userBatchResult,
    showUserBatchResult,
    showUserModal,
    editingUser,
    userForm,
    userFormRef,
    userFormRules,
    organizationLoading,
    organizationError,
    userListError,
    roleListError,
    userSaving,
    userPendingId,
    userFormErrors,
    unlinkedPeople,
    unlinkedPeopleLoading,
    unlinkedPeopleError,
    loadUnlinkedPeople,
    loadOrganization,
    loadUsers,
    retryOrganization,
    retryUserList,
    searchUsers,
    changeUserPage,
    changeUserPageSize,
    handleUserSelection,
    clearUserSelection,
    batchUpdateUserStatus,
    closeUserBatchResult,
    openUserModal,
    saveUser,
    userProtectionReason,
    userDeleteProtectionReason,
    canChangeUserRole,
    toggleUser,
    deleteUser,
    departments,
    departmentOptions,
    departmentCount: departmentTotal,
    departmentPage,
    departmentPageSize,
    departmentSearch,
    departmentLoading,
    departmentError,
    departmentSaving,
    departmentActionId,
    departmentFormErrors,
    departmentForm,
    editingDepartment,
    showDepartmentModal,
    loadDepartments,
    searchDepartments,
    changeDepartmentPage,
    changeDepartmentPageSize,
    retryDepartments,
    openDepartmentModal,
    saveDepartment,
    deleteDepartment,
    responsibilityDirectorySubjects,
    responsibilityDirectoryTotal,
    responsibilityDirectoryPage,
    responsibilityDirectoryPageSize,
    responsibilityDirectorySearch,
    responsibilityDirectoryType,
    responsibilityDirectoryActive,
    responsibilityDirectoryLoading,
    responsibilityDirectoryError,
    responsibilityDirectorySaving,
    responsibilityDirectoryActionId,
    responsibilityDirectoryFormErrors,
    responsibilityDirectoryForm,
    editingResponsibilitySubject,
    showResponsibilitySubjectModal,
    loadResponsibilityDirectory,
    searchResponsibilityDirectory,
    retryResponsibilityDirectory,
    changeResponsibilityDirectoryPage,
    changeResponsibilityDirectoryPageSize,
    openResponsibilitySubjectModal,
    saveResponsibilitySubject,
    toggleResponsibilitySubject,
    deleteResponsibilitySubject,
  };
}

export type OrganizationSettingsState = ReturnType<typeof useOrganizationSettings>;
