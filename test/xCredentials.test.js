import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearStaleCredentialExecutionLock,
  describeXCredentialSource,
  loadXBearerToken,
  normalizeCredentialExecutionLane,
  resolveCredentialExecutionLane,
  resolveXCredentialSource
} from '../src/xCredentials.js';

test('resolveXCredentialSource prefers env token over file', () => {
  const source = resolveXCredentialSource({
    env: {
      X_API_BEARER_TOKEN: 'token-from-env',
      X_API_BEARER_TOKEN_FILE: '/tmp/x-token'
    }
  });

  assert.equal(source.source, 'env');
  assert.equal(source.envKey, 'X_API_BEARER_TOKEN');
});

test('normalizeCredentialExecutionLane sanitizes and lowercases lane names', () => {
  assert.equal(normalizeCredentialExecutionLane('  Blue Team/Prod  '), 'blue-team-prod');
  assert.equal(normalizeCredentialExecutionLane(''), 'default');
});

test('resolveCredentialExecutionLane defaults to default lane', () => {
  assert.equal(resolveCredentialExecutionLane({ env: {} }), 'default');
});

test('loadXBearerToken reads from configured file path when env token missing', () => {
  const loaded = loadXBearerToken({
    env: {
      X_API_BEARER_TOKEN_FILE: '/tmp/x-token'
    },
    fsReadFile: () => 'abcdefghijklmnopqrstuvwxyz123456',
    fsExists: () => false
  });

  assert.equal(loaded.token, 'abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(loaded.source.source, 'file');
  assert.equal(loaded.source.filePath, '/tmp/x-token');
});

test('loadXBearerToken falls back to default mounted secret path', () => {
  const loaded = loadXBearerToken({
    env: {},
    fsReadFile: (path) => {
      assert.equal(path, '/run/secrets/x_api_bearer_token');
      return 'abcdefghijklmnopqrstuvwxyz123456';
    },
    fsExists: (path) => path === '/run/secrets/x_api_bearer_token'
  });

  assert.equal(loaded.source.source, 'file');
  assert.equal(loaded.source.filePath, '/run/secrets/x_api_bearer_token');
});

test('describeXCredentialSource returns safe source-only metadata', () => {
  const fromEnv = describeXCredentialSource({ source: 'env', envKey: 'X_API_BEARER_TOKEN' });
  const fromFile = describeXCredentialSource({
    source: 'file',
    filePath: '/run/secrets/x_api_bearer_token',
    envKey: 'X_API_BEARER_TOKEN_FILE'
  });

  assert.equal(fromEnv, 'env:X_API_BEARER_TOKEN');
  assert.equal(fromFile, 'file:/run/secrets/x_api_bearer_token (from X_API_BEARER_TOKEN_FILE)');
});

test('loadXBearerToken throws when no credential source exists', () => {
  assert.throws(
    () =>
      loadXBearerToken({
        env: {},
        fsReadFile: () => '',
        fsExists: () => false
      }),
    /Missing X credentials/
  );
});

test('loadXBearerToken reads bearer token from workspace .env file', () => {
  const loaded = loadXBearerToken({
    env: {},
    cwd: '/workspace',
    fsExists: (path) => path === '/workspace/.env',
    fsReadFile: (path) => {
      assert.equal(path, '/workspace/.env');
      return 'X_API_BEARER_TOKEN=abcdefghijklmnopqrstuvwxyz123456\n';
    }
  });

  assert.equal(loaded.token, 'abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(loaded.source.source, 'env');
  assert.equal(loaded.dotenvPath, '/workspace/.env');
});

test('process env overrides values from .env file', () => {
  const loaded = loadXBearerToken({
    env: {
      X_API_BEARER_TOKEN: 'abcdefghijklmnopqrstuvwxyz999999'
    },
    cwd: '/workspace',
    fsExists: (path) => path === '/workspace/.env',
    fsReadFile: () => 'X_API_BEARER_TOKEN=abcdefghijklmnopqrstuvwxyz123456\n'
  });

  assert.equal(loaded.token, 'abcdefghijklmnopqrstuvwxyz999999');
});

test('loadXBearerToken supports custom dotenv path env key', () => {
  const loaded = loadXBearerToken({
    env: {
      X_API_DOTENV_PATH: '/secure/env/x.env'
    },
    cwd: '/workspace',
    fsExists: (path) => path === '/secure/env/x.env',
    fsReadFile: (path) => {
      assert.equal(path, '/secure/env/x.env');
      return 'X_API_BEARER_TOKEN=abcdefghijklmnopqrstuvwxyz123456\n';
    }
  });

  assert.equal(loaded.token, 'abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(loaded.dotenvPath, '/secure/env/x.env');
});

test('loadXBearerToken returns normalized credential execution lane', () => {
  const loaded = loadXBearerToken({
    env: {
      X_API_CREDENTIAL_EXECUTION_LANE: ' Team A / US-EAST ',
      X_API_BEARER_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456'
    }
  });

  assert.equal(loaded.credentialExecutionLane, 'team-a-us-east');
});

test('clearStaleCredentialExecutionLock removes stale lock files', () => {
  let removed = null;
  const result = clearStaleCredentialExecutionLock({
    env: {
      X_API_CREDENTIAL_EXECUTION_LANE: 'TeamA',
      X_API_CREDENTIAL_LOCK_TTL_MS: '60000'
    },
    nowMs: 200_000,
    fsExists: () => true,
    fsStat: () => ({ mtimeMs: 100_000 }),
    fsRm: (path) => {
      removed = path;
    }
  });

  assert.equal(result.lockStatus, 'cleared_stale');
  assert.equal(result.lockCleared, true);
  assert.equal(removed, '/tmp/x-api-credential-teama.lock');
});

test('clearStaleCredentialExecutionLock keeps active lock files', () => {
  let removed = false;
  const result = clearStaleCredentialExecutionLock({
    env: {
      X_API_CREDENTIAL_EXECUTION_LANE: 'prod',
      X_API_CREDENTIAL_LOCK_TTL_MS: '60000'
    },
    nowMs: 120_000,
    fsExists: () => true,
    fsStat: () => ({ mtimeMs: 100_000 }),
    fsRm: () => {
      removed = true;
    }
  });

  assert.equal(result.lockStatus, 'active');
  assert.equal(result.lockCleared, false);
  assert.equal(removed, false);
});
