/**
 * e2e-images.mjs — checks the whole photo workflow against your REAL local blockchain.
 *
 *   Terminal 1:  cd Blockchain && npm run node
 *   Terminal 2:  cd Blockchain && npm run deploy:local
 *   Terminal 3:  cd backend_test && npm run e2e:images
 *
 * What is real:   the Express app (src/app.js, with its helmet / rate limit / multer / JWT / error
 *                 handling), the chain reads, and the four contracts — listings and trade requests are
 *                 created with real transactions from Hardhat accounts #1–#3.
 * What is faked:  Cloudinary's network call (an in-memory store that, like Cloudinary, refuses to
 *                 overwrite an existing public_id), MongoDB (not needed for uploads), and the sign-in
 *                 handshake (tokens are minted with your JWT_SECRET, which is what /auth/verify returns).
 *                 No real Cloudinary account is contacted and nothing is uploaded anywhere.
 *
 * It ADDS a few listings / requests to the chain it runs against, so use a throw-away dev chain.
 * Exit code 0 = every check passed.
 */
import 'dotenv/config'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { ethers } from 'ethers'
import jwt from 'jsonwebtoken'
import mongoose from 'mongoose'
import { v2 as cloudinary } from 'cloudinary'

// This script sets Express's 'trust proxy' (so each request can carry its own client address); the rate-limit
// library only warns about that. Hide that one warning, keep every other error visible.
const realConsoleError = console.error
console.error = (...a) => { if (!String(a[0]?.code ?? a[0]).includes('ERR_ERL_PERMISSIVE_TRUST_PROXY')) realConsoleError(...a) }

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..', '..')
const CLOUD = (process.env.CLOUDINARY_CLOUD_NAME ||= 'e2e-cloud')
process.env.CLOUDINARY_API_KEY ||= '000000000000000'
process.env.CLOUDINARY_API_SECRET ||= 'e2e-not-a-real-secret'
process.env.JWT_SECRET ||= 'e2e-jwt-secret'
const RPC = process.env.CHAIN_RPC_URL || 'http://127.0.0.1:8545'

// ── tiny test harness ─────────────────────────────────────────────────────────
let passed = 0
const failures = []
function check(name, ok, detail = '') {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failures.push(name)
    console.log(`  ✗ ${name}${detail ? `\n      ${detail}` : ''}`)
  }
}
const section = (t) => console.log(`\n${t}`)

// ── fake Cloudinary (overwrite:false semantics) ───────────────────────────────
const store = new Map() // public_id -> { bytes, res }
const uploadOptions = []
let failNext = null
cloudinary.uploader.upload_stream = (options, cb) => ({
  on() {},
  end(buf) {
    uploadOptions.push(options)
    setImmediate(() => {
      if (failNext) {
        const err = failNext
        failNext = null
        return cb(err)
      }
      const id = options.public_id
      if (store.has(id) && options.overwrite === false) return cb(null, { ...store.get(id).res, existing: true })
      const res = {
        public_id: id,
        secure_url: `https://res.cloudinary.com/${CLOUD}/image/upload/v${store.size + 1}/${id}.png`,
        version: store.size + 1,
        bytes: buf.length,
        format: 'png',
      }
      store.set(id, { bytes: Buffer.from(buf), res })
      cb(null, res)
    })
  },
})

// ── MongoDB is not used by the photo routes: pretend it is connected, stub the two models we touch ──
const { default: User } = await import('../src/models/User.js') // compile the models first …
const { default: Activity } = await import('../src/models/Activity.js')
Object.defineProperty(mongoose.connection, 'readyState', { get: () => 1, configurable: true }) // … then report "connected"
const fakeUser = { address: null, username: null, bio: '', avatarUrl: null, async save() { return this } }
User.findOne = async () => fakeUser
let activityOps = []
Activity.bulkWrite = async (ops) => { activityOps = ops }

const { default: app } = await import('../src/app.js')
app.set('trust proxy', true) // lets each request below carry its own X-Forwarded-For, so the rate limiter does not interfere
const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)) })
const BASE = `http://127.0.0.1:${server.address().port}`

