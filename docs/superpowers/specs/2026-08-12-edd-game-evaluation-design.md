# EDD Game Evaluation Design

## 1. Purpose

Define a reusable Evaluation-Driven Development (EDD) framework for evaluating
Keco/Godot games during development and release acceptance. The framework turns
runtime evidence, structured playtests, player judgment, and observed behavior
into:

- a traceable 100-point quality score;
- a separate player sentiment profile;
- a P0-P3 risk register;
- a stage-specific release decision;
- prioritized improvement work with fixed retest criteria.

The framework follows the paper *Evaluation-Driven Development of LLM Agents: A
Process Model and Reference Architecture*: evaluation spans the lifecycle,
combines final and intermediate evidence, uses human and automated evaluators,
and closes the loop from findings to runtime or redevelopment changes. The paper
does not provide a game scoring rubric, so this design adapts its process and
evidence principles to game development rather than claiming the paper validates
the weights below.

## 2. Goals And Non-Goals

### Goals

- Support both development diagnosis and release acceptance.
- Preserve an 80-point cross-game baseline while allowing 20 points of
  genre- and GDD-specific evaluation.
- Evaluate gameplay Slices quickly and milestones comprehensively.
- Separate deterministic runtime facts from subjective player experience.
- Make every score traceable to a rubric, version, evaluator, and evidence.
- Prevent aggregate scores from hiding critical failures.
- Preserve findings, repairs, and retest evidence across versions.
- Extend the existing Keco `EvalSpec`, `KECO_EVAL`, and `EvalReport` evidence
  contracts rather than replacing them.

### Non-Goals

- Let AI decide whether a game is fun or aesthetically pleasing.
- Infer player emotion from faces, voices, or other biometric signals.
- Train an opaque machine-learning quality score.
- Rank unrelated games publicly by their aggregate scores.
- Predict sales or commercial success from a small playtest sample.
- Automatically change a GDD or game implementation after evaluation.
- Treat screenshots, file existence, or AI opinion as proof of player
  experience.

## 3. Evaluation Cadence

The framework uses two evaluation depths.

### Slice Evaluation

Run after a gameplay Slice is completed. It evaluates only:

- metrics directly served by the Slice;
- adjacent systems that could regress;
- relevant P0/P1 risks;
- previously failed evaluations being repaired;
- the smallest representative core-flow regression.

It does not produce a new full 100-point score. Its output states the evaluated
items, pass/fail/manual/blocked counts, new risks, regression results, and whether
the Slice may advance.

### Milestone Evaluation

Run at Alpha, Beta, Release Candidate (RC), and Release. It executes the complete
applicable 100-point profile, reports evidence coverage, and produces a formal
stage decision.

## 4. Evaluators And Evidence Ownership

The default standard playtest has three to five target players and one developer
or designer acting as observer. Early Slice tests may use a smaller internal
sample; Beta and Release can expand the target-player sample without changing the
rubric.

Evaluation ownership is divided by the nature of the claim:

- Deterministic state, flow, performance, errors, resources, and persistence use
  fresh structured runtime evidence.
- Fun, feel, pacing, readability, and aesthetic response use target-player
  answers and concrete play events.
- The observer records behavior and incidents but does not enter the player
  subjective average.
- AI may organize evidence, identify contradictions, and draft findings. It may
  not substitute its preferences for player judgment or turn unsupported visual
  review into an objective pass.

## 5. Score Model

### 5.1 Top-Level Weights

| Metric group | ID | Weight |
|---|---|---:|
| Core gameplay and fun | `general.core` | 18 |
| Goals and rule clarity | `general.clarity` | 8 |
| Controls and interaction feedback | `general.interaction` | 12 |
| Level and experience pacing | `general.pacing` | 10 |
| System completeness and balance | `general.systems` | 10 |
| Audio-visual presentation and consistency | `general.presentation` | 8 |
| Stability and performance | `general.stability` | 8 |
| Accessibility and safety | `general.accessibility` | 6 |
| Genre and project specialization | `specialized` | 20 |
| **Total** | | **100** |

