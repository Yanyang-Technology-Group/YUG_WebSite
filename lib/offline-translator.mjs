import path from 'node:path';
import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { translationLanguages } from './articles.mjs';

// The worker reads only bundled local files. Runtime requests never download models.
export function createOfflineTranslator({ rootDir, timeoutMs = 15 * 60 * 1000 } = {}) {
  const assets = path.join(rootDir, 'offline-translation');
  const runtimeName = process.platform === 'win32' ? 'windows-x64' : 'linux-x64';
  const runtimeCandidates = [path.join(rootDir, 'runtime', 'translation', runtimeName), path.join(assets, 'runtime', runtimeName)];
  let runtime = runtimeCandidates[0];
  let executable = process.platform === 'win32' ? path.join(runtime, 'python.exe') : path.join(runtime, 'bin/python3');
  const script = path.join(rootDir, 'deployment/offline-translate.py');
  let worker, pending, buffer = '', stopped = false;
  const failure = code => Object.assign(new Error(code), { translationCode: code });
  async function available() {
    if (!['win32', 'linux'].includes(process.platform) || process.arch !== 'x64') return false;
    try {
      await Promise.all([script, path.join(assets, 'manifest.json'), path.join(assets, 'model/model.bin')].map(file => access(file)));
      for (const candidate of runtimeCandidates) {
        const candidateExecutable = process.platform === 'win32' ? path.join(candidate, 'python.exe') : path.join(candidate, 'bin/python3');
        try { await access(candidateExecutable); runtime = candidate; executable = candidateExecutable; return true; } catch { /* Try the source-tree fallback. */ }
      }
      return false;
    } catch { return false; }
  }
  function fail(error) {
    const item = pending;
    pending = undefined;
    if (item) { clearTimeout(item.timer); item.reject(error); }
  }
  function stopWorker(child, error) {
    if (worker !== child) return;
    worker = undefined; fail(error); child.kill();
  }
  function ensureWorker() {
    if (worker) return;
    const child = spawn(executable, ['-u', script, '--root', assets], {
      cwd: rootDir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', HF_HUB_DISABLE_TELEMETRY: '1', ...(process.platform === 'linux' ? { LD_LIBRARY_PATH: path.join(runtime, 'lib') + (process.env.LD_LIBRARY_PATH ? ':' + process.env.LD_LIBRARY_PATH : '') } : {}) },
    });
    worker = child;
    buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (worker !== child) return;
      buffer += chunk;
      if (buffer.length > 4 * 1024 * 1024) { stopWorker(child, failure('invalid_translation')); return; }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { stopWorker(child, failure('invalid_translation')); return; }
        const item = pending;
        if (!item || message.id !== item.id) continue;
        item.touch();
        if (message.error) { stopWorker(child, failure('translation_failed')); return; }
        if (message.language) item.chain = item.chain.then(() => item.onTranslation(message.language, message.translation));
        item.chain.catch(error => { if (pending === item) stopWorker(child, error); });
        if (message.done) {
          item.chain.then(() => { if (pending === item) { pending = undefined; clearTimeout(item.timer); item.resolve(); } }, () => {});
        }
      }
    });
    // Never forward worker diagnostics or article text to operation logs or clients.
    child.stderr.resume();
    child.stdin.on('error', () => stopWorker(child, failure('translation_failed')));
    child.on('error', () => stopWorker(child, failure('engine_unavailable')));
    child.on('exit', () => { if (worker === child) { worker = undefined; fail(failure('translation_failed')); } });
  }
  return {
    available,
    async translate(article, onTranslation, { languages = translationLanguages } = {}) {
      if (stopped || !await available()) throw failure('engine_unavailable');
      if (pending) throw failure('translation_failed');
      ensureWorker();
      const child = worker;
      return new Promise((resolve, reject) => {
        const id = randomUUID();
        const item = { id, onTranslation, resolve, reject, chain: Promise.resolve(), touch() { clearTimeout(item.timer); item.timer = setTimeout(() => stopWorker(child, failure('translation_timeout')), timeoutMs); item.timer.unref(); } };
        pending = item; item.touch();
        child.stdin.write(JSON.stringify({ id, article: { title: article.title, summary: article.summary, source: article.source, body: article.body }, languages }) + '\n');
      });
    },
    close() { stopped = true; fail(failure('translation_failed')); worker?.kill(); worker = undefined; },
  };
}
