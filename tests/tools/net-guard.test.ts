import { describe, expect, it } from 'vitest';
import { checkHost, isPrivateAddress } from '../../src/tools/net-guard.js';

describe('isPrivateAddress', () => {
  it('blocks reserved IPv4 ranges', () => {
    for (const ip of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '192.0.2.1',
      '198.18.0.1',
      '100.64.0.1',
      '224.0.0.1',
      '255.255.255.255',
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows publicly routable IPv4', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '93.184.216.34', '172.32.0.1', '11.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('blocks reserved IPv6 ranges', () => {
    for (const ip of ['::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('blocks IPv4-mapped loopback addresses', () => {
    expect(isPrivateAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isPrivateAddress('::ffff:169.254.169.254')).toBe(true);
  });

  it('allows IPv4-mapped public addresses', () => {
    expect(isPrivateAddress('::ffff:8.8.8.8')).toBe(false);
  });

  it('allows public IPv6', () => {
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false);
  });

  it('fails closed on anything that is not an IP literal', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
    expect(isPrivateAddress('')).toBe(true);
  });
});

describe('checkHost', () => {
  const never = async () => {
    throw new Error('resolver should not have been called');
  };

  it('rejects private IP literals without resolving', async () => {
    const result = await checkHost('127.0.0.1', never);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('private');
  });

  it('accepts public IP literals without resolving', async () => {
    const result = await checkHost('8.8.8.8', never);
    expect(result.allowed).toBe(true);
    expect(result.addresses).toEqual(['8.8.8.8']);
  });

  it('rejects local hostname suffixes without resolving', async () => {
    for (const host of ['localhost', 'app.localhost', 'printer.local', 'api.internal']) {
      const result = await checkHost(host, never);
      expect(result.allowed, host).toBe(false);
    }
  });

  it('rejects a public hostname that resolves to a private address', async () => {
    const result = await checkHost('evil.example.com', async () => ['127.0.0.1']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('127.0.0.1');
  });

  it('rejects when any resolved address is private', async () => {
    const result = await checkHost('mixed.example.com', async () => ['8.8.8.8', '10.0.0.5']);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('10.0.0.5');
  });

  it('allows a hostname that resolves only to public addresses', async () => {
    const result = await checkHost('example.com', async () => ['93.184.216.34']);
    expect(result.allowed).toBe(true);
    expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('fails closed when resolution throws', async () => {
    const result = await checkHost('nope.example.com', async () => {
      throw new Error('ENOTFOUND');
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('could not resolve');
  });

  it('fails closed when resolution returns nothing', async () => {
    const result = await checkHost('empty.example.com', async () => []);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('did not resolve');
  });

  it('strips brackets from IPv6 literals', async () => {
    const result = await checkHost('[::1]', never);
    expect(result.allowed).toBe(false);
  });
});
