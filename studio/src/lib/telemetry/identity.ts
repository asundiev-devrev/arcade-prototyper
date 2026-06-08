/**
 * Resolves the telemetry distinct_id. Dependency-injected for pure testing.
 * Order: persisted settings.telemetry.distinctId → DevRev email → anon UUID.
 * Whatever is resolved is persisted so renderer + server agree.
 */
export interface IdentityDeps {
  readSettings: () => Promise<{ telemetry?: { distinctId?: string } }>;
  writeDistinctId: (id: string) => Promise<void>;
  resolveEmail: () => Promise<string | null>;
  genUuid: () => string;
}

export async function resolveDistinctId(deps: IdentityDeps): Promise<string> {
  const existing = (await deps.readSettings()).telemetry?.distinctId;
  if (existing) return existing;
  const id = (await deps.resolveEmail()) ?? deps.genUuid();
  await deps.writeDistinctId(id);
  return id;
}