The first eight groups are the fixed 80-point baseline. The final 20 points use
one primary-genre template with controlled GDD customization.

### 5.2 Behavior-Anchored Rating Scale

Every scored item uses a five-level rubric. Item-specific descriptions refine
these anchors but must preserve their direction.

| Rating | General anchor | Score rate |
|---:|---|---:|
| 1 | The intended experience repeatedly fails or blocks the player | 20% |
| 2 | A clear problem requires repeated attempts, explanation, or workaround | 40% |
| 3 | The experience basically works but contains identifiable friction | 60% |
| 4 | The experience is consistently effective with minor issues | 80% |
| 5 | The goal is reliably achieved and materially strengthens the experience | 100% |

Ratings 2 and 4 may use item-specific intermediate anchors. A rating without the
required evidence is `not_evaluated`, not zero.

### 5.3 Subjective Contribution

Seven player-experience groups use structured evidence plus one overall player
rating for that group:

```text
groupScore = groupWeight * (
  structuredRate * 0.80 +
  subjectiveRate * 0.20
)
```

The seven groups are `general.core`, `general.clarity`,
`general.interaction`, `general.pacing`, `general.systems`,
`general.presentation`, and the complete `specialized` group. The overall rating
is normalized from a 1-10 scale to `0.10-1.00`.

`structuredRate` is the weighted mean of the group's applicable item rates. Each
item rate is resolved only from its declared evaluator and evidence requirements;
the player questionnaire is one source and does not replace runtime or observer
evidence required by that item.

`general.stability` and `general.accessibility` are based primarily on measured
or professionally reviewed evidence. Player-reported failures remain evidence
but are not added again as a second subjective component.

Example:

```text
Interaction weight = 12
Structured average = 4/5 = 0.80
Overall player feel = 7.5/10 = 0.75
Score = 12 * (0.80 * 0.80 + 0.75 * 0.20) = 9.48
```

### 5.4 Player Aggregation And Confidence

- Behavior-anchored items use the mean of valid target-player responses.
- Overall ratings show mean, median, minimum, and maximum.
- A 1-10 spread of at least 4, or a 1-5 spread of at least 2, is `high_disagreement`.
- Fewer than three valid target-player answers is `low_confidence`.
- A player who did not experience an item answers `not_applicable`; that answer
  is excluded and the applicable item weights are normalized within the group.
- A required item without evidence is `not_evaluated`; it reduces coverage and
  cannot silently redistribute weight for a formal Release score.
- An answer pattern with no engagement, identical rapid answers, and no required
  events may be excluded. The exclusion and reason must be recorded.
- Observer ratings never enter the player average.

### 5.5 Duplicate-Impact Rule

A defect may affect several groups but has exactly one `primaryMetricId` for
scoring. Other groups record linked impact without subtracting the same loss
again. P2 and P3 findings are expressed through their affected metric ratings;
they do not cause an extra mechanical deduction. P0 and P1 findings act as stage
gates independently of the numeric score.

### 5.6 Required Output

No report may present the aggregate score alone. Its summary includes:

```text
EDD score: 82.4/100
Player overall sentiment: 7.6/10
Evidence coverage: 94%
Stage decision: Beta Passed / Release Failed
```

## 6. General 80-Point Rubric

### 6.1 Core Gameplay And Fun: 18

| Item | Weight | Evidence examples |
|---|---:|---|
| Core loop functions and is understood | 4 | Loop completion, time to completion, help events |
| Player decisions materially change outcomes | 4 | Choice distribution, strategy change, outcome variance |
| Actions, feedback, and rewards correspond | 4 | Reward timing, player explanation, repeated action |
| Players want to retry after failure | 3 | Retry rate, voluntary continuation, exit event |
| Repetition avoids avoidable fatigue | 3 | Repetition counts, skip/exit points, concrete comments |

