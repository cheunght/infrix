// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { ApiError } from "../src/api";
import { useDataDictionary } from "../src/composables/useDataDictionary";
import type { ActionMessageType } from "../src/error-handling";
import type { RequestFn } from "../src/page-context";

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanups.splice(0).reverse().forEach((cleanup) => cleanup());
});

function createController(request: RequestFn, can = vi.fn(() => true)) {
  const scope = effectScope();
  const controller = scope.run(() => useDataDictionary({
    request,
    confirmAction: vi.fn(async () => true),
    can,
    actionMessage: ref(""),
    actionMessageType: ref<ActionMessageType | null>(null),
  }))!;
  cleanups.push(() => scope.stop());
  return { controller, can };
}

describe("data dictionary controller", () => {
  it("loads only the selected dictionary endpoint and switches sections", async () => {
    const request = vi.fn<RequestFn>(async <T>() => ({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, name: "Acme", code: "ACME", is_active: true }],
    } as T));
    const { controller } = createController(request);

    await controller.loadDictionaries();
    await controller.changeDictionarySection("spare-categories");

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/manufacturers/?page=1&page_size=50&is_active=all",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/spare-part-categories/?page=1&page_size=50&is_active=all",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(controller.dictionarySection.value).toBe("spare-categories");
  });

  it("sends only the active dictionary fields and refreshes the baseline", async () => {
    const request = vi.fn<RequestFn>();
    request
      .mockResolvedValueOnce({ id: 7, name: "New vendor", code: null, is_active: true })
      .mockResolvedValueOnce({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 7, name: "New vendor", code: null, is_active: true }],
      });
    const { controller } = createController(request);

    controller.openDictionaryModal();
    controller.dictionaryForm.value = { name: " New vendor ", code: " ", is_active: true };
    await controller.saveDictionary();

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/manufacturers/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "New vendor", code: null, is_active: true }),
      }),
    );
    expect(controller.showDictionaryModal.value).toBe(false);
    expect(controller.currentDictionaryItems.value[0]).toMatchObject({ id: 7, name: "New vendor" });
    expect(controller.dictionarySaving.value).toBe(false);
  });

  it("maps nested field validation and ignores an older response", async () => {
    const request = vi.fn<RequestFn>();
    let resolveOld!: (value: unknown) => void;
    request
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 2, name: "Current", code: "CURRENT", is_active: true }],
      });
    const { controller } = createController(request);

    const oldLoad = controller.loadDictionaries();
    const currentLoad = controller.loadDictionaries();
    await currentLoad;
    resolveOld({
      count: 1,
      next: null,
      previous: null,
      results: [{ id: 1, name: "Old", code: "OLD", is_active: true }],
    });
    await oldLoad;

    expect(controller.currentDictionaryItems.value[0]).toMatchObject({ id: 2, name: "Current" });

    request.mockRejectedValueOnce(new ApiError(400, "invalid", { name: ["名称已存在"] }));
    controller.openDictionaryModal();
    controller.dictionaryForm.value.name = "Duplicate";
    await controller.saveDictionary();

    expect(controller.dictionaryFormErrors.value.name).toBe("名称已存在");
    expect(controller.dictionarySaving.value).toBe(false);
  });
});
