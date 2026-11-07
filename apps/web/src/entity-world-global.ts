// The entity world's page handle. `__simEntity` is its old name, kept as an alias: `look` in the eden-god.mjs people have
// already downloaded, and the server's look page, read it from the world page (#1148).
type EntityWorld = { layer: unknown; [key: string]: unknown };
type Host = { __soulsEntity?: EntityWorld; __simEntity?: EntityWorld };
const pageHost = () => window as unknown as Host;

export function publishEntityWorld(world: EntityWorld, host: Host = pageHost()): void {
  host.__soulsEntity = world; host.__simEntity = world;
}

/** Only the layer that published the handle removes it: a newer scene's handle stays. */
export function retireEntityWorld(layer: unknown, host: Host = pageHost()): void {
  if (host.__soulsEntity?.layer !== layer) return;
  delete host.__soulsEntity; delete host.__simEntity;
}
