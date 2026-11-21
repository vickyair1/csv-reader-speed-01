# csv-reader-speed-01

[![competition](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121) [![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/vickyair1/csv-reader-speed-01/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121) [![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/vickyair1/csv-reader-speed-01/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0, for the [csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ($100 over 10 places, deadline 23 Nov 2026 09:42 WIB). It answers exactly as csv-reader 1.0.0 does on every case — including every broken-CSV edge case — at a fraction of its CPU time.

## How it is faster

csv-reader 1.0.0 reads one character at a time and builds each field a character at a time. This drop-in instead:

- scans fields with bulk `indexOf` calls (comma and line end) and takes each field as one `slice()` of the input text, instead of concatenating characters;
- looks the line end up once per record, not once per field — the next LF is the same for every field of a record;
- tracks the first CR at/after the cursor with a lazy forward pointer, so a stray-CR check never scans past the current field;
- keeps the hot field readers in one function so a cold process (each harness round is one) pays a single compile;
- warms the just-in-time compiler in `main.ts` with two small synthetic inputs that exercise every code path (BOM, CRLF/LF, quoted fields with commas, doubled quotes and embedded line breaks, quote junk, stray CRs, blank lines, short/long rows, a line of only stray CRs, an unterminated quote, a last line with no trailing newline) before the real cases, so the first cases do not pay for re-optimizing as each new path appears.

## Local benchmark (practice set, 6 cases, ~10.2 MB of CSV)

Fresh process per run, trimmed mean over 11 runs (drop 2 fastest + 2 slowest, the harness's rule):

| entry | CPU, whole program |
| --- | --- |
| csv-reader 1.0.0 (house baseline) | ~1,719,000 µs |
| this entry (no warm-up) | ~1,091,000 µs |
| **this entry** | **~879,000 µs** |

`run()` alone, cold process: baseline ~1,120,000 µs, this entry ~210,000–230,000 µs after warm-up (~90,000 µs fully warm). Correct on all 6 practice cases (verified against the kit's `practice/reference/expected.json` with the scorer's own comparison, and against csv-reader 1.0.0 on generated edge-case inputs).

## Files

- `solve.js` — the drop-in. `run(input)` returns csv-reader 1.0.0's answer for `{text, header}`: `{columns, rows, errors}`.
- `main.ts` — the driver the harness runs: warms up, reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.
- `package.json` — `{"type": "module"}`.

## License

MIT — see [LICENSE](LICENSE).
