'use strict';
// write-google-client.js — writes electron/googleClient.json, the Google client sync signs in with, from the
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables. CI runs it before electron-builder with the
// repository secrets in its env. The file is gitignored: the repo is public and push protection rejects the secret.
// ⚠ NEVER PRINT A VALUE. GitHub masks a secret in the log only as long as nothing transforms it first.
//
//   node tools/write-google-client.js [out]     out defaults to electron/googleClient.json

const fs = require('fs');
const path = require('path');

const DEFAULT_OUT = path.join(__dirname, '..', 'electron', 'googleClient.json');

// { ok, message }: the file written, or why not. The message never carries a value.
function writeGoogleClient(env, out) {
  const id = (env.GOOGLE_CLIENT_ID || '').trim(), secret = (env.GOOGLE_CLIENT_SECRET || '').trim();
  const missing = [!id && 'GOOGLE_CLIENT_ID', !secret && 'GOOGLE_CLIENT_SECRET'].filter(Boolean);
  if (missing.length) return { ok: false, message: missing.join(' and ') + ' empty or unset; nothing written. Sync would be missing from this build.' };
  fs.writeFileSync(out, JSON.stringify({ clientId: id, clientSecret: secret }) + '\n');
  return { ok: true, message: 'wrote ' + path.relative(process.cwd(), out) };
}

if (require.main === module) {
  const r = writeGoogleClient(process.env, process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT);
  (r.ok ? console.log : console.error)(r.message);
  process.exitCode = r.ok ? 0 : 1;
}

module.exports = { writeGoogleClient };
