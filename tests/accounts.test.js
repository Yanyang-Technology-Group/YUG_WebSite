import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessions, hashPassword, hashPagesPassword, verifyPassword } from '../lib/auth.mjs';
import { normalizeAccounts as normalize, makeUser, publicUser } from '../lib/accounts.mjs';

const createdAt = '2026-10-10T00:00:00.000Z';
test('Pages PBKDF2 accounts validate and authenticate without losing legacy scrypt support', async () => {
  const account = await hashPagesPassword('pages_owner', 'secure-pages-password-2026');
  const normalized = normalize({ version: 2, users: [{ id: 'pages-owner', ...account, role: 'superadmin', disabled: false, createdAt }] });
  assert.equal(await verifyPassword(normalized.users[0], 'secure-pages-password-2026'), true);
  assert.equal(await verifyPassword(account, 'wrong-password-2026'), false);
  assert.equal(await verifyPassword({ ...account, salt: account.salt.replace('100000', '1') }, 'secure-pages-password-2026'), false);
  const legacyAccount = await hashPassword('local_owner', 'secure-local-password-2026');
  assert.equal(await verifyPassword(legacyAccount, 'secure-local-password-2026'), true);
  assert.equal(await verifyPassword(legacyAccount, 'wrong-password-2026'), false);
});
const legacy = { username: 'Portal_Admin', salt: 'ab'.repeat(16), passwordHash: 'cd'.repeat(64) };
function user(overrides = {}) {
  return { id: 'first-admin', ...legacy, role: 'superadmin', disabled: false, createdAt, ...overrides };
}
function response() { return { setHeader() {} }; }
function request(session) { return { headers: { cookie: `portal_session=${session.id}` } }; }

test('a missing account document permits initial setup with an empty version 2 user list', () => {
  assert.deepEqual(normalize(undefined), { version: 2, users: [] });
  assert.deepEqual(normalize({ version: 2, users: [] }), { version: 2, users: [] });
});

test('legacy account migration preserves password credentials and grants active superadmin access', () => {
  const migrated = normalize(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.users.length, 1);
  assert.deepEqual(migrated.users[0], {
    ...legacy,
    id: migrated.users[0].id,
    role: 'superadmin',
    disabled: false,
    createdAt: '1970-01-01T00:00:00.000Z'
  });
  assert.match(migrated.users[0].id, /^[A-Za-z0-9_-]{1,80}$/);
  assert.deepEqual(normalize(legacy), migrated, 'migration must produce a stable identity and creation timestamp');
  assert.equal(normalize({ ...legacy, username: 'portal_admin' }).users[0].id, migrated.users[0].id);
});

test('normalization retains both roles and disabled accounts without sharing mutable user records', () => {
  const source = { version: 2, users: [user(), user({ id: 'second-admin', username: 'editor', role: 'admin', disabled: true })] };
  const validated = normalize(source);
  assert.deepEqual(validated, source);
  validated.users[0].username = 'changed';
  assert.equal(source.users[0].username, 'Portal_Admin');
});

test('malformed account documents fail closed rather than becoming a fresh installation', () => {
  for (const document of [null, false, [], {}, { version: 1, users: [] }, { version: '2', users: [] }, { version: 2 }, { version: 2, users: {} }, { version: 2, users: [], extra: true }, { ...legacy, extra: true }, { ...legacy, passwordHash: 'bad' }]) {
    assert.throws(() => normalize(document), error => error.status === 400, JSON.stringify(document));
  }
});

test('stored account fields reject invalid identities, credentials, roles, flags and timestamps', () => {
  const invalidFields = [
    { id: '' }, { id: '../account' }, { id: 'a'.repeat(81) }, { username: 'xx' }, { username: '政府账号' },
    { username: 'name with space' }, { username: 'a'.repeat(41) }, { salt: 'ab' }, { salt: 12 },
    { salt: 'AB'.repeat(16) }, { passwordHash: 'cd' }, { passwordHash: null }, { passwordHash: 'zz'.repeat(64) },
    { role: 'owner' }, { role: undefined }, { disabled: 0 }, { disabled: 'false' }, { disabled: undefined },
    { createdAt: undefined }, { createdAt: '' }, { createdAt: '2026-02-30T00:00:00.000Z' }, { createdAt: 0 },
    { unexpected: 'field' }
  ];
  for (const fields of invalidFields) {
    assert.throws(() => normalize({ version: 2, users: [user(fields)] }), error => error.status === 400, JSON.stringify(fields));
  }
  assert.throws(() => normalize({ version: 2, users: [null] }), error => error.status === 400);
});

test('stored usernames are unique regardless of ASCII letter case', () => {
  assert.throws(() => normalize({ version: 2, users: [user(), user({ id: 'another-admin', username: 'portal_ADMIN', role: 'admin' })] }), error => error.status === 400);
});

test('stored account IDs cannot be shared by different usernames', () => {
  assert.throws(() => normalize({ version: 2, users: [user(), user({ username: 'different_admin', role: 'admin' })] }), error => error.status === 400);
});

