import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateBoundary, generateBoundaryWithSeparators } from '../src/core.js';

describe('generateBoundary', () => {
  it('returns a string', () => {
    const body = 'hello world';
    const boundary = generateBoundary(body);
    assert.equal(typeof boundary, 'string');
  });

  it('starts with the documented prefix', () => {
    const boundary = generateBoundary('');
    assert.ok(boundary.startsWith('----Boundary-'));
  });

  it('does not appear verbatim in the body', () => {
    const body = 'some content with a secret token inside';
    const boundary = generateBoundary(body);
    assert.equal(body.indexOf(boundary), -1);
  });

  it('does not collide when its CRLF+-- separator appears in the body', () => {
    // A body that contains the exact separator shape for a plausible boundary.
    const trap = '\r\n--someboundary';
    const body = 'part1' + trap + 'more';
    const boundary = generateBoundary(body);
    assert.equal(body.indexOf('\r\n--' + boundary), -1);
  });

  it('rejects a candidate that appears verbatim and retries', () => {
    // The injected source returns a fixed token the first time, which we
    // plant into the body so the first candidate is unsafe. The second call
    // returns a different token that is safe.
    const body = 'data with ----Boundary-firsttoken inside';
    let calls = 0;
    const randomSource = () => {
      calls++;
      return calls === 1 ? 'firsttoken' : 'secondtoken';
    };
    const boundary = generateBoundary(body, { randomSource });
    assert.equal(boundary, '----Boundary-secondtoken');
    assert.equal(calls, 2);
  });

  it('throws when no safe boundary is found within the attempt limit', () => {
    // Make every candidate unsafe by planting all of them in the body.
    const tokens = Array.from({ length: 20 }, (_, i) => 'tok' + i);
    const body = tokens.map((t) => '----Boundary-' + t).join(' ');
    let i = 0;
    const randomSource = () => tokens[i++];
    assert.throws(
      () => generateBoundary(body, { randomSource }),
      /Could not generate a boundary/
    );
  });

  it('throws TypeError for non-string body', () => {
    assert.throws(
      () => generateBoundary(123),
      { name: 'TypeError' }
    );
  });

  it('works with an empty body', () => {
    const boundary = generateBoundary('');
    assert.ok(boundary.length > 0);
    assert.ok(boundary.startsWith('----Boundary-'));
  });

  it('works with a body containing only whitespace and newlines', () => {
    const body = '\r\n\r\n  \t  \r\n';
    const boundary = generateBoundary(body);
    assert.equal(body.indexOf(boundary), -1);
  });
});

describe('generateBoundaryWithSeparators', () => {
  it('returns an object with boundary and separator fields', () => {
    const result = generateBoundaryWithSeparators('body');
    assert.equal(typeof result, 'object');
    assert.equal(typeof result.boundary, 'string');
    assert.equal(typeof result.start, 'string');
    assert.equal(typeof result.middle, 'string');
    assert.equal(typeof result.end, 'string');
  });

  it('start is boundary prefixed with two dashes', () => {
    const { start, boundary } = generateBoundaryWithSeparators('body');
    assert.equal(start, '--' + boundary);
  });

  it('middle is CRLF, dashes, boundary, CRLF', () => {
    const { middle, boundary } = generateBoundaryWithSeparators('body');
    assert.equal(middle, '\r\n--' + boundary + '\r\n');
  });

  it('end is CRLF, dashes, boundary, double dash, CRLF', () => {
    const { end, boundary } = generateBoundaryWithSeparators('body');
    assert.equal(end, '\r\n--' + boundary + '--\r\n');
  });

  it('the boundary does not appear in the body', () => {
    const body = 'some arbitrary content';
    const { boundary } = generateBoundaryWithSeparators(body);
    assert.equal(body.indexOf(boundary), -1);
  });
});
