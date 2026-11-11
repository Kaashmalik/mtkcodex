import { describe, expect, it } from 'vitest';
import { clientIp } from '@/lib/rate-limit';
import { verifyTokenMatches } from '@/lib/whatsapp';

const req = (headers: Record<string, string>) => new Request('https://mtkcodex.tech/api/admin/login', { headers });

describe('clientIp', () => {
  const spoofed = { 'cf-connecting-ip': '6.6.6.6', 'x-real-ip': '7.7.7.7' };

  it('uses only the header the host sets', () => {
    expect(clientIp(req({ ...spoofed, 'x-nf-client-connection-ip': '1.1.1.1' }), { NETLIFY: 'true' })).toBe('1.1.1.1');
    expect(clientIp(req({ 'x-real-ip': '2.2.2.2', 'cf-connecting-ip': '6.6.6.6' }), { VERCEL: '1' })).toBe('2.2.2.2');
    expect(clientIp(req({ 'cf-connecting-ip': '3.3.3.3', 'x-forwarded-for': '9.9.9.9' }), { TRUST_CLOUDFLARE: '1' })).toBe('3.3.3.3');
  });

  it('ignores a forged Cloudflare header when not behind Cloudflare', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '6.6.6.6', 'x-forwarded-for': '4.4.4.4, 10.0.0.1' }), {})).toBe('4.4.4.4');
    expect(clientIp(req({ 'cf-connecting-ip': '6.6.6.6' }), { NETLIFY: 'true' })).toBe('unknown');
  });
});

describe('verifyTokenMatches', () => {
  it('matches only the exact token', () => {
    expect(verifyTokenMatches('s3cret', 's3cret')).toBe(true);
    expect(verifyTokenMatches('s3cre', 's3cret')).toBe(false);
    expect(verifyTokenMatches(null, 's3cret')).toBe(false);
    expect(verifyTokenMatches('anything', '')).toBe(false);
  });
});
