#!/usr/bin/env node
// Fixed consumer for the manually approved diagnostics workflow. No runner imports.
import { constants, closeSync, fstatSync, mkdirSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

export const FAILURE = 'Diagnostics unavailable.';
export const MAX_BYTES = 1024 * 1024;
const REPO = 'dinkuskit/live-journeys';
const ACCOUNT = '4e8679e964d3d1808d6226b7150b13c0';
const BUCKET = 'dinkus-e2e-proof';
const LINK_STEP = "The product's links open its page";
const NAMES = Object.freeze([
  'Update the store', 'Install the Registry plugins', 'DinkusKit.com account and connect the store',
  'Payments status', 'Commerce settings', 'Ship settings', 'Buy and ship', 'Storefront', 'Cart',
  'Manage products', 'Full catalog', 'Mark as completed', 'Problems', 'Buy a label in the store admin',
  'One product with a category', 'An agent manages a product', 'Free shipping over an amount', 'Test run',
]);
// The private timing fact each journey's wrapper keeps, "<journey> timing" (support/steps.mjs; README
// "Private timing"), read only in the producer's exact shape. The runner retries a journey at most once,
// so the producer writes at most two tries; eight is a generous bound, not a promise of more.
const MAX_TRIES = 8;
const TRY_KEYS = Object.freeze(['try', 'body', 'verdict', 'body_ms', 'pace_sleeps', 'pace_sleep_requested_ms', 'pace_sleep_ms', 'pace_sleep_wall_ms']);
const TRY_COUNTS = Object.freeze(['body_ms', 'pace_sleeps', 'pace_sleep_requested_ms', 'pace_sleep_ms', 'pace_sleep_wall_ms']);
const BODIES = Object.freeze(['returned', 'threw']);
const TRY_VERDICTS = Object.freeze(['PASS', 'FAIL', 'INCOMPLETE']);
const fail = () => { throw new Error(FAILURE); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key));
const exact = (value, names) => keys(value, names) && names.every(name => Object.hasOwn(value, name));
const count = value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0);

export function selection(run, attempt) {
  if (typeof run !== 'string' || !/^[1-9][0-9]{0,14}$/.test(run)
      || typeof attempt !== 'string' || !/^[1-9][0-9]{0,3}$/.test(attempt)) fail();
  return { run, attempt, key: `runs/github-${run}-${attempt}/report.json` };
}

// Bounded reads also refuse symlinks and non-regular files. No path comes from the dispatch inputs.
export function readBounded(file, limit = MAX_BYTES) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) fail();
    const buffer = Buffer.alloc(limit + 1);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    if (length > limit) fail();
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally { closeSync(fd); }
}

export function verifyMetadata(meta, selected) {
  if (!object(meta) || meta.repository?.full_name !== REPO || meta.id !== Number(selected.run)
      || meta.run_attempt !== Number(selected.attempt) || meta.status !== 'completed'
      || meta.path !== '.github/workflows/live-journeys.yml') fail();
}

export async function verifyRun(selected, token, request = fetch) {
  selected = selection(selected.run, selected.attempt);
  if (!token) fail();
  const response = await request(`https://api.github.com/repos/${REPO}/actions/runs/${selected.run}/attempts/${selected.attempt}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) fail();
  // Stream with a cap instead of trusting Content-Length or buffering an unlimited response.
  let size = 0;
  const parts = [];
  for await (const part of response.body) {
    size += part.length;
    if (size > MAX_BYTES) fail();
    parts.push(part);
  }
  verifyMetadata(JSON.parse(Buffer.concat(parts).toString('utf8')), selected);
}

export function download(selected, folder, env, execute = spawnSync) {
  selected = selection(selected.run, selected.attempt);
  if (env.R2_ACCOUNT_ID !== ACCOUNT || env.R2_BUCKET !== BUCKET
      || !env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) fail();
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const home = join(folder, 'aws-home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = join(folder, 'report.json');
  rmSync(file, { force: true });
  writeFileSync(file, '', { mode: 0o600, flag: 'wx' });
  // Explicit allowlist: no ambient profiles, session token, endpoints, proxies, bootstrap or GitHub token.
  const result = execute('/usr/local/bin/aws', [
    's3api', 'get-object', '--bucket', BUCKET, '--key', selected.key,
    '--range', `bytes=0-${MAX_BYTES}`, '--endpoint-url', `https://${ACCOUNT}.r2.cloudflarestorage.com`,
    '--region', 'auto', '--no-cli-pager', '--cli-connect-timeout', '10', '--cli-read-timeout', '30', file,
  ], {
    env: { HOME: home, PATH: '/usr/local/bin:/usr/bin:/bin', AWS_ACCESS_KEY_ID: env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: env.AWS_SECRET_ACCESS_KEY, AWS_EC2_METADATA_DISABLED: 'true',
      AWS_CONFIG_FILE: '/dev/null', AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
      AWS_REQUEST_CHECKSUM_CALCULATION: 'when_required', AWS_RESPONSE_CHECKSUM_VALIDATION: 'when_required' },
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 45_000, maxBuffer: 64 * 1024,
  });
  // Discard AWS output on success AND failure; it can contain private keys/paths or response bodies.
  if (result.error || result.status !== 0) { rmSync(file, { force: true }); fail(); }
}

