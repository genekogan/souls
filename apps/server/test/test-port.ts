// #1162: ports for a test server. CI runs several jobs on one host, so a fixed port collides with another job's. A file
// takes its ports at load and keeps them, because a test often stops a server and starts it again, or hands a port to a
// child before anything listens. So they come from below the OS ephemeral range (Linux 32768+, macOS 49152+): a port
// taken from listen(0) and released could go to any outbound connection on the host before the file binds it again.
import { createServer } from 'node:net';

const LOW = 10_000, HIGH = 32_000;

const free = (port: number) => new Promise<boolean>((resolve) => {
  const probe = createServer();
  probe.once('error', () => resolve(false));
  probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => resolve(true)));
});

/** The first of `span` consecutive free ports. */
export async function testPort(span = 1): Promise<number> {
  for (let tries = 0; tries < 200; tries++) {
    const port = LOW + Math.floor(Math.random() * (HIGH - LOW - span));
    let open = true;
    for (let i = 0; open && i < span; i++) open = await free(port + i);
    if (open) return port;
  }
  throw Error('no free test port');
}
