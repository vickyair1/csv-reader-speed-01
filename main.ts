// csv-reader-speed-01 entry: the harness runs `node /bot/main.ts` (node22). It reads every case from /input/cases.json
// (a JSON array of {id, input}), answers each one alone with run() from solve.js, and writes /output/answers.json: a JSON
// array of the answers, one per case and in the cases' order. Outside a container MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output.
//
// The warm-up below runs solve.js's run() on two small synthetic inputs that exercise every code path (BOM, header,
// CRLF and LF, quoted fields with commas/doubled quotes/embedded line breaks, quote junk, stray CRs, blank lines,
// short and long rows, a line of only stray CRs, an unterminated quote, a last line with no trailing newline) before
// the real cases. Each harness round is a fresh process, so the just-in-time compiler would otherwise spend the first
// cases re-optimizing as each new path appears; warming the paths up first lets the real cases run on optimized code.
// run() is pure — the warm-up answers are discarded and no state carries into the cases.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8's incremental marking off, set before solve.js is imported so all of its work runs under it (the rules: the house
// baseline runs with --no-incremental-marking, and an entry may tune V8's flags too).
setFlagsFromString('--no-incremental-marking');

/** solve.js, imported by its URL (a .js module carries no types) and typed by its contract. */
const { run } = (await import(new URL('./solve.js', import.meta.url).href)) as { run: (input: unknown) => unknown };

const WARM_TEXT =
  '\uFEFFa,b,c\r\n' +
  '1,"x,y",3\n' +
  '"a""b",,5\r\n' +
  '"multi\nline",7,8\n' +
  '"cr\rinside",9,10\n' +
  '"junk"kg,11,12\n' +
  'stray\rcr,13,14\n' +
  '\n' +
  '15,16\n' +
  '17,18,19,20\n' +
  '\r\r\n' +
  '"unterminated,21,22\n' +
  '23,24,25';
const WARM = { text: WARM_TEXT, header: true };
const WARM2 = { text: 'p,q\n"a\nb",2\r\n3,4', header: false };
for (let i = 0; i < 50; i++) {
  run(WARM);
  run(WARM2);
}

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(INPUT_DIR, 'cases.json'), 'utf8')) as { id: string; input: unknown }[];
const answers: unknown[] = [];
for (const c of cases) answers.push(run(c.input));
writeFileSync(join(OUTPUT_DIR, 'answers.json'), JSON.stringify(answers));
