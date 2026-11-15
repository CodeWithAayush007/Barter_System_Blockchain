// src/app.js
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import mongoSanitize from 'express-mongo-sanitize'
import rateLimit from 'express-rate-limit'

import authRoutes from './routes/auth.js'
import imageRoutes from './routes/images.js'
import userRoutes from './routes/users.js'
import activityRoutes from './routes/activity.js'
import { notFound, errorHandler } from './middleware/errorHandler.js'
import { isDbConnected } from './config/db.js'
import { ApiError } from './utils/ApiError.js'

const app = express()

// Behind Render's proxy every request would otherwise look like it comes from one IP, which breaks
// the per-IP rate limits. Trust the first proxy hop in production only.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)

app.use(helmet())
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN?.split(',') || '*',
    credentials: true,
  })
)
app.use(express.json({ limit: '1mb' }))
app.use(mongoSanitize()) // strips $/dot operators from req.body/query/params
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'))

// Global rate limit — generous for reads, tightened further below for
// the routes most worth protecting from spam/duplicate submission.
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: { message: 'Too many requests. Please slow down.' } },
  })
)

// Tighter limit on photo uploads (each one is a Cloudinary call), to blunt duplicate-click and scripted spam.
const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many submissions. Please wait a moment and try again.' } },
})
app.use('/api/images', (req, res, next) => (req.method === 'GET' ? next() : writeLimiter(req, res, next)))

// Activity sync makes the backend read the chain, so it gets its own limit —
// higher, because the frontend calls it once after every transaction.
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: 'Too many sync requests. Please slow down.' } },
})
app.use('/api/activity', (req, res, next) => (req.method === 'GET' ? next() : syncLimiter(req, res, next)))

app.get('/api/health', (req, res) => res.json({ ok: true, database: isDbConnected() }))

// Every other route needs MongoDB. If it isn't connected (yet), answer at once
// with a clear 503 instead of letting requests hang until a timeout.
app.use('/api', (req, res, next) =>
  isDbConnected()
    ? next()
    : next(new ApiError(503, 'The database is not connected yet. Trading on the blockchain still works; sign-in and the activity feed need MongoDB (see backend_test/.env).'))
)
app.use('/api/auth', authRoutes)
app.use('/api/images', imageRoutes)
app.use('/api/users', userRoutes)
app.use('/api/activity', activityRoutes)

app.use(notFound)
app.use(errorHandler)

export default app
