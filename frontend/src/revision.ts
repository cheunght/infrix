import { ApiError } from "./api";
import { i18n } from "./i18n";

/** Use the version of the record the editor actually opened. */
export function revisionHeaders(record?: { id: number; revision?: number } | null): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!record) return headers;
  if (!Number.isSafeInteger(record.revision) || (record.revision || 0) < 1) {
    throw new ApiError(428, String(i18n.global.t("api.resourceRevisionRequired")), { code: "resource_revision_required" });
  }
  headers["If-Match"] = `"${record.revision}"`;
  return headers;
}