function category(detail) {
  // Only the linkProblems grammar, never broad searches in arbitrary error/page text.
  const where = '(?:the Shop list|the category page /[^\\s;]{1,2048})';
  const path = '/[^\\s;]{1,2048}';
  const patterns = [
    ['missing_card_or_link', `${where} (?:doesn't list it|lists it without a link to ${path})`],
    ['navigation_missing', `pressing it on ${where} didn't open ${path}`],
    ['non_200', `pressing it on ${where} opened ${path}, which answered HTTP (?!200)[1-5][0-9]{2}`],
    ['heading_mismatch', `pressing it on ${where} opened a page headed "[^"\\r\\n]{0,4096}" instead of "[^"\\r\\n]{0,4096}"`],
  ];
  return patterns.find(([, pattern]) => new RegExp(`^${pattern}$`).test(detail))?.[0] ?? 'unknown';
}

// One journey's timing fact, projected try by try as the producer wrote it: whole-millisecond counts and
// durations, each try kept apart, nothing summed, rated or attributed. Any departure from the exact
// shape fails the whole projection; a fact that isn't there stays missing, never a zero.
function timing(fact) {
  if (!exact(fact, ['unit', 'tries']) || fact.unit !== 'ms' || !Array.isArray(fact.tries)
      || !fact.tries.length || fact.tries.length > MAX_TRIES) fail();
  const tries = fact.tries.map(entry => {
    if (!exact(entry, TRY_KEYS) || !Number.isSafeInteger(entry.try) || entry.try < 1
        || !BODIES.includes(entry.body) || !TRY_VERDICTS.includes(entry.verdict)
        || !TRY_COUNTS.every(key => count(entry[key]))) fail();
    return { try: entry.try, body: entry.body, verdict: entry.verdict, body_ms: entry.body_ms, pace_sleeps: entry.pace_sleeps,
      pace_sleep_requested_ms: entry.pace_sleep_requested_ms, pace_sleep_ms: entry.pace_sleep_ms, pace_sleep_wall_ms: entry.pace_sleep_wall_ms };
  });
  if (new Set(tries.map(entry => entry.try)).size !== tries.length) fail();
  return { unit: 'ms', tries };
}

export function analyze(report, selected) {
  if (!keys(report, ['run', 'mode', 'store', 'ship', 'verdict', 'journeys', 'facts', 'steps'])
      || report.run !== `github-${selected.run}-${selected.attempt}`
      || !['PASS', 'FAIL', 'INCOMPLETE'].includes(report.verdict)
      || !Array.isArray(report.journeys) || !report.journeys.length || report.journeys.length > NAMES.length
      || !Array.isArray(report.steps) || report.steps.length > 10000 || !object(report.facts)
      || !['mode', 'store', 'ship'].every(key => typeof report[key] === 'string')) fail();
  const names = report.journeys.map(entry => {
    if (!keys(entry, ['name', 'verdict']) || !NAMES.includes(entry.name)
        || !['PASS', 'FAIL', 'FLAKY', 'INCOMPLETE'].includes(entry.verdict)) fail();
    return entry.name;
  });
  if (new Set(names).size !== names.length) fail();
  for (const step of report.steps) {
    if (!keys(step, ['journey', 'step', 'status', 'detail', 'at', 'retried']) || !names.includes(step.journey)
        || typeof step.step !== 'string' || typeof step.detail !== 'string' || typeof step.at !== 'string'
        || !['PASS', 'FAIL', 'SKIP'].includes(step.status)
        || ('retried' in step && typeof step.retried !== 'boolean')) fail();
  }
  // Emit fresh literals in canonical order, never spread/interpolate a private object or name.
  return NAMES.filter(name => names.includes(name)).map(name => {
    const steps = report.steps.filter(step => step.journey === name);
    const counts = { missing_card_or_link: 0, navigation_missing: 0, non_200: 0, heading_mismatch: 0, unknown: 0 };
    for (const step of steps) {
      if (name !== 'Manage products' || step.step !== LINK_STEP || step.status !== 'FAIL') continue;
      const details = step.detail.endsWith('.') ? step.detail.slice(0, -1).split('; ') : [];
      if (!details.length || details.length > 2) counts.unknown++;
      else for (const detail of details) counts[category(detail)]++;
    }
    const projection = { journey: name, step_count: steps.length, failed_step_count: steps.filter(step => step.status === 'FAIL').length, link_problems: counts };
    // Only the journey's own timing fact is read; every other fact is left alone. Without one, the
    // projection keeps its earlier shape exactly.
    const key = `${name} timing`;
    if (Object.hasOwn(report.facts, key)) projection.timing = timing(report.facts[key]);
    return projection;
  });
}

export async function main(args, env = process.env) {
  try {
    if (args.length !== 3 || !['verify', 'fetch', 'analyze', 'clean'].includes(args[0])) fail();
    const [mode, run, attempt] = args;
    const selected = selection(run, attempt);
    if (!env.RUNNER_TEMP) fail();
    const folder = join(env.RUNNER_TEMP, 'report-diagnostics');
    const receipt = join(folder, 'verified.json');
    if (mode === 'clean') { rmSync(folder, { recursive: true, force: true }); return 0; }
    if (mode === 'verify') {
      rmSync(folder, { recursive: true, force: true });
      await verifyRun(selected, env.GH_TOKEN);
      mkdirSync(folder, { mode: 0o700 });
      writeFileSync(receipt, JSON.stringify(selected), { mode: 0o600 });
    } else {
      const verified = readBounded(receipt, 1024);
      if (JSON.stringify(verified) !== JSON.stringify(selected)) fail();
      if (mode === 'fetch') download(selected, folder, env);
      else {
        if (Object.keys(env).some(key => /^(AWS_|R2_|OP_|GH_TOKEN$|GITHUB_TOKEN$)/.test(key))) fail();
        const output = analyze(readBounded(join(folder, 'report.json')), selected);
        console.log(JSON.stringify(output));
      }
    }
    return 0;
  } catch { console.error(FAILURE); return 1; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
