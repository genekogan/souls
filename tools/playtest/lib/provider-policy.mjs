// Explicit spending boundary. No provider is ever substituted for a missing binary.
export function providerPolicy(scenario = {}) {
  const codexOnly = scenario.providers?.allowed?.length === 1 && scenario.providers.allowed[0] === 'codex';
  const allowed = new Set(scenario.providers?.allowed ?? ['claude', 'codex']);
  for (const p of allowed) if (!['claude', 'codex'].includes(p)) throw new Error(`unknown provider ${p}`);
  const required = new Set();
  for (const seat of [...(scenario.seats ?? []), ...(scenario.god ? [scenario.god] : [])]) {
    const adapter = seat.adapter ?? 'claude-headless';
    if (adapter === 'scripted-owner') continue; // model-free seat adapter (#751): no provider, nothing to spend
    if (!['claude-headless', 'codex-headless'].includes(adapter)) throw new Error(`unknown adapter ${adapter}`);
    const provider = adapter.replace('-headless', '');
    if (!allowed.has(provider)) throw new Error(`provider policy forbids ${provider} seat ${seat.id ?? 'god'}`);
    required.add(provider);
  }
  const deterministic = scenario.review?.mode === 'deterministic';
  if (scenario.review?.mode && !['deterministic', 'model'].includes(scenario.review.mode)) throw new Error('unknown review mode');
  const modelRoles = [];
  if ((scenario.director?.mode ?? 'persona') !== 'scripted') modelRoles.push('persona director');
  if (!deterministic) modelRoles.push('reviewer');
  if (!deterministic && scenario.review?.developer !== false) modelRoles.push('developer');
  if (modelRoles.length) {
    if (!allowed.has('claude')) throw new Error(`provider policy forbids Claude ${modelRoles.join(', ')}; use scripted director and review.mode=deterministic`);
    required.add('claude');
  }
  return { required: [...required], codexOnly, deterministic, claude: required.has('claude') };
}
export function requireProviders(policy, versions) {
  for (const provider of policy.required) if (!versions[provider]) throw new Error(`${provider} unavailable; provider substitution is disabled`);
}

/** Draft fixtures must never accidentally spend inference or be mistaken for frozen measurements. */
export function assertMeasurementReady(scenario) {
  if (!scenario.freeze) return;
  if (scenario.freeze.status !== 'ready') throw new Error('measurement fixture is draft; verify and freeze physical geometry, starts and model before baseline');
  if (!scenario.freeze.physicalSha256 || !scenario.freeze.model) throw new Error('frozen measurement requires physicalSha256 and verified model');
  if ((scenario.seats ?? []).some(s => s.model !== scenario.freeze.model)) throw new Error('seat model differs from frozen model');
  if (scenario.director?.script?.some(e => e.expect?.journey?.readiness !== 'ready')) throw new Error('journey fixtures are not all ready');
}
