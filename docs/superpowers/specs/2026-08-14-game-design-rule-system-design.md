# Game Design Rule System Design

The approved product and technical design is maintained in
[`specs/032-game-design-rule-system/spec.md`](../../../specs/032-game-design-rule-system/spec.md).

This design replaces the Markdown-first `031` implementation with five explicit
boundaries:

1. strict structured rules and deterministic Markdown projection;
2. immutable versions with single-parent inheritance and visible diffs;
3. authorized source snapshot resolution for Documents and Keco Tables;
4. leased database jobs consumed by an opportunistic runner and Cron worker;
5. bounded untrusted-data Agent injection from a pinned project version.

The implementation must preserve the existing manager entry and official/personal
browsing experience while replacing fake references, request-lifetime background
work, substring validation, and raw Markdown prompt injection.
