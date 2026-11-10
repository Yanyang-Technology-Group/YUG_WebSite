import test from 'node:test';
import assert from 'node:assert/strict';
import { searchContent } from '../public/portal-utils.js';

const items = [
  { id: 'a', title: '优化企业开办服务', summary: '政务服务一窗受理', category: '政策文件', body: ['办理时限缩短至一个工作日。'] },
  { id: 'b', title: '居民医保办理指南', summary: '线上办理城乡居民医保', category: '民生资讯', body: ['可通过服务大厅查询参保进度。'] },
  { id: 'c', title: '公共服务升级', summary: '建设智慧城市', category: '政务要闻', body: ['企业开办服务全面升级。'] },
];

test('finds keyword in title, summary and body, keeping source order', () => {
  assert.deepEqual(searchContent(items, '企业').map(item => item.id), ['a', 'c']);
  assert.deepEqual(searchContent(items, '参保').map(item => item.id), ['b']);
});

test('requires every keyword and trims whitespace', () => {
  assert.deepEqual(searchContent(items, '  医保  办理 ').map(item => item.id), ['b']);
  assert.deepEqual(searchContent(items, '企业 医保'), []);
});

test('limits the results to the selected category', () => {
  assert.deepEqual(searchContent(items, '服务', '政策文件').map(item => item.id), ['a']);
  assert.deepEqual(searchContent(items, '', '民生资讯').map(item => item.id), ['b']);
});

test('blank searches list all items without mutating the source', () => {
  const snapshot = JSON.stringify(items);
  assert.equal(searchContent(items, '  ').length, 3);
  assert.equal(JSON.stringify(items), snapshot);
  assert.deepEqual(searchContent(items, '<不存在>'), []);
});
