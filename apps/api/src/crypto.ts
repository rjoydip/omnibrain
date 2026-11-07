const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Envelope format: v1:<iv b64>:<ciphertext b64>. Never log the plaintext. */
export async function encryptSecret(secret: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext));
  return `v1:${toB64(iv)}:${toB64(new Uint8Array(ct))}`;
}

export async function decryptSecret(secret: string, payload: string): Promise<string> {
  const [version, ivB64, ctB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !ctB64) throw new Error("unsupported ciphertext");
  const key = await aesKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ctB64),
  );
  return dec.decode(pt);
}

export function maskSecret(value: string): string {
  return value.length <= 6 ? "••••" : `${value.slice(0, 3)}••••${value.slice(-2)}`;
}
