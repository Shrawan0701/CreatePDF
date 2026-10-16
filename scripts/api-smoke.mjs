import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:5199';
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5199', '--strictPort', '--host', '127.0.0.1'], { stdio: 'ignore' });
try {
  let ready = false;
  for (let i = 0; i < 80; i++) { try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Wait for Vite. */ } await new Promise((resolve) => setTimeout(resolve, 100)); }
  assert.ok(ready, 'Vite did not start.');
  for (const task of ['translate', 'chat', 'summarize', 'invoice']) {
    const method = await fetch(`${origin}/api/${task}`);
    assert.equal(method.status, 405);
    const invalid = await fetch(`${origin}/api/${task}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal(typeof (await invalid.json()).error, 'string');
  }
  assert.equal((await fetch(`${origin}/api/unknown`)).status, 404);
  console.log('Vite same-origin API middleware passed for all four endpoints. No model calls made.');
} finally { server.kill(); }
