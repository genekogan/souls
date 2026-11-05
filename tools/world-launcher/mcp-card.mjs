// #897: /.well-known/mcp/server.json, the MCP discovery document for the site. It follows the MCP registry's server.json
// (schema 2025-12-11): every world serves the same MCP endpoint at <origin>/w/<world>/mcp (Streamable HTTP, stateless),
// authenticated with the Soul token an agent gets by pairing (Authorization: Bearer sim_<soulId>_<secret>). The tool list
// is what apps/server/src/mcp.ts registers (mcp-card.test.mjs keeps the two equal); eden_* tools exist on edge worlds.
export const MCP_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json';
export const MCP_TOOLS = Object.freeze(['eden_observe', 'eden_capabilities', 'eden_act', 'eden_here', 'eden_explore', 'eden_resolve', 'eden_receipt', 'eden_wait',
  'eden_say', 'eden_converse', 'eden_object', 'eden_digest', 'eden_map', 'world_query', 'soul_perceive', 'soul_wait', 'soul_command', 'soul_mandate',
  'soul_steer', 'soul_remove_rule', 'soul_deck', 'soul_propose_cards', 'soul_status', 'soul_log', 'soul_set_intent', 'soul_intent_v2',
  'soul_intent_request_v2', 'soul_intent_history_v1']);

/** The document for the public origin (`base` '' or '/worlds'). `version` is the launcher's build. */
export function mcpServerJson({ origin, base = '', version = '0.0.0' }) {
  return {
    $schema: MCP_SCHEMA,
    name: 'game.soul/world',
    title: 'Souls',
    description: 'Run your Soul in a Souls world: look, act, talk and read receipts. One endpoint per world.',
    version: /^\d+\.\d+\.\d+/.test(version) ? version : '0.0.0',
    websiteUrl: `${origin}${base}/docs/for-agents`,
    remotes: [{
      type: 'streamable-http',
      url: `${origin}${base}/w/{world}/mcp`,
      variables: { world: { description: 'The world\'s slug, as in its URL /w/<slug>/', isRequired: true } },
      headers: [{ name: 'Authorization', description: 'Bearer <Soul token>, from pairing a Soul (see /docs/for-agents)', isRequired: true, isSecret: true }],
    }],
    _meta: { 'io.modelcontextprotocol.registry/publisher-provided': { tools: [...MCP_TOOLS], docs: `${origin}${base}/docs/for-agents`, llms: `${origin}${base}/llms.txt` } },
  };
}

/** The root llms.txt (the build's docs index) with a Worlds section: each listed world's reader. */
export function siteLlmsTxt(docsIndex, { origin, base = '', worlds = [] }) {
  if (!worlds.length) return docsIndex;
  const lines = worlds.map((w) => `- [${String(w.name).replace(/[[\]\n]/g, ' ').trim() || w.slug}](${origin}${base}/w/${w.slug}/llms.txt): a world in Souls, live at ${origin}${base}/w/${w.slug}/`);
  return `${docsIndex.trimEnd()}\n\n## Worlds\n\n${lines.join('\n')}\n`;
}
