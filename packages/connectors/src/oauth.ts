export interface AuthorizeInput {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
  extra?: Record<string, string>;
}

export function buildAuthorizeUrl(input: AuthorizeInput): string {
  const url = new URL(input.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  for (const [k, v] of Object.entries(input.extra ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export async function exchangeCode(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    code_verifier: input.codeVerifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (input.clientSecret) {
    headers.authorization = `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`;
  }
  const res = await fetchImpl(input.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`token exchange failed (${res.status})`);
  return (await res.json()) as TokenSet;
}

export async function refreshToken(input: {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenSet> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (input.clientSecret) {
    headers.authorization = `Basic ${btoa(`${input.clientId}:${input.clientSecret}`)}`;
  }
  const res = await fetchImpl(input.tokenUrl, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`token refresh failed (${res.status})`);
  return (await res.json()) as TokenSet;
}
