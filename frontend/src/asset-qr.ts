import type { Asset } from "./types";

export type ParsedAssetQrValue = {
  assetId: number | null;
  assetNo: string;
};

function positiveId(value: unknown): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function decoded(value: string | null): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

/**
 * Keep the QR payload useful outside the current browser session while only
 * encoding the asset identity already exposed by the existing API.
 */
export function buildAssetQrValue(asset: Pick<Asset, "id" | "asset_no">): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = new URL(`${origin}/assets`, origin || "http://localhost");
  url.searchParams.set("asset_id", String(asset.id));
  if (asset.asset_no) url.searchParams.set("asset_no", asset.asset_no);
  return origin ? url.toString() : `${url.pathname}${url.search}`;
}

function parseObject(value: unknown): ParsedAssetQrValue | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const assetId = positiveId(record.asset_id);
  const assetNo = String(record.asset_no ?? "").trim();
  return assetId || assetNo ? { assetId, assetNo } : null;
}

/**
 * Accept generated app URLs, a small JSON payload from an external label
 * printer, or a plain asset number from a keyboard/handheld scanner.
 */
export function parseAssetQrValue(rawValue: string): ParsedAssetQrValue | null {
  const raw = rawValue.trim();
  if (!raw) return null;

  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      return parseObject(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  const isUrl = raw.includes("://") || raw.startsWith("/") || raw.startsWith("?");
  if (isUrl) {
    try {
      const url = new URL(raw, typeof window === "undefined" ? "http://localhost" : window.location.origin);
      const routeAssetId = positiveId(url.searchParams.get("asset_id"));
      const routeAssetNo = decoded(url.searchParams.get("asset_no"));
      if (routeAssetId || routeAssetNo) return { assetId: routeAssetId, assetNo: routeAssetNo };
      return null;
    } catch {
      return null;
    }
  }

  return { assetId: null, assetNo: raw };
}

export function assetLocationLabel(asset: Asset): string {
  const rack = asset.rack_allocation;
  const dataCenter = rack?.data_center || asset.data_center || asset.asset_data_center_name || "";
  const room = rack?.server_room || asset.server_room || "";
  const rackCode = rack?.rack_code || asset.rack_code || "";
  const uRange = rack && rack.start_u != null && rack.end_u != null
    ? `U${rack.start_u}–U${rack.end_u}`
    : asset.u_range || "";
  return [dataCenter, room, rackCode, uRange].filter(Boolean).join(" · ") || "—";
}
