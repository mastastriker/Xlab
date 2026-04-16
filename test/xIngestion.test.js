import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFinderPayload, normalizePost } from '../src/xIngestion.js';

test('normalizePost maps expected fields', () => {
  const normalized = normalizePost({
    id: '123',
    text: 'hello world',
    author_id: '42',
    created_at: '2026-04-16T14:00:00.000Z',
    public_metrics: { like_count: 5, reply_count: 3, retweet_count: 2, quote_count: 1 }
  });

  assert.equal(normalized.id, '123');
  assert.equal(normalized.authorId, '42');
  assert.equal(normalized.metrics.likes, 5);
  assert.equal(normalized.url, 'https://x.com/i/web/status/123');
});

test('buildFinderPayload keeps only fresh posts', () => {
  const now = new Date('2026-04-16T14:10:00.000Z');
  const payload = buildFinderPayload(
    [
      {
        id: 'fresh',
        text: 'fresh post',
        author_id: 'a1',
        created_at: '2026-04-16T14:00:30.000Z',
        public_metrics: { like_count: 1, reply_count: 0, retweet_count: 0, quote_count: 0 }
      },
      {
        id: 'stale',
        text: 'stale post',
        author_id: 'a2',
        created_at: '2026-04-16T13:00:00.000Z',
        public_metrics: { like_count: 0, reply_count: 0, retweet_count: 0, quote_count: 0 }
      }
    ],
    now
  );

  assert.equal(payload.totalFetched, 2);
  assert.equal(payload.totalFresh, 1);
  assert.equal(payload.posts[0].id, 'fresh');
});
