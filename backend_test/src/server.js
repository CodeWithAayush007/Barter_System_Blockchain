// src/server.js
import 'dotenv/config'
import app from './app.js'
import { connectDB } from './config/db.js'
import { isCloudinaryConfigured, getImageFolder } from './config/cloudinary.js'

const PORT = process.env.PORT || 5000

async function start() {
  await connectDB() // never throws — a missing database only puts the API in degraded mode
  getImageFolder() // fail fast on an invalid CLOUDINARY_FOLDER
  if (isCloudinaryConfigured()) {
    console.log(`[images] Cloudinary configured (cloud "${process.env.CLOUDINARY_CLOUD_NAME}", folder "${getImageFolder()}")`)
  } else {
    console.warn('[images] Cloudinary is NOT configured — photo uploads will answer 503. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in backend_test/.env.')
  }
  app.listen(PORT, () => {
    console.log(`[server] Trove API listening on http://localhost:${PORT}`)
  })
}

start().catch((err) => {
  console.error('[server] failed to start:', err)
  process.exit(1)
})
