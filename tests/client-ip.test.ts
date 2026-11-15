import { expect, it } from 'vitest';
import { clientIp } from '../src/server/client-ip';

it('uses the CloudFront-appended viewer address for limits and ignores spoofable prefixes', () => {
  expect(clientIp('10.0.0.1', 'spoofed, 192.0.2.4, 198.51.100.7', true)).toBe('198.51.100.7');
  expect(clientIp('127.0.0.1', '198.51.100.7', false)).toBe('127.0.0.1');
  expect(clientIp('10.0.0.1', '192.0.2.4, 2001:db8::1', true)).toBe('2001:db8::1');
  expect(clientIp('10.0.0.1', 'not-an-ip', true)).toBe('10.0.0.1');
});