Anchor 1 means players cannot reliably enter or complete the core loop, choices
are inert, or repetition dominates. Anchor 3 means the loop works but decisions,
rewards, or motivation are weak. Anchor 5 means the loop is clear and stable,
choices create recognizable differences, and players voluntarily continue or
retry.

### 6.2 Goals And Rule Clarity: 8

| Item | Weight |
|---|---:|
| Initial goal is clear | 2 |
| Core rules are understandable | 2 |
| The next meaningful action can be identified | 2 |
| Success and failure causes are understandable | 2 |

Anchor 1 requires frequent outside explanation. Anchor 3 indicates the main goal
is understood but some rules, states, or failure causes remain unclear. Anchor 5
means players proceed and explain outcomes without outside help. Evidence includes
time to first action, help count, wrong paths, pauses, verbalized understanding,
and task success.

### 6.3 Controls And Interaction Feedback: 12

| Item | Weight |
|---|---:|
| Input response is timely | 3 |
| Results are predictable from input | 3 |
| Hits, damage, selection, and state changes are legible | 3 |
| Interface interaction is accurate and recoverable | 3 |

Anchor 1 means unresponsive input, unintended actions, or absent feedback
repeatedly disrupt play. Anchor 3 indicates basic control with identifiable delay
or ambiguity. Anchor 5 means input, action, and feedback consistently correspond.
Evidence includes latency, input repetition, accidental actions, cancellations,
and concrete player incidents.

### 6.4 Level And Experience Pacing: 10

| Item | Weight |
|---|---:|
| Difficulty and challenge progress coherently | 3 |
| Intensity varies appropriately | 2 |
| Waiting, idle time, and repeated travel are controlled | 2 |
| Tutorials and new content arrive at useful times | 2 |
| Goals and rewards have effective spacing | 1 |

Anchor 1 means long periods without useful activity, severe difficulty spikes,
or blocking tutorials. Anchor 3 means the experience advances but has clearly
overlong, compressed, or abrupt sections. Anchor 5 means challenge, recovery,
learning, and reward create a sustained rhythm. Evidence includes duration,
death clusters, idle time, exit nodes, and reward intervals.

### 6.5 System Completeness And Balance: 10

| Item | Weight |
|---|---:|
| Core systems form a complete loop | 3 |
| Strategies, roles, and resource choices are viable | 3 |
| Systems interact consistently | 2 |
| Progression, economy, and resource pacing are sustainable | 2 |

Anchor 1 indicates a broken loop, one clearly dominant answer, resource collapse,
or conflicting systems. Anchor 3 indicates usable systems with weak choices or
balance defects. Anchor 5 indicates multiple effective choices and stable system
interactions. Evidence includes choice distributions, income/expense curves,
strategy success, and state logs.

### 6.6 Audio-Visual Presentation And Consistency: 8

| Item | Weight |
|---|---:|
| Important objects and states are visually legible | 2 |
| Character, environment, and UI styles are coherent | 2 |
| Animation and audio reinforce actions | 2 |
| UI hierarchy and text are readable | 2 |

Anchor 1 means key information is difficult to identify or presentation actively
interferes with play. Anchor 3 means the game is basically legible with local
ambiguity or inconsistency. Anchor 5 means presentation reliably communicates
state and supports the intended style. Personal taste alone does not determine
the score; target-player response and consistency with the design goal do.

### 6.7 Stability And Performance: 8

| Item | Weight |
|---|---:|
| Crash, freeze, and flow-blocking behavior | 3 |
| Frame pacing and response stability | 2 |
| Startup, loading, and scene transitions | 1 |
| Save/load and persistent-state integrity | 2 |

Anchor 1 includes frequent crashes, blocked core flow, corrupt saves, or
performance that prevents control. Anchor 3 means the flow completes but contains
reproducible stutter, long loads, or infrequent state errors. Anchor 5 requires
stable behavior on the declared device matrix and successful critical persistence
tests.

