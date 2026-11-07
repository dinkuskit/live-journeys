#!/usr/bin/env node
// One immutable-revision actual-helper sample; the opened hint is passed in both revisions. Uses immutable Git source and existing dependencies.
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const args={};for(let i=2;i<process.argv.length;i+=2){assert.ok(['--repo','--ref','--playwright','--chromium','--variant'].includes(process.argv[i]));assert.ok(process.argv[i+1]);args[process.argv[i]]=process.argv[i+1];}
assert.equal(process.version,'v24.22.0');assert.ok(args['--repo']&&args['--playwright']);assert.ok(/^[a-f0-9]{40}$/.test(args['--ref']));
const variant=args['--variant']??'empty';assert.ok(['empty','cards'].includes(variant));
const repo=resolve(args['--repo']),modules=resolve(args['--playwright']),sha=args['--ref'];
assert.equal(JSON.parse(readFileSync(join(modules,'playwright/package.json'))).version,'1.61.1');
const root=mkdtempSync(join(tmpdir(),'homepage-helper-proof-')),runner=join(root,'runner');mkdirSync(runner);
const hashes={},pending=['support/browser.mjs','support/shopper.mjs','support/store-check.mjs'];
while(pending.length){const rel=pending.pop();if(rel in hashes)continue;assert.ok(!rel.startsWith('../'));const b=execFileSync('git',['-C',repo,'show',sha+':runner/'+rel]);const dest=join(runner,rel);hashes[rel]=createHash('sha256').update(b).digest('hex');mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,b);for(const match of b.toString().matchAll(/(?:from\s*|import\s*\(\s*)["'](\.[^"']+)["']/g)){const dep=relative(runner,resolve(dirname(dest),match[1]));if(dep.endsWith('.mjs'))pending.push(dep);}}
writeFileSync(join(root,'source-manifest.json'),JSON.stringify({source_commit:sha,scope:'runner-relative actual-helper import closure',sha256:hashes},null,2));
symlinkSync(modules,join(runner,'node_modules'),'dir');
const requests=[];
const server=createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;requests.push({path,kind:req.headers['sec-fetch-dest']==='document'?'document':'preflight-or-other'});res.setHeader('content-type','text/html');res.setHeader('cache-control','no-store');
 if(path.startsWith('/images/')){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="green"/></svg>');}
 else if(path==='/products/fixture'){res.statusCode=404;res.end('<!doctype html><main>Product is not available</main>');}
 else if(path==='/categories/fixture'){res.end('<!doctype html><main><h1>Fixture category</h1><p>No products</p></main>');}
 else if(path==='/'){const cards=Array.from({length:3},(_,i)=>'<a data-commerce-product="unrelated-'+i+'" href="/products/unrelated-'+i+'"><h3>Unrelated product</h3><p data-product-price>$1.00</p><img data-commerce-image="unrelated-'+i+'" src="/images/unrelated-'+i+'.svg" width="8" height="8"></a>').join('');res.end('<!doctype html><main><div data-commerce-catalog>'+(variant==='cards'?cards:'<p data-commerce-empty>No products available</p>')+'</div></main>');}
 else{res.statusCode=404;res.end('<!doctype html><main>Not found</main>');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
Object.assign(process.env,{HOME:root,DINKUS_E2E_ENV_FILE:'/dev/null',DINKUS_E2E_PROOF:join(root,'proof'),DINKUS_E2E_PROFILE:join(root,'profile'),DINKUS_E2E_RUN:'synthetic-homepage',DINKUS_E2E_STORE:origin,DINKUS_E2E_HEADLESS:'1',DINKUS_E2E_VIDEO:'0',DINKUS_E2E_CHROME_PATH:args['--chromium']??'/usr/bin/chromium'});
let shopper;
try{const {shopperPage,closeShopper}=await import(pathToFileURL(join(runner,'support/browser.mjs')));const {openShopperPage}=await import(pathToFileURL(join(runner,'support/shopper.mjs')));const {storeHides}=await import(pathToFileURL(join(runner,'support/store-check.mjs')));const {paceSnapshot}=await import(pathToFileURL(join(runner,'support/pace.mjs')));
 shopper=await shopperPage();const browserVersion=shopper.context().browser().version();
 const before=paceSnapshot(),start=performance.now();
 const opened=await openShopperPage(shopper,'/');await shopper.reload();const checked=await storeHides(shopper,{id:'fixture-product',name:'Fixture product',productPath:'/products/fixture',categoryPath:'/categories/fixture',shared:true},{opened});
 const elapsed=performance.now()-start,after=paceSnapshot();
 assert.deepEqual(checked.problems,[]);
 const documents=requests.filter(r=>r.kind==='document');assert.deepEqual(documents.map(r=>r.path),['/','/','/','/products/fixture','/categories/fixture']);
 const pacing={};for(const key of Object.keys(after))pacing[key]=after[key]-before[key];assert.equal(pacing.sleeps,0);
 await closeShopper(shopper);assert.equal(shopper.isClosed(),true);shopper=null;
 const result={source_commit:sha,node:process.version,playwright:'1.61.1',browser:browserVersion,mode:'same-url-reload-fallback',variant,scope:'actual openShopperPage then storeHides; no source mocks',state:{productPath:'/products/fixture',categoryPath:'/categories/fixture',shared:true},checks:checked,requests,document_count:documents.length,homepage_documents:documents.filter(r=>r.path==='/').length,pacing,elapsed_ms:elapsed,closed:true,limits:['synthetic no-auth loopback','hide path only',variant==='empty'?'empty catalog is explicitly readable':'three unrelated cards with real SVG responses','no real request-limit pressure','single sample is not a live speed estimate']};
 writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({artifacts:root,...result},null,2));
}catch(error){if(shopper)await shopper.context().browser().close();throw error;}finally{await new Promise(done=>server.close(done));}
