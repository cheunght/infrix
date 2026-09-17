import { ApiError } from "./api";
import { i18n } from "./i18n";

export type NormalizedErrorKind =
  | "field-validation"
  | "non-field-validation"
  | "authentication"
  | "permission"
  | "not-found"
  | "conflict"
  | "network"
  | "server"
  | "unknown";

export type ActionMessageType = "success" | "error";

export type NormalizedApiError = {
  status?: number;
  kind: NormalizedErrorKind;
  message: string;
  fieldErrors: Record<string, string[]>;
  nonFieldErrors: string[];
  code?: string;
  retryable: boolean;
};

const tr = (key: string): string => String(i18n.global.t(key));

const INTERNAL_MESSAGE_PATTERN = /(?:traceback|stack\s*trace|exception|sql(?:state)?|operationalerror|integrityerror|programmingerror|psycopg|sqlite|django\.|file\s+"| at 0x[0-9a-f]+|undefined column|relation .* does not exist)/i;
const RAW_FIELD_MESSAGE_PATTERN = /^[A-Za-z_][\w.-]*\s*[:：]/;
const SENSITIVE_VALUE_PATTERN = /(?:password|passwd|secret|token|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|authorization|bearer|hash|digest)\s*(?:=|[:：])\s*\S+/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeMessage(value: unknown): string {
  if (typeof value !== "string") return "";
  const message = value.trim();
  if (!message || message.length > 300 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(message)) return "";
  if (
    INTERNAL_MESSAGE_PATTERN.test(message)
    || RAW_FIELD_MESSAGE_PATTERN.test(message)
    || SENSITIVE_VALUE_PATTERN.test(message)
  ) return "";
  return message;
}

function collectSafeMessages(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSafeMessages);
  if (isRecord(value)) return Object.values(value).flatMap(collectSafeMessages);
  const message = safeMessage(value);
  return message ? [message] : [];
}

function uniqueMessages(messages: string[]): string[] {
  return [...new Set(messages.filter(Boolean))];
}

function errorDetails(error: unknown): unknown {
  return error instanceof ApiError ? error.details : undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (error instanceof ApiError) return error.status;
  if (isRecord(error) && typeof error.status === "number") return error.status;
  return undefined;
}

function errorCode(details: unknown): string | undefined {
  if (!isRecord(details) || typeof details.code !== "string") return undefined;
  return details.code;
}

function isNetworkError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? String((error as { name?: unknown }).name || "") : "";
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";
  return name === "TypeError"
    || name === "NetworkError"
    || /failed to fetch|networkerror|load failed|fetch failed/i.test(message);
}

function extractDetails(details: unknown): {
  fieldErrors: Record<string, string[]>;
  nonFieldErrors: string[];
} {
  const root = isRecord(details) ? details : null;
  const nestedDetail = root && isRecord(root.detail) ? root.detail : null;
  const source = nestedDetail || root;
  if (!source) {
    return {
      fieldErrors: {},
      nonFieldErrors: uniqueMessages(collectSafeMessages(details)),
    };
  }

  const fieldErrors: Record<string, string[]> = {};
  const nonFieldErrors: string[] = [];
  const metaKeys = new Set(["code", "retry_after", "preview", "status", "message"]);

  for (const [key, value] of Object.entries(source)) {
    if (key === "detail" || key === "non_field_errors" || key === "message") {
      nonFieldErrors.push(...collectSafeMessages(value));
      continue;
    }
    if (metaKeys.has(key)) continue;
    const messages = uniqueMessages(collectSafeMessages(value));
    if (messages.length) fieldErrors[key] = messages;
  }

  if (root && typeof root.detail === "string") {
    nonFieldErrors.push(...collectSafeMessages(root.detail));
  }

  return {
    fieldErrors,
    nonFieldErrors: uniqueMessages(nonFieldErrors),
  };
}

function defaultMessage(kind: NormalizedErrorKind): string {
  switch (kind) {
    case "field-validation":
      return tr("api.validationFailed");
    case "non-field-validation":
      return tr("api.nonFieldValidationFailed");
    case "authentication":
      return tr("api.sessionExpired");
    case "permission":
      return tr("api.forbidden");
    case "not-found":
      return tr("api.resourceNotFound");
    case "conflict":
      return tr("api.conflict");
    case "network":
      return tr("api.networkError");
    case "server":
      return tr("api.serverUnavailable");
    default:
      return tr("api.unknownError");
  }
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  const status = errorStatus(error);
  const details = errorDetails(error);
  const extracted = extractDetails(details);
  const code = errorCode(details);
  let kind: NormalizedErrorKind;

  if (isNetworkError(error)) kind = "network";
  else if (status === 400 && Object.keys(extracted.fieldErrors).length) kind = "field-validation";
  else if (status === 400) kind = "non-field-validation";
  else if (status === 401) kind = "authentication";
  else if (status === 403) kind = "permission";
  else if (status === 404) kind = "not-found";
  else if (status === 409) kind = "conflict";
  else if (status != null && status >= 500) kind = "server";
  else kind = "unknown";

  const safeBusinessMessage = kind === "non-field-validation" || kind === "conflict"
    ? extracted.nonFieldErrors[0]
    : undefined;
  const safeUnknownMessage = kind === "unknown" && error instanceof Error
    ? safeMessage(error.message)
    : undefined;

  return {
    status,
    kind,
    message: safeBusinessMessage || safeUnknownMessage || defaultMessage(kind),
    fieldErrors: extracted.fieldErrors,
    nonFieldErrors: extracted.nonFieldErrors,
    code,
    retryable: kind === "network" || kind === "server",
  };
}

export function fieldErrorsToText(
  fieldErrors: Record<string, string[]>,
  allowedFields?: readonly string[],
): Record<string, string> {
  const allowed = allowedFields ? new Set(allowedFields) : null;
  return Object.fromEntries(
    Object.entries(fieldErrors)
      .filter(([field]) => !allowed || allowed.has(field))
      .map(([field, messages]) => [field, messages.join("；")]),
  );
}

export function clearFieldError<T extends Record<string, unknown>>(fieldErrors: T, field: string): T {
  if (!(field in fieldErrors)) return fieldErrors;
  const next = { ...fieldErrors } as T;
  delete next[field];
  return next;
}
