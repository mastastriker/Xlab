const DEFAULT_MAX_POST_AGE_MS = 15 * 60 * 1000;

export function normalizePost(raw) {
  if (!raw || !raw.id || !raw.text || !raw.created_at || !raw.author_id) {
    throw new Error('Invalid raw post payload');
  }

  const createdAt = new Date(raw.created_at);
  if (Number.isNaN(createdAt.valueOf())) {
    throw new Error('Invalid created_at timestamp');
  }

  return {
    id: String(raw.id),
    text: String(raw.text),
    authorId: String(raw.author_id),
    authorHandle: raw.author_username ? String(raw.author_username) : null,
    createdAt: createdAt.toISOString(),
    metrics: {
      likes: raw.public_metrics?.like_count ?? 0,
      replies: raw.public_metrics?.reply_count ?? 0,
      reposts: raw.public_metrics?.retweet_count ?? 0,
      quotes: raw.public_metrics?.quote_count ?? 0
    },
    url: `https://x.com/i/web/status/${raw.id}`
  };
}

export function filterFreshPosts(posts, now = new Date(), maxAgeMs = DEFAULT_MAX_POST_AGE_MS) {
  return posts.filter((post) => {
    const age = now.valueOf() - new Date(post.createdAt).valueOf();
    return age >= 0 && age <= maxAgeMs;
  });
}

export function buildFinderPayload(rawPosts, now = new Date(), maxAgeMs = DEFAULT_MAX_POST_AGE_MS) {
  const normalized = rawPosts.map(normalizePost);
  const fresh = filterFreshPosts(normalized, now, maxAgeMs);

  return {
    fetchedAt: now.toISOString(),
    totalFetched: rawPosts.length,
    totalFresh: fresh.length,
    posts: fresh
  };
}