### 6.8 Accessibility And Safety: 6

| Item | Weight |
|---|---:|
| Text, contrast, and information readability | 2 |
| Relevant input, audio, and display settings | 2 |
| Sensitive-content notices and player protection | 1 |
| Data, permission, and destructive-action transparency | 1 |

Only requirements relevant to the platform, audience, and feature set apply. A
fully offline game without accounts does not receive invented network-privacy
criteria. Anchor 1 means critical information or operation is inaccessible, or a
material risk is hidden. Anchor 3 means basic use is supported with incomplete
options or notices. Anchor 5 means critical information, alternatives, and
relevant protections are effective.

## 7. Specialized 20-Point Profile

### 7.1 Selection And Customization

Select the primary genre by the activity occupying most meaningful player time,
not theme or art direction. Start with one 20-point genre template. Extract the
game's explicit experience promises from the GDD and replace at most 10 template
points with two to four project-specific items.

The final profile must:

- preserve at least 10 genre-template points;
- total exactly 20 points;
- assign integer item weights, normally 2-5;
- trace every custom item to a GDD section;
- define a test scene, evidence, and item-specific 1/3/5 anchors;
- avoid duplicating general or specialized items;
- be locked before playtesting.

Hybrid games still choose one primary template. Secondary genres appear through
the custom portion rather than through a second template.

### 7.2 Default Genre Templates

#### Action

| Item | Weight |
|---|---:|
| Combat input and action response | 4 |
| Attack, damage, and evasion feedback | 4 |
| Enemy behavior and attack readability | 4 |
| Skill and tactical combination space | 4 |
| Difficulty, fairness, and recovery opportunity | 4 |

#### RPG

| Item | Weight |
|---|---:|
| Perceptible character growth | 4 |
| Equipment, skill, or attribute builds | 4 |
| Quest and exploration motivation | 4 |
| Character, relationship, and narrative engagement | 4 |
| Progression linkage to the core loop | 4 |

#### Simulation And Management

| Item | Weight |
|---|---:|
| Production and consumption loop | 4 |
| Resource constraints and strategic choice | 4 |
| Short-term feedback and long-term goals | 4 |
| Legibility of systemic consequences | 4 |
| Failure recovery and management pacing | 4 |

#### Puzzle

| Item | Weight |
|---|---:|
| Puzzle rules are expressed clearly | 4 |
| Reasoning chain is logically complete | 4 |
| Difficulty progresses coherently | 4 |
| Hint system provides proportionate help | 4 |
| Solution creates earned satisfaction | 4 |

#### Visual Novel And Narrative

| Item | Weight |
|---|---:|
| Narrative pacing and information release | 4 |
| Characterization and relationship change | 4 |
| Player choices have meaning | 4 |
| Branch logic and continuity | 4 |
| Text, staging, and emotion reinforce one another | 4 |

#### Strategy

| Item | Weight |
|---|---:|
| Decision space and number of viable strategies | 4 |
| Information transparency and predictability | 4 |
| Risk, reward, and counterplay | 4 |
| Adaptation as the situation changes | 4 |
| Opening, midgame, and endgame structure | 4 |

#### Platformer

| Item | Weight |
|---|---:|
| Movement and jump precision | 4 |
| Landing, collision, and spatial readability | 4 |
| Obstacle composition and progression | 4 |
| Failure and retry cost | 4 |
| Flow and route variation | 4 |

### 7.3 Custom Item Example

```yaml
metricId: specialized.build-strategy-impact
name: Equipment builds change combat strategy
weight: 4
gddSource: GDD-4.2
test: Complete the same standard encounter with distinct equipment sets
evidence:
  - equipment choice distribution
  - skill-use changes
  - completion time and failure cause
  - player explanation for switching builds
anchors:
  1: Equipment has little effect or one option dominates
  3: Builds create local differences but play remains mostly identical
  5: At least three viable builds create clear, explainable strategy changes
```