// ── helpers ───────────────────────────────────────────────────────────────────
let ipCounter = 10
const nextIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`
const tokenFor = (addr) => jwt.sign({ address: addr.toLowerCase() }, process.env.JWT_SECRET, { expiresIn: '1h' })

/** A real, valid 4×4 PNG whose pixels depend on `seed` — a different seed is a different file. */
function makePng(seed) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 2
  const px = crypto.createHash('sha256').update(String(seed)).digest()
  const raw = Buffer.concat(Array.from({ length: 4 }, (_, y) => Buffer.concat([Buffer.from([0]), px.subarray(y * 12, y * 12 + 12)])))
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const hashOf = (buf) => `0x${crypto.createHash('sha256').update(buf).digest('hex')}`

async function send(method, route, { token, fields = {}, file, ip = nextIp() } = {}) {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v))
  if (file) form.append(file.field || 'image', new Blob([file.bytes], { type: file.type || 'image/png' }), file.name || 'photo.png')
  const headers = { 'X-Forwarded-For': ip }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${BASE}${route}`, { method, headers, body: form })
  let json = null
  try { json = await res.json() } catch { /* no body */ }
  return { status: res.status, json }
}
const uploadListing = (id, bytes, token, extra = {}) => send('POST', '/api/images/listings', { token, fields: { onChainListingId: id }, file: { bytes, ...extra } })
const uploadRequest = (id, bytes, token, extra = {}) => send('POST', '/api/images/requests', { token, fields: { onChainRequestId: id }, file: { bytes, ...extra } })

// ── chain setup ───────────────────────────────────────────────────────────────
const provider = new ethers.JsonRpcProvider(RPC)
try {
  await provider.getNetwork()
} catch {
  console.error(`Cannot reach a blockchain node at ${RPC}. Start it (cd Blockchain && npm run node) and deploy (npm run deploy:local) first.`)
  server.close()
  process.exit(2)
}
const deployments = JSON.parse(fs.readFileSync(path.join(root, 'Blockchain', 'deployments.json'), 'utf8')).contracts
const abi = (name) => JSON.parse(fs.readFileSync(path.join(root, 'Frontend', 'src', 'blockchain', 'abi', `${name}.json`), 'utf8'))
if ((await provider.getCode(deployments.BarterAgreement)) === '0x') {
  console.error('No BarterAgreement at the saved address — the node was restarted. Run `npm run deploy:local` in Blockchain/ again.')
  server.close()
  process.exit(2)
}
const [, seller, buyer, attacker] = await Promise.all([0, 1, 2, 3].map((i) => provider.getSigner(i)))
const [sellerAddr, buyerAddr, attackerAddr] = [seller.address, buyer.address, attacker.address]
const agreement = new ethers.Contract(deployments.BarterAgreement, abi('BarterAgreement'), provider)
const tokenC = new ethers.Contract(deployments.BarterToken, abi('BarterToken'), provider)
const BTK = (n) => ethers.parseUnits(String(n), 18)
const T = { BARTER: 0, SELL: 1, BUY: 2 }

for (const s of [seller, buyer, attacker]) {
  if (!(await tokenC.hasClaimedStarterTokens(s.address))) await (await tokenC.connect(s).claimStarterTokens()).wait()
}
async function makeListing(signer, type, title, imageHash, { wait = true } = {}) {
  const tx = await agreement.connect(signer).createListing(type, title, 'Electronics', 'e2e listing', type === T.BARTER ? 'anything' : '', imageHash, ethers.parseEther('0.01'), BTK(10))
  const receipt = await tx.wait()
  return { id: Number((await agreement.nextListingId()) - 1n), txHash: receipt.hash }
}
async function makeRequest(signer, listingId, imageHash) {
  await (await tokenC.connect(signer).approve(deployments.Escrow, BTK(10))).wait()
  const value = await agreement.requesterEthRequired(listingId)
  await (await agreement.connect(signer).requestTrade(listingId, 'my item', 'e2e', imageHash, { value })).wait()
  return Number((await agreement.nextRequestId()) - 1n)
}

