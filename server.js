import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const dataDir = path.join(here, 'data');
const contentFile = path.join(dataDir, 'reviews.json');
const uploadDir = path.join(publicDir, 'uploads');
const adminPage = path.join(here, 'admin.html');
const port = Number(process.env.PORT || 3000);
const sessions = new Map();
const loginAttempts = new Map();
const subscribeAttempts = new Map();
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const seedReviews = [
  { id: 'atlas-mesh-pro', category: 'chairs', title: 'Atlas Mesh Pro', score: 9.2, art: '↟', copy: 'A deeply adjustable task chair that makes long, focused days feel lighter.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'northline-task-chair', category: 'chairs', title: 'Northline Task Chair', score: 8.7, art: '◒', copy: 'The rare compact chair that still gets lumbar support and movement right.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'form-work-lounge', category: 'chairs', title: 'Form Work Lounge', score: 8.5, art: '⌁', copy: 'A relaxed, design-forward seat for the hybrid office corner.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'field-standing-desk', category: 'desks', title: 'Field Standing Desk', score: 9, art: '—', copy: 'An exceptionally steady sit-stand desk with a quiet, unfussy control system.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'oakline-lift', category: 'desks', title: 'Oakline Lift', score: 8.8, art: '⌑', copy: 'Warm solid-wood character without compromising on everyday cable management.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'frame-mini', category: 'desks', title: 'Frame Mini', score: 8.2, art: '⌐', copy: 'The strongest small-space standing desk for an apartment setup.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'frame-one-webcam', category: 'video', title: 'Frame One Webcam', score: 8.8, art: '◉', copy: 'Natural color, low-light composure, and zero friction on a busy Monday.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'studio-light-bar', category: 'video', title: 'Studio Light Bar', score: 8.6, art: '◒', copy: 'Soft, flattering light that disappears into your monitor setup.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'soundboard-mini', category: 'video', title: 'Soundboard Mini', score: 8.4, art: '◌', copy: 'Small desktop audio with remarkable voice clarity for calls.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'orbit-focus', category: 'software', title: 'Orbit Focus', score: 9.1, art: '◐', copy: 'The calmest way we have found to shape a week around meaningful work.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'papertrail-notes', category: 'software', title: 'Papertrail Notes', score: 8.9, art: '▱', copy: 'A thoughtful note system that gets out of your way at exactly the right time.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
  { id: 'pulse-planner', category: 'software', title: 'Pulse Planner', score: 8.3, art: '✦', copy: 'A less anxious approach to project planning for small, remote teams.', imageUrl: '', createdAt: '2026-07-31T09:00:00.000Z', updatedAt: '2026-07-31T09:00:00.000Z' },
];

const types = {
  '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

function reply(res, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store', ...extraHeaders });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function getClientKey(req) { return req.socket.remoteAddress || 'unknown'; }

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split(/=(.*)/s)).filter(([key]) => key));
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const source = new URL(origin);
    return source.host === req.headers.host && ['http:', 'https:'].includes(source.protocol);
  } catch { return false; }
}

function setSessionCookie(res, token, maxAge = Math.floor(SESSION_DURATION_MS / 1000)) {
  res.setHeader('Set-Cookie', `rr_admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`);
}

function getBody(req, maxBytes = 10_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        settled = true;
        reject(new Error('Request body is too large.'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', error => { if (!settled) reject(error); });
  });
}

async function getJson(req, maxBytes) {
  const body = await getBody(req, maxBytes);
  try { return JSON.parse(body); } catch { throw new Error('Invalid request data.'); }
}

async function loadLocalSettings() {
  try {
    const settings = await readFile(path.join(here, '.env'), 'utf8');
    for (const rawLine of settings.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const separator = line.indexOf('=');
      if (separator === -1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      if (key && !process.env[key]) process.env[key] = value;
    }
  } catch (error) { if (error.code !== 'ENOENT') console.warn('Could not read .env:', error.message); }
}

async function initializeStorage() {
  await mkdir(dataDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });
  try { await stat(contentFile); } catch { await writeFile(contentFile, `${JSON.stringify(seedReviews, null, 2)}\n`, 'utf8'); }
}

async function getReviews() {
  try {
    const content = JSON.parse(await readFile(contentFile, 'utf8'));
    return Array.isArray(content) ? content : seedReviews;
  } catch { return seedReviews; }
}

async function saveReviews(reviews) {
  const tempFile = `${contentFile}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(reviews, null, 2)}\n`, 'utf8');
  await rename(tempFile, contentFile);
}

