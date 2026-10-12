import { computed, ref } from "vue";
import { apiBase } from "../api";

export type BackupOperation = {
  id: string;
  kind: "backup" | "restore";
  status: "queued" | "running" | "succeeded" | "failed";
  stage: string;
  filename: string;
  detail?: string;
  error_code?: string;
  maintenance_closed?: boolean;
  recovery_required?: boolean;
  safety_backup?: string;
  result?: { filename: string; safety_backup?: string; sessions_invalidated?: number };
};
type Receipt = { id: string; token: string; kind: "backup" | "restore"; filename: string };
const STORAGE_KEY = "infrix.backup-operation";

export function createBackupOperations() {
  const receipt = ref<Receipt | null>(null);
  const operation = ref<BackupOperation | null>(null);
  const readFailed = ref(false);
  const notFound = ref(false);
  const submitting = ref(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  let active = false;
  const busy = computed(() => Boolean(receipt.value && (!operation.value || ["queued", "running"].includes(operation.value.status))));
  function persist() {
    try {
      if (receipt.value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(receipt.value));
      else sessionStorage.removeItem(STORAGE_KEY);
    } catch { /* Status can still be monitored in this page. */ }
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null") as Receipt | null;
    if (stored && /^[0-9a-f-]{36}$/.test(stored.id) && /^[0-9a-f]{64}$/.test(stored.token) && ["backup", "restore"].includes(stored.kind)) receipt.value = stored;
  } catch { /* An unavailable or invalid receipt must not block login. */ }
  async function poll() {
    if (!receipt.value || controller || (typeof document !== "undefined" && document.hidden)) return;
    const current = receipt.value;
    const abort = new AbortController(); controller = abort;
    const deadline = setTimeout(() => abort.abort("timeout"), 10000);
    try {
      const response = await fetch(`${apiBase}/system/backups/operations/${current.id}/`, {
        headers: { "X-Maintenance-Token": current.token }, credentials: "omit", cache: "no-store", signal: abort.signal,
      });
      if (receipt.value !== current || abort.signal.aborted) return;
      notFound.value = response.status === 404;
      if (!response.ok) throw new Error("status unavailable");
      const payload = await response.json() as { operation: BackupOperation };
      if (receipt.value !== current || abort.signal.aborted) return;
      if (payload.operation.id !== current.id || payload.operation.kind !== current.kind) throw new Error("invalid status");
      operation.value = payload.operation; readFailed.value = false;
    } catch {
      if (receipt.value === current && (!abort.signal.aborted || abort.signal.reason === "timeout")) readFailed.value = true;
    } finally {
      clearTimeout(deadline);
      if (controller === abort) controller = undefined;
      if (receipt.value === current) {
        clearTimeout(timer);
        if (active && (busy.value || readFailed.value || operation.value?.maintenance_closed)) timer = setTimeout(() => void poll(), 2000);
      }
    }
  }
  function visibility() { if (!document.hidden && receipt.value) void poll(); }
  function start() {
    if (active) return;
    active = true; document.addEventListener("visibilitychange", visibility); void poll();
  }
  function stop() {
    active = false; clearTimeout(timer); controller?.abort(); controller = undefined;
    document.removeEventListener("visibilitychange", visibility);
  }
  function clear() {
    controller?.abort(); controller = undefined; clearTimeout(timer);
    receipt.value = null; operation.value = null; readFailed.value = false; notFound.value = false; persist();
    submitting.value = false;
  }
  function begin(kind: Receipt["kind"], filename = "") {
    if (receipt.value) throw new Error("maintenance operation already pending");
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const token = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
    const identity = crypto.getRandomValues(new Uint8Array(16));
    identity[6] = (identity[6] & 15) | 64; identity[8] = (identity[8] & 63) | 128;
    const hex = [...identity].map(value => value.toString(16).padStart(2, "0")).join("");
    const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    receipt.value = { id, token, kind, filename };
    operation.value = { id: receipt.value.id, kind, filename, status: "queued", stage: "queued" };
    submitting.value = true;
    persist(); start();
    return receipt.value;
  }
  function accepted(value: BackupOperation) {
    if (!receipt.value || value?.id !== receipt.value.id || value.kind !== receipt.value.kind) throw new Error("invalid maintenance receipt");
    if (!operation.value || !["succeeded", "failed"].includes(operation.value.status)) operation.value = value;
    submitting.value = false; void poll();
  }
  function unconfirmed() { submitting.value = false; readFailed.value = true; void poll(); }
  return { receipt, operation, busy, submitting, readFailed, notFound, begin, accepted, unconfirmed, clear, poll, start, stop };
}

let instance: ReturnType<typeof createBackupOperations> | undefined;
export function useBackupOperations() { return instance ??= createBackupOperations(); }
