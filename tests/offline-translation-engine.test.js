import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const bundled = path.join(root, 'offline-translation/runtime/windows-x64/python.exe');
const python = process.env.YANYANG_TEST_PYTHON || (process.platform === 'win32' && existsSync(bundled) ? bundled : 'python3');
function runPython(code) {
  const result = spawnSync(python, ['-c', code], { encoding: 'utf8', cwd: root, env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout.trim();
}
const load = `import importlib.util, pathlib, json\nspec=importlib.util.spec_from_file_location('offline_worker', pathlib.Path('deployment/offline-translate.py'))\nworker=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(worker)\n`;

test('offline worker preserves paragraph boundaries and validates supported languages', () => {
  const result = JSON.parse(runPython(load + `print(json.dumps(worker.validate_request({'id':'a','article':{'title':'公告','summary':'','source':'','body':['第一段','第二段']},'languages':['zh-TW','en']}), ensure_ascii=False))`));
  assert.deepEqual(result.article.body, ['第一段', '第二段']);
  assert.deepEqual(result.languages, ['zh-TW', 'en']);
  assert.equal(runPython(load + `try:\n worker.validate_request({'id':'a','article':{'title':'公告','body':['正文']},'languages':['xx']})\nexcept ValueError as error:\n print(str(error))`), 'invalid_request');
});

test('token splitting retains every source token without model truncation', () => {
  const result = JSON.parse(runPython(load + `parts=worker.token_chunks(list(range(1300)), 240)\nprint(json.dumps(parts))`));
  assert.equal(result.length, 6);
  assert.ok(result.every(part => part.length <= 240));
  assert.deepEqual(result.flat(), Array.from({ length: 1300 }, (_, index) => index));
});

test('offline worker translates languages concurrently with a bounded worker pool and reports every successful result', () => {
  const result = JSON.parse(runPython(load + `import threading\nactive=0\npeak=0\nlock=threading.Lock()\nbarrier=threading.Barrier(2)\nreported=[]\ndef translate(article, language):\n global active, peak\n with lock:\n  active += 1\n  peak = max(peak, active)\n try:\n  barrier.wait(timeout=3)\n  return {'title': language, 'body': [article['title']]}\n finally:\n  with lock: active -= 1\nworker.translate_languages(translate, {'title':'公告'}, ['en','ko','ja','fr'], lambda language, value: reported.append((language, value['title'])))\nprint(json.dumps({'peak':peak,'reported':reported}))`));
  assert.equal(result.peak, 2);
  assert.deepEqual(result.reported.map(([language]) => language).sort(), ['en', 'fr', 'ja', 'ko']);
  assert.ok(result.reported.every(([language, title]) => language === title));
});

test('offline worker reports successful parallel languages before failing the whole request', () => {
  const result = JSON.parse(runPython(load + `reported=[]\ndef translate(article, language):\n if language == 'ko': raise RuntimeError('private article text')\n return {'title': language}\ntry:\n worker.translate_languages(translate, {'title':'公告'}, ['en','ko','ja'], lambda language, value: reported.append(language))\nexcept RuntimeError as error:\n print(json.dumps({'error':str(error),'reported':reported}))`));
  assert.equal(result.error, 'translation_failed');
  assert.deepEqual(result.reported.sort(), ['en', 'ja']);
});

test('JSONL errors hide submitted text and a later request is still accepted', () => {
  const result = spawnSync(python, ['-u', 'deployment/offline-translate.py', '--root', 'artifacts/nonexistent-translation-resources'], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1' },
    input: JSON.stringify({ id: 'bad', article: { title: 'SECRET-DRAFT', body: ['CONFIDENTIAL'] }, languages: ['xx'] }) + '\n' + JSON.stringify({ id: 'good', article: { title: 'SECRET-DRAFT', body: ['CONFIDENTIAL'] }, languages: ['en'] }) + '\n'
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const messages = result.stdout.trim().split('\n').map(JSON.parse);
  assert.deepEqual(messages, [{ id: 'bad', error: 'invalid_request' }, { id: 'good', error: 'engine_unavailable' }]);
  assert.doesNotMatch(result.stdout + result.stderr, /SECRET-DRAFT|CONFIDENTIAL/);
});
