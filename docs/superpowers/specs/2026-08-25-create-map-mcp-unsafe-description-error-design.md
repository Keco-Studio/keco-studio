# Create Map MCP Unsafe Description Error Design

## Goal

When `create_map_draft` receives a description containing unsupported provider controls, credentials, URLs, or dynamic Keco UI instructions, return a stable, actionable MCP validation error to the calling AI instead of reporting a retryable service outage.

## Current Behavior

`createMapPlanV3` rejects unsafe source descriptions with `CreateMapPlannerInputError.code = "map_description_unsafe"` before calling the planning model. The Create Map MCP service does not map that planner code, so `mapProviderError` converts it to `UPSTREAM_UNAVAILABLE`. The App bridge then marks the error retryable, and the MCP client sees only `The Create Map service is temporarily unavailable.`

This hides the required user correction and can cause an AI client to repeat the same invalid request.

## Chosen Design

Map `map_description_unsafe` to the existing `FIELD_VALIDATION_FAILED` MCP error code. Use a dedicated safe public message:

```text
The map description contains unsupported instructions. Remove provider or API controls, credentials, URLs, and dynamic Keco UI instructions, then create a new draft request.
```

The message is deliberately instructional without echoing the submitted description, matched token, credential, URL, provider response, or internal exception.

No new MCP error code is introduced. Existing clients already understand `FIELD_VALIDATION_FAILED`, and HTTP/App bridge handling already treats it as a non-retryable 400 response.

## Data Flow

```text
create_map_draft
  -> claim idempotent draft intent
  -> createMapPlanV3 source validation
  -> map_description_unsafe
  -> release the draft claim
  -> CreateMapMcpError(FIELD_VALIDATION_FAILED, safe guidance)
  -> App route public response
  -> App bridge McpDomainError
  -> MCP toolFailure with isError: true and retryable omitted/false
```

The planning LLM and PixelLab provider are not called. No map project, revision, asset, or paid generation is created. The temporary idempotency claim continues to be released by the existing failure path.

## Error Contract

The MCP caller must receive:

- `isError: true`.
- `structuredContent.ok: false`.
- `structuredContent.error.code: "FIELD_VALIDATION_FAILED"`.
- A safe message explaining which categories to remove and that a new draft request is required.
- No `retryable: true` flag.

Other `FIELD_VALIDATION_FAILED` cases keep the existing generic `The Create Map request is invalid.` message. The actionable message applies only when the planner reports `map_description_unsafe`.

## Testing

1. Service regression: a backend planner failure with `code: "map_description_unsafe"` becomes `FIELD_VALIDATION_FAILED` with the safe guidance, and the claimed draft is released.
2. App route regression: a custom safe message on `FIELD_VALIDATION_FAILED` is preserved rather than replaced by the generic public message only when it is the approved unsafe-description guidance.
3. MCP bridge/result regression: the final tool result is an error with the stable validation code, actionable safe message, and no retryable flag.
4. Existing planner safety, App route sanitization, App bridge sanitization, and Map tool tests remain green.

## Non-Goals

- Changing the unsafe-description pattern list.
- Adding general violence, mature-content, or provider moderation rules.
- Echoing which exact token matched.
- Creating or updating a map draft after validation fails.
- Changing paid-generation confirmation behavior.
