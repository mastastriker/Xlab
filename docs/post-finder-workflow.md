# Post Finder Direct-X Workflow

## Source Of Truth

The Post Finder queue now uses `direct_x_ingestion` as the canonical source path.

- API access: `src/xApiClient.js`
- Credential loading: `src/xCredentials.js`
- Normalization/freshness: `src/xIngestion.js`
- Queue ranking + writer payload: `src/postFinderWorkflow.js`

Credential policy and runtime secret-store wiring are documented in `docs/x-credentials.md`.

No webview/scraped path is part of this primary queue flow.

## Queue Rules

- Freshness threshold: default `15m` (`maxPostAgeMs` configurable).
- Freshness SLA: queue build fails if fresh ratio is below `minFreshRatio`.
- Ranking: recency-weighted + engagement-weighted score.
- Writer payload for each candidate includes:
  - `authorHandle`
  - `sourceLink`
  - `postAgeMinutes`
  - `contextSummary`
  - `intentTopicTags`
