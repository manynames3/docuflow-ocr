type AuthSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  email: string;
};

type AuthRedirectResult = { handled: false } | { handled: true; error?: string };

const SESSION_KEY = "docuflow.auth.session";
const PKCE_KEY = "docuflow.auth.pkce";
const AUTH_DOMAIN = (import.meta.env.VITE_COGNITO_AUTH_DOMAIN || "").replace(/\/$/, "");
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID || "";
const REDIRECT_URI = import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/auth/callback`;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function readSession(): AuthSession | null {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? (JSON.parse(stored) as AuthSession) : null;
  } catch {
    return null;
  }
}

function storeSession(session: AuthSession | null) {
  if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else sessionStorage.removeItem(SESSION_KEY);
}

function decodeEmail(idToken: string): string {
  try {
    const base64 = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return String(JSON.parse(atob(payload)).email || "");
  } catch {
    return "";
  }
}

export function hasAuthConfiguration(): boolean {
  return Boolean(AUTH_DOMAIN && CLIENT_ID);
}

export function currentUser(): string | null {
  const session = readSession();
  return session ? session.email || "Signed in" : null;
}

export async function beginAuth(flow: "login" | "signup" | "forgotPassword"): Promise<void> {
  if (!hasAuthConfiguration()) throw new Error("Account access is not configured for this site yet.");
  const state = randomString(24);
  const verifier = randomString(48);
  const challenge = await challengeFor(verifier);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify({ state, verifier }));

  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`${AUTH_DOMAIN}/${flow}?${query.toString()}`);
}

export async function completeAuthRedirect(): Promise<AuthRedirectResult> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get("code");
  const authError = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (!code && !authError && !url.pathname.endsWith("/auth/callback")) return { handled: false };

  const stored = sessionStorage.getItem(PKCE_KEY);
  sessionStorage.removeItem(PKCE_KEY);
  if (authError) return { handled: true, error: authError };
  let pkce: { state: string; verifier: string } | null = null;
  try {
    pkce = stored ? (JSON.parse(stored) as { state: string; verifier: string }) : null;
  } catch {
    pkce = null;
  }
  if (!code || !pkce || pkce.state !== url.searchParams.get("state")) {
    return { handled: true, error: "Sign-in could not be verified. Start again." };
  }

  try {
    const response = await fetch(`${AUTH_DOMAIN}/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: CLIENT_ID,
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: pkce.verifier,
      }),
    });
    if (!response.ok) throw new Error("Sign-in could not be completed. Please try again.");
    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in: number;
    };
    storeSession({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      email: decodeEmail(tokens.id_token),
    });
    window.history.replaceState({}, document.title, "/");
    return { handled: true };
  } catch (error) {
    return {
      handled: true,
      error: error instanceof Error ? error.message : "Sign-in could not be completed.",
    };
  }
}

export async function accessToken(): Promise<string> {
  const session = readSession();
  if (!session) throw new Error("Sign in to continue.");
  if (session.expiresAt > Date.now() + 60_000) return session.accessToken;
  if (!session.refreshToken || !hasAuthConfiguration()) {
    storeSession(null);
    throw new Error("Your session expired. Sign in again.");
  }

  const response = await fetch(`${AUTH_DOMAIN}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: session.refreshToken,
    }),
  });
  if (!response.ok) {
    storeSession(null);
    throw new Error("Your session expired. Sign in again.");
  }
  const tokens = (await response.json()) as { access_token: string; expires_in: number };
  const refreshed = {
    ...session,
    accessToken: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  storeSession(refreshed);
  return refreshed.accessToken;
}

export function endSession() {
  storeSession(null);
  sessionStorage.removeItem(PKCE_KEY);
  if (hasAuthConfiguration()) {
    const query = new URLSearchParams({ client_id: CLIENT_ID, logout_uri: window.location.origin });
    window.location.assign(`${AUTH_DOMAIN}/logout?${query.toString()}`);
  } else {
    window.location.assign("/");
  }
}
