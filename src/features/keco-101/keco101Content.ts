export type Keco101Tab = 'welcome' | 'getting-started';

export type PipelineStage = {
  id: string;
  step: string;
  title: string;
  summary: string;
};

/** The six stages of the Keco production line, in the order a game moves through them. */
export const PIPELINE_STAGES: PipelineStage[] = [
  {
    id: 'design',
    step: '01',
    title: 'Write the design',
    summary: 'GDD, gameplay notes, and a roadmap live as documents in the project.',
  },
  {
    id: 'data',
    step: '02',
    title: 'Turn design into data',
    summary: 'Characters, enemies, items, levels, and drop rules become linked tables.',
  },
  {
    id: 'art',
    step: '03',
    title: 'Get the art ready',
    summary: 'Import the images you already have, or generate pixel art with PixelLab.',
  },
  {
    id: 'slice',
    step: '04',
    title: 'Build a playable slice',
    summary: 'Implement the smallest version of the idea in Godot and prove it runs.',
  },
  {
    id: 'evaluate',
    step: '05',
    title: 'Score it',
    summary: 'Run an EDD evaluation against a fixed standard and get an issue list.',
  },
  {
    id: 'iterate',
    step: '06',
    title: 'Fix and re-check',
    summary: 'Repair what failed, re-test only what changed, then start the next slice.',
  },
];

export type ProjectContentGroup = {
  label: string;
  purpose: string;
};

export const PROJECT_CONTENTS: ProjectContentGroup[] = [
  { label: 'Folders, documents, story graph, search', purpose: 'Design and planning' },
  { label: 'Tables, fields, rows, references, images', purpose: 'Game data' },
  { label: 'Local image assets', purpose: 'Art you already have' },
  { label: 'Godot slice planning and development', purpose: 'Implementation' },
  { label: 'PixelLab pixel art', purpose: 'Generated art' },
  { label: 'EDD game evaluation', purpose: 'Quality gate' },
];

export type WorkSurface = {
  name: string;
  bestFor: string;
  audience: string;
  feel: string;
};

export const WORK_SURFACES: WorkSurface[] = [
  {
    name: 'The web app',
    bestFor: 'Writing documents, filling tables by hand, reviewing dialogue branches, running balance simulations',
    audience: 'Designers, writers, systems designers',
    feel: 'What you see is what you get, and every change syncs immediately',
  },
  {
    name: 'An AI client',
    bestFor: 'Generating tables in bulk, importing asset folders, writing Godot code, running evaluations',
    audience: 'Engineers and technical designers',
    feel: 'One request runs a whole workflow, with a confirmation and a verification at every step',
  },
];

export type Boundary = {
  title: string;
  detail: string;
};

export const BOUNDARIES: Boundary[] = [
  {
    title: 'It will not generate a finished commercial game',
    detail:
      'Keco covers design, data, art, slice, evaluation, and repair. Full map design, gameplay trade-offs, and shipping engineering still need people.',
  },
  {
    title: 'It will not decide whether your game is fun',
    detail:
      'Evaluation needs real run records and real player feedback. With no evidence, it marks the item as needing a human call instead of quietly passing it.',
  },
  {
    title: 'It will not change things behind your back',
    detail:
      'Expensive or irreversible work is previewed and confirmed first, and every write is read back afterwards to prove it landed.',
  },
];

export type GuideStage = {
  id: string;
  step: string;
  title: string;
  tagline: string;
  where: string;
  youDo: string[];
  youGet: string;
  limits?: string;
  placeholder: string;
  lists?: { heading: string; items: string[] }[];
};

