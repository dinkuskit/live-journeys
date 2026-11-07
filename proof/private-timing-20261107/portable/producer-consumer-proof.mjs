#!/usr/bin/env node
// Bounded offline proof only. Requires existing Playwright1.61.1 and Chromium; installs nothing.
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const args={};
for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i];assert.ok(['--repo','--node','--playwright','--chromium','--ref'].includes(key));assert.ok(process.argv[i+1]);assert.ok(!(key in args));args[key]=process.argv[i+1];}
assert.ok(args['--repo']&&args['--playwright'],'Provide --repo CHECKOUT --playwright EXISTING_NODE_MODULES');
const repo=resolve(args['--repo']),modules=resolve(args['--playwright']);
const node=args['--node']?resolve(args['--node']):process.execPath;
const chromium=args['--chromium']?resolve(args['--chromium']):'/usr/bin/chromium';
assert.equal(execFileSync(node,['--version'],{encoding:'utf8'}).trim(),'v24.22.0');
assert.equal(JSON.parse(readFileSync(join(modules,'playwright/package.json'))).version,'1.61.1');
const ref=args['--ref']??'HEAD';assert.ok(ref==='HEAD'||/^[a-f0-9]{40}$/.test(ref));
const git=(...argv)=>execFileSync('git',['-C',repo,...argv]);
const sha=git('rev-parse',ref+'^{commit}').toString().trim();
const root=mkdtempSync(join(tmpdir(),'journey-producer-consumer-')),runner=join(root,'runner');mkdirSync(runner);
const hashes={},pending=['playwright.config.mjs','support/steps.mjs','support/verdict-reporter.mjs','scripts/run-summary.mjs','scripts/report-diagnostics.mjs'];
while(pending.length){const rel=pending.pop();if(rel in hashes)continue;assert.ok(!rel.startsWith('../'));
 const bytes=git('show',sha+':runner/'+rel),dest=join(runner,rel);hashes[rel]=createHash('sha256').update(bytes).digest('hex');mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,bytes);
 for(const match of bytes.toString().matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)){const dep=relative(runner,resolve(dirname(dest),match[1]));if(dep.endsWith('.mjs'))pending.push(dep);}}