function normalizeReview(input, existing = {}) {
  const category = String(input.category || '').trim();
  const title = String(input.title || '').trim();
  const copy = String(input.copy || '').trim();
  const art = String(input.art || '✦').trim();
  const score = Number(input.score);
  const imageUrl = String(input.imageUrl || '').trim();
  if (!['chairs', 'desks', 'video', 'software'].includes(category)) throw new Error('Choose a valid category.');
  if (title.length < 2 || title.length > 120) throw new Error('Title must be between 2 and 120 characters.');
  if (copy.length < 12 || copy.length > 700) throw new Error('Review summary must be between 12 and 700 characters.');
  if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error('Score must be a number from 0 to 10.');
  if (art.length > 12) throw new Error('The visual mark can be at most 12 characters.');
  if (imageUrl && !/^\/uploads\/[a-f0-9]+\.(?:png|jpe?g|webp)$/i.test(imageUrl)) throw new Error('Use an image uploaded through this dashboard.');
  const now = new Date().toISOString();
  return { id: existing.id || randomBytes(12).toString('hex'), category, title, copy, art: art || '✦', score: Number(score.toFixed(1)), imageUrl, createdAt: existing.createdAt || now, updatedAt: now };
}

function passwordMatches(candidate) {
  if (!process.env.ADMIN_PASSWORD) return false;
  const expected = createHash('sha256').update(process.env.ADMIN_PASSWORD).digest();
  const received = createHash('sha256').update(String(candidate || '')).digest();
  return timingSafeEqual(expected, received);
}

function authenticated(req) {
  const token = parseCookies(req).rr_admin_session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return false;
  }
  return true;
}

function requireAdmin(req, res) {
  if (!authenticated(req)) { reply(res, 401, { error: 'Sign in is required.' }); return false; }
  if (!isSameOrigin(req)) { reply(res, 403, { error: 'This request was blocked for security.' }); return false; }
  return true;
}

function allowedAttempt(bucket, key, durationMs, maxAttempts) {
  const now = Date.now();
  const attempts = (bucket.get(key) || []).filter(timestamp => timestamp > now - durationMs);
  if (attempts.length >= maxAttempts) return false;
  attempts.push(now);
  bucket.set(key, attempts);
  return true;
}

async function subscribe(req, res) {
  const client = getClientKey(req);
  if (!allowedAttempt(subscribeAttempts, client, 15_000, 1)) return reply(res, 429, { error: 'Please wait a moment before trying again.' });
  try {
    const { email, source = 'website' } = await getJson(req, 10_000);
    const normalEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalEmail)) return reply(res, 400, { error: 'Please enter a valid email address.' });
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) return reply(res, 503, { error: 'Email delivery has not been configured yet. Add your Resend settings to .env, then restart the site.' });
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [normalEmail], subject: 'Hello from RemoteRefined 👋', html: `<!doctype html><html><body style="margin:0;background:#f5f5f7;color:#121212;font-family:Arial,sans-serif"><main style="max-width:560px;margin:32px auto;background:#fff;padding:42px;border-radius:24px"><p style="font-size:12px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">RemoteRefined</p><h1 style="font-size:40px;letter-spacing:-2px;margin:25px 0 14px">Hello. Your workspace is about to get better.</h1><p style="font-size:16px;line-height:1.55;color:#555">Thanks for joining RemoteRefined. We’ll send thoughtful product reviews and home-office ideas when they’re worth your time.</p><p style="margin-top:30px;font-size:13px;color:#777">You signed up through the ${String(source).replace(/[^a-z-]/gi, '') || 'website'} form.</p></main></body></html>` }),
    });
    if (!emailResponse.ok) return reply(res, 502, { error: 'We could not send that email just now. Please try again.' });
    return reply(res, 200, { message: 'Hello is on its way — check your inbox.' });
  } catch (error) { return reply(res, 400, { error: error.message || 'That request could not be processed.' }); }
}

async function adminLogin(req, res) {
  if (!process.env.ADMIN_PASSWORD) return reply(res, 503, { error: 'Admin login is not configured. Add ADMIN_PASSWORD to .env and restart the server.' });
  const client = getClientKey(req);
  if (!allowedAttempt(loginAttempts, client, LOGIN_WINDOW_MS, MAX_LOGIN_ATTEMPTS)) return reply(res, 429, { error: 'Too many attempts. Please wait 15 minutes and try again.' });
  try {
    const { password } = await getJson(req, 10_000);
    if (!passwordMatches(password)) return reply(res, 401, { error: 'Incorrect password.' });
    loginAttempts.delete(client);
    const token = randomBytes(32).toString('base64url');
    sessions.set(token, { expiresAt: Date.now() + SESSION_DURATION_MS });
    setSessionCookie(res, token);
    return reply(res, 200, { ok: true, expiresAt: new Date(Date.now() + SESSION_DURATION_MS).toISOString() });
  } catch (error) { return reply(res, 400, { error: error.message || 'Could not sign in.' }); }
}

