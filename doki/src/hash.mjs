import { createHash } from 'node:crypto';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function digestJson(value) {
  return sha256(canonicalize(value));
}
