// Build a small offline organization snapshot; no visitor IP is sent to a lookup service.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const bytes = fs.readFileSync(process.argv[2]);
const source = bytes.toString('utf8');
const operators = {};
const groups = [
  [/CHINA\s*TELECOM|CHINANET|CTGNET/i, '中国电信'],
  [/CHINA\s*UNICOM|CHINA169|\bCUII\b/i, '中国联通'],
  [/CHINA\s*MOBILE|CMNET|\bCMI-INT\b/i, '中国移动'],
  [/CHINA BROADNET|CHINA BROADCASTING/i, '中国广电'],
  [/\bCERNET\b/i, '教育网'], [/\bCSTNET\b/i, '科技网'],
];
let records = 0;
for (const line of source.split(/\r?\n/)) {
  const match = /^(\d+)\s+(.+),\s*([A-Z]{2})$/.exec(line);
  if (!match) continue;
  records++;
  const [, asn, description, country] = match;
  const carrier = groups.find(([pattern]) => pattern.test(description))?.[1];
  if (carrier || ['CN', 'HK', 'MO', 'TW'].includes(country)) operators[asn] = carrier || `${description.split(' - ')[0].slice(0, 64)} · AS${asn}`;
}
assert.ok(records > 100000, 'Use the complete RIPE ASN source, not a partial download');
for (const [asn, label] of [['4134', '中国电信'], ['4809', '中国电信'], ['4837', '中国联通'], ['9808', '中国移动']]) assert.equal(operators[asn], label);
const snapshot = { source: 'https://ftp.ripe.net/ripe/asnames/asn.txt', date: new Date().toISOString().slice(0, 10), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), scope: 'CN/HK/MO/TW organizations and known Chinese carrier networks; other ASNs remain explicit AS numbers', operators };
fs.writeFileSync(path.resolve(__dirname, '../../src/lib/analytics-operators.json'), JSON.stringify(snapshot));
console.log('OPERATOR_SNAPSHOT_BUILT', Object.keys(operators).length, 'organizations from', records, 'verified source rows');
