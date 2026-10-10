export interface BackgroundJob {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress: number;
  checkpoint: string;
  attempts: number;
  created_at: string;
  finished_at: string | null;
  error_code: string;
  result: Record<string, unknown>;
  result_available: boolean;
}
export interface QueuedJob { job: BackgroundJob }
export function isQueuedJob(value: unknown): value is QueuedJob {
  return typeof value === 'object' && value !== null && 'job' in value;
}
export function announceJob(job: BackgroundJob) {
  window.dispatchEvent(new CustomEvent('infrix-job-created', {detail: job}));
}
export const importJobs: Record<string, string> = {
  '/assets/import/': 'asset_import', '/asset-models/import/': 'asset_model_import',
  '/people/import/': 'people_import', '/departments/import/': 'department_import',
};
export const exportJobs: Record<string, string> = {
  '/reports/assets/export/': 'asset_export', '/reports/asset-models/export/': 'asset_model_export',
  '/reports/repairs/export/': 'repair_record_export', '/reports/licenses/export/': 'license_export',
  '/reports/spare-parts/export/': 'spare_part_export', '/reports/spare-transactions/export/': 'spare_transaction_export',
  '/reports/racks/export/': 'rack_layout_export', '/audit-logs/export/': 'audit_export',
};