### 7.4 Change Control

- Prototype through Alpha may revise the specialized profile once after the core
  experience is validated.
- After Alpha, a revision requires a formal change to the GDD's core goals.
- Beta and Release profiles are frozen in normal operation.
- Each revision retains its prior version and states whether trend comparison is
  valid.
- A low-scoring item may not be removed or down-weighted merely because of its
  result.

## 8. Standard Player Questionnaire

The standard questionnaire contains approximately 30 question groups and takes
8-12 minutes. It covers only content the player actually experienced.

| Questions | Content | Form |
|---|---|---|
| 1-4 | Core loop, meaningful choice, reward feedback, repetition | 1-5 anchored |
| 5 | Overall fun | 1-10 subjective |
| 6-8 | Goal, rules, success/failure understanding | 1-5 anchored |
| 9 | Overall clarity | 1-10 subjective |
| 10-12 | Response, predictability, state feedback | 1-5 anchored |
| 13 | Overall control feel | 1-10 subjective |
| 14-16 | Difficulty, idle time, content introduction | 1-5 anchored |
| 17 | Overall pacing | 1-10 subjective |
| 18-20 | System loop, choice value, progression/balance | 1-5 anchored |
| 21 | Overall system experience | 1-10 subjective |
| 22-24 | Readability, style consistency, audio-visual feedback | 1-5 anchored |
| 25 | Overall presentation | 1-10 subjective |
| 26 | Stutter, crash, and state anomalies | Incident selection and detail |
| 27 | Reading, input, audio, display, or content obstacles | Incident selection and detail |
| 28 | Best, worst, and most confusing events | Open response |
| 29 | Specialized behavior matrix, one row per locked specialized item | 1-5 anchored |
| 30 | Overall specialized experience | 1-10 subjective |

An anchored question uses concrete language. Example:

> Did the game produce the expected action promptly after your input?

| Rating | Answer anchor |
|---:|---|
| 1 | Input frequently had no response or produced the wrong action and blocked play |
| 2 | Problems occurred repeatedly and required another input |
| 3 | Input basically worked but had a specific, identifiable friction |
| 4 | Response was accurate with only a minor issue |
| 5 | Response was consistently prompt, accurate, and clearly confirmed |

A 1 or 2 answer requires a scene description. A player may select
`not_applicable` when the tested content was not encountered.

### 8.1 Independent Sentiment Profile

After the 30 groups, collect five summary ratings:

- overall liking, 1-10;
- willingness to play another 15 minutes, 1-5;
- willingness to recommend to the target audience, 1-5;
- perceived current-version completeness, 1-10;
- overall subjective game score, 1-10.

These values form an independent player profile. They do not enter the 100-point
score again; only the seven group-level subjective questions contribute their
defined 20 percent.

Question 29 is one questionnaire group rather than one generic rating. It renders
one concrete, anchored row for every applicable specialized item in the locked
profile. This keeps the standard form near 30 groups while preserving evidence
for each part of the 20-point profile.

### 8.2 Required Concrete Events

Each player records at least:

- the most enjoyable or satisfying event;
- the most boring, frustrating, or exit-inducing event;
- the most confusing or unexpected event.

Each event captures the approximate time or location, intended action, actual
result, reason for the response, and whether it affected continuation.

## 9. Observer Protocol

The observer records without coaching:

- time to understand the core goal;
- time to complete the first core loop;
- help requests and the exact question;
- repeated errors or repeated inputs;
- pauses longer than 10 seconds and their locations;
- failure, death, and retry causes;
- voluntary exploration and strategy changes;
- skipped text, tutorials, or animation;
- spontaneous positive and negative statements;
- crashes, stutter, visual misidentification, and flow blocks.

When a player explicitly asks for help, the observer may use only the predefined
minimum hint and must record it. Observation is diagnostic evidence and does not
override the player's reported experience.

