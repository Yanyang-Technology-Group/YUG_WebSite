// Temporary synthetic installation for browser QA. Never uses the real data directory.
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createPortalServer } from '../../server.mjs';

const rootDir = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'yanyang-roles-preview-'));
const server = await createPortalServer({ rootDir, dataDir, deploymentDir: path.join(dataDir, 'downloads') });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const password = 'Preview-only-password-2026';
try {
  const setup = await fetch(base + '/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'preview_owner', password }) });
  assert.equal(setup.status, 201); const owner = await setup.json();
  const headers = { 'Content-Type': 'application/json', Cookie: setup.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': owner.csrfToken };
  for (const [username, role] of [['preview_senior', 'senioradmin'], ['preview_editor', 'admin']]) {
    assert.equal((await fetch(base + '/api/admin/users', { method: 'POST', headers, body: JSON.stringify({ username, password, role }) })).status, 201);
  }
  assert.equal((await fetch(base + '/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'suggestion', gameName: '示例玩家', qq: '123456789', title: '权限演示留言', content: '此留言仅用于隔离环境的管理功能验收。' }) })).status, 201);
  console.log(JSON.stringify({ url: base + '/admin', accounts: ['preview_owner', 'preview_senior', 'preview_editor'], password, dataDir, synthetic: true }));
} catch (error) {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
  throw error;
}
let closing = false;
async function close() {
  if (closing) return; closing = true;
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
  process.exit(0);
}
process.on('SIGINT', close); process.on('SIGTERM', close);
