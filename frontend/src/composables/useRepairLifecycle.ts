import { ref, watch } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { revisionHeaders } from "../revision";
import { i18n } from "../i18n";
import { systemDateTimeInputValue } from "../system-settings";
import { clearFieldError, fieldErrorsToText, normalizeApiError, type ActionMessageType } from "../error-handling";
import type { FaultEvent } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";

const tr = (key: string): string => String(i18n.global.t(key));
const REPAIR_FORM_FIELDS = ["provider", "started_at", "finished_at", "cost", "notes"] as const;
interface RepairLifecycleDeps {
  can: CapabilityFn;
  request: RequestFn;
  confirmAction?: (message: string) => Promise<boolean>;
  refreshOpenAssetDetail?: (assetId: number) => Promise<boolean | null>;
  refreshList: () => Promise<boolean>;
  setActionMessage: (message: string, type?: ActionMessageType) => void;
}

/** Owns the repair editor snapshot and commands; late replies retain newer drafts. */
export function useRepairLifecycle(deps: RepairLifecycleDeps) {
  const selectedFault = ref<FaultEvent | null>(null);
  const showRepairModal = ref(false);
  const repairForm = ref({ provider: "", started_at: "", finished_at: "", cost: "", notes: "" });
  const repairSaving = ref(false);
  const repairError = ref("");
  const repairFormErrors = ref<Record<string, string>>({});
  for (const field of REPAIR_FORM_FIELDS) {
    watch(() => repairForm.value[field], () => {
      if (repairFormErrors.value[field]) repairFormErrors.value = clearFieldError(repairFormErrors.value, field);
    });
  }
  function toDateTimeLocal(value: string | null) {
    return value ? systemDateTimeInputValue(value) : "";
  }
  function errorMessage(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    return normalized.kind === "unknown" ? fallback : normalized.message;
  }
  function setDialogError(error: unknown) {
    const normalized = normalizeApiError(error);
    const fields = fieldErrorsToText(normalized.fieldErrors, REPAIR_FORM_FIELDS);
    repairFormErrors.value = fields;
    repairError.value = Object.keys(fields).length ? "" : errorMessage(error, tr("repair.recordSaveFailed"));
  }
  function openRepairEditor(fault: FaultEvent): boolean {
    if (!deps.can("faults.view")) return false;
    repairError.value = "";
    repairFormErrors.value = {};
    selectedFault.value = {...fault, repair: fault.repair ? {...fault.repair} : null};
    repairForm.value = {
      provider: fault.repair?.provider || "",
      started_at: toDateTimeLocal(fault.repair?.started_at || null),
      finished_at: toDateTimeLocal(fault.repair?.finished_at || null),
      cost: fault.repair?.cost || "",
      notes: fault.repair?.notes || "",
    };
    showRepairModal.value = true;
    return true;
  }

  function repairTimeError() {
    const startedAt = repairForm.value.started_at.trim();
    const finishedAt = repairForm.value.finished_at.trim();
    return startedAt && finishedAt && startedAt > finishedAt
      ? tr("repair.invalidTimeRange")
      : "";
  }
  async function saveRepair(): Promise<boolean> {
    if (!deps.can("faults.manage")) return false;
    if (!selectedFault.value || repairSaving.value) return false;
    if (selectedFault.value.is_closed || selectedFault.value.repair?.finished_at || selectedFault.value.repair?.is_current === false) {
      repairError.value = tr("repair.completedViewOnly");
      return false;
    }
    repairError.value = "";
    repairFormErrors.value = {};
    const timeError = repairTimeError();
    if (timeError) {
      repairError.value = timeError;
      return false;
    }
    repairSaving.value = true;
    const editor = selectedFault.value;
    const repairedAssetId = selectedFault.value.asset;
    const successMessage = repairForm.value.finished_at ? tr("repair.completed") : tr("repair.recordSaved");
    try {
      const payload = {
        fault: selectedFault.value.id,
        provider: repairForm.value.provider.trim(),
        started_at: repairForm.value.started_at || null,
        finished_at: repairForm.value.finished_at || null,
        cost: repairForm.value.cost.trim() || null,
        notes: repairForm.value.notes,
      };
      if (selectedFault.value.repair) {
        await deps.request(`/repair-records/${selectedFault.value.repair.id}/`, { method: "PATCH", headers: revisionHeaders(selectedFault.value.repair), body: JSON.stringify(payload) });
      } else {
        await deps.request("/repair-records/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
    } catch (error) {
      if (selectedFault.value === editor) setDialogError(error);
      return false;
    } finally {
      repairSaving.value = false;
    }
    if (selectedFault.value === editor) showRepairModal.value = false;
    const listRefreshed = await deps.refreshList();
    let detailRefresh: boolean | null = null;
    if (deps.refreshOpenAssetDetail) {
      try {
        detailRefresh = await deps.refreshOpenAssetDetail(repairedAssetId);
      } catch {
        detailRefresh = false;
      }
    }
    const followUpMessages: string[] = [];
    if (!listRefreshed) followUpMessages.push(tr("common.refreshFailed"));
    if (detailRefresh === false) followUpMessages.push(tr("asset.assetDetailLoadFailed"));
    deps.setActionMessage(successMessage, "success");
    if (followUpMessages.length) ElMessage.warning(followUpMessages.join("；"));
    return true;
  }
  async function reopenRepair(): Promise<boolean> {
    if (
      !deps.can("faults.manage")
      || !selectedFault.value?.is_closed
      || !selectedFault.value.repair
      || selectedFault.value.repair.is_current === false
      || repairSaving.value
    ) return false;
    repairError.value = "";
    repairFormErrors.value = {};
    repairSaving.value = true;
    const editor = selectedFault.value;
    const repairedAssetId = selectedFault.value.asset;
    const repairId = selectedFault.value.repair.id;
    try {
      if (!deps.confirmAction || !(await deps.confirmAction(tr("repair.reopenConfirm")))) return false;
      if (selectedFault.value !== editor) return false;
      await deps.request(`/repair-records/${repairId}/reopen/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    } catch (error) {
      if (selectedFault.value === editor) repairError.value = errorMessage(error, tr("repair.reopenFailed"));
      return false;
    } finally {
      repairSaving.value = false;
    }

    if (selectedFault.value === editor) showRepairModal.value = false;
    const listRefreshed = await deps.refreshList();
    let detailRefresh: boolean | null = null;
    if (deps.refreshOpenAssetDetail) {
      try {
        detailRefresh = await deps.refreshOpenAssetDetail(repairedAssetId);
      } catch {
        detailRefresh = false;
      }
    }
    const followUpMessages: string[] = [];
    if (!listRefreshed) followUpMessages.push(tr("repair.reopenedRefreshFailed"));
    if (detailRefresh === false) followUpMessages.push(tr("asset.assetDetailLoadFailed"));
    deps.setActionMessage(tr("repair.reopened"), "success");
    if (followUpMessages.length) ElMessage.warning(followUpMessages.join("；"));
    return true;
  }
  return { selectedFault, showRepairModal, repairForm, repairSaving, repairError, repairFormErrors,
    openRepairEditor, repairTimeError, saveRepair, reopenRepair };
}