## 10. EvalSpec And Runtime Evidence

Every testable claim is defined before implementation or evaluation:

```yaml
evalId: control-basic-attack-response
metricIds:
  - general.interaction.input-response
sourceRequirement: GDD-Combat-2.1
preconditions:
  - player is in the standard combat scene
  - the declared character and equipment are active
action:
  - execute ten basic attacks
expected:
  - every accepted input triggers an attack
  - input-to-animation latency remains within the declared tolerance
evidence:
  - structured KECO_EVAL record
  - input and action timestamps
passRule: all required trials and thresholds pass
manualRequired: false
risk: P1
```

The existing Keco evaluation kinds remain authoritative: `state`, `flow`,
`regression`, `asset_integrity`, `animation_resource`, `tileset_resource`,
`visual`, and `experience`. Deterministic evaluation requires fresh structured
evidence from the current snapshot. Visual and experience claims may remain
`manual_required` and cannot be promoted by file parsing or AI judgment.

Godot runtime evidence retains the existing format:

```text
KECO_EVAL {"evalId":"...","status":"passed|failed","expected":{},"actual":{},"snapshotHash":"sha256:..."}
```

Only evidence bound to the current build and snapshot can support a current
pass. Historical evidence is retained for trends, not reused as proof.

## 11. Milestone Evaluation Workflow

### 11.1 Freeze

Create an evaluation batch with:

- batch ID, project, game version, commit/build/snapshot hash;
- stage and declared test scope;
- target platform and device matrix;
- GDD and evaluation-profile revisions;
- primary genre and specialized profile;
- test window, player sample, and observer;
- thresholds and required evidence.

Metrics, weights, and thresholds cannot change during the batch. A rubric defect
is recorded as a limitation and corrected only in a new profile version.

### 11.2 Execute

1. Run startup, core flow, state, performance, persistence, and regression checks.
2. Give each target player the same declared tasks and conditions.
3. Record observation without coaching.
4. Collect the questionnaire and required concrete events.
5. Aggregate ratings, evidence, confidence, disagreement, and coverage.
6. Create findings, improvement tasks, a stage decision, and a retest scope.

Recommended player time is 15-30 minutes for a Slice, 30-60 minutes for Alpha,
60-120 minutes for Beta, and the declared complete critical experience for RC or
Release. The report names all content outside the test scope.

### 11.3 Evidence Priority

Evidence is resolved according to the claim:

- Deterministic state: structured runtime state, then observation, then player
  recollection.
- Player experience: concrete player event, then observed behavior, then abstract
  rating. AI speculation has no standing.
- Presentation: target-player response plus design-goal consistency, then
  structured visual checks.
- Safety and release risk: reproducible failure and appropriate professional
  review take priority over general sentiment.

Conflicts are recorded and investigated rather than silently resolved by one
global priority.

## 12. Evidence Coverage

Each metric declares required evidence. Coverage is weighted:

```text
coverage = weight of applicable metrics with all required evidence
         / weight of all applicable metrics in the batch
```

| Coverage | Allowed conclusion |
|---:|---|
| 100% | Complete evaluation |
| 90-99% | Development decision only; not Release acceptance |
| 70-89% | Partial evaluation with limited confidence |
| Below 70% | No formal aggregate score; report findings only |

A missing mandatory P0/P1 evaluation blocks stage passage regardless of overall
coverage.

## 13. Risk Classification

| Level | Definition | Examples | Effect |
|---|---|---|---|
| P0 | Unacceptable game, data, security, or compliance state | Cannot start, frequent crash, corrupt save, critical security issue | Immediately blocks acceptance |
| P1 | Core experience cannot be completed reliably | Permanent core-flow block, key feature absent, many players cannot progress | Blocks RC and Release |
| P2 | Major experience impact with a workaround | Severe stutter, misleading rule, broken balance, missing key feedback | Lowers its primary metric and enters near-term repair |
| P3 | Local defect without core-flow impact | Text defect, minor visual issue, rare feedback flaw | Recorded and prioritized by impact/cost |