export const GUIDE_STAGES: GuideStage[] = [
  {
    id: 'stage-design',
    step: '01',
    title: 'Write the design',
    tagline: 'Everything downstream reads from what you write here, so start with words.',
    where: 'Web app, or an AI client',
    youDo: [
      'Create a folder for the game, then a collaborative Markdown document for the GDD.',
      'Write down the pillars, the core loop, and the one slice you want playable first.',
      'Keep the roadmap, slice specs, development status, and evaluation reports as documents in the same project.',
      'Read a document however you need it: full text, outline, a single heading, or a line range.',
      'Search across documents and tables by meaning or by keyword when you cannot remember where something was written.',
    ],
    youGet:
      'A single source of truth. Tables, art plans, slice specs, and evaluation reports all point back to these documents.',
    limits:
      'Concurrent edits are protected by a state token, so an AI client cannot silently overwrite a teammate. Deleting documents, deleting folders, and renaming folders are not part of the tool set today.',
    placeholder: 'Placeholder: writing a GDD document in the project',
  },
  {
    id: 'stage-data',
    step: '02',
    title: 'Turn the design into data',
    tagline: 'Prose is for humans. Tables are what the game actually reads.',
    where: 'Web app, or an AI client',
    youDo: [
      'Create tables with their fields and first rows: characters, enemies, items, levels, drop rules.',
      'Add, edit, reorder, or remove fields as the design changes; rename a table or move it to another folder.',
      'Create, update, batch update, batch upsert, or delete rows.',
      'Address data by stable ID, by exact row number, or by a stable matching field, never by guessing a name.',
      'Link tables to each other so a character points at its skills, a level at its enemies, an enemy at its drops.',
      'Read back a page of rows with only the fields you care about to confirm the data looks right.',
    ],
    youGet:
      'Linked, typed game data that Godot can read and that an evaluation can be traced back to.',
    limits:
      'Deleting something that other rows reference requires an explicit cleanup, so a reference is never broken silently.',
    lists: [
      {
        heading: 'Field types available',
        items: [
          'Text and text array',
          'Integer and integer array',
          'Float and float array',
          'Boolean',
          'Enum',
          'Date',
          'Cross-table reference',
          'Image',
        ],
      },
      {
        heading: 'Generating tables from a document',
        items: [
          'It reads the document, works out the entities and their relationships, and drafts a build plan.',
          'It checks for name clashes and field conflicts, then waits for your confirmation.',
          'It creates the tables in dependency order, fills the initial data, and reads everything back to verify.',
          'It only creates new tables. It will not overwrite, merge, or evolve tables you already have, and it does not handle local files, audio, or formulas.',
        ],
      },
    ],
    placeholder: 'Placeholder: a document turning into linked tables',
  },
  {
    id: 'stage-art',
    step: '03',
    title: 'Get the art ready',
    tagline: 'Bring in what you already drew, and generate what you are missing.',
    where: 'AI client',
    youDo: [
      'Import a single image or a whole local folder into an asset table.',
      'Let the import take inventory, check for duplicates, reuse or create the asset table, upload the original bytes, then read everything back to confirm.',
      'Generate pixel art with PixelLab when you need placeholder or final art you do not have yet.',
      'Plan map art up front: size, projection, transparency, style reference, and the target path inside your Godot project.',
    ],
    youGet:
      'Verified art registered in the project, with a record of what is still planned and what is ready to use.',
    limits:
      'Local import covers PNG, JPEG, GIF, WebP, and safe static SVG, up to 20 items per batch; audio, video, and generic attachments are not supported. If a batch partly fails, only the failed items are retried, so nothing uploads twice.',
    lists: [
      {
        heading: 'What PixelLab can do',
        items: [
          'Pixflux: generate a pixel character, object, or scene from a text description.',
          'Bitforge: generate new art that matches the style of a reference image.',
          'Inpaint: change part of a pixel image through a mask.',
          'Rotate: produce eight-direction views of a character or object.',
          'Skeleton Estimate: detect a character skeleton and pose keypoints.',
          'Text Animation: generate animation frames from a described motion.',
          'Skeleton Animation: generate animation from skeleton keyframes.',
          'Balance: check the remaining PixelLab credit on the account.',
        ],
      },
      {
        heading: 'Map art and Godot wiring',
        items: [
          'Assets are registered as planned first, and only flip to ready once they are generated and verified.',
          'Verified art can be wired into a TileSet, TileMap, or TileMapLayer, including atlas setup and terrain peering.',
          'Roads support straight, corner, T-junction, and endpoint rules; buildings are split into reusable floor, wall, door, and pillar pieces; map objects become Sprite2D, StaticBody2D, or Area2D nodes.',
          'Four asset classes are defined for maps — terrain tilesets, roads, building components, and map objects — but no dedicated tileset generator is exposed yet, so do not expect auto-tiling tilesets from a plain image.',
          'Collision, walkable areas, navigation, spawn points, triggers, and the map layout itself remain Godot work.',
        ],
      },
    ],
    placeholder: 'Placeholder: asset table with imported and generated art',
  },
  {
    id: 'stage-slice',
    step: '04',
    title: 'Build a playable slice',
    tagline: 'One slice at a time, each one small enough to prove it works.',
    where: 'AI client, with Godot',
    youDo: [
      'Find the source of the work: the GDD, playtest feedback, a document, or a table.',
      'Split the ideas into a slice roadmap ordered by dependency, so nothing is built before what it needs.',
      'For each slice, keep a spec, a plan, a status, an evaluation spec, a data plan, and an asset plan in the project.',
      'Reuse or evolve the tables, rows, art, and Godot resources you already have instead of starting over.',
      'Fix which files this round is allowed to touch before any code is written.',
      'Define the check that currently fails, make the smallest implementation that passes it, then verify again.',
      'Confirm the behaviour through structured run records, not by assuming the code is correct.',
    ],
    youGet:
      'A playable slice with a written trail: what was planned, what changed, what ran, and what proved it.',
    limits:
      'After three targeted repair rounds it stops and asks you to decide rather than churning. Godot itself offers 14 operations — read the version, list projects, read project info, launch the editor, create scenes, add nodes, load sprites, save scenes, start and stop the project, read debug output, export a MeshLibrary, read a UID, and update UIDs for Godot 4.4 and later. Runtime input injection, screenshots, arbitrary editor scripting, and general runtime state reads are not available.',
    placeholder: 'Placeholder: slice roadmap next to a running Godot scene',
  },
  {
    id: 'stage-evaluate',
    step: '05',
    title: 'Score it with EDD',
    tagline: 'A fixed standard, so "is it good yet" stops being an argument.',
    where: 'AI client',
    youDo: [
      'Pick the mode that matches where you are: a quick slice check, or a full Alpha, Beta, RC, or Release evaluation.',
      'For a milestone evaluation, line up 3 to 5 players from your target audience plus one observer who does not score.',
      'Play, record what happened, and let the evaluation turn that evidence into a score.',
      'Read the issue list, then hand the failures to the slice workflow.',
    ],
    youGet:
      'A score with its coverage and confidence, the player feedback behind it, a P0 to P3 issue list, a stage verdict, and the exact scope to re-test.',
    limits:
      'Evaluation never edits the game. A quick slice check only re-examines the affected metrics and their neighbouring regressions rather than regenerating a full score.',
    lists: [
      {
        heading: 'How the score is built',
        items: [
          '80 points from fixed general metrics: gameplay, rule clarity, controls, pacing, systems, audio and visuals, stability, accessibility and safety.',
          '20 points from a genre or GDD-specific template: action, RPG, simulation and management, puzzle, visual novel, strategy, or platformer.',
          'Stage gates: Alpha 60, Beta 70, RC 80, Release 85, each with its own coverage and risk limits.',
        ],
      },
    ],
    placeholder: 'Placeholder: evaluation report with score and issue list',
  },
  {
    id: 'stage-iterate',
    step: '06',
    title: 'Fix and re-check',
    tagline: 'The loop closes here, and the next slice starts better informed.',
    where: 'AI client',
    youDo: [
      'Take the P0 and P1 issues from the evaluation and turn them into the next slice of work.',
      'Repair against the same failing checks you were given, and keep the file scope tight.',
      'Re-test only the scope the evaluation asked for instead of replaying everything.',
      'Update the roadmap and status in the project, then move on to the next slice.',
    ],
    youGet:
      'A shorter loop each round: the design, the data, and the evidence all sit in one project, so the next slice does not start from zero.',
    placeholder: 'Placeholder: before and after scores across two rounds',
  },
];