const run = Date.now()
const imgBarter = makePng(`barter-${run}`)
const imgSell = makePng(`sell-${run}`)
const imgBuy = makePng(`buy-${run}`)
const imgOffer = makePng(`offer-${run}`)
const imgOther = makePng(`other-${run}`)
const tSeller = tokenFor(sellerAddr)
const tBuyer = tokenFor(buyerAddr)
const tAttacker = tokenFor(attackerAddr)
const pid = (hash) => `trove/${hash.slice(2)}`

// ═════════════════════════════════════════════════════════════════════════════
section('1–3. Listings with an image (barter, sell, buy)')
const barter = await makeListing(seller, T.BARTER, 'E2E barter', hashOf(imgBarter))
const sell = await makeListing(seller, T.SELL, 'E2E sell', hashOf(imgSell))
const buy = await makeListing(buyer, T.BUY, 'E2E buy', hashOf(imgBuy))
for (const [label, l, img, tok] of [['barter', barter, imgBarter, tSeller], ['sell', sell, imgSell, tSeller], ['buy', buy, imgBuy, tBuyer]]) {
  const r = await uploadListing(l.id, img, tok)
  check(`${label} listing #${l.id}: upload accepted (201)`, r.status === 201, JSON.stringify(r))
  check(`${label}: stored as "${pid(hashOf(img)).slice(0, 14)}…" (the on-chain hash)`, r.json?.publicId === pid(hashOf(img)))
  check(`${label}: response carries an https res.cloudinary.com URL for this cloud`, r.json?.secureUrl?.startsWith(`https://res.cloudinary.com/${CLOUD}/`))
  check(`${label}: the stored bytes are byte-for-byte the original file`, store.get(pid(hashOf(img)))?.bytes.equals(img))
}

section('4. A second user requests a trade and uploads the offered-item image')
const reqId = await makeRequest(buyer, barter.id, hashOf(imgOffer))
const rr = await uploadRequest(reqId, imgOffer, tBuyer)
check(`request #${reqId}: upload accepted (201)`, rr.status === 201, JSON.stringify(rr))
check('request: stored under the request’s on-chain hash', rr.json?.publicId === pid(hashOf(imgOffer)))

section('Upload options sent to Cloudinary')
check('every upload used overwrite:false, no filename-derived names, no remote URL', uploadOptions.every((o) => o.overwrite === false && o.unique_filename === false && o.use_filename === false && o.type === 'upload' && !('url' in o)))

section('7. Invalid files are rejected')
let before = store.size
let r = await uploadListing(barter.id, Buffer.from('this is plainly not an image, but is labelled image/png'.repeat(3)), tSeller)
check('text file labelled image/png → 400 (magic-byte check)', r.status === 400 && /not a valid/i.test(r.json?.error?.message), JSON.stringify(r))
r = await uploadListing(barter.id, imgBarter, tSeller, { type: 'application/pdf', name: 'x.pdf' })
check('declared type application/pdf → 400', r.status === 400, JSON.stringify(r))
r = await uploadListing(barter.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), tSeller, { type: 'image/svg+xml' })
check('SVG → 400', r.status === 400, JSON.stringify(r))
r = await uploadListing(barter.id, Buffer.concat([imgBarter, Buffer.alloc(6 * 1024 * 1024)]), tSeller)
check('6 MB file (limit 5 MB) → 400 "smaller than"', r.status === 400 && /smaller than/i.test(r.json?.error?.message), JSON.stringify(r))
r = await send('POST', '/api/images/listings', { token: tSeller, fields: { onChainListingId: barter.id, url: 'https://evil.example/a.png', image: 'https://evil.example/a.png' } })
check('a remote URL instead of a file → 400, nothing fetched', r.status === 400, JSON.stringify(r))
check('none of the rejected uploads reached Cloudinary', store.size === before)

section('8. A file whose hash differs from the on-chain hash is rejected')
before = store.size
r = await uploadListing(barter.id, imgOther, tSeller)
check('different (valid) image for the listing → 400 "does not match"', r.status === 400 && /does not match/i.test(r.json?.error?.message), JSON.stringify(r))
r = await uploadRequest(reqId, imgOther, tBuyer)
check('different image for the request → 400 "does not match"', r.status === 400 && /does not match/i.test(r.json?.error?.message), JSON.stringify(r))
check('nothing new was stored', store.size === before)

