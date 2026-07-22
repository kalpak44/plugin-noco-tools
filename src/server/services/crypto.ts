import crypto from 'crypto';

const ALG = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function getKey(): Buffer {
  const material =
    process.env.APP_KEY ||
    process.env.NOCOBASE_APP_KEY ||
    'nocobase-noco-tools-fallback-key-please-set-APP_KEY';
  return crypto.createHash('sha256').update(material).digest().slice(0, KEY_LEN);
}

export function encryptSecret(plaintext: string): string {
  if (plaintext == null) return plaintext as any;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${Buffer.concat([iv, tag, enc]).toString('base64')}`;
}

export function decryptSecret(payload: string): string {
  if (!payload) return payload;
  if (!payload.startsWith('v1:')) return payload;
  const buf = Buffer.from(payload.slice(3), 'base64');
  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.slice(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}