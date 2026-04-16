import { readFileSync, existsSync, statSync, rmSync } from 'node:fs';
import path from 'node:path';

const DEFAULT_TOKEN_FILE = '/run/secrets/x_api_bearer_token';
const TOKEN_ENV_KEY = 'X_API_BEARER_TOKEN';
const TOKEN_FILE_ENV_KEY = 'X_API_BEARER_TOKEN_FILE';
const DOTENV_PATH_ENV_KEY = 'X_API_DOTENV_PATH';
const DEFAULT_DOTENV_BASENAME = '.env';
const EXECUTION_LANE_ENV_KEY = 'X_API_CREDENTIAL_EXECUTION_LANE';
const LOCK_FILE_ENV_KEY = 'X_API_CREDENTIAL_LOCK_FILE';
const LOCK_TTL_MS_ENV_KEY = 'X_API_CREDENTIAL_LOCK_TTL_MS';
const DEFAULT_EXECUTION_LANE = 'default';
const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function parseDotEnv(content) {
  const parsed = {};
  const lines = String(content).split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalIndex = line.indexOf('=');
    if (equalIndex <= 0) continue;

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    parsed[key] = value;
  }

  return parsed;
}

function resolveDotEnvPath({ env, cwd }) {
  const configured = normalizeToken(env[DOTENV_PATH_ENV_KEY]);
  if (configured) return configured;
  return path.join(cwd, DEFAULT_DOTENV_BASENAME);
}

function mergeEnvWithDotEnv({ env, fsReadFile, fsExists, cwd }) {
  const dotenvPath = resolveDotEnvPath({ env, cwd });
  if (!fsExists(dotenvPath)) {
    return { mergedEnv: env, dotenvPath: null };
  }

  const dotEnvRaw = fsReadFile(dotenvPath, 'utf8');
  const dotEnvValues = parseDotEnv(dotEnvRaw);

  return {
    mergedEnv: {
      ...dotEnvValues,
      ...env
    },
    dotenvPath
  };
}

function validateToken(token) {
  if (!token) {
    throw new Error('X API bearer token is empty');
  }

  if (token.length < 20) {
    throw new Error('X API bearer token appears invalid (too short)');
  }
}

export function normalizeCredentialExecutionLane(value) {
  const normalized = normalizeToken(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || DEFAULT_EXECUTION_LANE;
}

function parsePositiveInt(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return Math.floor(numeric);
}

export function resolveCredentialExecutionLane({ env = process.env } = {}) {
  return normalizeCredentialExecutionLane(env[EXECUTION_LANE_ENV_KEY]);
}

export function resolveCredentialLockPath({ env = process.env, lane } = {}) {
  const configuredPath = normalizeToken(env[LOCK_FILE_ENV_KEY]);
  if (configuredPath) return configuredPath;
  return path.join('/tmp', `x-api-credential-${lane}.lock`);
}

export function clearStaleCredentialExecutionLock({
  env = process.env,
  fsExists = existsSync,
  fsStat = statSync,
  fsRm = rmSync,
  nowMs = Date.now()
} = {}) {
  const lane = resolveCredentialExecutionLane({ env });
  const lockFilePath = resolveCredentialLockPath({ env, lane });
  const staleAfterMs = parsePositiveInt(env[LOCK_TTL_MS_ENV_KEY], DEFAULT_LOCK_TTL_MS);

  if (!fsExists(lockFilePath)) {
    return {
      lane,
      lockFilePath,
      staleAfterMs,
      lockCleared: false,
      lockStatus: 'missing'
    };
  }

  const lockStat = fsStat(lockFilePath);
  const ageMs = Math.max(0, nowMs - lockStat.mtimeMs);
  if (ageMs < staleAfterMs) {
    return {
      lane,
      lockFilePath,
      staleAfterMs,
      lockCleared: false,
      lockStatus: 'active',
      lockAgeMs: ageMs
    };
  }

  fsRm(lockFilePath, { force: true });
  return {
    lane,
    lockFilePath,
    staleAfterMs,
    lockCleared: true,
    lockStatus: 'cleared_stale',
    lockAgeMs: ageMs
  };
}

export function resolveXCredentialSource({ env = process.env, fsExists = existsSync } = {}) {
  const envToken = normalizeToken(env[TOKEN_ENV_KEY]);
  if (envToken) {
    return { source: 'env', envKey: TOKEN_ENV_KEY };
  }

  const configuredFilePath = normalizeToken(env[TOKEN_FILE_ENV_KEY]);
  if (configuredFilePath) {
    return { source: 'file', filePath: configuredFilePath, envKey: TOKEN_FILE_ENV_KEY };
  }

  if (fsExists(DEFAULT_TOKEN_FILE)) {
    return { source: 'file', filePath: DEFAULT_TOKEN_FILE, envKey: null };
  }

  return { source: 'missing', envKey: TOKEN_ENV_KEY, fileEnvKey: TOKEN_FILE_ENV_KEY };
}

export function loadXBearerToken({
  env = process.env,
  fsReadFile = readFileSync,
  fsExists = existsSync,
  cwd = process.cwd()
} = {}) {
  const { mergedEnv, dotenvPath } = mergeEnvWithDotEnv({ env, fsReadFile, fsExists, cwd });
  const credentialExecutionLane = resolveCredentialExecutionLane({ env: mergedEnv });
  const source = resolveXCredentialSource({ env: mergedEnv, fsExists });

  if (source.source === 'env') {
    const token = normalizeToken(mergedEnv[TOKEN_ENV_KEY]);
    validateToken(token);
    return { token, source, dotenvPath, credentialExecutionLane };
  }

  if (source.source === 'file') {
    const raw = fsReadFile(source.filePath, 'utf8');
    const token = normalizeToken(raw);
    validateToken(token);
    return { token, source, dotenvPath, credentialExecutionLane };
  }

  throw new Error(
    `Missing X credentials. Set ${TOKEN_ENV_KEY}, set ${TOKEN_FILE_ENV_KEY}, or mount ${DEFAULT_TOKEN_FILE}.`
  );
}

export function describeXCredentialSource(source) {
  if (!source || source.source === 'missing') {
    return `missing (${TOKEN_ENV_KEY} or ${TOKEN_FILE_ENV_KEY})`;
  }

  if (source.source === 'env') {
    return `env:${source.envKey}`;
  }

  return source.envKey ? `file:${source.filePath} (from ${source.envKey})` : `file:${source.filePath}`;
}
