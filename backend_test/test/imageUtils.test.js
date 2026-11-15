import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { sniffImageType, sha256Hex, normalizeImageHash } from '../src/utils/imageUtils.js'

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)])
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 2)])
const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 3)])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBP'), Buffer.alloc(16)])

test('sniffImageType recognises the four allowed formats from their bytes', () => {
  assert.equal(sniffImageType(png), 'png')
  assert.equal(sniffImageType(jpg), 'jpg')
  assert.equal(sniffImageType(gif), 'gif')
  assert.equal(sniffImageType(webp), 'webp')
})

test('sniffImageType rejects disguised or unsupported files', () => {
  assert.equal(sniffImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null)
  assert.equal(sniffImageType(Buffer.from('<?php echo 1; ?>' + ' '.repeat(40))), null)
  assert.equal(sniffImageType(Buffer.from('%PDF-1.7 ' + 'x'.repeat(40))), null)
  assert.equal(sniffImageType(Buffer.alloc(0)), null)
  assert.equal(sniffImageType(Buffer.from('RIFF1234WAVEfmt ')), null) // RIFF but not WEBP
  assert.equal(sniffImageType('not a buffer'), null)
})

test('sha256Hex matches node crypto over the exact bytes', () => {
  assert.equal(sha256Hex(png), crypto.createHash('sha256').update(png).digest('hex'))
  assert.match(sha256Hex(png), /^[0-9a-f]{64}$/)
  assert.notEqual(sha256Hex(png), sha256Hex(Buffer.concat([png, Buffer.from([0])])))
})

test('normalizeImageHash accepts a SHA-256 with or without 0x, any case', () => {
  const h = 'ab'.repeat(32)
  assert.equal(normalizeImageHash(`0x${h}`), h)
  assert.equal(normalizeImageHash(h.toUpperCase()), h)
  assert.equal(normalizeImageHash(`  0x${h}  `), h)
})

test('normalizeImageHash rejects anything that is not a SHA-256 (path / URL injection)', () => {
  for (const bad of ['', null, undefined, '0x1234', '../../etc/passwd', 'ab'.repeat(32) + '/../x', `0x${'ab'.repeat(31)}zz`, 'a/b'.repeat(22), `${'ab'.repeat(32)}?x=1`, `0x${'ab'.repeat(33)}`]) {
    assert.equal(normalizeImageHash(bad), null, `should reject ${bad}`)
  }
})
