const enc = new TextEncoder();

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  let data: Uint8Array<ArrayBuffer>;
  if (typeof input === "string") {
    data = new Uint8Array(enc.encode(input));
  } else if (input instanceof Uint8Array) {
    data = new Uint8Array(input.byteLength);
    data.set(input);
  } else {
    data = new Uint8Array(input);
  }
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** 6 digits, uniform enough for a 10-minute OTP (rejection sampling avoids modulo bias). */
export function randomDigits(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0] ?? 0;
    if (n < limit) return String(n % max).padStart(digits, "0");
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}
