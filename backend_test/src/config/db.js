// src/config/db.js
import dns from 'node:dns'
import mongoose from 'mongoose'

// --- Windows + mongodb+srv:// DNS workaround -----------------------------
// Node resolves `mongodb+srv://` hosts itself via its bundled c-ares
// resolver (dns.resolveSrv), which talks directly to whatever DNS servers
// your network adapter is configured with. On many home routers / some
// corporate networks, that resolver either doesn't proxy SRV record
// queries correctly or actively refuses them — producing exactly:
//
//   querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
//
// Meanwhile `nslookup`, PowerShell's `Resolve-DnsName`, and .NET's
// System.Net.Dns all go through the Windows DNS Client service, which
// has its own resolution path/cache and works fine — so those tools
// succeeding while Node fails is the expected signature of this issue,
// not a contradiction. It is not caused by your code, Atlas config, or
// Node version.
//
// Pointing Node's resolver at a public DNS service that reliably serves
// SRV records (Google/Cloudflare) sidesteps the broken hop entirely.
if (process.env.DNS_SERVERS) {
  dns.setServers(process.env.DNS_SERVERS.split(',').map((s) => s.trim()))
} else {
  dns.setServers(['8.8.8.8', '1.1.1.1'])
}
// ---------------------------------------------------------------------------

const RETRY_MS = 10_000
let retryTimer = null

/** True while the MongoDB connection is open. */
export function isDbConnected() {
  return mongoose.connection.readyState === 1
}

/**
 * Connects to MongoDB WITHOUT ever stopping the API.
 *
 * Trading itself runs on the blockchain and doesn't touch this database, so a
 * missing/unreachable MongoDB must not take the whole backend down. If the first
 * attempt fails, the API still starts (routes answer 503 "database not connected"
 * — see app.js) and the connection is retried every few seconds until it works.
 */
export async function connectDB() {
  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.warn(
      '[db] MONGODB_URI is not set — starting WITHOUT a database. ' +
      'Set it in backend_test/.env (a local MongoDB or an Atlas string) to enable sign-in, photos and the activity feed.'
    )
    return false
  }

  mongoose.set('strictQuery', true)

  let everConnected = false
  let hintShown = false
  mongoose.connection.on('connected', () => {
    everConnected = true
    console.log(`[db] connected → ${mongoose.connection.name}`)
  })
  mongoose.connection.on('disconnected', () => {
    if (everConnected) console.warn('[db] disconnected — will reconnect')
  })

  let connecting = false
  const attempt = async () => {
    if (connecting || isDbConnected()) return isDbConnected()
    connecting = true
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 })
      if (retryTimer) { clearInterval(retryTimer); retryTimer = null }
      return true
    } catch (err) {
      if (hintShown) {
        console.warn('[db] still not connected — retrying…')
        return false
      }
      hintShown = true
      console.error('[db] connection failed:', err.message)

      if (err.message?.includes('querySrv') || err.message?.includes('ECONNREFUSED')) {
        console.error(
          '[db] Is MongoDB running at the address in MONGODB_URI? For an Atlas "mongodb+srv://" string on Windows, ' +
          'this can also be the Node SRV-record DNS issue: set DNS_SERVERS in .env (e.g. 1.1.1.1,8.8.8.8), or use ' +
          'the standard "mongodb://" string from Atlas (Database > Connect > Drivers).'
        )
      }
      return false
    } finally {
      connecting = false
    }
  }

  const ok = await attempt()
  if (!ok) {
    console.warn(`[db] The API is starting anyway; it will keep retrying every ${RETRY_MS / 1000}s. Trading on the blockchain is unaffected.`)
    retryTimer = setInterval(attempt, RETRY_MS)
    retryTimer.unref?.()
  }
  return ok
}
