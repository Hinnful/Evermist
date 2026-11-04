#!/usr/bin/env node
'use strict';

/*
 * The Linux AppImage's first launch on a stock Ubuntu: no kernel setting changed and no FUSE library
 * added, which is what a DM who downloads it has. update-proofs.yml runs it before the steps that
 * change both for the rest of the job.
 *
 *   node tools/linux-first-launch.js <dir holding the built AppImage>
 *
 * Passes when the DM window loads index.html within 90 s; fails with the app's own output otherwise.
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn, execSync } = require('child_process');

const PORT = 9337;
const dir = process.argv[2] || 'dist-new';
const image = fs.readdirSync(dir).find(f => f.endsWith('.AppImage'));
if (!image) { console.log('::error::no AppImage in ' + dir); process.exit(1); }
const file = path.resolve(dir, image);
fs.chmodSync(file, 0o755);

const read = f => { try { return fs.readFileSync(f, 'utf8').trim(); } catch (_) { return '(absent)'; } };
let fuse2 = false;
try { fuse2 = /libfuse\.so\.2/.test(execSync('ldconfig -p', { encoding: 'utf8' })); } catch (_) { /* no ldconfig */ }
console.log('apparmor_restrict_unprivileged_userns=' + read('/proc/sys/kernel/apparmor_restrict_unprivileged_userns') +
            ', libfuse.so.2 ' + (fuse2 ? 'present' : 'absent'));

const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'evermist-first-'));
const app = spawn(file, ['--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(home, 'profile')],
                  { env: { ...process.env, HOME: home } });
let out = '';
app.stdout.on('data', d => { out += d; });
app.stderr.on('data', d => { out += d; });
let exited = null;
app.on('exit', code => { exited = code; });

const pages = () => new Promise(resolve => {
  http.get({ host: '127.0.0.1', port: PORT, path: '/json' }, res => {
    let body = '';
    res.on('data', c => { body += c; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (_) { resolve([]); } });
  }).on('error', () => resolve([]));
});

(async () => {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline && exited === null) {
    const list = await pages();
    if (list.some(p => /index\.html/.test(p.url || ''))) {
      console.log('The AppImage opened its DM window on a stock Ubuntu.');
      app.kill('SIGKILL');
      process.exit(0);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  app.kill('SIGKILL');
  console.log('::error::The AppImage did not open its DM window on a stock Ubuntu' +
              (exited !== null ? ' (it exited with code ' + exited + ')' : ' within 90 s') + '.');
  console.log(out.slice(-4000));
  process.exit(1);
})();
