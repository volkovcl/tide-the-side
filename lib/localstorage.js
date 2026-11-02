'use strict';

// Chromium keeps a web page's localStorage in LevelDB. For the claude.ai page:
//   key   = "_https://claude.ai" 0x00 0x01 <key name in latin-1>
//   value = 0x01 <latin-1 text>   or   0x00 <UTF-16LE text>
// None of this is documented. Anything else makes the tool stop.

const { StopError } = require('./errors');

const ORIGIN = '_https://claude.ai';
const KEY_PREFIX = Buffer.concat([Buffer.from(ORIGIN, 'latin1'), Buffer.from([0x00, 0x01])]);
// Upper bound for iterating every latin-1 key of the origin.
const KEY_PREFIX_END = Buffer.concat([Buffer.from(ORIGIN, 'latin1'), Buffer.from([0x00, 0x02])]);

function keyFor(name) {
  if (!/^[\x20-\x7e]+$/.test(name)) throw new StopError(`unexpected characters in key name: ${JSON.stringify(name)}`);
  return Buffer.concat([KEY_PREFIX, Buffer.from(name, 'latin1')]);
}

function nameOf(key) {
  if (key.length <= KEY_PREFIX.length) return null;
  if (!key.subarray(0, KEY_PREFIX.length).equals(KEY_PREFIX)) return null;
  return key.subarray(KEY_PREFIX.length).toString('latin1');
}

function decodeValue(buf, keyName) {
  if (!Buffer.isBuffer(buf) || buf.length < 1) {
    throw new StopError(`value of ${keyName} is empty`);
  }
  const kind = buf[0];
  if (kind === 0x01) return { text: buf.subarray(1).toString('latin1'), encoding: 'latin1' };
  if (kind === 0x00) {
    if ((buf.length - 1) % 2 !== 0) throw new StopError(`value of ${keyName} has an odd UTF-16 length`);
    return { text: buf.subarray(1).toString('utf16le'), encoding: 'utf16' };
  }
  throw new StopError(`value of ${keyName} starts with byte 0x${kind.toString(16).padStart(2, '0')}; expected 0x00 or 0x01`);
}

// Like Chromium: latin-1 when every character fits, UTF-16LE otherwise.
function encodeValue(text) {
  if (/^[\x00-\xff]*$/.test(text)) {
    return Buffer.concat([Buffer.from([0x01]), Buffer.from(text, 'latin1')]);
  }
  return Buffer.concat([Buffer.from([0x00]), Buffer.from(text, 'utf16le')]);
}

module.exports = { KEY_PREFIX, KEY_PREFIX_END, keyFor, nameOf, decodeValue, encodeValue };
