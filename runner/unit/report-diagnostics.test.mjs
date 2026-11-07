import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { analyze, download, FAILURE, main, MAX_BYTES, readBounded, selection, verifyMetadata, verifyRun } from '../scripts/report-diagnostics.mjs';

const selected = selection('42337050608', '1');
const poison = 'PRIVATE_CANARY user@example.invalid https://private.invalid/path?token=SECRET Authorization: Bearer SECRET Cookie: session=SECRET order=987654';
const step = (detail, extra = {}) => ({ journey: 'Manage products', step: "The product's links open its page", status: 'FAIL', detail, at: poison, ...extra });
const report = (detail = poison) => ({
  run: 'github-42337050608-1', mode: poison, store: poison, ship: poison, verdict: 'FAIL',
  journeys: [{ name: 'Manage products', verdict: 'FAIL' }], facts: { [poison]: poison }, steps: [step(detail)],
});
const metadata = () => ({ repository: { full_name: 'dinkuskit/live-journeys' }, id: 42337050608, run_attempt: 1, status: 'completed', path: '.github/workflows/live-journeys.yml' });
function temporary(body) {
  const root = mkdtempSync(join(tmpdir(), 'diagnostics-unit-'));
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    const result = body(root);
    if (result?.finally) return result.finally(cleanup);
    cleanup();
    return result;
  } catch (error) { cleanup(); throw error; }
}
// Exercise the same CLI boundary in-process: this worker's sandbox refuses child spawning.
async function cli(root, args, extra = {}) {
  const stdout = [], stderr = [];
  const original = { log: console.log, error: console.error };
  console.log = value => stdout.push(`${value}\n`);
  console.error = value => stderr.push(`${value}\n`);
  try {
    const status = await main(args, { HOME: root, RUNNER_TEMP: root, DINKUS_E2E_ENV_FILE: '/dev/null',
      DINKUS_E2E_PROOF: join(root, 'proof'), DINKUS_E2E_PROFILE: join(root, 'profile'), ...extra });
    return { status, stdout: stdout.join(''), stderr: stderr.join('') };
  } finally { Object.assign(console, original); }
}
function prepare(root, content) {
  const folder = join(root, 'report-diagnostics');
  mkdirSync(folder);
  writeFileSync(join(folder, 'verified.json'), JSON.stringify(selected));
  writeFileSync(join(folder, 'report.json'), content);
  return folder;
}
const assertFailure = result => {
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `${FAILURE}\n`);
};

test('selectors are bounded canonical decimal; no path, URL, flags or extra argument reaches transport', async () => {
  assert.deepEqual(selected, { run: '42337050608', attempt: '1', key: 'runs/github-42337050608-1/report.json' });
  for (const bad of ['', '0', '-1', '+1', '01', '1.0', '1e3', ' 1', '1\n', '../x', 'https://x', '--bucket=x', '1;echo SECRET', '９', '9'.repeat(16)]) {
    assert.throws(() => selection(bad, '1'));
    await temporary(async root => assertFailure(await cli(root, ['fetch', bad, '1'])));
  }
  for (const bad of ['0', '-1', '01', '1.1', '10000', '../1']) assert.throws(() => selection('1', bad));
  await temporary(async root => assertFailure(await cli(root, ['fetch', '1', '1', poison])));
});

test('metadata binds exact repo, workflow, completed run and attempt', async () => {
  verifyMetadata(metadata(), selected);
  for (const patch of [{ repository: { full_name: 'attacker/repo' } }, { id: 1 }, { id: '42337050608' }, { run_attempt: 2 }, { status: 'in_progress' }, { path: '.github/workflows/tests.yml' }]) {
    assert.throws(() => verifyMetadata({ ...metadata(), ...patch }, selected));
  }
  let seen;
  await verifyRun(selected, 'synthetic-test-token', async (url, options) => {
    seen = { url, options };
    return new Response(JSON.stringify(metadata()));
  });
  assert.equal(seen.url, 'https://api.github.com/repos/dinkuskit/live-journeys/actions/runs/42337050608/attempts/1');
  assert.equal(seen.options.redirect, 'error');
  for (const response of [new Response(poison, { status: 403 }), new Response(poison), new Response('x'.repeat(MAX_BYTES + 1))]) {
    await assert.rejects(verifyRun(selected, 'synthetic-test-token', async () => response));
  }
});

