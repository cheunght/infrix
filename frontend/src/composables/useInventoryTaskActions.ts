import { ref, type Ref } from "vue";
import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { ElMessageBox } from "element-plus/es/components/message-box/index.mjs";
import { i18n } from "../i18n";
import type { InventoryTask } from "../types";
import type { InventoryContext } from "../page-context";
import type { ActionMessageType } from "../error-handling";

interface TaskActionDeps {
  request: InventoryContext["request"];
  can: InventoryContext["can"];
  activeTask: Ref<InventoryTask | null>;
  itemListError: Ref<string>;
  taskListError: Ref<string>;
  loadItems: () => Promise<boolean>;
  loadTasks: () => Promise<unknown>;
  setActionMessage: (message: string, type?: ActionMessageType) => void;
  setActionError: (error: unknown, fallback: string) => string;
}

export function useInventoryTaskActions(deps: TaskActionDeps) {
  const taskCompleting = ref(false);
  const taskReopening = ref(false);

  async function completeTask() {
    if (!deps.can("inventory.manage") || !deps.activeTask.value || taskCompleting.value) return;
    if (deps.activeTask.value.summary.pending > 0) {
      ElMessage.warning(i18n.global.t("inventory.pendingCannotComplete", { count: deps.activeTask.value.summary.pending }));
      return;
    }
    const taskId = deps.activeTask.value.id;
    const summary = deps.activeTask.value.summary;
    const ok = await ElMessageBox.confirm(
      [
        i18n.global.t("inventory.completeSummaryTotal", { count: summary.total }),
        i18n.global.t("inventory.completeSummaryNormal", { count: summary.normal, exceptions: summary.exceptions }),
        i18n.global.t("inventory.completeSummaryPending", { pending: summary.pending, unresolved: summary.resolution_pending }),
        "",
        i18n.global.t("inventory.completeConfirmWarning"),
      ].join("\n"),
      i18n.global.t("inventory.completeTaskTitle"),
      {
        type: "warning",
        confirmButtonText: i18n.global.t("inventory.completeTask"),
        cancelButtonText: i18n.global.t("common.cancel"),
      },
    ).catch(() => false);
    if (!ok || deps.activeTask.value?.id !== taskId || taskCompleting.value) return;
    taskCompleting.value = true;
    try {
      const result = await deps.request<InventoryTask>(
        `/inventory-tasks/${taskId}/complete/`,
        { method: "POST" },
      );
      if (deps.activeTask.value?.id === taskId) deps.activeTask.value = result;
      await Promise.all([deps.loadItems(), deps.loadTasks()]);
      const resolutionPending = result.summary.resolution_pending || 0;
      deps.setActionMessage(
        resolutionPending > 0
          ? i18n.global.t("inventory.taskCompletedWithPending", { count: resolutionPending })
          : i18n.global.t("inventory.taskCompleted"),
        "success",
      );
      if (deps.itemListError.value || deps.taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskCompleteRefreshFailed"));
      }
    } catch (error) {
      deps.setActionError(error, i18n.global.t("inventory.taskCompleteFailed"));
    } finally {
      taskCompleting.value = false;
    }
  }

  async function reopenTask() {
    if (!deps.can("inventory.manage") || !deps.activeTask.value || taskReopening.value) return;
    if (deps.activeTask.value.status !== "completed") {
      ElMessage.warning(i18n.global.t("inventory.reopenOnlyCompleted"));
      return;
    }
    const taskId = deps.activeTask.value.id;
    taskReopening.value = true;
    try {
      const result = await deps.request<InventoryTask>(
        `/inventory-tasks/${taskId}/reopen/`,
        { method: "POST" },
      );
      if (deps.activeTask.value?.id === taskId) deps.activeTask.value = result;
      await Promise.all([deps.loadItems(), deps.loadTasks()]);
      deps.setActionMessage(i18n.global.t("inventory.taskReopened"), "success");
      if (deps.itemListError.value || deps.taskListError.value) {
        ElMessage.warning(i18n.global.t("inventory.taskReopenRefreshFailed"));
      }
    } catch (error) {
      deps.setActionError(error, i18n.global.t("inventory.taskReopenFailed"));
    } finally {
      taskReopening.value = false;
    }
  }

  return {taskCompleting, taskReopening, completeTask, reopenTask};
}