export const SAFETY_RULES: string[] = [
  'Before writing, you are shown the goal, the source, the scope, what will count as success, and the next step.',
  'When something is genuinely ambiguous, you get exactly one question rather than a guess.',
  'Expensive or lasting operations are previewed and confirmed before they run.',
  'After every write, the data is read back to verify it. A successful API response alone is never treated as proof.',
  'If a run is interrupted, IDs, versions, hashes, and checkpoints are kept so it can resume from the step that failed.',
  'Passwords, tokens, and signed upload URLs are never requested or displayed in chat.',
  'When run evidence or player evidence cannot be obtained, the item is marked as needing a human decision instead of being assumed to pass.',
];

export type FaqItem = {
  question: string;
  answer: string;
};

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Do I have to start with a design document?',
    answer:
      'It is the smoothest path, because table generation, slice planning, and evaluation all read from it. If your design already lives in tables, you can start at stage two and write the document later.',
  },
  {
    question: 'Can it work on several projects at once?',
    answer:
      'No. The tools operate inside the project you have selected. Creating projects and listing across projects are not part of the tool set, which is what keeps writes from landing in the wrong place.',
  },
  {
    question: 'Will generating tables from a document overwrite my existing tables?',
    answer:
      'No. It only creates new tables. Evolving a table you already have is deliberate work you do through the slice workflow or by hand.',
  },
  {
    question: 'Can I get an auto-tiling tileset out of PixelLab today?',
    answer:
      'Not yet. Map art is planned as four asset classes, but no dedicated tileset generator is exposed in this environment, so a plain generated image should not be presented as a ready tileset.',
  },
  {
    question: 'Who decides whether a slice passes?',
    answer:
      'The score comes from the fixed standard, but it needs real run records and real players. Without that evidence the result is flagged for a human decision.',
  },
];

export type GlossaryItem = {
  term: string;
  meaning: string;
};

export const GLOSSARY_ITEMS: GlossaryItem[] = [
  { term: 'Project', meaning: 'The workspace for one game. Every document, table, asset, plan, and report lives inside it.' },
  { term: 'Document', meaning: 'Collaborative Markdown. GDDs, roadmaps, slice specs, status, and reports are all documents.' },
  { term: 'Table', meaning: 'Structured game data. One row per thing, typed fields, and references between tables.' },
  { term: 'Story graph', meaning: 'The branch structure generated from a script document, readable and checkable.' },
  { term: 'Slice', meaning: 'The smallest playable piece of the game that can be built and verified on its own.' },
  { term: 'EDD', meaning: 'Evaluation-driven development: score the build against a fixed standard, then fix what failed.' },
  { term: 'MCP', meaning: 'The connection that lets an AI client read and write your Keco project data.' },
];
