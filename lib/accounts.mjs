import { createHash, randomUUID } from 'node:crypto';
import { HttpError } from './articles.mjs';
import { hashPassword, validateCredentials } from './auth.mjs';

const userFields = ['id', 'username', 'salt', 'passwordHash', 'role', 'disabled', 'createdAt'];
const credentialFields = ['username', 'salt', 'passwordHash'];
export const adminRoles = ['admin', 'senioradmin', 'superadmin'];
export function canManageSite(user) {
  return user?.role === 'senioradmin' || user?.role === 'superadmin';
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === fields.length && fields.every(field => Object.hasOwn(value, field));
}

function validCredentials(value) {
  return typeof value.username === 'string' && /^[A-Za-z0-9_-]{3,40}$/.test(value.username)
    && typeof value.salt === 'string' && /^(?:pbkdf2-sha512:100000:)?[0-9a-f]{32}$/.test(value.salt)
    && typeof value.passwordHash === 'string' && /^[0-9a-f]{128}$/.test(value.passwordHash);
}

function validateUser(value) {
  if (!exactFields(value, userFields) || !validCredentials(value)
    || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(value.id)
    || !adminRoles.includes(value.role) || typeof value.disabled !== 'boolean'
    || typeof value.createdAt !== 'string' || value.createdAt.length !== 24
    || !Number.isFinite(Date.parse(value.createdAt)) || new Date(value.createdAt).toISOString() !== value.createdAt) {
    throw new HttpError(400, '管理员账号数据格式不正确。');
  }
  return Object.fromEntries(userFields.map(field => [field, value[field]]));
}

export function normalizeAccounts(document) {
  if (document === undefined) return { version: 2, users: [] };
  if (exactFields(document, credentialFields) && validCredentials(document)) {
    // The old file has no creation time. A stable sentinel avoids changing
    // account metadata on every read before the migration is persisted.
    const id = `legacy-${createHash('sha256').update(document.username.toLowerCase()).digest('hex')}`;
    return { version: 2, users: [validateUser({ ...document, id, role: 'superadmin', disabled: false, createdAt: '1970-01-01T00:00:00.000Z' })] };
  }
  if (!exactFields(document, ['version', 'users']) || document.version !== 2 || !Array.isArray(document.users)) {
    throw new HttpError(400, '管理员账号数据格式不正确。');
  }
  if (document.users.length > 100) throw new HttpError(413, '管理员账号数量不能超过 100 个。');
  const ids = new Set();
  const usernames = new Set();
  const users = document.users.map(value => {
    const user = validateUser(value);
    const username = user.username.toLowerCase();
    if (ids.has(user.id) || usernames.has(username)) throw new HttpError(400, '管理员账号编号或用户名重复。');
    ids.add(user.id);
    usernames.add(username);
    return user;
  });
  if (users.length && !users.some(user => user.role === 'superadmin' && !user.disabled)) {
    throw new HttpError(400, '至少须保留一个启用的超级管理员账号。');
  }
  return { version: 2, users };
}

export function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, disabled: user.disabled, createdAt: user.createdAt };
}

export async function makeUser(credentials, role = 'admin', hasher = hashPassword) {
  if (!adminRoles.includes(role)) throw new HttpError(400, '管理员角色须为 admin、senioradmin 或 superadmin。');
  const { username, password } = validateCredentials(credentials);
  return { ...await hasher(username, password), id: randomUUID(), role, disabled: false, createdAt: new Date().toISOString() };
}