writeFileSync(join(root,'source-manifest.json'),JSON.stringify({source_commit:sha,scope:'runner-relative import closure from immutable Git objects',sha256:hashes},null,2));
symlinkSync(modules,join(runner,'node_modules'),'dir');mkdirSync(join(runner,'tests'));
const fixture=String.raw`
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const stamp=Date.now()-59000;
const host=new URL(process.env.DINKUS_E2E_STORE).host.replace(/[^a-z0-9.-]/gi,'-');
writeFileSync(join(process.env.DINKUS_E2E_PROOF,'.store-requests-'+host+'-'+Math.floor(stamp/60000)+'.log'),Array(100).fill(stamp+'\n').join(''));
const {test,expect,shopperPage,closeShopper}=await import('../support/browser.mjs');
const {journey,step}=await import('../support/steps.mjs');
const {paceStore}=await import('../support/pace.mjs');
const {config}=await import('../support/env.mjs');
if(process.env.LOCAL_RETRY==='1')test.describe.configure({retries:1});
test('Manage products',{tag:'@running'},journey(async()=>{
 await paceStore(1);
 const page=await shopperPage();
 try{
  await step(page,'Synthetic shopper opens loopback page',async()=>{
   const response=await page.goto(config.store);expect(response.status()).toBe(200);
   await page.getByRole('button',{name:'Check product'}).click();await expect(page.locator('output')).toHaveText('checked');return 'synthetic checked';
  });
  if(process.env.LOCAL_RETRY==='1'&&test.info().retry===0)throw new Error('Intentional synthetic first-attempt failure');
 }finally{await closeShopper(page);}
},{profile:false}));
`;
writeFileSync(join(runner,'tests/local-timing.spec.mjs'),fixture);
const server=createServer((_req,res)=>{res.setHeader('content-type','text/html');res.end('<!doctype html><meta charset=utf-8><title>Local fixture</title><main><h1>Fixture</h1><button>Check product</button><output>ready</output></main><script>document.querySelector("button").onclick=()=>document.querySelector("output").textContent="checked";</script>');});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
function command(argv,env){return new Promise((done,reject)=>{const child=spawn(node,argv,{cwd:runner,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',reject);child.on('close',code=>done({code,stdout,stderr}));});}
const results=[];
try{for(const kind of ['pass','retry']){
 const dir=join(root,kind);mkdirSync(dir);mkdirSync(join(dir,'proof'));const attempt=kind==='pass'?'1':'2',runId='github-991711071-'+attempt;
 const env={PATH:'/usr/bin:/bin',HOME:dir,DINKUS_E2E_ENV_FILE:'/dev/null',DINKUS_E2E_STORE:origin,DINKUS_E2E_PROFILE:join(dir,'profile'),DINKUS_E2E_PROOF:join(dir,'proof'),DINKUS_E2E_RUN:runId,DINKUS_E2E_HEADLESS:'1',DINKUS_E2E_VIDEO:'0',DINKUS_E2E_CHROME_PATH:chromium,LOCAL_RETRY:kind==='retry'?'1':'0'};
 const run=await command([join(modules,'@playwright/test/cli.js'),'test','--config=playwright.config.mjs','--grep','@running','--timeout=15000','--global-timeout=60000'],env);
 writeFileSync(join(dir,'stdout.txt'),run.stdout);writeFileSync(join(dir,'stderr.txt'),run.stderr);assert.equal(run.code,0,'Synthetic Playwright run failed; inspect local artifacts');
 const folder=join(dir,'proof',runId),report=JSON.parse(readFileSync(join(folder,'report.json'))),timing=report.facts['Manage products timing'];
 assert.equal(report.verdict,'PASS');assert.equal(report.journeys[0].verdict,kind==='retry'?'FLAKY':'PASS');assert.equal(timing.tries.length,kind==='retry'?2:1);
 for(const entry of timing.tries){assert.ok(entry.pace_sleeps>=1);assert.ok(entry.pace_sleep_ms>0);assert.ok(entry.body_ms>=entry.pace_sleep_ms);assert.ok(entry.body_ms>=entry.pace_sleep_wall_ms);}
 if(kind==='retry'){assert.equal(timing.tries[0].body,'threw');assert.equal(timing.tries[0].verdict,'FAIL');assert.equal(timing.tries[1].body,'returned');assert.equal(timing.tries[1].verdict,'PASS');assert.ok(report.steps.some(s=>s.retried&&s.status==='FAIL'));}
 const publicSummary=await command(['scripts/run-summary.mjs',folder,'0'],env);assert.equal(publicSummary.code,0);assert.doesNotMatch(publicSummary.stdout,/body_ms|pace_sleep|Manage products timing/);assert.doesNotMatch(run.stdout,/body_ms|pace_sleep|Manage products timing/);writeFileSync(join(dir,'public-summary.txt'),publicSummary.stdout);
 const analysisRoot=join(dir,'analysis');mkdirSync(analysisRoot);mkdirSync(join(analysisRoot,'report-diagnostics'));
 // Synthetic selection receipt isolates analyze; this is not GitHub verification or R2 qualification.
 writeFileSync(join(analysisRoot,'report-diagnostics/verified.json'),JSON.stringify({run:'991711071',attempt,key:'runs/'+runId+'/report.json'}));writeFileSync(join(analysisRoot,'report-diagnostics/report.json'),JSON.stringify(report));
 const analyzed=await command(['scripts/report-diagnostics.mjs','analyze','991711071',attempt],{PATH:'/usr/bin:/bin',RUNNER_TEMP:analysisRoot});assert.equal(analyzed.code,0);assert.equal(analyzed.stderr,'');const projection=JSON.parse(analyzed.stdout);assert.equal(projection.length,1);assert.deepEqual(projection[0].timing,timing);writeFileSync(join(dir,'analyzer-output.json'),analyzed.stdout);
 const pw=JSON.parse(readFileSync(join(folder,'playwright.json'))),attempts=[];function walk(suites){for(const suite of suites){for(const spec of suite.specs??[])for(const t of spec.tests??[])attempts.push(...t.results.map(r=>({worker:r.workerIndex,retry:r.retry,status:r.status})));walk(suite.suites??[]);}}walk(pw.suites??[]);
 if(kind==='retry')assert.notEqual(attempts[0].worker,attempts[1].worker);
 results.push({kind,exit:run.code,verdict:report.verdict,journey:report.journeys[0].verdict,timing,playwright_attempts:attempts,analyzer_matches:true,public_summary_omits_timing:true});
}
 const result={source_commit:sha,node:'v24.22.0',playwright:'1.61.1',scope:'loopback-only synthetic producer/analyzer proof; no private transport',results};writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({artifacts:root,...result},null,2));
}finally{await new Promise(done=>server.close(done));}
