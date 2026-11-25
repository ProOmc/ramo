/**
 * One typed model-choice list shared by the chip menu, the toolbar select and
 * the Choose-model dialog — the point of the re-derivation (scope doc §9).
 * Values are the real ids the runtime accepts.
 */

export interface ModelChoice {
  name: string;
  label: string;
  details?: string;
  group: 'profiles' | 'api';
  kind?: 'api';
  ready?: boolean;
}

export function localProfiles(): ModelChoice[] {
  const registry = (globalThis as { __ramoModelRegistry?: Array<{ id?: string; kind?: string; model?: string; label?: string; tier?: string }> }).__ramoModelRegistry ?? [];
  const labels: Array<[string, string]> = [['fast', 'Fast'], ['smart', 'Smart'], ['superSmart', 'Super Smart']];
  return labels.map(([tier, label]) => {
    const configured = registry.find((profile) => profile.tier === tier)
      ?? registry.find((profile) => profile.label === label);
    return { name: configured?.model || '', label, details: configured?.model || 'Assign a model in Settings → Setup', group: 'profiles' as const };
  }).filter((choice) => choice.name);
}

export function availableModelChoices(): ModelChoice[] {
  const choices = localProfiles();
  const seen = new Set(choices.map((c) => c.name));
  for (const p of (globalThis as { __ramoModelRegistry?: Array<Record<string, unknown>> }).__ramoModelRegistry ?? []) {
    if (!p || p.kind !== 'api' || typeof p.model !== 'string' || !p.model || seen.has(p.model)) continue;
    seen.add(p.model as string);
    choices.push({
      name: p.model as string,
      label: String(p.label ?? p.name ?? p.model),
      details: [p.provider, p.providerModel].filter(Boolean).join(' · ') || 'Cloud provider model',
      group: 'api',
      kind: 'api',
      ready: typeof p.ready === 'boolean' ? (p.ready as boolean) : undefined,
    });
  }
  return choices;
}

let registryAt = 0;
let registryPending = false;

/** Merge local runtime summary + saved API profiles into __ramoModelRegistry. */
export async function refreshApiRegistry(force = false): Promise<void> {
  if (registryPending || (!force && Date.now() - registryAt < 8000) || !window.ramoDesktop?.modelSummary) return;
  registryPending = true;
  try {
    const [local, api] = await Promise.all([
      window.ramoDesktop.modelSummary(),
      window.ramoDesktop.apiProviders?.list?.().catch(() => []) ?? Promise.resolve([] as unknown[]),
    ]);
    const apiRows = (api as Array<Record<string, unknown>>) ?? [];
    (globalThis as { __ramoModelRegistry?: Array<Record<string, unknown>> }).__ramoModelRegistry = [
      ...((local ?? []) as Array<Record<string, unknown>>),
      ...apiRows.filter((row) => row && typeof row === 'object' && (typeof row.kind === 'string' ? row.kind === 'api' : true)),
    ];
    registryAt = Date.now();
  } finally {
    registryPending = false;
  }
}