section('9. Unauthorized uploads are refused')
r = await uploadListing(barter.id, imgBarter, tAttacker)
check('stranger uploads the CORRECT file for someone else’s listing → 403', r.status === 403, JSON.stringify(r))
r = await uploadListing(barter.id, imgBarter, tBuyer)
check('another trader (not the owner) → 403', r.status === 403, JSON.stringify(r))
r = await uploadRequest(reqId, imgOffer, tAttacker)
check('stranger uploads for someone else’s trade request → 403', r.status === 403, JSON.stringify(r))
r = await uploadRequest(reqId, imgOffer, tSeller)
check('the listing owner cannot upload the requester’s photo → 403', r.status === 403, JSON.stringify(r))
r = await uploadListing(barter.id, imgBarter, undefined)
check('no token → 401', r.status === 401, JSON.stringify(r))
r = await uploadListing(barter.id, imgBarter, 'not.a.jwt')
check('garbage token → 401', r.status === 401, JSON.stringify(r))
r = await uploadListing(barter.id, imgBarter, jwt.sign({ address: sellerAddr.toLowerCase() }, 'some-other-secret'))
check('token signed with a different secret → 401', r.status === 401, JSON.stringify(r))

section('Duplicates, overwrites and retries')
const versionBefore = store.get(pid(hashOf(imgBarter))).res.version
r = await uploadListing(barter.id, imgBarter, tSeller)
check('uploading the same verified file again → 200 existing:true (not an error)', r.status === 200 && r.json?.existing === true, JSON.stringify(r))
check('the stored asset was NOT replaced (version unchanged)', store.get(pid(hashOf(imgBarter))).res.version === versionBefore)
const twin = await makeListing(seller, T.BARTER, 'E2E twin (same photo)', hashOf(imgBarter))
r = await uploadListing(twin.id, imgBarter, tSeller)
check('a second listing using the same file shares the one stored image', r.status === 200 && r.json?.existing === true && r.json?.publicId === pid(hashOf(imgBarter)), JSON.stringify(r))
const parallel = await Promise.all([1, 2, 3].map(() => uploadListing(sell.id, imgSell, tSeller)))
check('3 parallel duplicate uploads all succeed and store exactly one image', parallel.every((x) => x.status === 200 || x.status === 201) && [...store.keys()].filter((k) => k === pid(hashOf(imgSell))).length === 1, JSON.stringify(parallel.map((x) => x.status)))

section('Cloudinary outage / bad credentials')
const fresh = makePng(`retry-${run}`)
const retryListing = await makeListing(seller, T.BARTER, 'E2E retry', hashOf(fresh))
const logError = console.error; console.error = () => {}
failNext = { http_code: 401, message: 'Invalid api_key 000' }
r = await uploadListing(retryListing.id, fresh, tSeller)
check('Cloudinary 401 → 502 with a safe message (no key in it)', r.status === 502 && !/api_key|000/.test(r.json?.error?.message), JSON.stringify(r))
failNext = { http_code: 429, message: 'Rate Limit Exceeded' }
r = await uploadListing(retryListing.id, fresh, tSeller)
check('Cloudinary rate limit → 503', r.status === 503, JSON.stringify(r))
console.error = logError
r = await uploadListing(retryListing.id, fresh, tSeller)
check('the retry afterwards succeeds (201) — a failed upload left nothing half-done', r.status === 201, JSON.stringify(r))

