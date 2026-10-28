// Minimal Java .properties parser. Values may be secrets: callers that report
// results must only ever expose keys, never values.
import { readFileSync, existsSync } from 'node:fs';

function unescape(s) {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => {
    if (c[0] === 'u' && c.length === 5) return String.fromCharCode(parseInt(c.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', f: '\f' }[c] ?? c;
  });
}

export function parseProperties(text) {
  const out = new Map();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].replace(/^\s+/, '');
    if (!line || line[0] === '#' || line[0] === '!') continue;
    // A line ending in an odd number of backslashes continues on the next line.
    while (/(^|[^\\])(\\\\)*\\$/.test(line) && i + 1 < lines.length) {
      line = line.slice(0, -1) + lines[++i].replace(/^\s+/, '');
    }
    const m = line.match(/^((?:\\.|[^=:\s\\])+)\s*[=:\s]\s*(.*)$/) ?? line.match(/^((?:\\.|[^=:\s\\])+)$/);
    if (!m) continue;
    out.set(unescape(m[1]), unescape(m[2] ?? ''));
  }
  return out;
}

export function readProperties(file) {
  if (!existsSync(file)) return null;
  return parseProperties(readFileSync(file, 'utf8'));
}
