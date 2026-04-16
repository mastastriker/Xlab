import test from 'node:test';
import assert from 'node:assert/strict';

import { createRankedQueue } from '../src/postFinderWorkflow.js';

test('createRankedQueue ranks fresh candidates and emits writer context', () => {
  const now = new Date('2026-04-16T15:00:00.000Z');
  const queue = createRankedQueue(
    [
      {
        id: 'fresh-high-engagement',
        text: 'Bitcoin ETF inflows are back and market momentum looks strong',
        author_id: 'a1',
        author_username: 'alpha',
        created_at: '2026-04-16T14:57:00.000Z',
        public_metrics: { like_count: 42, reply_count: 10, retweet_count: 8, quote_count: 3 }
      },
      {
        id: 'fresh-low-engagement',
        text: 'DeFi yields are stabilizing this week',
        author_id: 'a2',
        author_username: 'beta',
        created_at: '2026-04-16T14:59:00.000Z',
        public_metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0 }
      },
      {
        id: 'stale',
        text: 'Old market note',
        author_id: 'a3',
        created_at: '2026-04-16T13:00:00.000Z',
        public_metrics: { like_count: 999, reply_count: 999, retweet_count: 999, quote_count: 999 }
      }
    ],
    now,
    { maxPostAgeMs: 15 * 60 * 1000, minFreshRatio: 0.6 }
  );

  assert.equal(queue.sourceOfTruth, 'direct_x_ingestion');
  assert.equal(queue.totals.fetched, 3);
  assert.equal(queue.totals.fresh, 2);
  assert.equal(queue.candidates.length, 2);
  assert.equal(queue.candidates[0].id, 'fresh-high-engagement');
  assert.equal(queue.candidates[0].replyContext.authorHandle, 'alpha');
  assert.equal(queue.candidates[0].replyContext.sourceLink, 'https://x.com/i/web/status/fresh-high-engagement');
  assert.ok(queue.candidates[0].replyContext.intentTopicTags.includes('bitcoin'));
});

test('createRankedQueue fails when freshness SLA ratio is violated', () => {
  const now = new Date('2026-04-16T15:00:00.000Z');

  assert.throws(
    () =>
      createRankedQueue(
        [
          {
            id: 'fresh',
            text: 'Stocks look interesting',
            author_id: 'a1',
            created_at: '2026-04-16T14:59:00.000Z',
            public_metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0 }
          },
          {
            id: 'stale',
            text: 'Very old post',
            author_id: 'a2',
            created_at: '2026-04-16T10:00:00.000Z',
            public_metrics: { like_count: 100, reply_count: 50, retweet_count: 30, quote_count: 10 }
          }
        ],
        now,
        { maxPostAgeMs: 15 * 60 * 1000, minFreshRatio: 0.8 }
      ),
    /Freshness SLA failed/
  );
});
