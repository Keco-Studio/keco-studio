# GDD Change Contract

Use this contract when a Slice request needs a feature, entity, rule, or value
that cannot be cited in the GDD bound by the run's `SourceProfile`.

```text
proposal -> user approval -> bound GDD amendment or accepted patch reference
         -> re-read bound GDD -> refresh source hash and inventory -> Slice
```

The proposal must identify the target GDD section, proposed wording, rationale,
affected requirement IDs, and whether the change is normative, descriptive, or
tentative. Until approval and authoritative write-back, it is not a Slice
source. A separate patch document is valid only when the bound GDD explicitly
references it and marks it accepted; a standalone Slice spec cannot authorize a
new design.
