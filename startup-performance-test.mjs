import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
import {productionFiles,productionFilesAsync,verifyRelease,verifyReleaseAsync,writeReleaseManifest} from './internal/release-manifest.mjs';
import {createBackgroundReleaseCheck,deferStartupWork} from './internal/startup-work.mjs';
const dir=mkdtempSync(join(tmpdir(),'dsh-startup-check-'));let passed=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function test(name,fn){await fn();passed++;console.log('PASS '+name)}
try{
 writeFileSync(join(dir,'package.json'),JSON.stringify({name:'startup-fixture',version:'1.0.0'}));
 for(const p of ['backend','internal','assets/character','native/indicator-helper/build'])mkdirSync(join(dir,p),{recursive:true});
 writeFileSync(join(dir,'backend','fixture.ps1'),'Write-Output 1');
 writeFileSync(join(dir,'assets/character','fixture.png'),Buffer.alloc(2*1024*1024,7));
 writeFileSync(join(dir,'native/indicator-helper/build/dsh-interaction-indicator.exe'),'fixture');
 writeReleaseManifest(dir);
 await test('async and sync production sets/complete reports agree',async()=>{assert.deepEqual(await productionFilesAsync(dir),productionFiles(dir));assert.deepEqual(await verifyReleaseAsync(dir),verifyRelease(dir));assert.equal((await verifyReleaseAsync(dir)).matches,true)});
 await test('async verifier still detects changed, added and missing runtime files',async()=>{writeFileSync(join(dir,'backend','fixture.ps1'),'Write-Output 2');writeFileSync(join(dir,'internal','extra.mjs'),'// added');rmSync(join(dir,'assets/character','fixture.png'));const r=await verifyReleaseAsync(dir);assert.deepEqual(r,verifyRelease(dir));assert.equal(r.matches,false);assert.ok(r.mismatched.includes('backend/fixture.ps1'));assert.ok(r.extra.includes('internal/extra.mjs'));assert.ok(r.missing.includes('assets/character/fixture.png'))});
 await test('missing native helper and malformed manifest are not accepted',async()=>{rmSync(join(dir,'native/indicator-helper/build/dsh-interaction-indicator.exe'));writeFileSync(join(dir,'release-manifest.json'),'{bad');assert.deepEqual(await verifyReleaseAsync(dir),verifyRelease(dir));assert.equal((await verifyReleaseAsync(dir)).matches,false)});
 writeReleaseManifestFixture();
 function writeReleaseManifestFixture(){writeFileSync(join(dir,'native/indicator-helper/build/dsh-interaction-indicator.exe'),'fixture');writeReleaseManifest(dir)}
 await test('deferred check reports pending and doctor-style callers share one full verification',async()=>{let calls=0;let resolve;const c=createBackgroundReleaseCheck({root:dir,delayMs:10000,verify:()=>{calls++;return new Promise(r=>{resolve=r})}});assert.equal(c.current.verification,'pending');assert.equal(c.current.buildId,null);assert.equal(c.current.matches,false);assert.equal(calls,0);const p=c.ensure(),p2=c.ensure();assert.equal(p,p2);await Promise.resolve();assert.equal(calls,1);resolve(verifyRelease(dir));await p;assert.equal(c.current.verification,'complete');assert.equal(c.current.matches,true);c.dispose()});
 await test('timer starts automatically without a tool call',async()=>{let calls=0;const c=createBackgroundReleaseCheck({root:dir,delayMs:10,verify:async()=>{calls++;return verifyRelease(dir)}});await sleep(60);assert.equal(calls,1);assert.equal(c.current.verification,'complete');c.dispose()});
 await test('dispose cancels pending startup work and suppresses late completion callbacks',async()=>{let calls=0;const c=createBackgroundReleaseCheck({root:dir,delayMs:10,verify:async()=>{calls++;return verifyRelease(dir)}});c.dispose();await sleep(35);assert.equal(calls,0);let finish,notified=0;const d=createBackgroundReleaseCheck({root:dir,delayMs:10000,verify:()=>new Promise(r=>{finish=r}),onComplete:()=>notified++});const p=d.ensure();await Promise.resolve();d.dispose();finish(verifyRelease(dir));await p;assert.equal(notified,0);let started=false;const cancel=deferStartupWork(()=>{started=true},10);cancel();await sleep(25);assert.equal(started,false)});
 await test('verification errors become an explicit report',async()=>{const c=createBackgroundReleaseCheck({root:dir,delayMs:10000,verify:async()=>{throw Error('disk unavailable')}});const r=await c.ensure();assert.equal(r.verification,'error');assert.equal(r.matches,false);assert.match(r.error,/disk unavailable/);c.dispose()});
 await test('a failing diagnostic observer cannot reject the completed background check',async()=>{const c=createBackgroundReleaseCheck({root:dir,delayMs:10000,verify:async()=>verifyRelease(dir),onComplete:()=>{throw Error('logger gone')}});await c.ensure();assert.equal(c.current.verification,'complete');assert.equal(c.current.matches,true);c.dispose()});
 const lazyResolutions=[];
 const stub=join(dir,'stub.mjs');writeFileSync(stub,'export const defineTool = x => x;');registerHooks({resolve(s,c,n){if(/(?:browser\/(?:connection|state|actions)|internal\/doctor)\.mjs$/.test(s))lazyResolutions.push(s);return s==='@deepseek-ai/dsh-tools'?{url:pathToFileURL(stub).href,shortCircuit:true}:n(s,c)}});
 const plugin=await import('./index.js');const effects=[],routes=new Map(),tools=new Map();let spawns=0;
 const services={webServer:{register:r=>{routes.set(r.path,r);return()=>{}}}};
 const ctx={tools:{register:t=>{tools.set(t.name,t);return()=>{}}},webServer:services.webServer,on:()=>{},get:n=>services[n],effect:fn=>{const d=fn();if(typeof d==='function')effects.push(d);return()=>{}},inject:(names,fn)=>{if(names.every(n=>services[n]))fn(ctx);return()=>{}},logger:{info(){},warn(){},error(){}}};
 const original=fs.readFileSync;const syncReads=[];fs.readFileSync=function(p,...a){syncReads.push(String(p));return original.call(this,p,...a)};syncBuiltinESMExports();
 try{plugin.apply(ctx,{shotDir:join(dir,'shots'),visualPreferencesPath:join(dir,'prefs.json'),visualEffects:{enabled:true,cursorCompanion:true},interactionIndicator:{exePath:process.execPath,spawn:()=>{spawns++;throw Error('unexpected helper start')}}})}finally{fs.readFileSync=original;syncBuiltinESMExports()}
 async function route(path){let result;await routes.get(path).handler({url:path,method:'GET'},{writeHead(){},end:s=>{result=JSON.parse(s)}});return result}
 try{
  await test('unused browser engines and doctor are not imported during mounting',async()=>{assert.deepEqual(lazyResolutions,[])});
  await test('mount reads no runtime images/exe/worker and does not start companion synchronously',async()=>{assert.equal(tools.size,18);assert.equal(spawns,0);assert.equal(syncReads.some(p=>/\.png$|\.exe$|worker\.ps1$/.test(p)),false);const s=await route('/computer-use/status');assert.equal(s.runtime.release.verification,'pending');assert.equal(s.runtime.release.matches,false)});
  await test('doctor waits for full verification and status then carries computed identity',async()=>{await route('/computer-use/doctor');const s=await route('/computer-use/status');assert.equal(s.runtime.release.verification,'complete');assert.match(s.runtime.release.buildId,/^[0-9a-f]{16}$/)});
 }finally{for(const d of effects.reverse())await d()}
 console.log(`${passed} passed, 0 failed`);
}finally{rmSync(dir,{recursive:true,force:true})}
