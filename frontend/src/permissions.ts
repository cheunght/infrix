/** Centralized frontend capability checks.  The API remains the authority. */
export function hasCapability(permissions: readonly string[], capability: string) {
  return permissions.includes("*") || permissions.includes(capability);
}

export function hasAnyCapability(
  permissions: readonly string[],
  capabilities: readonly string[],
) {
  return capabilities.some((capability) => hasCapability(permissions, capability));
}
