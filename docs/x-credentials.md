# X Credential Handling

## Approved Secret Store Locations

The X API bearer token must be provided at runtime using one of these approved inputs:

- `X_API_BEARER_TOKEN` environment variable
- `X_API_BEARER_TOKEN_FILE` path to a mounted secret file
- default mounted file path: `/run/secrets/x_api_bearer_token`
- workspace `.env` file at project root (`<repo>/.env`)

Do not commit credentials into repository files or issue comments.

## Credential Execution Lane And Lock Hygiene

Credential bootstrap now normalizes execution lane names and clears stale lane locks before client creation.

- `X_API_CREDENTIAL_EXECUTION_LANE` sets a lane identifier (defaults to `default`)
- lane values are normalized to lowercase kebab-safe identifiers (example: `Blue Team/Prod` -> `blue-team-prod`)
- lock file path defaults to `/tmp/x-api-credential-<lane>.lock`
- `X_API_CREDENTIAL_LOCK_FILE` overrides the default lock file path
- `X_API_CREDENTIAL_LOCK_TTL_MS` controls stale lock threshold (default `900000` / 15 minutes)

When a lock file exists but its age exceeds the configured TTL, it is removed automatically.

## `.env` Placement And Format

Place the file exactly at the repository root:

- `/home/paperclip/.paperclip/instances/default/projects/a3ede02f-71b1-44b8-acd5-289c3853d6ba/3f629bd5-6b50-4dba-a92a-24013b3e473f/_default/.env`

Minimal `.env` content:

```dotenv
X_API_BEARER_TOKEN=your_real_x_bearer_token_here
```

Alternative `.env` content using a file-based secret:

```dotenv
X_API_BEARER_TOKEN_FILE=/run/secrets/x_api_bearer_token
```

Optional: custom dotenv path can be set with `X_API_DOTENV_PATH`.

## Runtime Ingestion Path

- Source resolution and loading: `src/xCredentials.js`
- X client bootstrap from secrets: `createXApiClientFromEnv` in `src/xApiClient.js`

`createXApiClientFromEnv` returns both:

- `client`: `XApiClient` ready for API calls
- `credentialSource`: safe source metadata (`env` or `file`) for diagnostics
- `credentialExecutionLane`: normalized lane used for credential execution
- `executionLock`: stale-lock cleanup metadata (`lockStatus`, `lockCleared`, `lockFilePath`)

`credentialSource` is intentionally secret-free so it can be logged for debugging without exposing credentials.

## Validation

Credential loading validates that tokens are non-empty and plausibly sized before the client starts.
If no valid source exists, startup fails with a clear error that lists approved inputs.