test('only fixed codes are derived from linkProblems grammar, including combined failures', () => {
  const cases = [
    ["the Shop list doesn't list it.", 'missing_card_or_link'],
    ['the category page /private-category lists it without a link to /private-product.', 'missing_card_or_link'],
    ["pressing it on the Shop list didn't open /private-product.", 'navigation_missing'],
    ['pressing it on the category page /private-category opened /private-product, which answered HTTP 503.', 'non_200'],
    [`pressing it on the Shop list opened a page headed "${poison}" instead of "${poison}".`, 'heading_mismatch'],
    [poison, 'unknown'],
    ['prefix pressing it on the Shop list opened /x, which answered HTTP 404.', 'unknown'],
    ['pressing it on the Shop list opened /x, which answered HTTP 200.', 'unknown'],
  ];
  for (const [detail, code] of cases) {
    const output = analyze(report(detail), selected);
    assert.equal(output[0].link_problems[code], 1);
    assert.equal(Object.values(output[0].link_problems).reduce((a, b) => a + b), 1);
    assert.doesNotMatch(JSON.stringify(output), /PRIVATE|SECRET|example|private-|https:|987654/);
  }
  const both = analyze(report("the Shop list doesn't list it; pressing it on the category page /c didn't open /p."), selected)[0];
  assert.equal(both.link_problems.missing_card_or_link, 1);
  assert.equal(both.link_problems.navigation_missing, 1);
});

test('private data in every unused field and arbitrary step names never escapes stdout/stderr', () => temporary(async root => {
  const fixture = report();
  fixture.steps.push(step(poison, { step: poison, status: 'PASS' }));
  prepare(root, JSON.stringify(fixture));
  const result = await cli(root, ['analyze', selected.run, selected.attempt]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), [{ journey: 'Manage products', step_count: 2, failed_step_count: 1,
    link_problems: { missing_card_or_link: 0, navigation_missing: 0, non_200: 0, heading_mismatch: 0, unknown: 1 } }]);
}));

test('malformed, oversized, unknown schema/journey and identity mismatch fail with fixed output only', async () => {
  const changed = modify => { const value = report(); modify(value); return JSON.stringify(value); };
  const inputs = [poison, 'null', '[]', '{}', 'x'.repeat(MAX_BYTES + 1),
    changed(r => { r.extra = poison; }), changed(r => { r.run = poison; }),
    changed(r => { r.journeys[0].name = `Manage products${poison}`; }),
    changed(r => { r.steps[0].journey = poison; }), changed(r => { r.steps[0].status = poison; }),
    changed(r => { r.steps[0].detail = { secret: poison }; }), changed(r => { r.steps[0].retried = poison; }),
    changed(r => { r.steps = Array(10001).fill(step(poison)); }),
    changed(r => { r.journeys.push(r.journeys[0]); }), changed(r => { r.verdict = poison; }),
  ];
  for (const value of inputs) await temporary(async root => {
    prepare(root, value);
    assertFailure(await cli(root, ['analyze', selected.run, selected.attempt]));
  });
  await temporary(async root => assertFailure(await cli(root, ['analyze', selected.run, selected.attempt])));
  await temporary(async root => {
    const folder = prepare(root, JSON.stringify(report()));
    rmSync(join(folder, 'report.json'));
    symlinkSync(join(folder, 'verified.json'), join(folder, 'report.json'));
    assert.throws(() => readBounded(join(folder, 'report.json')));
    assertFailure(await cli(root, ['analyze', selected.run, selected.attempt]));
  });
});

