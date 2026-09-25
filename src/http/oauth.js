// OAuth 2.1 for the online connector, following the MCP authorization spec:
// protected-resource metadata (RFC 9728), authorization-server metadata
// (RFC 8414), dynamic client registration (RFC 7591), PKCE S256, refresh.
//
// Why: a published ChatGPT app (the only way to reach the ChatGPT phone app)
// and Claude's connector sign-in use one public address for everyone, so each
// person signs in to their own memory store. There are still no accounts: the
// store's private key *is* the identity. Access tokens carry that key sealed
// with the server secret, so the disk never holds anything that opens a store
// on its own.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TOKEN_RE } from './secure-store.js';

const CODE_TTL_MS = 10 * 60000;
const ACCESS_TTL_S = 30 * 86400;
const REFRESH_TTL_S = 365 * 86400;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

/** Server secret: PERSONAL_MEMORY_SECRET, else a key file created once in the data directory. */
export function loadServerSecret(dataDir, fromEnv) {
  if (fromEnv) return crypto.createHash('sha256').update(fromEnv).digest();
  const file = path.join(dataDir, 'server.key');
  try {
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
  } catch {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const key = crypto.randomBytes(32);
    fs.writeFileSync(file, key.toString('base64'), { mode: 0o600 });
    return key;
  }
}

