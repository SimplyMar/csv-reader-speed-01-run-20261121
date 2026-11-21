import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';

// V8 flags set before solve.js is imported:
// - --no-incremental-marking: matches the baseline driver's GC tuning
// - --no-turbofan: avoids heavy background TurboFan JIT CPU on short-lived ~200ms runs while keeping Maglev fast
setFlagsFromString('--no-incremental-marking --no-turbofan');

const { runCasesBuffer } = (await import(new URL('./solve.js', import.meta.url).href)) as {
  run: (input: unknown) => unknown;
  runCasesBuffer: (buf: Buffer) => Buffer;
};

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const casesBuf = readFileSync(join(INPUT_DIR, 'cases.json'));
const outBuf = runCasesBuffer(casesBuf);
writeFileSync(join(OUTPUT_DIR, 'answers.json'), outBuf);