test('analyzer refuses inherited credentials; fetch cannot run without a matching verification receipt', () => temporary(async root => {
  prepare(root, JSON.stringify(report()));
  for (const key of ['AWS_ACCESS_KEY_ID', 'R2_BUCKET', 'GH_TOKEN', 'GITHUB_TOKEN', 'OP_SERVICE_ACCOUNT_TOKEN']) {
    assertFailure(await cli(root, ['analyze', selected.run, selected.attempt], { [key]: poison }));
  }
  assertFailure(await cli(root, ['fetch', '1', '1']));
}));

test('AWS invocation is fixed, bounded, isolated and never propagates success or failure output', async t => {
  const env = { R2_ACCOUNT_ID: '4e8679e964d3d1808d6226b7150b13c0', R2_BUCKET: 'dinkus-e2e-proof',
    AWS_ACCESS_KEY_ID: 'synthetic-key', AWS_SECRET_ACCESS_KEY: 'synthetic-secret',
    AWS_SESSION_TOKEN: poison, OP_SERVICE_ACCOUNT_TOKEN: poison, GH_TOKEN: poison, AWS_ENDPOINT_URL: poison, HTTPS_PROXY: poison };
  temporary(root => {
    let calls = 0;
    const fake = (file, args, options) => {
      calls++;
      assert.equal(file, '/usr/local/bin/aws');
      assert.deepEqual(args.slice(0, 8), ['s3api', 'get-object', '--bucket', 'dinkus-e2e-proof', '--key', selected.key, '--range', `bytes=0-${MAX_BYTES}`]);
      assert.ok(args.includes('https://4e8679e964d3d1808d6226b7150b13c0.r2.cloudflarestorage.com'));
      assert.equal(args.at(-1), join(root, 'report.json'));
      assert.deepEqual(Object.keys(options.env).sort(), ['HOME', 'PATH', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_EC2_METADATA_DISABLED', 'AWS_CONFIG_FILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_REQUEST_CHECKSUM_CALCULATION', 'AWS_RESPONSE_CHECKSUM_VALIDATION'].sort());
      assert.equal(options.env.AWS_CONFIG_FILE, '/dev/null');
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
      assert.equal(options.timeout, 45000);
      return { status: 0, stdout: poison, stderr: poison };
    };
    download(selected, root, env, fake);
    assert.equal(calls, 1);
    for (const patch of [{ R2_BUCKET: poison }, { R2_ACCOUNT_ID: poison }, { AWS_ACCESS_KEY_ID: '' }]) {
      assert.throws(() => download(selected, root, { ...env, ...patch }, fake));
    }
    assert.equal(calls, 1);
    assert.throws(() => download(selected, root, env, () => ({ status: 1, stdout: poison, stderr: poison, error: new Error(poison) })), { message: FAILURE });
  });
  const errors = [];
  const output = [];
  t.mock.method(console, 'error', message => errors.push(message));
  t.mock.method(console, 'log', message => output.push(message));
  await temporary(root => {
    prepare(root, JSON.stringify(report()));
    // A failed fetch is caught at the public boundary before any transport is available.
    const pending = main(['fetch', selected.run, selected.attempt], { RUNNER_TEMP: root, ...env, R2_BUCKET: poison });
    return pending;
  });
  assert.deepEqual(errors, [FAILURE]);
  assert.deepEqual(output, []);
});

test('workflow keeps manual/default-branch gate, minimal read permissions and step-local secret references', () => {
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/report-diagnostics.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:|push:|schedule:|npm |playwright|--recursive/);
  assert.match(workflow, /github.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /contents: read\n  actions: read/);
  const secretSteps = workflow.split(/\n      - name:/).filter(part => part.includes('secrets.'));
  assert.equal(secretSteps.length, 1);
  // Static policy regression only; production process isolation needs runtime evidence.
  assert.match(secretSteps[0], /run: env -i .* node scripts\/report-diagnostics\.mjs fetch /);
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]).sort(), ['R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_SECRET_ACCESS_KEY']);
  assert.doesNotMatch(workflow, /run:.*\$\{\{ inputs/);
});
