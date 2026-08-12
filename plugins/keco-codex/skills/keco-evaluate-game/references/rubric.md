# EDD Game Evaluation Rubric

## Contents

- Score composition
- General rubric
- Specialized templates
- Playtest evidence
- Risk and stage gates

## Score Composition

Use 80 fixed general points plus one locked 20-point specialized profile. Rate each item from 1 to 5 with anchored evidence. For `general.core`, `general.clarity`, `general.interaction`, `general.pacing`, `general.systems`, `general.presentation`, and `specialized`, combine the weighted structured rate at 80 percent with the group player rating at 20 percent. Use measured or professionally reviewed evidence for stability, accessibility, and safety.

Do not turn `not_evaluated` into zero. Exclude `not_applicable` from the applicable denominator. One finding has one primary scoring metric.

## General Rubric: 80 Points

| Group | Items | Weight |
|---|---:|---:|
| Core gameplay and fun | Core loop, meaningful decisions, action/reward feedback, retry motivation, repetition fatigue | 18 |
| Goals and rule clarity | Initial goal, core rules, next action, success/failure cause | 8 |
| Controls and interaction | Input response, predictability, state feedback, interface recovery | 12 |
| Level and experience pacing | Difficulty, intensity, idle time, content introduction, reward spacing | 10 |
| System completeness and balance | Complete loop, viable choices, system linkage, economy/progression | 10 |
| Audio-visual presentation | Legibility, style consistency, action reinforcement, UI/text readability | 8 |
| Stability and performance | Crashes/blocks, frame pacing, loading, persistence | 8 |
| Accessibility and safety | Readability, settings, content protection, data/action transparency | 6 |

Use these common anchors unless an item defines a stricter one:

- `1`: the intended experience repeatedly fails or blocks the player.
- `3`: the experience works but has concrete, repeatable friction.
- `5`: the goal is reliably achieved and strengthens the experience.

## Specialized Templates: 20 Points

Each template contains five 4-point items. Replace no more than 10 points with GDD-sourced project metrics and preserve a final total of 20.

### Action

- Combat input and action response
- Attack, damage, and evasion feedback
- Enemy behavior and attack readability
- Skill and tactical combination space
- Difficulty, fairness, and recovery opportunity

### RPG

- Perceptible character growth
- Equipment, skill, or attribute builds
- Quest and exploration motivation
- Character, relationship, and narrative engagement
- Progression linkage to the core loop

### Simulation And Management

- Production and consumption loop
- Resource constraints and strategic choice
- Short-term feedback and long-term goals
- Legibility of systemic consequences
- Failure recovery and management pacing

### Puzzle

- Puzzle rule expression
- Logical completeness of the reasoning chain
- Difficulty progression
- Proportionate hint support
- Earned solution satisfaction

### Visual Novel And Narrative

- Narrative pacing and information release
- Characterization and relationship change
- Meaningful player choice
- Branch logic and continuity
- Text, staging, and emotional reinforcement

### Strategy

- Decision space and viable strategies
- Information transparency and predictability
- Risk, reward, and counterplay
- Adaptation to changing situations
- Opening, midgame, and endgame structure

### Platformer

- Movement and jump precision
- Landing, collision, and spatial readability
- Obstacle composition and progression
- Failure and retry cost
- Flow and route variation

## Playtest Evidence

Use three to five target players and one non-scoring observer for a standard milestone. Collect behavior-anchored answers, one 1-10 subjective rating for each experience group, and each player's best, worst, and most confusing event. Flag fewer than three valid ratings as low confidence. Flag a 1-10 spread of at least 4 or a 1-5 spread of at least 2 as high disagreement.

## Risk And Stage Gates

| Stage | Score | Risk | Coverage |
|---|---:|---|---:|
| Alpha | 60 | No P0; open managed P1 makes the result conditional | 70% |
| Beta | 70 | No P0; open P1 requires owner, fixed acceptance, target version | 90% |
| Release Candidate | 80 | No P0/P1 | 100% |
| Release | 85 | No P0/P1 | 100% |

Require core gameplay at 60 percent, stability at 70 percent, specialized at 60 percent, and every general group at 50 percent for Release. P0 is fatal, P1 blocks RC/Release, P2 is major with a workaround, and P3 is local/non-blocking.
