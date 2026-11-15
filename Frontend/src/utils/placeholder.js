// src/utils/placeholder.js
//
// Listings without a photo get a small inline SVG instead of a stock image —
// no external requests, and it matches the app's palette.

const ACCENT = { barter: '#D98F4E', sell: '#3FC1B0', buy: '#E0B84E' }

export function placeholderImage(type = 'barter') {
  const c = ACCENT[type] || ACCENT.barter
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="320" viewBox="0 0 600 320">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#171C27"/><stop offset="1" stop-color="#0B0E14"/></linearGradient></defs>` +
    `<rect width="600" height="320" fill="url(#g)"/>` +
    `<g fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" opacity=".55">` +
    `<path d="M240 135h120l-24-24M360 185H240l24 24"/></g></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}
