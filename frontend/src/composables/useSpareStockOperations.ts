import { ref, watch, type Ref } from "vue";
import type { ServerRoom, SparePart } from "../types";
import type { CapabilityFn, RequestFn } from "../page-context";
import { businessOptionLabel, STOCK_OPERATION_OPTIONS, STOCK_SOURCE_OPERATION_VALUES, STOCK_TARGET_OPERATION_VALUES, type StockOperationType } from "../business-enums";
import { clearFieldError, fieldErrorsToText, normalizeApiError, type ActionMessageType } from "../error-handling";
import { i18n } from "../i18n";

const tr = (key: string, params?: Record<string, unknown>): string => String(params ? i18n.global.t(key, params) : i18n.global.t(key));

const SPARE_OPERATION_FORM_FIELDS = [
  "part",
  "quantity",
  "adjustment_quantity",
  "source_data_center",
  "source_server_room",
  "target_data_center",
  "target_server_room",
  "reference",
  "notes",
] as const;

export type SpareOperationLocation = {
  data_center: number;
  server_room: number | null;
  quantity: number;
  label: string;
};

interface StockOperationsDeps {
  request: RequestFn;
  can: CapabilityFn;
  spareRooms: Ref<ServerRoom[]>;
  actionMessage: Ref<string>;
  actionMessageType: Ref<ActionMessageType | null>;
  refresh: () => Promise<string | null>;
}

