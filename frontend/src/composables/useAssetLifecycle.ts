import { ref, type Ref } from "vue";
import { isAbortError } from "../api";
import { i18n } from "../i18n";
import { clearFieldError, fieldErrorsToText, normalizeApiError, type ActionMessageType } from "../error-handling";
import type { Asset, AssetDetail, AssetDisposalInput, AssetBatchAssignmentAction, AssetBatchAssignmentResponse, AssetBatchDeleteResponse } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
const tr = (key: string, params?: Record<string, unknown>): string => String(params ? i18n.global.t(key, params) : i18n.global.t(key));
const RESPONSIBILITY_ACTION_FIELDS = ["target_person", "reason"] as const;
const ASSET_DISPOSAL_FIELDS = ["disposed_on", "reason", "method", "notes"] as const;
interface AssetLifecycleDeps {
  can: CapabilityFn;
  request: RequestFn;
  confirmAction: (message: string) => Promise<boolean>;
  selectedAssetIds: Ref<number[]>;
  refreshList: (force?: boolean) => Promise<boolean>;
  refreshDetail: (id: number) => Promise<unknown>;
  refreshAfterAction: (id: number, history: "responsibility" | "disposal") => Promise<boolean>;
  notify: (message: string, type?: ActionMessageType) => void;
}
/** Responsibility, disposal and archive commands retain their public page interface. */
export function useAssetLifecycle(deps: AssetLifecycleDeps) {
  const assetBatchDeleteSaving = ref(false);
  const assetBatchDeleteResult = ref<AssetBatchDeleteResponse | null>(null);
  const showAssetBatchDeleteResult = ref(false);
  const assetBatchAssignmentSaving = ref(false);
  const assetBatchAssignmentError = ref("");
  const assetBatchAssignmentResult = ref<AssetBatchAssignmentResponse | null>(null);
  const showAssetBatchAssignmentResult = ref(false);
  const responsibilityActionSaving = ref(false);
  const responsibilityActionError = ref("");
  const responsibilityActionFieldErrors = ref<Record<string, string>>({});
  const assetDisposalSaving = ref(false);
  const assetDisposalError = ref("");
  const assetDisposalFieldErrors = ref<Record<string, string>>({});

  function setActionError(error: unknown, fallback: string) {
    const normalized = normalizeApiError(error);
    deps.notify(normalized.kind === "unknown" ? fallback : normalized.message, "error");
  }
  async function mutateAssetResponsibility(
    assetId: number,
    path: string,
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> {
    if (!deps.can("assets.manage") || responsibilityActionSaving.value) return false;
    responsibilityActionSaving.value = true;
    responsibilityActionError.value = "";
    responsibilityActionFieldErrors.value = {};
    try {
      await deps.request<AssetDetail>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const refreshFailed = !(await deps.refreshAfterAction(assetId, "responsibility"));
      deps.notify(
        refreshFailed
          ? `${successMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`
          : successMessage,
        refreshFailed ? "error" : "success",
      );
      return true;
    } catch (error) {
      if (!isAbortError(error)) {
        const normalized = normalizeApiError(error);
        responsibilityActionFieldErrors.value = fieldErrorsToText(
          normalized.fieldErrors,
          RESPONSIBILITY_ACTION_FIELDS,
        );
        const hasUnknownField = Object.keys(normalized.fieldErrors).some(
          (field) => !RESPONSIBILITY_ACTION_FIELDS.includes(field as typeof RESPONSIBILITY_ACTION_FIELDS[number]),
        );
        responsibilityActionError.value = normalized.kind === "field-validation" && !hasUnknownField
          ? ""
          : normalized.kind === "unknown"
            ? tr("asset.assignmentActionFailed")
            : normalized.message;
      }
      return false;
    } finally {
      responsibilityActionSaving.value = false;
    }
  }

  function clearResponsibilityActionErrors() {
    responsibilityActionError.value = "";
    responsibilityActionFieldErrors.value = {};
  }

  function clearResponsibilityActionFieldError(field: string) {
    if (responsibilityActionFieldErrors.value[field]) {
      responsibilityActionFieldErrors.value = clearFieldError(
        responsibilityActionFieldErrors.value,
        field,
      );
    }
  }

  function assignAsset(assetId: number, targetPersonId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/assign/`,
      { target_person: targetPersonId, reason },
      tr("asset.assignPersonSuccess"),
    );
  }

  function returnAsset(assetId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/return/`,
      { reason },
      tr("asset.returnPersonSuccess"),
    );
  }

  function transferAsset(assetId: number, targetPersonId: number, reason: string): Promise<boolean> {
    return mutateAssetResponsibility(
      assetId,
      `/assets/${assetId}/transfer/`,
      { target_person: targetPersonId, reason },
      tr("asset.transferPersonSuccess"),
    );
  }

  async function disposeAsset(assetId: number, payload: AssetDisposalInput): Promise<boolean> {
    if (!deps.can("assets.manage") || assetDisposalSaving.value) return false;
    assetDisposalSaving.value = true;
    assetDisposalError.value = "";
    assetDisposalFieldErrors.value = {};
    try {
      await deps.request<AssetDetail>(`/assets/${assetId}/dispose/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const refreshFailed = !(await deps.refreshAfterAction(assetId, "disposal"));
      deps.notify(
        refreshFailed
          ? `${tr("asset.disposalSaved")}；${tr("common.refreshFailed")}，${tr("common.retry")}`
          : tr("asset.disposalSaved"),
        refreshFailed ? "error" : "success",
      );
      return true;
    } catch (error) {
      if (!isAbortError(error)) {
        const normalized = normalizeApiError(error);
        assetDisposalFieldErrors.value = fieldErrorsToText(
          normalized.fieldErrors,
          ASSET_DISPOSAL_FIELDS,
        );
        const hasUnknownField = Object.keys(normalized.fieldErrors).some(
          (field) => !ASSET_DISPOSAL_FIELDS.includes(field as typeof ASSET_DISPOSAL_FIELDS[number]),
        );
        assetDisposalError.value = normalized.kind === "field-validation" && !hasUnknownField
          ? ""
          : normalized.kind === "unknown"
            ? tr("asset.disposalFailed")
            : normalized.message;
      }
      return false;
    } finally {
      assetDisposalSaving.value = false;
    }
  }

  function clearAssetDisposalErrors() {
    assetDisposalError.value = "";
    assetDisposalFieldErrors.value = {};
  }

  async function restoreAsset(asset: Asset) {
    if (!deps.can("assets.manage") || !asset.archived_at) return;
    if (!(await deps.confirmAction(tr("asset.restoreConfirm", { asset: asset.asset_no })))) return;
    try {
      await deps.request(`/assets/${asset.id}/restore/`, { method: "POST" });
      deps.notify(tr("asset.restored"));
      if (!(await deps.refreshList())) deps.notify(tr("asset.restoredRefreshFailed"), "error");
      await deps.refreshDetail(asset.id);
    } catch (error) {
      setActionError(error, tr("asset.restoreFailed"));
    }
  }

  async function deleteAsset(asset: Asset) {
    if (!deps.can("assets.manage")) return;
    if (!(await deps.confirmAction(tr("asset.deleteConfirm", { asset: asset.asset_no })))) return;
    try {
      await deps.request(`/assets/${asset.id}/`, { method: "DELETE" });
      deps.selectedAssetIds.value = deps.selectedAssetIds.value.filter((id) => id !== asset.id);
      deps.notify(tr("asset.deleted"));
      if (!(await deps.refreshList())) {
        deps.notify(tr("asset.deletedRefreshFailed"), "error");
      }
    } catch (error) {
      setActionError(error, tr("asset.deleteFailed"));
    }
  }

  async function deleteSelectedAssets() {
    if (!deps.can("assets.manage")) return;
    const ids = [...deps.selectedAssetIds.value];
    if (!ids.length || assetBatchDeleteSaving.value) return;
    if (!(await deps.confirmAction(tr("asset.batchDeleteConfirm", { count: ids.length })))) return;
    assetBatchDeleteSaving.value = true;
    assetBatchDeleteResult.value = null;
    showAssetBatchDeleteResult.value = false;
    try {
      const result = await deps.request<AssetBatchDeleteResponse>("/assets/batch-delete/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      assetBatchDeleteResult.value = result;
      const succeededIds = new Set(result.results.filter((item) => item.success).map((item) => item.id));
      deps.selectedAssetIds.value = deps.selectedAssetIds.value.filter((id) => !succeededIds.has(id));
      const mutationMessage = result.failed
        ? tr("asset.batchDeleteSummary", { succeeded: result.succeeded, failed: result.failed })
        : tr("asset.batchDeleteSuccess", { count: result.succeeded });
      deps.notify(mutationMessage, result.failed ? "error" : "success");
      const refreshed = await deps.refreshList(true);
      if (!refreshed) {
        deps.notify(`${mutationMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`, "error");
      }
      if (result.failed) showAssetBatchDeleteResult.value = true;
    } catch (error) {
      setActionError(error, tr("asset.batchDeleteFailed"));
    } finally {
      assetBatchDeleteSaving.value = false;
    }
  }

  function closeAssetBatchDeleteResult() {
    if (assetBatchDeleteSaving.value) return;
    showAssetBatchDeleteResult.value = false;
    assetBatchDeleteResult.value = null;
  }

  async function batchAssignAssets(
    action: AssetBatchAssignmentAction,
    assetIds: number[],
    targetPersonId: number,
    reason: string,
  ): Promise<boolean> {
    if (!deps.can("assets.manage") || assetBatchAssignmentSaving.value) return false;
    const ids = Array.from(new Set(assetIds));
    if (!ids.length || ids.length > 100 || !Number.isSafeInteger(targetPersonId) || targetPersonId <= 0) {
      assetBatchAssignmentError.value = ids.length > 100
        ? tr("asset.batchAssignmentLimit")
        : tr("asset.selectPerson");
      return false;
    }

    assetBatchAssignmentSaving.value = true;
    assetBatchAssignmentError.value = "";
    assetBatchAssignmentResult.value = null;
    showAssetBatchAssignmentResult.value = false;
    try {
      const result = await deps.request<AssetBatchAssignmentResponse>("/assets/batch-assignment/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          action,
          target_person: targetPersonId,
          reason: reason.trim(),
        }),
      });
      assetBatchAssignmentResult.value = result;
      const succeededIds = result.results.filter((item) => item.success).map((item) => item.id);
      deps.selectedAssetIds.value = deps.selectedAssetIds.value.filter((id) => !succeededIds.includes(id));
      const mutationMessage = result.failed
        ? tr("asset.batchAssignmentSummary", { succeeded: result.succeeded, failed: result.failed })
        : tr("asset.batchAssignmentSuccess", { count: result.succeeded });
      deps.notify(mutationMessage, result.failed ? "error" : "success");
      const refreshed = await deps.refreshList(true);
      if (!refreshed) {
        deps.notify(`${mutationMessage}；${tr("common.refreshFailed")}，${tr("common.retry")}`, "error");
      }
      showAssetBatchAssignmentResult.value = true;
      return true;
    } catch (error) {
      const normalized = normalizeApiError(error);
      assetBatchAssignmentError.value = normalized.kind === "unknown"
        ? tr("asset.batchAssignmentNetworkUnknown")
        : normalized.kind === "field-validation"
          ? normalized.message
          : normalized.message || tr("asset.batchAssignmentFailed");
      if (normalized.kind === "unknown") {
        await deps.refreshList(true);
      }
      deps.notify(assetBatchAssignmentError.value, "error");
      return false;
    } finally {
      assetBatchAssignmentSaving.value = false;
    }
  }

  function closeAssetBatchAssignmentResult() {
    if (assetBatchAssignmentSaving.value) return;
    showAssetBatchAssignmentResult.value = false;
    assetBatchAssignmentResult.value = null;
    assetBatchAssignmentError.value = "";
  }

  return { assetBatchDeleteSaving, assetBatchDeleteResult, showAssetBatchDeleteResult, assetBatchAssignmentSaving, assetBatchAssignmentError, assetBatchAssignmentResult, showAssetBatchAssignmentResult, responsibilityActionSaving, responsibilityActionError, responsibilityActionFieldErrors, assetDisposalSaving, assetDisposalError, assetDisposalFieldErrors, assignAsset, returnAsset, transferAsset, disposeAsset, clearAssetDisposalErrors, clearResponsibilityActionErrors, clearResponsibilityActionFieldError, restoreAsset, deleteAsset, deleteSelectedAssets, closeAssetBatchDeleteResult, batchAssignAssets, closeAssetBatchAssignmentResult };
}