test('a nonempty account document must retain an enabled superadmin', () => {
  for (const users of [[user({ role: 'admin' })], [user({ disabled: true })], [user({ disabled: true }), user({ id: 'editor', username: 'editor', role: 'admin' })]]) {
    assert.throws(() => normalize({ version: 2, users }), error => error.status === 400);
  }
});

test('the account document accepts 100 users and rejects a 101st account', () => {
  const users = Array.from({ length: 100 }, (_, i) => user({ id: `account-${i}`, username: `admin_${i}`, role: i === 0 ? 'superadmin' : 'admin' }));
  assert.equal(normalize({ version: 2, users }).users.length, 100);
  assert.throws(() => normalize({ version: 2, users: [...users, user({ id: 'overflow', username: 'overflow' })] }), error => error.status === 413);
});

test('public account responses include identity and permission metadata without credential secrets', () => {
  assert.deepEqual(publicUser(user({ internalSecret: 'private' })), { id: 'first-admin', username: 'Portal_Admin', role: 'superadmin', disabled: false, createdAt });
});

test('new accounts receive unique identities and usable password hashes with admin as the default role', async () => {
  const credentials = { username: 'new_editor', password: 'new-safe-password-123' };
  const first = await makeUser(credentials);
  const second = await makeUser(credentials, 'superadmin');
  assert.equal(first.username, credentials.username);
  assert.equal(first.role, 'admin');
  assert.equal(first.disabled, false);
  assert.equal(second.role, 'superadmin');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.salt, second.salt);
  assert.equal(await verifyPassword(first, credentials.password), true);
  assert.equal(await verifyPassword(first, 'different-password'), false);
  assert.equal(new Date(first.createdAt).toISOString(), first.createdAt);
  assert.deepEqual(Object.keys(first).sort(), ['createdAt', 'disabled', 'id', 'passwordHash', 'role', 'salt', 'username']);
});

test('new accounts reject unsupported roles and invalid credentials with HTTP 400', async () => {
  for (const [credentials, role] of [
    [{ username: 'new_editor', password: 'new-safe-password-123' }, 'owner'],
    [{ username: 'xx', password: 'new-safe-password-123' }, 'admin'],
    [{ username: 'new_editor', password: 'short' }, 'admin']
  ]) {
    await assert.rejects(makeUser(credentials, role), error => error.status === 400);
  }
});

test('password verification returns false safely when stored credentials are malformed', async () => {
  for (const record of [undefined, {}, { salt: legacy.salt }, { ...legacy, salt: undefined }, { ...legacy, salt: null }, { ...legacy, passwordHash: 'short' }, { ...legacy, passwordHash: 'gg'.repeat(64) }, { ...legacy, passwordHash: 123 }, { ...legacy, passwordHash: 'cd'.repeat(65) }]) {
    assert.equal(await verifyPassword(record, 'secure-password-123'), false);
  }
  const record = await hashPassword('valid_admin', 'secure-password-123');
  assert.equal(await verifyPassword(record, 'secure-password-123'), true);
});

test('sessions retain their account identity when created and read back from a cookie', () => {
  const sessions = createSessions();
  const session = sessions.create('editor', response(), 'editor-id');
  assert.equal(session.userId, 'editor-id');
  assert.deepEqual(sessions.from(request(session)), session);
});

test('invalidating an account removes its sessions while preserving other accounts and an optional current session', () => {
  const sessions = createSessions();
  const keep = sessions.create('editor', response(), 'editor-id');
  const revoke = sessions.create('editor', response(), 'editor-id');
  const other = sessions.create('superadmin', response(), 'superadmin-id');
  assert.equal(typeof sessions.invalidateUser, 'function');
  sessions.invalidateUser('editor-id', keep.id);
  assert.ok(sessions.from(request(keep)));
  assert.equal(sessions.from(request(revoke)), undefined);
  assert.ok(sessions.from(request(other)));
  sessions.invalidateUser('editor-id');
  assert.equal(sessions.from(request(keep)), undefined);
  assert.ok(sessions.from(request(other)));
});

test('legacy two-argument session creation and invalidateOthers remain compatible', () => {
  const sessions = createSessions();
  const keep = sessions.create('legacy_admin', response());
  const revoke = sessions.create('another_admin', response(), 'another-id');
  assert.equal(sessions.from(request(keep)).username, 'legacy_admin');
  sessions.invalidateOthers(keep);
  assert.ok(sessions.from(request(keep)));
  assert.equal(sessions.from(request(revoke)), undefined);
});

test('invalid account identity cannot revoke legacy sessions without an account identity', () => {
  const sessions = createSessions();
  const legacySession = sessions.create('legacy_admin', response());
  assert.equal(typeof sessions.invalidateUser, 'function');
  sessions.invalidateUser(undefined);
  assert.ok(sessions.from(request(legacySession)));
});
