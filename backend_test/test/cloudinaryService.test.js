import test from 'node:test'
import assert from 'node:assert/strict'
import { v2 as cloudinary } from 'cloudinary'
import { ApiError } from '../src/utils/ApiError.js'

// Fake credentials: nothing here ever reaches the network, the SDK's uploader is replaced below.
process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud'
process.env.CLOUDINARY_API_KEY = '123456789012345'
process.env.CLOUDINARY_API_SECRET = 'not-a-real-secret'
delete process.env.CLOUDINARY_FOLDER

const { uploadVerifiedImage, buildImagePublicId, buildAvatarPublicId, mapCloudinaryError } = await import('../src/services/cloudinaryService.js')
const { getImageFolder, isCloudinaryConfigured } = await import('../src/config/cloudinary.js')

const HASH = 'cd'.repeat(32)
const bytes = Buffer.from('original-bytes-must-not-change')

/** Replaces upload_stream with a fake that records what it was given. */
function fakeUploader(respond) {
  const calls = []
  cloudinary.uploader.upload_stream = (options, cb) => {
    const call = { options, written: null }
    calls.push(call)
    return {
      on() {},
      end(buf) {
        call.written = buf
        respond(cb, options)
      },
    }
  }
  return calls
}

test('public ids are "<folder>/<hash>" and "<folder>/avatars/<hash>"', () => {
  assert.equal(getImageFolder(), 'trove')
  assert.equal(buildImagePublicId(HASH), `trove/${HASH}`)
  assert.equal(buildAvatarPublicId(HASH), `trove/avatars/${HASH}`)
  process.env.CLOUDINARY_FOLDER = '/trove-dev/'
  assert.equal(buildImagePublicId(HASH), `trove-dev/${HASH}`)
  process.env.CLOUDINARY_FOLDER = '../evil'
  assert.throws(() => getImageFolder(), /CLOUDINARY_FOLDER/)
  delete process.env.CLOUDINARY_FOLDER
})

test('upload sends the untouched bytes with overwrite disabled and a fixed name', async () => {
  const calls = fakeUploader((cb, o) =>
    cb(null, { public_id: o.public_id, secure_url: `https://res.cloudinary.com/demo-cloud/image/upload/v1/${o.public_id}.png`, version: 1, bytes: bytes.length, format: 'png' })
  )
  const out = await uploadVerifiedImage({ buffer: bytes, publicId: buildImagePublicId(HASH) })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].written, bytes, 'the exact buffer is streamed — no re-encoding')
  const o = calls[0].options
  assert.equal(o.public_id, `trove/${HASH}`)
  assert.equal(o.overwrite, false)
  assert.equal(o.unique_filename, false)
  assert.equal(o.use_filename, false)
  assert.equal(o.resource_type, 'image')
  assert.deepEqual(o.allowed_formats, ['png', 'jpg', 'webp', 'gif'])
  assert.equal(o.eager, undefined, 'no transformation is baked into the stored original')
  assert.equal(o.transformation, undefined)
  assert.equal(out.existing, false)
  assert.match(out.secureUrl, /^https:\/\/res\.cloudinary\.com\/demo-cloud\//)
})

test('an already-stored image is reported as existing, not as an error', async () => {
  fakeUploader((cb, o) => cb(null, { public_id: o.public_id, secure_url: 'https://res.cloudinary.com/demo-cloud/image/upload/v1/x.png', existing: true }))
  const out = await uploadVerifiedImage({ buffer: bytes, publicId: `trove/${HASH}` })
  assert.equal(out.existing, true)
})

test('Cloudinary failures become friendly ApiErrors without leaking details', async () => {
  const cases = [
    [{ http_code: 401, message: 'Invalid api_key 123' }, 502],
    [{ http_code: 429, message: 'Rate Limit Exceeded' }, 503],
    [{ http_code: 420, message: 'Rate Limit Exceeded' }, 503],
    [{ http_code: 400, message: 'Invalid image file' }, 400],
    [{ http_code: 499, name: 'TimeoutError', message: 'Request Timeout' }, 504],
    [{ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.cloudinary.com' }, 502],
    [{ http_code: 500, message: 'boom' }, 502],
  ]
  const realError = console.error
  console.error = () => {}
  try {
    for (const [raw, status] of cases) {
      fakeUploader((cb) => cb(raw))
      await assert.rejects(
        uploadVerifiedImage({ buffer: bytes, publicId: `trove/${HASH}` }),
        (err) => err instanceof ApiError && err.statusCode === status && !/api_key|123|ENOTFOUND|boom/.test(err.message),
        `http_code ${raw.http_code ?? raw.code} should map to ${status}`
      )
    }
  } finally {
    console.error = realError
  }
  assert.ok(mapCloudinaryError(new ApiError(418, 'x')) instanceof ApiError)
})

test('without CLOUDINARY_* set, upload is refused with a clear 503 (the API itself keeps running)', async () => {
  const saved = process.env.CLOUDINARY_API_SECRET
  delete process.env.CLOUDINARY_API_SECRET
  assert.equal(isCloudinaryConfigured(), false)
  await assert.rejects(uploadVerifiedImage({ buffer: bytes, publicId: `trove/${HASH}` }), (e) => e.statusCode === 503 && /not configured/.test(e.message))
  process.env.CLOUDINARY_API_SECRET = saved
})

test('an empty or non-buffer payload is rejected before any network call', async () => {
  const calls = fakeUploader(() => {})
  await assert.rejects(uploadVerifiedImage({ buffer: Buffer.alloc(0), publicId: 'trove/x' }), (e) => e.statusCode === 400)
  await assert.rejects(uploadVerifiedImage({ buffer: 'http://evil.example/a.png', publicId: 'trove/x' }), (e) => e.statusCode === 400)
  assert.equal(calls.length, 0)
})
