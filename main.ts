import { mkdirSync, readFileSync, copyFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseSnapshot, buildRadar, boardIssue, dataScript, SnapshotError } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function argValue(args: string[], flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
}

function isDirectory(p: string): boolean {
  try {
    return require('node:fs').statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function resolveInput(input: string): string {
  if (isDirectory(input)) {
    return join(input, 'snapshot.json');
  }
  return input;
}

function copyDir(src: string, dest: string): void {
  if (!existsSync(src)) return;
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name.startsWith('.')) continue;
    copyFileSync(join(src, name), join(dest, name));
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const inputRaw = argValue(args, '--input', '/input');
  const outputRaw = argValue(args, '--output', process.env.MAKEFUN_OUTPUT_DIR || '/output');
  const inputFile = resolveInput(inputRaw);

  if (!existsSync(inputFile)) {
    console.error(`input snapshot not found: ${inputFile}`);
    process.exit(2);
  }

  let snapshot;
  try {
    snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
  } catch (err) {
    console.error(`failed to parse snapshot: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }

  const { board, radar } = buildRadar(snapshot);
  const issue = boardIssue(board, snapshot);
  if (issue) {
    console.error(`board issue: ${issue}`);
    process.exit(1);
  }

  const out = outputRaw.startsWith('/') ? outputRaw : join(process.cwd(), outputRaw);
  mkdirSync(out, { recursive: true });

  writeFileSync(join(out, 'board.json'), JSON.stringify({ rows: board }) + '\n');
  writeFileSync(join(out, 'data.js'), dataScript(radar));

  const screenshots = existsSync('screenshots') ? readdirSync('screenshots') : [];
  const images = screenshots.filter((n) => !n.startsWith('.') && /\.(png|jpe?g)$/i.test(n));
  if (images.length < 3) {
    console.error('need 3 screenshots: board, detail, filtered');
    process.exit(1);
  }
  for (const n of images) {
    if (!NAME_RE.test(n)) {
      console.error(`invalid screenshot name: ${n}`);
      process.exit(1);
    }
  }

  mkdirSync(join(out, 'screenshots'), { recursive: true });
  for (const n of images) {
    copyFileSync(join('screenshots', n), join(out, 'screenshots', n));
  }

  copyDir('dashboard', join(out, 'dashboard'));

  const dossier = buildDossier(out, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  writeFileSync(join(out, 'dossier.json'), dossier);

  console.log(
    `protocols ${snapshot.protocols.length} watchlist ${snapshot.watchlist.length} board ${board.length} early ${radar.counts.early} live ${radar.counts.live} set_aside ${radar.counts.set_aside}`
  );
}

main();