import { buildFinderPayload } from './xIngestion.js';

const DEFAULT_MAX_POST_AGE_MS = 15 * 60 * 1000;
const DEFAULT_MIN_FRESH_RATIO = 0.6;

function inferIntentTags(text) {
  const lower = text.toLowerCase();
  const tags = [];

  if (/(bitcoin|btc|etf)/.test(lower)) tags.push('bitcoin');
  if (/(defi|yield|staking|protocol)/.test(lower)) tags.push('defi');
  if (/(stock|equity|earnings|valuation|dividend)/.test(lower)) tags.push('stocks');
  if (/(dividend|income|yield)/.test(lower)) tags.push('dividend-income');
  if (/(macro|rate|inflation|fed)/.test(lower)) tags.push('macro');

  return tags.length > 0 ? tags : ['general-market'];
}

function buildReplyContext(post, now) {
  const ageMinutes = Math.floor((now.valueOf() - new Date(post.createdAt).valueOf()) / 60000);

  return {
    authorHandle: post.authorHandle ?? null,
    sourceLink: post.url,
    postAgeMinutes: ageMinutes,
    contextSummary: post.text.slice(0, 220),
    intentTopicTags: inferIntentTags(post.text)
  };
}

function scorePost(post, now) {
  const ageMinutes = Math.max(1, (now.valueOf() - new Date(post.createdAt).valueOf()) / 60000);
  const recencyScore = Math.max(0, 1 - ageMinutes / 60);
  const engagementRaw =
    post.metrics.likes +
    post.metrics.replies * 2 +
    post.metrics.reposts * 1.5 +
    post.metrics.quotes * 1.5;
  const engagementScore = Math.log10(engagementRaw + 10);

  return recencyScore * 10 + engagementScore * 20;
}

export function createRankedQueue(rawPosts, now = new Date(), options = {}) {
  const maxAgeMs = options.maxPostAgeMs ?? DEFAULT_MAX_POST_AGE_MS;
  const minFreshRatio = options.minFreshRatio ?? DEFAULT_MIN_FRESH_RATIO;
  const payload = buildFinderPayload(rawPosts, now, maxAgeMs);
  const freshRatio = payload.totalFetched === 0 ? 0 : payload.totalFresh / payload.totalFetched;

  if (payload.totalFresh === 0) {
    throw new Error('Freshness SLA failed: no fresh posts available for queue build');
  }

  if (freshRatio < minFreshRatio) {
    throw new Error(
      `Freshness SLA failed: fresh_ratio=${freshRatio.toFixed(2)} below minimum=${minFreshRatio.toFixed(2)}`
    );
  }

  const candidates = payload.posts
    .map((post) => ({
      ...post,
      score: scorePost(post, now),
      replyContext: buildReplyContext(post, now)
    }))
    .sort((a, b) => b.score - a.score);

  return {
    sourceOfTruth: 'direct_x_ingestion',
    freshnessThresholdMs: maxAgeMs,
    fetchedAt: payload.fetchedAt,
    totals: {
      fetched: payload.totalFetched,
      fresh: payload.totalFresh
    },
    candidates
  };
}
