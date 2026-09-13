// The supplied deployment runs Caddy beside Node. Never trust arbitrary peers
// or a hop count: clients can otherwise choose their rate-limit identity.
export function proxyTrust(value: string | undefined): false | string[] {
  if (!value) return false;
  if (value === 'loopback') return ['127.0.0.1', '::1'];
  throw new Error('TRUST_PROXY must be unset or loopback.');
}