section('Bad or hostile input')
r = await uploadListing(999999, imgBarter, tSeller)
check('listing that does not exist → 404', r.status === 404, JSON.stringify(r))
r = await uploadRequest(999999, imgOffer, tBuyer)
check('request that does not exist → 404', r.status === 404, JSON.stringify(r))
r = await uploadListing('abc', imgBarter, tSeller)
check('non-numeric id → 400', r.status === 400, JSON.stringify(r))
r = await uploadListing(0, imgBarter, tSeller)
check('id 0 → 400', r.status === 400, JSON.stringify(r))
r = await send('POST', '/api/images/listings', { token: tSeller, fields: { onChainListingId: barter.id } })
check('no file → 400', r.status === 400, JSON.stringify(r))
const noPhoto = await makeListing(seller, T.BARTER, 'E2E no photo', '')
r = await uploadListing(noPhoto.id, imgBarter, tSeller)
check('listing created without an image hash → 400, nothing stored', r.status === 400, JSON.stringify(r))
before = store.size
const sneaky = await makeListing(seller, T.BARTER, 'E2E hostile hash', '../../etc/passwd')
r = await uploadListing(sneaky.id, imgBarter, tSeller)
check('a non-SHA-256 string committed on-chain ("../../etc/passwd") is never used as a name → 400', r.status === 400 && store.size === before, JSON.stringify(r))
const upperImg = makePng(`upper-${run}`)
const upperHash = `0x${hashOf(upperImg).slice(2).toUpperCase()}`
const upper = await makeListing(seller, T.BARTER, 'E2E uppercase hash', upperHash)
r = await uploadListing(upper.id, upperImg, tSeller)
check('an upper-case hash on-chain still matches and is stored under the lower-case name', r.status === 201 && r.json?.publicId === pid(hashOf(upperImg)), JSON.stringify(r))

section('Avatar upload goes to Cloudinary too (no local file)')
fakeUser.address = sellerAddr.toLowerCase()
r = await send('PUT', '/api/users/me', { token: tSeller, fields: { username: 'e2e' }, file: { field: 'avatar', bytes: makePng(`avatar-${run}`) } })
check('avatar stored on Cloudinary under <folder>/avatars/<hash>', r.status === 200 && /^https:\/\/res\.cloudinary\.com\/.+\/trove\/avatars\/[0-9a-f]{64}\.png$/.test(r.json?.avatarUrl || ''), JSON.stringify(r))
r = await send('PUT', '/api/users/me', { token: tSeller, file: { field: 'avatar', bytes: Buffer.from('not an image at all, just text ' .repeat(4)) } })
check('non-image avatar → 400', r.status === 400, JSON.stringify(r))

section('13. Removed collections / routes are really gone; activity sync still works')
for (const [m, p] of [['GET', '/api/listings'], ['GET', '/api/listings/meta?ids=1'], ['GET', '/api/listings/1'], ['GET', '/api/requests/meta?ids=1'], ['GET', '/uploads/anything.png']]) {
  const res = await fetch(`${BASE}${p}`, { method: m, headers: { 'X-Forwarded-For': nextIp() } })
  check(`${m} ${p} → 404`, res.status === 404, `got ${res.status}`)
}
check('no Listing / RequestPhoto model files remain', !fs.existsSync(path.join(here, '..', 'src', 'models', 'Listing.js')) && !fs.existsSync(path.join(here, '..', 'src', 'models', 'RequestPhoto.js')))
const syncRes = await fetch(`${BASE}/api/activity/sync`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() }, body: JSON.stringify({ txHash: barter.txHash }) })
const syncJson = await syncRes.json().catch(() => ({}))
check('POST /api/activity/sync for a ListingCreated tx still works (no listings-collection write)', syncRes.status === 200 && syncJson.synced >= 1 && activityOps.length >= 1, JSON.stringify(syncJson))

section('11. No local image files')
check('no backend_test/uploads folder exists', !fs.existsSync(path.join(here, '..', 'uploads')))

section('Rate limit on photo uploads')
const spamIp = nextIp()
const codes = []
for (let i = 0; i < 14; i++) codes.push((await send('POST', '/api/images/listings', { ip: spamIp, fields: { onChainListingId: 1 } })).status)
check('the 13th+ upload attempt from one address in a minute is answered 429', codes.includes(429) && codes.slice(0, 12).every((c) => c === 401), codes.join(','))

// ═════════════════════════════════════════════════════════════════════════════
server.close()
console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('FAILED:\n  - ' + failures.join('\n  - '))
  process.exit(1)
}
process.exit(0)
