# http-multipart-boundary

Generates boundary strings for multipart bodies that are guaranteed not to appear in a given payload.

## Usage

```js
import { generateBoundary, generateBoundaryWithSeparators } from 'http-multipart-boundary';

const body = '--some-content--';
const boundary = generateBoundary(body);
// '----Boundary-<random token>'

const { start, middle, end } = generateBoundaryWithSeparators(body);
// start:  '--<boundary>'
// middle: '\r\n--<boundary>\r\n'
// end:    '\r\n--<boundary>--\r\n'
```

## Why

When building a multipart body, the boundary delimiter must not occur anywhere in the enclosed data. Most implementations pick a random string and hope. This library picks a random string and then verifies it does not appear in the body, retrying with fresh randomness if it does.

The trade-off is a small amount of extra work per body: we scan the payload once per candidate. For typical request sizes this is negligible. The benefit is that the boundary cannot collide with the data, which is the entire point of the delimiter.

## Edge cases

- The body is checked for both the raw boundary token and the full `CRLF + "--" + boundary` separator sequence, because the separator is what a parser actually looks for on the wire. A boundary whose token appears inside the body but never as a separator is still rejected, because a sufficiently clever parser or a later body mutation could trip on it.
- If the library cannot find a safe boundary after ten attempts it throws. In practice this means the body contains a fragment that matches every candidate, which requires the body to be adversarial against the random source.
- The library refuses to fall back to `Math.random`. If no secure random source is available at module load time, importing it throws rather than silently weakening the guarantee.

## Performance

The window keeps a bounded buffer, so `push` is constant time and memory does not
grow with the length of the stream. `peak` and `trough` are linear in the window
size, which is the trade that keeps `push` cheap.

