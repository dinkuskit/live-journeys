import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/live-journeys.yml', import.meta.url), 'utf8');
const normal = workflow.split('\n  journeys:\n')[1].split('\n  # TEMPORARY:')[0];
const qualification = workflow.split('\n  diagnostics-qualification:\n')[1];
const condition = text => text.match(/^    if: (.+)$/m)[1];
// Evaluate the actual restricted boolean expressions in this owned workflow.
// This is an offline routing regression, not a GitHub runner emulator.
function evaluate(expression, context) {
  const literal = expression.replace(/\b(?:github|inputs|matrix|steps)(?:\.[a-z_]+)+\b/g, key => {
    assert.ok(Object.hasOwn(context, key), `unhandled workflow value: ${key}`);
    return JSON.stringify(context[key]);
  });
  assert.doesNotMatch(literal.replace(/'[^']*'|"[^"]*"/g, ''), /[^\s0-9!=&|.()truefals]/);
  return Function(`"use strict"; return (${literal});`)();
}
const valid = {
  'github.repository': 'dinkuskit/live-journeys', 'github.event_name': 'workflow_dispatch',
  'github.ref': 'refs/heads/ridge/live-journey-diagnostics-20261107', 'github.actor_id': '159389674',
  'github.run_attempt': 1, 'github.sha': 'a'.repeat(40),
  'inputs.diagnostics_qualification': true, 'inputs.diagnostics_expected_head': 'a'.repeat(40),
};

test('temporary mode routes exclusively; unapproved context and reruns cannot reach qualification', () => {
  assert.equal(evaluate(condition(qualification), valid), true);
  assert.equal(evaluate(condition(normal), valid), false);
  for (const patch of [
    { 'github.repository': 'foreign/repo' }, { 'github.event_name': 'push' },
    { 'github.ref': 'refs/heads/main' }, { 'github.actor_id': '1' },
    { 'github.run_attempt': 2 }, { 'inputs.diagnostics_qualification': false },
    { 'inputs.diagnostics_expected_head': '' }, { 'inputs.diagnostics_expected_head': 'b'.repeat(40) },
  ]) assert.equal(evaluate(condition(qualification), { ...valid, ...patch }), false);
  assert.equal(evaluate(condition(normal), { ...valid, 'inputs.diagnostics_qualification': false }), true);
  const input = workflow.split('      diagnostics_qualification:\n')[1].split('      diagnostics_expected_head:')[0];
  assert.match(input, /^        type: boolean$/m);
  assert.match(input, /^        default: false$/m);
  assert.match(workflow, /group: \$\{\{ inputs.diagnostics_qualification && format\('report-qualification-\{0\}', github.run_id\) \|\| 'live-journeys-beta-store' \}\}/);
});

test('qualification pins production reader and permits only the four fixed cases', () => {
  const reader = readFileSync(new URL('../scripts/report-diagnostics.mjs', import.meta.url));
  const hash = createHash('sha256').update(reader).digest('hex');
  assert.ok(qualification.includes(`'${hash}' 'scripts/report-diagnostics.mjs' | sha256sum --check --status`));
  assert.match(qualification, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(qualification, /git rev-parse HEAD/);
  assert.match(qualification, /ref: \$\{\{ github.sha \}\}/);
  assert.match(qualification, /persist-credentials: false/);
  const cases = [...qualification.matchAll(/- case: ([\w-]+)\n            run: '(\d+)'\n            attempt: '(\d+)'/g)].map(m => m.slice(1));
  assert.deepEqual(cases, [
    ['allowed', '42337050608', '1'], ['forbidden-workflow', '42342624009', '1'],
    ['foreign-repository', '42342657068', '1'], ['forbidden-attempt', '42337050608', '9999'],
  ]);
  assert.doesNotMatch(qualification, /inputs\.(?:run|attempt)|npm |playwright|--recursive|upload-artifact/);
  assert.match(qualification, /contents: read\n      actions: read/);
});

test('rejected cases cannot fetch even if metadata unexpectedly succeeds; secrets remain fetch-local', () => {
  const fetchStep = qualification.split('      - name: Read only the allowed bounded report\n')[1].split('\n      - name:')[0];
  const expression = fetchStep.match(/^        if: (.+)$/m)[1];
  for (const name of ['allowed', 'forbidden-workflow', 'foreign-repository', 'forbidden-attempt']) {
    for (const outcome of ['success', 'failure', 'skipped', 'cancelled']) {
      assert.equal(evaluate(expression, { 'matrix.case': name, 'steps.verify.outcome': outcome }), name === 'allowed' && outcome === 'success');
    }
  }
  const secrets = qualification.split(/\n      - name:/).filter(step => step.includes('secrets.'));
  assert.equal(secrets.length, 1);
  assert.ok(secrets[0].includes('id: fetch'));
  assert.deepEqual([...qualification.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(m => m[1]).sort(),
    ['R2_ACCESS_KEY_ID', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_SECRET_ACCESS_KEY']);
  assert.ok(qualification.indexOf('id: pin') < qualification.indexOf('GH_TOKEN:'));
  for (const mode of ['verify', 'fetch', 'analyze', 'clean']) {
    assert.ok(qualification.includes(`node scripts/report-diagnostics.mjs ${mode} "$SELECTED_RUN" "$SELECTED_ATTEMPT"`));
  }
  assert.match(qualification, /if: always\(\) && steps.pin.outcome == 'success'/);
  assert.match(qualification, /"\$VERIFY_OUTCOME" != failure \|\| "\$FETCH_OUTCOME" != skipped \|\| "\$ANALYZE_OUTCOME" != skipped/);
});

test('both workflows launch every reader mode with a fresh exact environment allowlist', () => {
  const production = readFileSync(new URL('../../.github/workflows/report-diagnostics.yml', import.meta.url), 'utf8');
  const expected = {
    verify: ['PATH', 'RUNNER_TEMP', 'GH_TOKEN'],
    fetch: ['PATH', 'RUNNER_TEMP', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'],
    analyze: ['PATH', 'RUNNER_TEMP'],
    clean: ['PATH', 'RUNNER_TEMP'],
  };
  for (const source of [production, qualification]) {
    // Check every reader call, including rejecting extra calls without env -i.
    const lines = source.split('\n').filter(line => /node scripts\/report-diagnostics\.mjs/.test(line));
    assert.equal(lines.length, 4);
    for (const [mode, names] of Object.entries(expected)) {
      const line = lines.find(line => line.includes(`report-diagnostics.mjs ${mode} `));
      assert.ok(line);
      const launch = line.trim().replace(/^run: /, '').split(' node scripts/')[0];
      assert.ok(launch.startsWith('env -i '));
      const assignments = launch.slice('env -i '.length).split(' ');
      assert.deepEqual(assignments, names.map(name => `${name}="$${name}"`));
      const suffix = line.split(`report-diagnostics.mjs ${mode} `)[1];
      assert.equal(suffix, '"$SELECTED_RUN" "$SELECTED_ATTEMPT"' +
        (mode === 'analyze' ? ' | tee -a "$GITHUB_STEP_SUMMARY"' : ''));
    }
  }
});
