import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './articles.mjs';
const scrypt = promisify(scryptCallback);
const duration = 8 * 60 * 60 * 1000;
export function validateCredentials(input) {
  if (!input || typeof input !== 'object' || typeof input.username !== 'string' || !/^[A-Za-z0-9_-]{3,40}$/.test(input.username)) throw new HttpError(400, '账号须为 3 至 40 位字母、数字、下划线或短横线。');
  validatePassword(input.password);
  return { username: input.username, password: input.password };
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 10 || password.length > 128) throw new HttpError(400, '密码长度须为 10 至 128 个字符。');
}
export async function hashPassword(username, password) {
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await scrypt(password, salt, 64)).toString('hex');
  return { username, salt, passwordHash };
}
export async function verifyPassword(admin, password) {
  if (!admin || typeof password !== 'string' || password.length > 128
    || typeof admin.salt !== 'string' || !/^(?:pbkdf2-sha512:100000:)?[0-9a-f]{32}$/.test(admin.salt)
    || typeof admin.passwordHash !== 'string' || !/^[0-9a-f]{128}$/.test(admin.passwordHash)) return false;
  try {
    const attempt = admin.salt.startsWith('pbkdf2-') ? await derivePagesPassword(password, admin.salt.split(':')[2]) : await scrypt(password, admin.salt, 64);
    return timingSafeEqual(attempt, Buffer.from(admin.passwordHash, 'hex'));
  } catch { return false; }
}
async function derivePagesPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-512', salt: Buffer.from(salt, 'hex'), iterations: 100000 }, key, 512));
}
export async function hashPagesPassword(username, password) {
  const salt = randomBytes(16).toString('hex');
  return { username, salt: 'pbkdf2-sha512:100000:' + salt, passwordHash: (await derivePagesPassword(password, salt)).toString('hex') };
}
export function isLoopback(address) {
  return address === '::1' || /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address || '') || /^::ffff:127\.(?:\d{1,3}\.){2}\d{1,3}$/i.test(address || '');
}
export function createSessions({ sessions = new Map(), failures = new Map(), secure = false } = {}) {
  function from(request) {
    const cookie = request.headers.cookie || '';
    const value = cookie.split(';').map(part => part.trim()).find(part => part.startsWith('portal_session='))?.slice('portal_session='.length);
    const session = value && sessions.get(value);
    if (!session) return undefined;
    if (session.expires <= Date.now()) { sessions.delete(value); return undefined; }
    return { ...session, id: value };
  }
  return {
    from,
    create(username, response, userId) {
      for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id);
      const id = randomBytes(32).toString('hex');
      const session = { username, ...(userId === undefined ? {} : { userId }), csrfToken: randomBytes(32).toString('hex'), expires: Date.now() + duration };
      sessions.set(id, session);
      response.setHeader('Set-Cookie', `portal_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${duration / 1000}${secure ? '; Secure' : ''}`);
      return { ...session, id };
    },
    logout(session, response) {
      if (session) sessions.delete(session.id);
      response.setHeader('Set-Cookie', `portal_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`);
    },
    invalidateOthers(current) { for (const id of sessions.keys()) if (id !== current.id) sessions.delete(id); },
    invalidateUser(userId, exceptId) {
      if (typeof userId !== 'string' || !userId) return;
      for (const [id, session] of sessions) if (session.userId === userId && id !== exceptId) sessions.delete(id);
    },
    checkAttempts(ip, response) {
      const failure = failures.get(ip);
      if (!failure) return;
      if (failure.until <= Date.now()) { failures.delete(ip); return; }
      if (failure.count >= 5) {
        response.setHeader('Retry-After', String(Math.ceil((failure.until - Date.now()) / 1000)));
        throw new HttpError(429, '登录失败次数过多，请 15 分钟后重试。');
      }
    },
    failed(ip) {
      if (failures.size > 10000) for (const [key, value] of failures) if (value.until <= Date.now()) failures.delete(key);
      const previous = failures.get(ip);
      failures.set(ip, { count: previous && previous.until > Date.now() ? previous.count + 1 : 1, until: previous && previous.until > Date.now() ? previous.until : Date.now() + 15 * 60 * 1000 });
    },
    succeeded(ip) { failures.delete(ip); }
  };
}
