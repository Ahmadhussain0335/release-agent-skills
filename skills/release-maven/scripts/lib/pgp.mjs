// Reads the issuer (key ID / fingerprint) from an ASCII-armored detached
// OpenPGP signature (RFC 4880 / RFC 9580). Public data only; no crypto.

export function dearmor(text) {
  const m = text.match(/-----BEGIN PGP SIGNATURE-----\r?\n([\s\S]*?)-----END PGP SIGNATURE-----/);
  if (!m) throw new Error('not an ASCII-armored PGP signature');
  const lines = m[1].split(/\r?\n/);
  // Armor headers end at the first empty line, if any are present.
  const blank = lines.findIndex((l) => l.trim() === '');
  const hasHeaders = blank > 0 && lines.slice(0, blank).every((l) => /^[\w-]+: /.test(l));
  const body = (hasHeaders ? lines.slice(blank + 1) : lines).filter((l) => l && !l.startsWith('='));
  return Buffer.from(body.join(''), 'base64');
}

function packetHeader(buf, pos) {
  const b = buf[pos];
  if (!(b & 0x80)) throw new Error('invalid packet header');
  if (b & 0x40) {
    const tag = b & 0x3f;
    const o = buf[pos + 1];
    if (o < 192) return { tag, len: o, start: pos + 2 };
    if (o < 224) return { tag, len: ((o - 192) << 8) + buf[pos + 2] + 192, start: pos + 3 };
    if (o === 255) return { tag, len: buf.readUInt32BE(pos + 2), start: pos + 6 };
    throw new Error('partial-length signature packets are not supported');
  }
  const tag = (b >> 2) & 0x0f;
  const lt = b & 0x03;
  if (lt === 0) return { tag, len: buf[pos + 1], start: pos + 2 };
  if (lt === 1) return { tag, len: buf.readUInt16BE(pos + 1), start: pos + 3 };
  if (lt === 2) return { tag, len: buf.readUInt32BE(pos + 1), start: pos + 5 };
  return { tag, len: buf.length - pos - 1, start: pos + 1 };
}

function readSubpackets(buf, start, end, out) {
  let p = start;
  while (p < end) {
    let len = buf[p];
    if (len < 192) p += 1;
    else if (len < 255) { len = ((len - 192) << 8) + buf[p + 1] + 192; p += 2; }
    else { len = buf.readUInt32BE(p + 1); p += 5; }
    const type = buf[p] & 0x7f;
    const data = buf.subarray(p + 1, p + len);
    if (type === 33 && data.length > 1) out.fingerprint = data.subarray(1).toString('hex').toUpperCase();
    if (type === 16 && data.length === 8) out.keyId = data.toString('hex').toUpperCase();
    if (type === 2 && data.length === 4) out.created = new Date(data.readUInt32BE(0) * 1000).toISOString();
    p += len;
  }
}

export function signatureInfo(armored) {
  const buf = dearmor(armored);
  const { tag, len, start } = packetHeader(buf, 0);
  if (tag !== 2) throw new Error(`expected a signature packet, found tag ${tag}`);
  const body = buf.subarray(start, start + len);
  const version = body[0];
  const out = { version };
  if (version === 3) {
    out.keyId = body.subarray(7, 15).toString('hex').toUpperCase();
  } else if (version === 4 || version === 5 || version === 6) {
    const wide = version === 6;
    let p = 4;
    const hashedLen = wide ? body.readUInt32BE(p) : body.readUInt16BE(p);
    p += wide ? 4 : 2;
    readSubpackets(body, p, p + hashedLen, out);
    p += hashedLen;
    const unhashedLen = wide ? body.readUInt32BE(p) : body.readUInt16BE(p);
    p += wide ? 4 : 2;
    readSubpackets(body, p, p + unhashedLen, out);
  } else {
    throw new Error(`unsupported signature version ${version}`);
  }
  if (!out.keyId && out.fingerprint) out.keyId = out.fingerprint.slice(-16);
  return out;
}
