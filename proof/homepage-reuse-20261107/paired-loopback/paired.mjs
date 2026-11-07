#!/usr/bin/env node
// Paired deterministic-count comparison; no candidate execution until explicitly authorized.
import {spawn} from 'node:child_process';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const args={};for(let i=2;i<process.argv.length;i+=2){assert.ok(['--repo','--base','--candidate','--playwright','--chromium','--node','--variant'].includes(process.argv[i]));assert.ok(process.argv[i+1]);args[process.argv[i]]=process.argv[i+1];}
for(const key of ['--repo','--base','--candidate','--playwright'])assert.ok(args[key],key);
for(const key of ['--base','--candidate'])assert.ok(/^[a-f0-9]{40}$/.test(args[key]));
const node=args['--node']??process.execPath,variant=args['--variant']??'empty';assert.ok(['empty','cards'].includes(variant));
const root=mkdtempSync(join(tmpdir(),'homepage-paired-results-')),rows=[];
async function sample(mode,pair){const argv=[fileURLToPath(new URL('./sample.mjs',import.meta.url)),'--repo',args['--repo'],'--ref',args[mode==='base'?'--base':'--candidate'],'--playwright',args['--playwright'],'--chromium',args['--chromium']??'/usr/bin/chromium','--variant',variant];
 const outcome=await new Promise((done,reject)=>{const p=spawn(node,argv,{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>done({code,stdout,stderr}));});
 writeFileSync(join(root,`${pair}-${mode}-stdout.json`),outcome.stdout);writeFileSync(join(root,`${pair}-${mode}-stderr.txt`),outcome.stderr);
 assert.equal(outcome.code,0,`${pair}-${mode}: sample failed; see local artifacts`);const result=JSON.parse(outcome.stdout);assert.deepEqual(result.checks.problems,[]);assert.equal(result.homepage_documents,mode==='base'?2:1);assert.equal(result.document_count,mode==='base'?4:3);assert.equal(result.pacing.sleeps,0);rows.push({pair,mode,...result});writeFileSync(join(root,'rows.json'),JSON.stringify(rows,null,2));}
for(let pair=1;pair<=5;pair++)for(const mode of pair%2?['base','candidate']:['candidate','base'])await sample(mode,pair);
const result={variant,samples_per_revision:5,primary:'document/request counts and unchanged absence-check results; elapsed time descriptive only',base:args['--base'],candidate:args['--candidate'],all_checks_equal:true,homepage_documents:{base:2,candidate:1},total_documents:{base:4,candidate:3},rows};writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({artifacts:root,samples_per_revision:5,variant,homepage_documents:result.homepage_documents,total_documents:result.total_documents,all_checks_equal:true},null,2));
