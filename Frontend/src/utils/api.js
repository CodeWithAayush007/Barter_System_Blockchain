// src/utils/api.js

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
const API_ORIGIN = API_URL.replace(/\/api\/?$/, '')
const TOKEN_KEY = 'trove_auth_token'

export function getApiOrigin() {
  return API_ORIGIN
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

/**
 * Thin fetch wrapper for the Trove backend. Attaches the JWT (if any),
 * serializes JSON bodies, and normalizes error responses into a single
 * Error shape that utils/errors.js knows how to read (`err.apiMessage`).
 *
 * Pass `formData: true` with a FormData body for multipart uploads
 * (image fields) instead of JSON.
 */
export async function apiFetch(path, { method = 'GET', body, formData = false, auth = true } = {}) {
  const headers = {}
  if (!formData) headers['Content-Type'] = 'application/json'

  const token = getToken()
  if (auth && token) headers['Authorization'] = `Bearer ${token}`

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? (formData ? body : JSON.stringify(body)) : undefined,
    })
  } catch (networkErr) {
    const err = new Error('Could not reach the Trove API.')
    err.apiMessage = 'Could not reach the server. Is the backend running?'
    err.cause = networkErr
    throw err
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    // No JSON body (e.g. 204) — fine.
  }

  if (!response.ok) {
    const err = new Error(data?.error?.message || `Request failed (${response.status})`)
    err.status = response.status
    err.apiMessage = data?.error?.message || `Request failed with status ${response.status}.`
    err.details = data?.error?.details
    throw err
  }

  return data
}