export function createOAuth({ dataDir, secret, clock = () => new Date() }) {
  const clientsFile = path.join(dataDir, 'clients.json');
  const codes = new Map(); // code -> { storeToken, clientId, redirectUri, challenge, resource, exp }
  let clients = null;

  function loadClients() {
    if (clients) return clients;
    try {
      clients = JSON.parse(fs.readFileSync(clientsFile, 'utf8'));
    } catch {
      clients = {};
    }
    return clients;
  }
  function saveClients() {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    const tmp = `${clientsFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(clients, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, clientsFile);
  }

  function seal(obj) {
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', secret, iv);
    const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
    return `pm1.${b64url(Buffer.concat([iv, c.getAuthTag(), body]))}`;
  }
  function unseal(token) {
    if (typeof token !== 'string' || !token.startsWith('pm1.')) return null;
    try {
      const buf = Buffer.from(token.slice(4), 'base64url');
      const d = crypto.createDecipheriv('aes-256-gcm', secret, buf.subarray(0, 12));
      d.setAuthTag(buf.subarray(12, 28));
      return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
    } catch {
      return null;
    }
  }
  const now = () => Math.floor(clock().getTime() / 1000);

  return {
    metadata(base) {
      return {
        resource: {
          resource: `${base}/mcp`,
          authorization_servers: [base],
          bearer_methods_supported: ['header'],
          resource_name: 'My Memory · 我的记忆',
          resource_documentation: `${base}/`,
        },
        server: {
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
          scopes_supported: ['memory'],
          service_documentation: `${base}/`,
          op_policy_uri: `${base}/privacy`,
          op_tos_uri: `${base}/terms`,
        },
      };
    },

    /** RFC 7591 dynamic client registration. */
    register(body) {
      const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
      if (!uris.length || uris.length > 10) return { status: 400, json: { error: 'invalid_redirect_uri', error_description: 'redirect_uris required' } };
      for (const u of uris) {
        let url;
        try {
          url = new URL(u);
        } catch {
          return { status: 400, json: { error: 'invalid_redirect_uri' } };
        }
        const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { status: 400, json: { error: 'invalid_redirect_uri', error_description: 'https required' } };
      }
      const all = loadClients();
      if (Object.keys(all).length > 10000) return { status: 429, json: { error: 'temporarily_unavailable' } };
      const method = ['none', 'client_secret_post', 'client_secret_basic'].includes(body.token_endpoint_auth_method) ? body.token_endpoint_auth_method : 'none';
      const clientId = `c_${crypto.randomBytes(12).toString('base64url')}`;
      const clientSecret = method === 'none' ? null : crypto.randomBytes(24).toString('base64url');
      const name = typeof body.client_name === 'string' ? body.client_name.slice(0, 60) : 'AI app';
      all[clientId] = {
        redirect_uris: uris,
        client_name: name,
        auth: method,
        secret_hash: clientSecret ? crypto.createHash('sha256').update(clientSecret).digest('hex') : null,
        created: clock().toISOString(),
      };
      saveClients();
      return {
        status: 201,
        json: {
          client_id: clientId,
          ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
          client_id_issued_at: now(),
          client_name: name,
          redirect_uris: uris,
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: method,
        },
      };
    },

    /** Validate an /authorize request; returns { ok, error, client, params }. */
    checkAuthorize(q) {
      const p = {
        response_type: q.get('response_type'),
        client_id: q.get('client_id'),
        redirect_uri: q.get('redirect_uri'),
        code_challenge: q.get('code_challenge'),
        code_challenge_method: q.get('code_challenge_method'),
        state: q.get('state') || '',
        resource: q.get('resource') || '',
        scope: q.get('scope') || 'memory',
      };
      const client = loadClients()[p.client_id];
      if (!client) return { ok: false, error: 'Unknown app. Please add the connector again.' };
      if (!client.redirect_uris.includes(p.redirect_uri)) return { ok: false, error: 'This app is not allowed to use that return address.' };
      if (p.response_type !== 'code') return { ok: false, redirect: true, error: 'unsupported_response_type', client, params: p };
      if (!p.code_challenge || p.code_challenge_method !== 'S256') return { ok: false, redirect: true, error: 'invalid_request', client, params: p };
      return { ok: true, client, params: p };
    },

    /** After the person chose (or created) their store: hand the app a one-time code. */
    issueCode(params, storeToken) {
      if (!TOKEN_RE.test(storeToken)) throw new Error('bad store token');
      const code = crypto.randomBytes(24).toString('base64url');
      codes.set(code, { storeToken, clientId: params.client_id, redirectUri: params.redirect_uri, challenge: params.code_challenge, resource: params.resource, exp: clock().getTime() + CODE_TTL_MS });
      const url = new URL(params.redirect_uri);
      url.searchParams.set('code', code);
      if (params.state) url.searchParams.set('state', params.state);
      return url.toString();
    },

    errorRedirect(params, error) {
      const url = new URL(params.redirect_uri);
      url.searchParams.set('error', error);
      if (params.state) url.searchParams.set('state', params.state);
      return url.toString();
    },

    /** Token endpoint. `generationOf(storeToken)` returns the store's current token generation. */
    async token(form, authHeader, generationOf) {
      let clientId = form.get('client_id');
      let clientSecret = form.get('client_secret');
      if (authHeader && authHeader.startsWith('Basic ')) {
        const [id, sec] = Buffer.from(authHeader.slice(6), 'base64').toString('utf8').split(':');
        clientId = decodeURIComponent(id || '');
        clientSecret = decodeURIComponent(sec || '');
      }
      const client = loadClients()[clientId];
      if (!client) return { status: 401, json: { error: 'invalid_client' } };
      if (client.secret_hash && crypto.createHash('sha256').update(String(clientSecret || '')).digest('hex') !== client.secret_hash) {
        return { status: 401, json: { error: 'invalid_client' } };
      }
      const grant = form.get('grant_type');
      let storeToken;
      if (grant === 'authorization_code') {
        const code = codes.get(form.get('code'));
        codes.delete(form.get('code')); // one use only
        if (!code || code.exp < clock().getTime() || code.clientId !== clientId || code.redirectUri !== form.get('redirect_uri')) {
          return { status: 400, json: { error: 'invalid_grant' } };
        }
        const verifier = form.get('code_verifier') || '';
        if (b64url(crypto.createHash('sha256').update(verifier).digest()) !== code.challenge) return { status: 400, json: { error: 'invalid_grant', error_description: 'PKCE check failed' } };
        storeToken = code.storeToken;
      } else if (grant === 'refresh_token') {
        const r = unseal(form.get('refresh_token'));
        if (!r || r.k !== 'r' || r.c !== clientId || r.exp < now()) return { status: 400, json: { error: 'invalid_grant' } };
        if ((await generationOf(r.t)) !== r.g) return { status: 400, json: { error: 'invalid_grant', error_description: 'access was revoked' } };
        storeToken = r.t;
      } else {
        return { status: 400, json: { error: 'unsupported_grant_type' } };
      }
      const g = await generationOf(storeToken);
      if (g === null) return { status: 400, json: { error: 'invalid_grant', error_description: 'memory store no longer exists' } };
      return {
        status: 200,
        json: {
          access_token: seal({ k: 'a', t: storeToken, c: clientId, g, exp: now() + ACCESS_TTL_S }),
          token_type: 'Bearer',
          expires_in: ACCESS_TTL_S,
          refresh_token: seal({ k: 'r', t: storeToken, c: clientId, g, exp: now() + REFRESH_TTL_S }),
          scope: 'memory',
        },
      };
    },

    /** Resolve a Bearer access token to its store token, or null. */
    async verifyAccess(authHeader, generationOf) {
      if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
      const a = unseal(authHeader.slice(7).trim());
      if (!a || a.k !== 'a' || a.exp < now() || !TOKEN_RE.test(a.t)) return null;
      if ((await generationOf(a.t)) !== a.g) return null; // the owner disconnected all apps
      return a.t;
    },

    clientName(clientId) {
      return loadClients()[clientId]?.client_name || 'AI app';
    },
  };
}
