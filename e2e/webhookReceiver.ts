/*
 * A receiver for the webhook specs: a tiny HTTP server on the Mac that the app (in DDEV, or `php artisan serve` in CI) calls.
 * It keeps what it got, the raw body included (the signature is over those bytes), and answers with the status asked for.
 */

import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedRequest {
  headers: IncomingHttpHeaders;
  /** The body as it arrived, byte for byte (what the signature covers). */
  body: string;
}

export interface Receiver {
  /** Where the app reaches it: `E2E_WEBHOOK_HOST` (`host.docker.internal` in DDEV, `127.0.0.1` in CI) and the port. */
  url: string;
  requests: ReceivedRequest[];
  close(): Promise<void>;
}

/**
 * Starts the receiver on a free port. `status` is the answer (default 200) or a function of the number of the request,
 * counted from 1, so a spec can fail the first tries and then answer.
 *
 * It listens on the loopback only (K3): Colima forwards the host name of the VM to the Mac's 127.0.0.1, so the container
 * reaches it, while `0.0.0.0` would ask the macOS firewall and open the port to the network. `E2E_WEBHOOK_BIND` overrides.
 */
export async function startReceiver({ status = 200 }: { status?: number | ((n: number) => number) } = {}): Promise<Receiver> {
  const requests: ReceivedRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      requests.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(typeof status === 'function' ? status(requests.length) : status, { 'content-type': 'application/json' });
      response.end('{"ok":true}');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, process.env.E2E_WEBHOOK_BIND ?? '127.0.0.1', resolve);
  });

  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${process.env.E2E_WEBHOOK_HOST ?? 'host.docker.internal'}:${port}/hook`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
