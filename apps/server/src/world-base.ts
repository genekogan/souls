/** The world base a request reached, for links the world hands back: the proxy's forwarded host and scheme
 *  (x-forwarded-host / x-forwarded-proto), else the Host header, https unless the host is local; without a Host, the
 *  configured base (`fallback`). */
export function requestWorldBase(worldPath: string, header: (name: string) => string | undefined, fallback: () => string): string {
  const host = header('x-forwarded-host') ?? header('host');
  const proto = header('x-forwarded-proto') ?? (host?.startsWith('localhost') || host?.startsWith('127.') ? 'http' : 'https');
  return host ? `${proto}://${host}${worldPath}` : fallback();
}
