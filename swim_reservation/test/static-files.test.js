import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {readFile} from 'node:fs/promises';import {serveStatic} from '../src/static-files.js';
test('실제 HTTP 제공 경로는 첫 화면의 모든 스크립트와 메시지 파일을 제공하고 임의 경로는 차단한다',async t=>{
 const server=http.createServer((req,res)=>void serveStatic(new URL(req.url,'http://localhost').pathname,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
 const root=await fetch(base+'/');assert.equal(root.status,200);const html=await root.text(),scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(m=>m[1]);assert.ok(scripts.includes('toast.js'));
 for(const name of scripts){const response=await fetch(base+'/'+name);assert.equal(response.status,200,name);assert.match(response.headers.get('content-type'),/javascript/);assert.equal(await response.text(),await readFile(new URL('../public/'+name,import.meta.url),'utf8'));}
 for(const name of ['not-allowed.js','src/server.js','package.json'])assert.equal((await fetch(base+'/'+name)).status,404,name);
});
