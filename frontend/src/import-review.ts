import { ElMessage } from "element-plus/es/components/message/index.mjs";
import { i18n } from "./i18n";

export type ImportReviewOperation = "create" | "update" | "unchanged" | "conflict" | "error";
export type ImportReviewError = { field: string; label: string; message: string };
export type ImportReviewChange = { field: string; label: string; old_value: unknown; new_value: unknown };
export type ImportReviewRow = {
  line: number;
  identity: string;
  name: string;
  operation: ImportReviewOperation;
  fields: Array<{ label: string; value: string }>;
  changes: ImportReviewChange[];
  changedFields?: string[];
  errors: ImportReviewError[];
};
export type ImportReviewGroup = { value: ImportReviewOperation; label: string };
type ErrorRow = Pick<ImportReviewRow, "line" | "errors">;

export function importReviewValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return i18n.global.t(value ? "status.active" : "status.inactive");
  return String(value);
}

export function normalizeImportReviewErrors(detail: unknown, labels: Record<string, string>, field = ""): ImportReviewError[] {
  if (detail == null || detail === "") return [];
  if (Array.isArray(detail)) return detail.flatMap(item => normalizeImportReviewErrors(item, labels, field));
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    if (typeof record.field === "string" && typeof record.message === "string") {
      return [{ field: record.field, label: labels[record.field] || String(record.label || ""), message: record.message }];
    }
    return Object.entries(record).filter(([key]) => !["code", "status", "preview"].includes(key))
      .flatMap(([key, value]) => normalizeImportReviewErrors(value, labels, key));
  }
  return [{ field, label: labels[field] || i18n.global.t("common.errorDetails"), message: String(detail) }];
}

export async function copyImportReviewErrors(rows: readonly ErrorRow[]) {
  const text = rows.flatMap(row => row.errors.map(error => (
    `${i18n.global.t("overlay.importErrorLine", { line: row.line })}${error.label ? `${error.label}: ` : ""}${error.message}`
  ))).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    ElMessage.success(i18n.global.t("asset.importErrorsCopied"));
  } catch {
    ElMessage.warning(i18n.global.t("asset.copyDenied"));
  }
}

export function downloadImportReviewErrors(rows: readonly ErrorRow[], filename: string) {
  const csvCell = (value: unknown) => {
    const text = String(value ?? "");
    // Quoting alone does not stop a spreadsheet from interpreting formulas.
    const safe = /^[\s\u0000]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [
    [i18n.global.t("asset.importReviewLine"), i18n.global.t("common.field"), i18n.global.t("common.errorDetails")],
    ...rows.flatMap(row => row.errors.map(error => [row.line, error.label || i18n.global.t("common.errorDetails"), error.message])),
  ].map(line => line.map(csvCell).join(","));
  const url = URL.createObjectURL(new Blob([`\ufeff${lines.join("\n")}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
