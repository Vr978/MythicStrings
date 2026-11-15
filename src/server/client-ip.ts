import { isIP } from 'node:net';

/** CloudFront appends the viewer IP to any client-supplied chain; the prefix is untrusted. */
export function clientIp(remote: string | undefined, forwarded: string | string[] | undefined, trustProxy: boolean): string {
  if (trustProxy) {
    const header = Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '';
    const viewer = header.split(',').at(-1)?.trim();
    if (viewer && isIP(viewer)) return viewer;
  }
  return remote || 'unknown';
}