Classification uses consequence, affected population, frequency, and
recoverability. It is not determined solely by whether one player reports being
bothered.

## 14. Stage Gates

| Stage | Score | Risk gate | Evidence gate |
|---|---:|---|---|
| Slice | No full score | No P0/P1 blocking the Slice | Direct items and adjacent regressions complete |
| Alpha | At least 60 | No P0 | Core-loop evidence complete; at least 70% coverage |
| Beta | At least 70 | No P0; every P1 has owner and target version | At least 90% coverage |
| RC | At least 80 | No P0/P1 | Mandatory evaluations pass; 100% coverage |
| Release | At least 85 | No P0/P1 | 100% coverage and critical regressions pass |

Projects may raise a threshold before a batch starts but may not lower it after
seeing results.

Additional minimums prevent compensation by unrelated strengths:

- `general.core` is at least 60 percent of its weight;
- `general.stability` is at least 70 percent;
- `specialized` is at least 60 percent;
- at Release, every general group is at least 50 percent.

Decision order is fixed:

```text
known build identity
-> complete mandatory evidence
-> permitted P0/P1 state
-> mandatory evaluations pass
-> aggregate threshold
-> critical group minimums
-> stage decision
```

Allowed decisions are:

- `passed`: all stage conditions pass;
- `conditional`: Alpha/Beta only, numeric conditions pass and accepted P1 work is
  owned and scheduled;
- `partial`: evaluation ran but evidence is insufficient for acceptance;
- `failed`: evaluation completed and a gate failed;
- `blocked`: build identity, runtime, or critical environment prevented a valid
  evaluation.

RC and Release cannot be conditional.

At Alpha or Beta, any accepted open P1 makes the result `conditional`, never
`passed`. A `passed` decision at those stages has no open P0 or P1. At Beta, an
open P1 is acceptable only when it has an owner, fixed acceptance rule, and target
version.

## 15. Improvement And Retest Loop

Every failure or low-scoring finding creates a traceable improvement record:

```yaml
issueId: ISSUE-...
firstSeenBuild: sha256:...
primaryMetricId: general.clarity.next-action
linkedMetricIds: []
evalIds: []
severity: P2
evidence: []
reproduction: []
rootCauseHypothesis: "..."
owner: "..."
targetVersion: "..."
fixedAcceptanceRule: "..."
affectedRegressions: []
retestResults: []
closedBuild: null
```

Repair requires rerunning the original failure and all affected regressions while
keeping the original acceptance rule fixed. The report preserves before-and-after
evidence and updates score, finding state, and stage decision.

Priority ordering is:

1. P0.
2. P1 blocking the current stage.
3. Core-loop problems shared by several target players.
4. Problems causing exits, permanent blocks, or inability to identify the next
   action.
5. High-disagreement problems relevant to the target audience.
6. P2 experience and balance work.
7. P3 defects and polish.

Within a tier, use severity, affected-player proportion, frequency, and linkage
to core GDD goals. Every task has a measurable retest rule; phrases such as
"improve feel" are not acceptance criteria.

## 16. Data Model

| Object | Responsibility |
|---|---|
| `EvaluationTemplate` | Versioned general rubric and genre presets |
| `EvaluationProfile` | Locked game-specific 80+20 configuration and gates |
| `EvalSpec` | Preconditions, action, expected result, evidence, and pass rule |
| `PlaytestSession` | Build, device, participant, tasks, and observations |
| `QuestionnaireResponse` | Raw anchored answers, sentiment, and concrete events |
| `GameEvaluationReport` | Scores, evidence, confidence, risks, and stage decision |
| `ImprovementIssue` | Repair ownership, fixed acceptance, regression, and retest history |

Example locked profile:

```yaml
profileId: game-alpha-eval-v1
gameId: example-game
gddRevision: sha256:...
stage: alpha
primaryGenre: action-rpg
templateVersion: 1
generalWeight: 80
specializedWeight: 20
subjectiveWeight: 0.20
playerSampleTarget: 5
thresholds:
  alpha: 60
  beta: 70
  rc: 80
  release: 85
specializedMetrics:
  - metricId: specialized.build-strategy-impact
    gddSource: GDD-4.2
    weight: 4
lockedAt: 2026-08-12T00:00:00Z
```

Data rules:

- Every result binds to a build and profile revision.
- Participants use anonymous IDs; unnecessary personal data is not retained.
- Raw responses and evidence remain immutable beneath derived summaries.
- `not_applicable` and `not_evaluated` remain distinct from zero.
- Automated values and human judgment are stored separately.
- Manual score overrides preserve the original value, new value, rationale, and
  approver.
- Given identical source evidence and profile, score computation is
  deterministic.

## 17. Keco Contract Integration

The existing Keco runtime `EvalReport` remains the source for direct Godot
evaluation outcomes. The new `GameEvaluationReport` references its `evalId`,
evidence, status, runtime batch, and snapshot rather than rewriting those facts.

```text
Keco EvalSpec and KECO_EVAL evidence
                  |
                  v
passed / failed / manual_required / blocked
                  |
                  v
metric evidence mapping + questionnaire + observation
                  |
                  v
100-point score + sentiment + coverage + risk gates
                  |
                  v
stage decision + improvement issues + retest scope
```

A Keco runtime report may be technically `passed` while the game milestone fails
its experience score or stage threshold. Conversely, player satisfaction cannot
convert a failed deterministic P0/P1 evaluation into a pass.

## 18. Report Structure

1. Evaluation summary: project, version, hashes, profile, stage, score, sentiment,
   coverage, and decision.
2. Score details: all general and specialized items, evidence, confidence, and
   disagreement.
3. Player experience: questionnaire summary, sentiment profile, required events,
   and audience-segment differences.
4. Runtime evidence: `KECO_EVAL` results, performance, errors, persistence,
   devices, and tested scope.
5. Risks and findings: P0-P3 list, reproduction, impact, and uncovered risk.
6. EDD loop: improvement issues, owners, target versions, fixed retest rules, and
   adjacent regressions.
7. Trend: score movement, new/fixed/reopened findings, and changes in profile or
   evidence coverage.

Example summary:

```text
EDD score: 82.4/100
Player overall sentiment: 7.6/10
Evidence coverage: 100%
Risks: P0 0, P1 1, P2 6, P3 9
Target stage: Release Candidate
Decision: Failed
Reason: one P1 core-flow blocker remains
```

## 19. First Release Scope

The first implementation includes:

1. The fixed 80-point template.
2. Seven 20-point genre templates.
3. Controlled GDD customization and profile freezing.
4. The standard 30-group player questionnaire.
5. The observer record.
6. Automated and manual evidence mapping.
7. Score, sentiment, confidence, disagreement, and coverage computation.
8. P0-P3 finding management.
9. Slice, Alpha, Beta, RC, and Release decisions.
10. `GameEvaluationReport` export and historical comparison.

## 20. Acceptance Criteria

- All configured weights total exactly 100, with 80 general and 20 specialized.
- Every scored item resolves to a weight, anchors, evaluator, and required
  evidence.
- Custom metrics retain a GDD source and replace at most 10 genre points.
- Subjective contribution is exactly 20 percent only for the seven declared
  experience groups.
- Missing data is never converted to zero or silently imputed.
- One defect has one primary scoring metric and cannot be deducted twice.
- P0/P1 gates operate independently of aggregate score.
- Mandatory evidence and critical regressions are complete for RC and Release.
- A locked profile cannot change silently.
- The report preserves raw, derived, overridden, historical, and retest data.
- Repairs retain fixed acceptance rules and affected regression coverage.
- The system can emit a human-readable summary and a machine-validatable report.
