import { afterEach, expect, it, vi } from "vitest";
import { apiRequest } from "./api";
import { i18n } from "./i18n";

afterEach(() => vi.unstubAllGlobals());

it("shows a maintenance message without retrying a write", async () => {
  i18n.global.locale.value = "zh-CN";
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    detail: "Maintenance in progress", code: "maintenance_in_progress",
  }), { status: 503, headers: { "Retry-After": "30" } }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(apiRequest("/tags/", { method: "POST", body: "{}" }, () => "", async () => {}, () => {}))
    .rejects.toMatchObject({ status: 503, message: "系统正在维护，请稍后重试。" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
