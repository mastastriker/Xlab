import test from 'node:test';
import assert from 'node:assert/strict';

import { XApiClient, createXApiClientFromEnv } from '../src/xApiClient.js';

function createResponse({ status = 200, json = {}, headers = {} }) {
  const headerEntries = Object.entries(headers);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const lower = name.toLowerCase();
        const match = headerEntries.find(([key]) => key.toLowerCase() === lower);
        return match ? String(match[1]) : null;
      }
    },
    async json() {
      return json;
    },
    async text() {
      return JSON.stringify(json);
    }
  };
}

test('retries on 429 using reset header, then succeeds', async () => {
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  Date.now = () => 1_000_000;
  global.setTimeout = (fn) => {
    fn();
    return 0;
  };

  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return createResponse({
        status: 429,
        headers: {
          'x-rate-limit-reset': '1001'
        }
      });
    }

    return createResponse({
      status: 200,
      json: { data: [{ id: '1' }] },
      headers: {
        'x-rate-limit-limit': '300',
        'x-rate-limit-remaining': '299',
        'x-rate-limit-reset': '2000'
      }
    });
  };

  try {
    const client = new XApiClient({ bearerToken: 'token', fetchImpl });
    const result = await client.recentSearch({ query: 'bitcoin' });

    assert.equal(calls, 2);
    assert.equal(result.body.data[0].id, '1');
  } finally {
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
  }
});

test('falls back to user timeline when recent search is empty', async () => {
  const responses = [
    createResponse({
      status: 200,
      json: { data: [] },
      headers: {
        'x-rate-limit-limit': '300',
        'x-rate-limit-remaining': '120',
        'x-rate-limit-reset': '2000'
      }
    }),
    createResponse({
      status: 200,
      json: { data: [{ id: 'timeline-post' }] },
      headers: {
        'x-rate-limit-limit': '300',
        'x-rate-limit-remaining': '119',
        'x-rate-limit-reset': '2000'
      }
    })
  ];

  const fetchImpl = async () => responses.shift();
  const client = new XApiClient({ bearerToken: 'token', fetchImpl });
  const result = await client.fetchFreshPosts({
    query: 'defi',
    fallbackUserIds: ['42']
  });

  assert.equal(result.source, 'user_timeline');
  assert.equal(result.fallbackUserId, '42');
  assert.equal(result.posts[0].id, 'timeline-post');
  assert.equal(result.requestCount, 2);
});

test('enforces usage guardrail from remaining call count', async () => {
  const fetchImpl = async () =>
    createResponse({
      status: 200,
      json: { data: [{ id: '1' }] },
      headers: {
        'x-rate-limit-limit': '300',
        'x-rate-limit-remaining': '3',
        'x-rate-limit-reset': '2000'
      }
    });

  const client = new XApiClient({ bearerToken: 'token', fetchImpl });
  await assert.rejects(
    () => client.recentSearch({ query: 'stocks', minRemainingCalls: 5 }),
    /usage guardrail triggered/
  );
});

test('createXApiClientFromEnv loads bearer token via secret file path', () => {
  const { client, credentialSource } = createXApiClientFromEnv({
    env: {
      X_API_BEARER_TOKEN_FILE: '/secure/path/x-token'
    },
    fsReadFile: () => 'abcdefghijklmnopqrstuvwxyz123456'
  });

  assert.ok(client instanceof XApiClient);
  assert.equal(client.bearerToken, 'abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(credentialSource.source, 'file');
  assert.equal(credentialSource.filePath, '/secure/path/x-token');
});

test('createXApiClientFromEnv returns normalized lane and lock metadata', () => {
  const result = createXApiClientFromEnv({
    env: {
      X_API_BEARER_TOKEN: 'abcdefghijklmnopqrstuvwxyz123456',
      X_API_CREDENTIAL_EXECUTION_LANE: 'Ops/Blue',
      X_API_CREDENTIAL_LOCK_TTL_MS: '60000'
    },
    nowMs: 200_000,
    fsExists: (path) => path === '/tmp/x-api-credential-ops-blue.lock',
    fsStat: () => ({ mtimeMs: 50_000 }),
    fsRm: () => {}
  });

  assert.equal(result.credentialExecutionLane, 'ops-blue');
  assert.equal(result.executionLock.lockStatus, 'cleared_stale');
  assert.equal(result.executionLock.lockCleared, true);
});
