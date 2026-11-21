import { readFileSync, writeFileSync } from 'node:fs';
import { setFlagsFromString } from 'node:v8';

setFlagsFromString('--no-incremental-marking --no-concurrent-recompilation');

const { runCasesBuffer } = await import('./solve.js');

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const casesBuf = readFileSync(`${INPUT_DIR}/cases.json`);
const outBuf = runCasesBuffer(casesBuf);
writeFileSync(`${OUTPUT_DIR}/answers.json`, outBuf);
