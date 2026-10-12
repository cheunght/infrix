export interface BackgroundJob {
  id: string;
  kind: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  checkpoint: string;
  attempts: number;
  created_at: string;
  started_at?: string | null;
  params?: Record<string, string | number | boolean> | null;
  task_id?: string | number | null;
  result_unavailable_reason?: string;
  finished_at: string | null;
  error_code: string;
  result: Record<string, unknown>;
  result_available: boolean;
}
export interface QueuedJob {
  job: BackgroundJob;
}
export function isQueuedJob(value: unknown): value is QueuedJob {
  return typeof value === "object" && value !== null && "job" in value;
}
export const importJobs: Record<string, string> = {
  "/assets/import/": "asset_import",
  "/asset-models/import/": "asset_model_import",
  "/people/import/": "people_import",
  "/departments/import/": "department_import",
};
export const exportJobs: Record<string, string> = {
  "/reports/assets/export/": "asset_export",
  "/reports/asset-models/export/": "asset_model_export",
  "/reports/repairs/export/": "repair_record_export",
  "/reports/licenses/export/": "license_export",
  "/reports/spare-parts/export/": "spare_part_export",
  "/reports/spare-transactions/export/": "spare_transaction_export",
  "/reports/racks/export/": "rack_layout_export",
  "/audit-logs/export/": "audit_export",
};

export const pendingJob = (job: BackgroundJob) =>
  job.status === "queued" || job.status === "running";
export const jobAttemptKey = (job: BackgroundJob) =>
  `${job.id}:${job.attempts}`;
export function jobLocation(job: BackgroundJob): string {
  const routes: Record<string, string> = {
    asset_import: "/assets",
    asset_export: "/assets",
    asset_model_import: "/assets/configuration?tab=models",
    asset_model_export: "/assets/configuration?tab=models",
    people_import: "/settings/organization?tab=people",
    department_import: "/settings/organization?tab=departments",
    repair_record_export: "/repairs",
    license_export: "/licenses",
    spare_part_export: "/spares",
    spare_transaction_export: "/spares",
    rack_layout_export: "/racks/view",
    inventory_export: "/inventory",
    audit_export: "/settings/audit",
    notification_digest: "/settings/system?tab=notifications",
  };
  const url = new URL(routes[job.kind] || "/", window.location.origin);
  url.searchParams.set("job", job.id);
  if (job.kind === "inventory_export" && job.task_id)
    url.searchParams.set("task", String(job.task_id));
  return url.pathname + url.search;
}
export function routeJobKinds(path: string, tab?: unknown): string[] {
  if (path === "/assets") return ["asset_import", "asset_export"];
  if (path === "/assets/configuration" && (!tab || tab === "models"))
    return ["asset_model_import", "asset_model_export"];
  if (path === "/settings/organization" && tab === "people")
    return ["people_import"];
  if (path === "/settings/organization" && tab === "departments")
    return ["department_import"];
  const kinds: Record<string, string[]> = {
    "/repairs": ["repair_record_export"],
    "/licenses": ["license_export"],
    "/spares": ["spare_part_export", "spare_transaction_export"],
    "/racks/view": ["rack_layout_export"],
    "/racks/locations": ["rack_layout_export"],
    "/inventory": ["inventory_export"],
    "/settings/audit": ["audit_export"],
  };
  return kinds[path] || [];
}

export function announceJob(job: BackgroundJob) {
  window.dispatchEvent(new CustomEvent('infrix-job-created', {detail:job}));
}
