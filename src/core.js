/**
 * Core boundary generation logic.
 *
 * @module core
 */

/**
 * Length of the randomness portion of a boundary, in bytes before base64
 * encoding. 15 bytes encode to 20 base64 characters (no padding), which keeps
 * the full boundary well under the 70-character guideline from RFC 2046
 * §5.1.1 while providing 120 bits of entropy — enough that a colliding body
 * fragment is astronomically unlikely even before we check.
 */
const RANDOM_BYTES = 15;

/**
 * Maximum number of generation attempts before we give up. Each attempt
 * draws fresh randomness so collisions are independent; ten tries covers a
 * body so adversarial that the user has bigger problems than this library.
 */
const MAX_ATTEMPTS = 10;

/**
 * Where available, pull crypto from the built-in `node:` module. Storing it
 * once at load time avoids repeated dynamic-import churn on the hot path.
 * `globalThis` keeps us compatible with browsers that expose `crypto` there.
 */
let cryptoGetRandomValuesImpl = null;

if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) {
  cryptoGetRandomValuesImpl = (len) => globalThis.crypto.getRandomValues(new Uint8Array(len));
} else {
  // Node 18+ and modern browsers have globalThis.crypto. For older runtimes
  // we try the synchronous path on the node:crypto module. This keeps the
  // library zero-dependency while still working where WebCrypto is absent.
  try {
    const { randomFillSync } = await import('node:crypto');
    cryptoGetRandomValuesImpl = (len) => {
      const buf = new Uint8Array(len);
      randomFillSync(buf);
      return buf;
    };
  } catch {
    // No deterministic fallback: we refuse to generate a boundary from
    // Math.random() because the whole point is that the body cannot predict
    // it. Throwing here is safer than silently weakening the guarantee.
    throw new Error('No secure random source available');
  }
}

/**
 * Encode an array of bytes as a base64 string without padding. RFC 2046
 * forbids padding characters in boundary strings, and stripping them keeps
 * the output shorter — the missing bits are irrelevant given our entropy.
 *
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64UrlNoPad(bytes) {
  // We avoid Buffer intentionally so the function is environment-agnostic.
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let out = '';
  let i = 0;
  const len = bytes.length;
  while (i < len) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    out += chars[b0 >> 2];
    out += chars[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += chars[((b1 & 0x0f) << 2) | (b2 >> 6)];
    out += chars[b2 & 0x3f];
    i += 3;
  }
  // Trim the characters produced from the zero-padded tail.
  const remainder = len % 3;
  if (remainder === 1) return out.slice(0, -2);
  if (remainder === 2) return out.slice(0, -1);
  return out;
}

/**
 * Generate a single candidate boundary string.
 *
 * @param {() => string} [randomSource] Optional injectable source returning a
 *   base64url-without-padding string. Used by tests for determinism.
 * @returns {string}
 */
function makeBoundary(randomSource) {
  if (randomSource) {
    return '----Boundary-' + randomSource();
  }
  const bytes = cryptoGetRandomValuesImpl(RANDOM_BYTES);
  return '----Boundary-' + base64UrlNoPad(bytes);
}

/**
 * Determine whether a candidate boundary is safe to use against `body`.
 *
 * A boundary is unsafe if it appears verbatim anywhere in the body, OR if the
 * CRLF+"--"+boundary separator sequence appears — because that is the exact
 * byte sequence a parser uses to delimit parts, and even a substring match
 * there would cause a parser to split the body prematurely. We check both
 * rather than just the raw boundary token because the separator is what
 * actually occurs in the wire format.
 *
 * @param {string} boundary
 * @param {string} body
 * @returns {boolean}
 */
function isSafe(boundary, body) {
  if (body.indexOf(boundary) !== -1) return false;
  const separator = '\r\n--' + boundary;
  if (body.indexOf(separator) !== -1) return false;
  return true;
}

/**
 * Generate a boundary string guaranteed not to appear in `body`.
 *
 * @param {string} body The multipart payload to scan, without any
 *   boundaries inserted yet.
 * @param {object} [options]
 * @param {() => string} [options.randomSource] Injectable randomness for
 *   testing; must return a base64url-no-pad-style token each call.
 * @returns {string} A boundary string safe for use with `body`.
 * @throws {Error} If no safe boundary can be found within MAX_ATTEMPTS, or if
 *   no secure random source is available at module load time.
 */
export function generateBoundary(body, options = {}) {
  if (typeof body !== 'string') {
    throw new TypeError('body must be a string');
  }
  const { randomSource } = options;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const boundary = makeBoundary(randomSource);
    if (isSafe(boundary, body)) {
      return boundary;
    }
  }
  throw new Error('Could not generate a boundary not present in the body after ' + MAX_ATTEMPTS + ' attempts');
}

/**
 * Generate a boundary and return it together with the properly framed
 * separator strings a caller needs to actually build a multipart body.
 *
 * The returned `start`, `middle`, and `end` values are the exact byte
 * sequences that should separate parts, so callers do not have to remember
 * the leading "--" or the trailing "--" on the final delimiter.
 *
 * @param {string} body
 * @param {object} [options]
 * @returns {{boundary: string, start: string, middle: string, end: string}}
 */
export function generateBoundaryWithSeparators(body, options = {}) {
  const boundary = generateBoundary(body, options);
  return {
    boundary,
    start: '--' + boundary,
    middle: '\r\n--' + boundary + '\r\n',
    end: '\r\n--' + boundary + '--\r\n',
  };
}
