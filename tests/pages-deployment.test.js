import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { defaultSiteContent, migratePortalDefaults } from '../public/site-content-schema.js';

const source = await readFile(new URL('../public/admin.js', import.meta.url), 'utf8');
const apiSource = source.slice(source.indexOf('async function api('), source.indexOf('async function connect('));
function api(response) {
  const context = vm.createContext({ session: null, sessionGeneration: 0, fetch: async () => response });
  vm.runInContext(apiSource, context);
  return vm.runInContext("api('/api/admin/session')", context);
}
test('admin reports missing Pages backend rather than a generic error or HTML', async () => {
  await assert.rejects(api({ status: 404, ok: false, json: async () => { throw new Error('<html>private runtime output</html>'); } }), error => error.message.includes('HTTP 404') && error.message.includes('_worker.js') && !error.message.includes('private runtime'));
  await assert.rejects(api({ status: 200, ok: true, json: async () => { throw new Error('static fallback'); } }), /HTTP 200/);
  await assert.rejects(api({ status: 503, ok: false, json: async () => ({ message: '请绑定 D1 数据库 DB，并执行数据库迁移。' }) }), /请绑定 D1 数据库 DB/);
  assert.equal((await api({ status: 200, ok: true, json: async () => ({ authenticated: false }) })).authenticated, false);
});
test('footer and contact defaults migrate old snapshots while retaining authored text', () => {
  const legacy = { version: 1, values: { 'footer.brand': '晏阳联合政府', 'footer.description': '晏阳联合政府网站 · 政务门户', 'interaction.hotlineTitle': '政务服务便民热线', 'interaction.hotlineNumber': '12345' } };
  const upgraded = migratePortalDefaults(legacy);
  for (const key of Object.keys(legacy.values)) assert.equal(upgraded.values[key], defaultSiteContent.values[key]);
  assert.equal(legacy.values['interaction.hotlineNumber'], '12345', 'read-only migration must not mutate the source snapshot');
  const authored = { version: 1, values: { 'footer.brand': '自定义版权', 'footer.description': '', 'interaction.hotlineNumber': 'custom@example.test' } };
  assert.deepEqual(migratePortalDefaults(authored), authored);
});
