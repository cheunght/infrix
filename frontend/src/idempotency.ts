/** Keep an uncertain mutation's identity until its response is consumed. */
const pending = new Map<string, string>();
const prefix = "infrix.pending-mutation.";

export async function prepareIdempotency(path: string, options: RequestInit, headers: Headers): Promise<() => void> {
  const route = path.split("?")[0];
  if ((options.method || "GET").toUpperCase() !== "POST" ||
    !(route === "/spare-transactions/" || /^\/fault-events\/\d+\/part-usages\/$/.test(route)) ||
    headers.has("Idempotency-Key")) return () => {};
  if (typeof options.body !== "string") throw new Error("This mutation requires a JSON body");
  const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest(
    "SHA-256", new TextEncoder().encode(`${path}\n${options.body}`),
  )), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const storageKey = prefix + fingerprint;
  let key = pending.get(fingerprint);
  try { key ||= sessionStorage.getItem(storageKey) || undefined; } catch { /* Privacy mode: retain in memory. */ }
  if (!key) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  pending.set(fingerprint, key);
  try { sessionStorage.setItem(storageKey, key); } catch { /* Privacy mode: retain in memory. */ }
  headers.set("Idempotency-Key", key);
  return () => {
    pending.delete(fingerprint);
    try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be unavailable. */ }
  };
}
