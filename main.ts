// Token Radar — the runnable token-radar-01 entry (Node 22.18+, standard library only).
// Entry: reads the sealed snapshot and writes the board, data and dossier.
//
// Pipeline: read the sealed snapshot (/input/snapshot.json, or --input <file|dir>) → score every
// pre-token protocol with lib/model.ts → write board.json and data.js → copy dashboard/ and
// screenshots/ → write dossier.json with the vendored make.fun library. The dashboard is a static
// page (dashboard/index.html, app.css, app.js) that reads data.js; it never touches the network.
//
// Exit codes: 0 wrote everything, 1 the model or screenshots broke the gate's shape, 2 no usable input.
//
// The repository holds no snapshot of its own: the grader mounts the sealed one at /input, and a
// local run names it with --input. From this directory:
//   $env:MAKEFUN_OUTPUT_DIR='..\..\work\out'; node main.ts --input ..\..\work\snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));
const SEALED_INPUT_DIR = '/input';
const DEFAULT_OUTPUT = '/output';

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
} as const;

/** A hand-in needs the board, a detail view and a filtered view: fewer is a shape the gate refuses. */
const MIN_SCREENSHOTS = 3;

/** A copied image keeps a name a scorer can resolve on every filesystem. */
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const EXIT_SHAPE = 1;
const EXIT_INPUT = 2;

type ExitCode = typeof EXIT_SHAPE | typeof EXIT_INPUT;

/** Stop on one line of plain reason, so a failed run says why without a stack trace. */
function fail(code: ExitCode, reason: string): never {
  process.stderr.write(`token radar: ${reason}\n`);
  process.exit(code);
}

/** The names a flag may be written under: one spelling, or that spelling plus its alias. */
function flagNames(name: string, alias?: string): string[] {
  const spelled = `--${name}`;
  return alias === undefined ? [spelled] : [spelled, `--${alias}`];
}

/** The value after `--name` at `argv[start]`, null when this token is not that flag. */
function flagValue(argv: readonly string[], start: number, flag: string): string | null {
  const token = argv[start];
  if (token === undefined) return null;
  if (token === flag) {
    const next = argv[start + 1];
    if (next === undefined || next === '' || next.startsWith('--')) return null;
    return next;
  }
  const prefix = `${flag}=`;
  return token.startsWith(prefix) ? token.slice(prefix.length) : null;
}

/**
 * The value a flag names, whether written `--name value` or `--name=value`. A repeat wins with the
 * later one, as a shell would; an empty `--name=` counts as given and empty.
 */
function arg(argv: readonly string[], name: string, fallback: string, alias?: string): string {
  const flags = flagNames(name, alias);
  let value = fallback;
  for (let at = 0; at < argv.length; at += 1) {
    for (const flag of flags) {
      const found = flagValue(argv, at, flag);
      if (found !== null) value = found;
    }
  }
  return value;
}

/** The snapshot file a --input value names: the file itself, or `snapshot.json` inside a directory. */
function snapshotPath(input: string): string {
  return input.endsWith('.json') ? input : join(input, 'snapshot.json');
}

/** Parse the snapshot at `path`, or stop with exit 2 and a reason a reader can act on. */
function loadSnapshot(path: string): Snapshot {
  if (!existsSync(path)) {
    fail(EXIT_INPUT, `no snapshot at ${path}: pass --input <snapshot.json|directory> or mount the sealed ${SEALED_INPUT_DIR}`);
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return fail(EXIT_INPUT, `${path} cannot be read: ${why}`);
  }
  try {
    return parseSnapshot(text);
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return fail(EXIT_INPUT, `${path} is not a usable snapshot: ${why}`);
  }
}

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** Refuse to hand in a set of images the gate would score as zero. */
function checkShots(shots: readonly string[]): void {
  if (shots.length < MIN_SCREENSHOTS) {
    const count = `${shots.length} image${shots.length === 1 ? '' : 's'}`;
    fail(EXIT_SHAPE, `screenshots/ holds ${count}: hand in ${MIN_SCREENSHOTS}, the board, a detail view and a filtered view`);
  }
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) fail(EXIT_SHAPE, `screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

const argv = process.argv;
const inputFile = snapshotPath(arg(argv, 'input', SEALED_INPUT_DIR));
const out = arg(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? DEFAULT_OUTPUT, 'out');

const snapshot = loadSnapshot(inputFile);
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(EXIT_SHAPE, `the model wrote a board the gate refuses: ${issue}`);

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const dashboardFiles = copyFiles(join(REPO_ROOT, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(REPO_ROOT, 'screenshots'), join(out, 'screenshots'));
checkShots(shots);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