function detectImage(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', extension: 'png' };
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  if (buffer.length > 12 && buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

async function uploadImage(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { dataUrl } = await getJson(req, Math.ceil(MAX_IMAGE_BYTES * 1.4));
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('Choose a PNG, JPEG, or WebP image.');
    const image = Buffer.from(match[2], 'base64');
    if (!image.length || image.length > MAX_IMAGE_BYTES) throw new Error('Images must be 5 MB or smaller.');
    const kind = detectImage(image);
    if (!kind || kind.mime !== match[1]) throw new Error('The file contents do not match the selected image type.');
    const fileName = `${randomBytes(16).toString('hex')}.${kind.extension}`;
    await writeFile(path.join(uploadDir, fileName), image, { flag: 'wx' });
    return reply(res, 201, { imageUrl: `/uploads/${fileName}` });
  } catch (error) { return reply(res, 400, { error: error.message || 'Image upload failed.' }); }
}

async function createReview(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const review = normalizeReview(await getJson(req, 50_000));
    const reviews = await getReviews();
    reviews.unshift(review);
    await saveReviews(reviews);
    return reply(res, 201, { review });
  } catch (error) { return reply(res, 400, { error: error.message || 'Could not create review.' }); }
}

async function updateReview(req, res, id) {
  if (!requireAdmin(req, res)) return;
  try {
    const reviews = await getReviews();
    const index = reviews.findIndex(review => review.id === id);
    if (index < 0) return reply(res, 404, { error: 'Review not found.' });
    const review = normalizeReview(await getJson(req, 50_000), reviews[index]);
    reviews[index] = review;
    await saveReviews(reviews);
    return reply(res, 200, { review });
  } catch (error) { return reply(res, 400, { error: error.message || 'Could not save review.' }); }
}

async function deleteReview(req, res, id) {
  if (!requireAdmin(req, res)) return;
  const reviews = await getReviews();
  if (!reviews.some(review => review.id === id)) return reply(res, 404, { error: 'Review not found.' });
  await saveReviews(reviews.filter(review => review.id !== id));
  return reply(res, 200, { ok: true });
}

async function serveFile(urlPath, req, res) {
  const requested = urlPath === '/' ? '/index.html' : decodeURIComponent(urlPath);
  const filePath = path.resolve(publicDir, `.${requested}`);
  if (!filePath.startsWith(`${publicDir}${path.sep}`)) return reply(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  try {
    const fileStats = await stat(filePath);
    if (!fileStats.isFile()) throw new Error('Not a file');
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    if (req.method !== 'HEAD') res.end(content); else res.end();
  } catch { reply(res, 404, 'Page not found', 'text/plain; charset=utf-8'); }
}

await loadLocalSettings();
await initializeStorage();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  if (pathname === '/api/health') return reply(res, 200, { ok: true, adminConfigured: Boolean(process.env.ADMIN_PASSWORD) });
  if (pathname === '/api/reviews' && req.method === 'GET') return reply(res, 200, { reviews: await getReviews() });
  if (pathname === '/api/subscribe') return req.method === 'POST' ? subscribe(req, res) : reply(res, 405, { error: 'Method not allowed.' });
  if (pathname === '/api/admin/session' && req.method === 'GET') return reply(res, 200, { authenticated: authenticated(req), configured: Boolean(process.env.ADMIN_PASSWORD) });
  if (pathname === '/api/admin/login') return req.method === 'POST' ? adminLogin(req, res) : reply(res, 405, { error: 'Method not allowed.' });
  if (pathname === '/api/admin/logout') {
    if (req.method !== 'POST') return reply(res, 405, { error: 'Method not allowed.' });
    const token = parseCookies(req).rr_admin_session;
    if (token) sessions.delete(token);
    setSessionCookie(res, '', 0);
    return reply(res, 200, { ok: true });
  }
  if (pathname === '/api/admin/reviews') {
    if (req.method === 'GET') { if (!requireAdmin(req, res)) return; return reply(res, 200, { reviews: await getReviews() }); }
    if (req.method === 'POST') return createReview(req, res);
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  if (pathname === '/api/admin/upload') return req.method === 'POST' ? uploadImage(req, res) : reply(res, 405, { error: 'Method not allowed.' });
  const reviewMatch = /^\/api\/admin\/reviews\/([a-z0-9-]{2,120})$/i.exec(pathname);
  if (reviewMatch) {
    if (req.method === 'PUT') return updateReview(req, res, reviewMatch[1]);
    if (req.method === 'DELETE') return deleteReview(req, res, reviewMatch[1]);
    return reply(res, 405, { error: 'Method not allowed.' });
  }
  if (pathname === '/adminpage' || pathname === '/adminpage/') {
    const content = await readFile(adminPage);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(content);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, { error: 'Method not allowed.' });
  return serveFile(pathname, req, res);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`RemoteRefined is running at http://localhost:${port}`);
  console.log(`Admin dashboard: http://localhost:${port}/adminpage`);
  console.log(process.env.ADMIN_PASSWORD ? 'Admin login is configured.' : 'Admin login is disabled: add ADMIN_PASSWORD to .env and restart.');
});