export function useSpareStockOperations(deps: StockOperationsDeps) {
  const spareOperationType = ref<StockOperationType>("inbound");
  const spareOperationForm = ref({
    part: "", quantity: "1", adjustment_quantity: "", source_data_center: "", source_server_room: "", target_data_center: "", target_server_room: "", reference: "", notes: "",
  });
  const showSpareOperationModal = ref(false);
  const spareOperationSaving = ref(false);
  const spareOperationError = ref("");
  const spareOperationFormErrors = ref<Record<string, string>>({});
  const spareOperationCurrentQuantity = ref<number | null>(null);
  const spareOperationLocationLabel = ref("");
  const spareOperationLocationLocked = ref(false);
  const spareRooms = deps.spareRooms;
  function setActionMessage(message: string, type: ActionMessageType = "success") {
    deps.actionMessageType.value = type;
    deps.actionMessage.value = message;
  }
  function extractFormError(error: unknown, allowedFields: readonly string[], fallback: string) {
    const normalized = normalizeApiError(error);
    const fields = fieldErrorsToText(normalized.fieldErrors, allowedFields);
    const hasUnknownField = Object.keys(normalized.fieldErrors).some(field => !allowedFields.includes(field));
    const message = normalized.kind === "field-validation" && !hasUnknownField ? "" : normalized.kind === "unknown" ? fallback : normalized.message;
    return {fields, message};
  }
  for (const field of SPARE_OPERATION_FORM_FIELDS) {
    watch(() => spareOperationForm.value[field], () => {
      if (spareOperationFormErrors.value[field]) spareOperationFormErrors.value = clearFieldError(spareOperationFormErrors.value, field);
    });
  }

  function openSpareOperation(part: SparePart, operationType: StockOperationType = "inbound", location?: SpareOperationLocation) {
    if (!deps.can("spares.manage")) return;
    spareOperationError.value = "";
    spareOperationFormErrors.value = {};
    spareOperationType.value = operationType;
    let remembered: Partial<SpareOperationLocation> | null = null;
    if (!location) {
      try { remembered = JSON.parse(localStorage.getItem("infrix.spare.last_location") || "null") as Partial<SpareOperationLocation> | null; } catch { remembered = null; }
    }
    const rememberedCenterId = remembered?.data_center ? Number(remembered.data_center) : 0;
    const rememberedRoomId = remembered?.server_room ? Number(remembered.server_room) : 0;
    const rememberedCenter = Number.isInteger(rememberedCenterId) && rememberedCenterId > 0
      ? { id: rememberedCenterId }
      : null;
    const rememberedRoom = rememberedCenter && Number.isInteger(rememberedRoomId) && rememberedRoomId > 0
      ? { id: rememberedRoomId, data_center: rememberedCenter.id }
      : null;
    const preset = location || (rememberedCenter && (!remembered?.server_room || rememberedRoom) ? { data_center: rememberedCenter.id, server_room: rememberedRoom?.id || null, quantity: 0, label: tr("spare.recentLocation") } : undefined);
    spareOperationForm.value = {
      part: String(part.id), quantity: "1", adjustment_quantity: "",
      source_data_center: preset && STOCK_SOURCE_OPERATION_VALUES.includes(operationType) ? String(preset.data_center) : "",
      source_server_room: preset && STOCK_SOURCE_OPERATION_VALUES.includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      target_data_center: preset && STOCK_TARGET_OPERATION_VALUES.includes(operationType) ? String(preset.data_center) : "",
      target_server_room: preset && STOCK_TARGET_OPERATION_VALUES.includes(operationType) && preset.server_room ? String(preset.server_room) : "",
      reference: "", notes: "",
    };
    spareOperationCurrentQuantity.value = location ? location.quantity : null;
    spareOperationLocationLabel.value = location?.label || "";
    spareOperationLocationLocked.value = Boolean(location);
    showSpareOperationModal.value = true;
  }

  async function saveSpareOperation(): Promise<boolean> {
    if (!deps.can("spares.manage")) return false;
    if (spareOperationSaving.value) return false;
    spareOperationError.value = "";
    spareOperationFormErrors.value = {};
    spareOperationSaving.value = true;
    try {
      const operation = spareOperationType.value;
      const form = spareOperationForm.value;
      const payload: Record<string, unknown> = { part: Number(form.part), operation_type: operation, reference: form.reference, notes: form.notes };
      if (operation === "adjustment") payload.adjustment_quantity = Number(form.adjustment_quantity || 0);
      else payload.quantity = Number(form.quantity || 0);
      if (STOCK_TARGET_OPERATION_VALUES.includes(operation)) { payload.target_data_center = Number(form.target_data_center); payload.target_server_room = form.target_server_room ? Number(form.target_server_room) : null; }
      if (STOCK_SOURCE_OPERATION_VALUES.includes(operation)) { payload.source_data_center = Number(form.source_data_center); payload.source_server_room = form.source_server_room ? Number(form.source_server_room) : null; }
      await deps.request("/spare-transactions/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const locationDataCenter = STOCK_SOURCE_OPERATION_VALUES.includes(operation) ? form.source_data_center : form.target_data_center;
      const locationServerRoom = STOCK_SOURCE_OPERATION_VALUES.includes(operation) ? form.source_server_room : form.target_server_room;
      try {
        if (locationDataCenter) localStorage.setItem("infrix.spare.last_location", JSON.stringify({ data_center: Number(locationDataCenter), server_room: locationServerRoom ? Number(locationServerRoom) : null }));
      } catch { /* Optional browser preferences must not change a committed transaction's outcome. */ }
      showSpareOperationModal.value = false;
      setActionMessage(tr("spare.transactionSaved"));
      try {
        const refreshError = await deps.refresh();
        if (refreshError) setActionMessage(tr("spare.transactionSavedRefreshFailed"), "error");
      } catch {
        setActionMessage(tr("spare.transactionSavedRefreshFailed"), "error");
      }
      return true;
    } catch (error) {
      const parsed = extractFormError(error, SPARE_OPERATION_FORM_FIELDS, tr("spare.operationFailed"));
      spareOperationFormErrors.value = parsed.fields;
      spareOperationError.value = parsed.message;
      return false;
    } finally {
      spareOperationSaving.value = false;
    }
  }

  function spareOperationLabel(operation: string) {
    return businessOptionLabel(STOCK_OPERATION_OPTIONS, operation);
  }

  return {spareOperationType, spareOperationForm, showSpareOperationModal, spareOperationSaving, spareOperationError, spareOperationFormErrors, spareOperationCurrentQuantity,
    spareOperationLocationLabel, spareOperationLocationLocked, openSpareOperation, saveSpareOperation, spareOperationLabel};
}
