'use strict';
// fileHash.js — a file's SHA-256, streamed so a 500 MB map never sits in memory. Pure Node, no Electron. Tested.

const fs = require('fs');
const crypto = require('crypto');

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const rs = fs.createReadStream(filePath);
    rs.on('data', c => h.update(c));
    rs.on('error', reject);
    rs.on('end', () => resolve(h.digest('hex')));
  });
}

module.exports = { hashFile };
