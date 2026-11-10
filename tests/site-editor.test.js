import test from 'node:test';
import assert from 'node:assert/strict';

test('failed website content saves retain edits and a later save sends the complete draft', async () => {
  const { createContentDraft } = await import('../public/admin-site-content.js');
  const { defaultSiteContent } = await import('../public/site-content-schema.js');
  let attempts = 0;
  let submitted;
  const draft = createContentDraft(defaultSiteContent, async content => {
    attempts++;
    submitted = content;
    if (attempts === 1) throw new Error('连接中断');
    return content;
  });
  draft.set('site.name', '管理员的新名称');
  await assert.rejects(draft.save(), /连接中断/);
  assert.equal(draft.dirty, true);
  assert.equal(draft.busy, false);
  assert.equal(draft.get('site.name'), '管理员的新名称');
  await draft.save();
  assert.equal(draft.dirty, false);
  assert.equal(submitted.values['site.name'], '管理员的新名称');
  assert.deepEqual(Object.keys(submitted.values), Object.keys(defaultSiteContent.values));
  assert.equal(defaultSiteContent.values['site.name'], '晏阳联合政府');
});

test('website content saves prevent changes and duplicate submissions while pending', async () => {
  const { createContentDraft } = await import('../public/admin-site-content.js');
  const { defaultSiteContent } = await import('../public/site-content-schema.js');
  let finish;
  let writes = 0;
  const draft = createContentDraft(defaultSiteContent, content => {
    writes++;
    return new Promise(resolve => { finish = () => resolve(content); });
  });
  draft.set('site.name', '提交中的名称');
  const saving = draft.save();
  assert.equal(draft.busy, true);
  assert.throws(() => draft.set('site.name', '提交后输入'), /正在保存/);
  await assert.rejects(draft.save(), /正在保存/);
  assert.equal(writes, 1);
  finish();
  await saving;
  assert.equal(draft.get('site.name'), '提交中的名称');
  assert.equal(draft.busy, false);
});
