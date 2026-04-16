import { clearStaleCredentialExecutionLock, loadXBearerToken } from './xCredentials.js';
const DEFAULT_BASE_URL = 'https://api.x.com/2';
const DEFAULT_MAX_RETRIES = 3;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRateLimitResetMs(headers, nowMs) {
  const resetHeader = headers.get('x-rate-limit-reset');
  if (!resetHeader) return null;
  const resetSeconds = Number(resetHeader);
  if (!Number.isFinite(resetSeconds)) return null;
  const resetMs = resetSeconds * 1000;
  if (resetMs <= nowMs) return 0;
  return resetMs - nowMs;
}

function parseUsage(headers) {
  const limit = Number(headers.get('x-rate-limit-limit'));
  const remaining = Number(headers.get('x-rate-limit-remaining'));
  const reset = Number(headers.get('x-rate-limit-reset'));

  return {
    limit: Number.isFinite(limit) ? limit : null,
    remaining: Number.isFinite(remaining) ? remaining : null,
    resetEpochSeconds: Number.isFinite(reset) ? reset : null
  };
}

function budgetGuardrailExceeded(usage, minRemainingCalls) {
  if (usage.remaining == null || minRemainingCalls == null) return false;
  return usage.remaining < minRemainingCalls;
}

export class XApiClient {
  constructor({ bearerToken, fetchImpl = fetch, baseUrl = DEFAULT_BASE_URL, maxRetries = DEFAULT_MAX_RETRIES } = {}) {
    if (!bearerToken) throw new Error('Missing bearerToken for X API client');
    this.bearerToken = bearerToken;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.maxRetries = maxRetries;
    this.requestCount = 0;
  }

  async request(path, params = {}, { minRemainingCalls = 0 } = {}) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    let attempt = 0;
    while (attempt <= this.maxRetries) {
      this.requestCount += 1;
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          'Content-Type': 'application/json'
        }
      });

      const now = Date.now();
      const usage = parseUsage(response.headers);

      if (response.status === 429) {
        if (attempt === this.maxRetries) {
          throw new Error('X API rate-limited after max retries');
        }

        const retryDelay = parseRateLimitResetMs(response.headers, now) ?? (500 * Math.pow(2, attempt));
        await sleep(Math.max(retryDelay, 250));
        attempt += 1;
        continue;
      }

      if (response.status >= 500 && response.status <= 599) {
        if (attempt === this.maxRetries) {
          throw new Error(`X API server error ${response.status} after max retries`);
        }
        await sleep(500 * Math.pow(2, attempt));
        attempt += 1;
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`X API request failed with status ${response.status}: ${text}`);
      }

      if (budgetGuardrailExceeded(usage, minRemainingCalls)) {
        throw new Error(
          `X API usage guardrail triggered: remaining=${usage.remaining}, minimum=${minRemainingCalls}`
        );
      }

      const body = await response.json();
      return { body, usage };
    }

    throw new Error('Unexpected retry loop exit');
  }

  async recentSearch({ query, maxResults = 20, minRemainingCalls = 0 }) {
    return this.request(
      '/tweets/search/recent',
      {
        query,
        max_results: maxResults,
        'tweet.fields': 'created_at,author_id,public_metrics'
      },
      { minRemainingCalls }
    );
  }

  async userTimeline({ userId, maxResults = 20, minRemainingCalls = 0 }) {
    return this.request(
      `/users/${userId}/tweets`,
      {
        max_results: maxResults,
        exclude: 'replies',
        'tweet.fields': 'created_at,author_id,public_metrics'
      },
      { minRemainingCalls }
    );
  }

  async fetchFreshPosts({ query, fallbackUserIds = [], maxResults = 20, minRemainingCalls = 0 }) {
    const search = await this.recentSearch({ query, maxResults, minRemainingCalls });
    const searchPosts = search.body.data ?? [];

    if (searchPosts.length > 0) {
      return {
        source: 'recent_search',
        posts: searchPosts,
        usage: [search.usage],
        requestCount: this.requestCount
      };
    }

    const usageSnapshots = [search.usage];
    for (const userId of fallbackUserIds) {
      const timeline = await this.userTimeline({ userId, maxResults, minRemainingCalls });
      usageSnapshots.push(timeline.usage);
      const timelinePosts = timeline.body.data ?? [];
      if (timelinePosts.length > 0) {
        return {
          source: 'user_timeline',
          fallbackUserId: userId,
          posts: timelinePosts,
          usage: usageSnapshots,
          requestCount: this.requestCount
        };
      }
    }

    return {
      source: 'none',
      posts: [],
      usage: usageSnapshots,
      requestCount: this.requestCount
    };
  }
}

export function createXApiClientFromEnv(options = {}) {
  const lock = clearStaleCredentialExecutionLock({
    env: options.env,
    fsExists: options.fsExists,
    fsStat: options.fsStat,
    fsRm: options.fsRm,
    nowMs: options.nowMs
  });

  const { token, source, credentialExecutionLane } = loadXBearerToken({
    env: options.env,
    fsReadFile: options.fsReadFile,
    fsExists: options.fsExists
  });
  const client = new XApiClient({
    bearerToken: token,
    fetchImpl: options.fetchImpl,
    baseUrl: options.baseUrl,
    maxRetries: options.maxRetries
  });

  return {
    client,
    credentialSource: source,
    credentialExecutionLane,
    executionLock: lock
  };
}
