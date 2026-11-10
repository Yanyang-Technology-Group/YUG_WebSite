#!/bin/sh
set -eu

fail() { printf '%s\n' "$*" >&2; exit 1; }
action=start
listen_host=127.0.0.1
port=${PORT:-5173}
open_browser=yes
while [ "$#" -gt 0 ]; do
  case "$1" in
    --lan) listen_host=0.0.0.0; shift ;;
    --no-browser) open_browser=no; shift ;;
    --port) [ "$#" -ge 2 ] || fail '--port 需要 1024 至 65535 的端口号。'; port=$2; shift 2 ;;
    --port=*) port=${1#--port=}; shift ;;
    --stop) action=stop; open_browser=no; shift ;;
    --help|-h)
      printf '%s\n' '用法：sh start.sh [--lan] [--no-browser] [--port 5173]' '停止：sh stop.sh；也可通过 PORT 环境变量设置端口（1024 至 65535）。'
      exit 0 ;;
    *) fail "未知参数：$1。使用 --help 查看用法。" ;;
  esac
done
case "$port" in ''|*[!0-9]*) fail '端口必须是 1024 至 65535 的整数。' ;; esac
[ "${#port}" -le 5 ] && [ "$port" -ge 1024 ] && [ "$port" -le 65535 ] || fail '端口必须是 1024 至 65535 的整数。'

script_dir=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
if [ -f "$script_dir/server.mjs" ]; then
  site_root=$script_dir
else
  site_root=$(CDPATH= cd -P "$script_dir/.." && pwd)
fi
[ -f "$site_root/server.mjs" ] || fail '找不到 server.mjs，请完整解压部署包后重试。'
distribution=node-v24.21.0-linux-x64
archive="$site_root/runtime/$distribution.tar.gz"
runtime_dir="$site_root/runtime/linux"
node_file="$runtime_dir/$distribution/bin/node"
[ -f "$archive" ] || fail '运行环境缺失，请完整解压 Linux x64 部署包。'
command -v sha256sum >/dev/null 2>&1 || fail '缺少系统工具 sha256sum，无法校验运行环境。'
archive_sum=$(sha256sum "$archive") || fail '无法读取运行环境归档。'
[ "${archive_sum%% *}" = '6e1db87ef58b8819e5d5402eff1536491b18edd8eb7bee5ef7897876e88dc5ff' ] || fail '运行环境 SHA-256 校验失败，请重新解压可信部署包。'
[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || fail '此启动器仅支持 Linux x64（x86_64），请使用对应平台部署包。'
command -v tar >/dev/null 2>&1 || fail '缺少系统工具 tar，无法解压运行环境。'
if [ ! -f "$node_file" ]; then
  mkdir -p "$runtime_dir"
  tar -xzf "$archive" -C "$runtime_dir" || fail '运行环境解压失败，请检查目录写入权限和剩余空间。'
fi
# Verify the executable too: a trusted archive does not make a modified cache safe.
node_sum=$(sha256sum "$node_file") || fail '无法读取内置 Node。'
expected_node_sum=$(tar -xOzf "$archive" "$distribution/bin/node" | sha256sum) || fail '无法校验归档内的 Node。'
[ "${node_sum%% *}" = "${expected_node_sum%% *}" ] || fail '已解压 Node 的 SHA-256 校验失败，请重新解压可信部署包。'
[ -x "$node_file" ] || fail '内置 Node 缺少执行权限，请完整解压部署包或恢复 runtime/linux 下 Node 的执行权限。'
command -v nohup >/dev/null 2>&1 || fail '缺少系统工具 nohup，无法在后台启动服务。'

"$node_file" --input-type=module - "$action" "$site_root" "$listen_host" "$port" "$open_browser" <<'PORTAL_LAUNCHER'
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';

const [action, suppliedRoot, host, suppliedPort, browser] = process.argv.slice(2);
const root = await fs.realpath(suppliedRoot);
const node = await fs.realpath(process.execPath);
const server = await fs.realpath(path.join(root, 'server.mjs'));
const port = Number(suppliedPort);
const data = path.join(root, 'data');
const pidFile = path.join(data, 'server.pid');
const lockFile = path.join(data, '.launcher.lock');
const baseUrl = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const absentError = error => ['ENOENT', 'ESRCH'].includes(error.code);

async function processInfo(pid) {
  try {
    const prefix = `/proc/${pid}`;
    const [stat, executable, cwd, command] = await Promise.all([
      fs.readFile(`${prefix}/stat`, 'utf8'), fs.readlink(`${prefix}/exe`),
      fs.readlink(`${prefix}/cwd`), fs.readFile(`${prefix}/cmdline`)
    ]);
    const fields = stat.slice(stat.lastIndexOf(')') + 1).trim().split(/\s+/);
    if (['Z', 'X'].includes(fields[0])) return null;
    return { startTime: fields[19], executable, cwd, args: command.toString().split('\0').filter(Boolean) };
  } catch (error) { if (absentError(error)) return null; throw error; }
}

async function ownership(record) {
  if (!record || !Number.isInteger(record.pid) || record.pid <= 1 || record.root !== root || record.node !== node || record.server !== server || !/^\d+$/.test(record.startTime || '')) return 'foreign';
  const info = await processInfo(record.pid);
  if (!info) return 'absent';
  return info.startTime === record.startTime && info.executable === node && info.cwd === root && info.args[0] === node && info.args[1] === server ? 'owned' : 'foreign';
}

async function readRecord() {
  try { return JSON.parse(await fs.readFile(pidFile, 'utf8')); }
  catch (error) {
    if (absentError(error)) return null;
    throw new Error('运行记录损坏，已取消操作。请检查 data/server.pid 和正在运行的进程。');
  }
}

async function acquireLock() {
  const current = await processInfo(process.pid);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const file = await fs.open(lockFile, 'wx', 0o600);
      try { await file.writeFile(JSON.stringify({ pid: process.pid, startTime: current.startTime })); }
      finally { await file.close(); }
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous;
      try { previous = JSON.parse(await fs.readFile(lockFile, 'utf8')); }
      catch { throw new Error('启动器锁记录不完整，已取消操作。请确认没有其他启停命令正在执行后移除 data/.launcher.lock。'); }
      const active = Number.isInteger(previous.pid) && previous.pid > 1 ? await processInfo(previous.pid) : null;
      if (active && active.startTime === previous.startTime) throw new Error('此部署包正在执行另一条启停命令，请稍后重试。');
      await fs.unlink(lockFile).catch(error => { if (!absentError(error)) throw error; });
    }
  }
  throw new Error('无法获取启动器锁，请稍后重试。');
}

function health() {
  return new Promise(resolve => {
    let finished = false;
    const done = ok => { if (!finished) { finished = true; resolve(ok); } };
    const request = http.get(`${baseUrl}/api/health`, { agent: false }, response => {
      let body = '';
      response.on('data', chunk => {
        body += chunk;
        if (body.length > 65536) { request.destroy(); done(false); }
      });
      response.on('error', () => done(false));
      response.on('end', () => {
        try { const value = JSON.parse(body); done(response.statusCode === 200 && value.ok === true && ['yanyang-government-portal', 'yunchuan-government-portal'].includes(value.service)); }
        catch { done(false); }
      });
    });
    request.setTimeout(700, () => { request.destroy(); done(false); });
    request.on('error', () => done(false));
  });
}

async function requireFreePort() {
  const probe = net.createServer();
  try {
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen({ port, host, exclusive: true }, resolve); });
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  } catch (error) {
    if (probe.listening) probe.close();
    throw new Error(`端口 ${port} 无法使用（${error.code || error.message}），可能由另一份网站或其他服务占用。请使用 --port 选择其他端口。`);
  }
}

async function terminate(record) {
  if (await ownership(record) !== 'owned') return;
  process.kill(record.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await ownership(record) !== 'owned') return;
    await delay(100);
  }
  if (await ownership(record) === 'owned') process.kill(record.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await ownership(record) !== 'owned') return;
    await delay(100);
  }
  throw new Error('服务尚未退出，已保留运行记录，请检查 data/server-error.log。');
}

function openBrowser() {
  if (browser !== 'yes' || (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY)) return;
  const child = spawn('xdg-open', [baseUrl], { detached: true, stdio: 'ignore' });
  child.on('error', () => console.log(`浏览器未自动打开，请手动访问 ${baseUrl}`));
  child.unref();
}

let locked = false;
try {
  await fs.mkdir(data, { recursive: true, mode: 0o700 });
  await acquireLock();
  locked = true;
  const previous = await readRecord();
  const state = previous ? await ownership(previous) : 'absent';
  if (state === 'foreign') throw new Error('运行记录中的进程不属于此部署包或 PID 已被复用，已取消操作；不会终止该进程。');
  if (action === 'stop') {
    if (state === 'owned') await terminate(previous);
    await fs.unlink(pidFile).catch(error => { if (!absentError(error)) throw error; });
    console.log(previous ? '网站服务已停止，文章、账号和其他 data 数据已保留。' : '此部署包没有运行记录。');
  } else if (state === 'owned') {
    if (previous.port !== port || previous.host !== host) throw new Error('此部署包正在运行。请先执行 sh stop.sh，再更改端口或局域网模式。');
    if (!await health() || await ownership(previous) !== 'owned') throw new Error('服务进程未通过健康检查，请查看 data/server.log 和 data/server-error.log。');
    console.log(`网站已在运行：${baseUrl}`);
    openBrowser();
  } else {
    if (previous) await fs.unlink(pidFile);
    await requireFreePort();
    const stdout = await fs.open(path.join(data, 'server.log'), 'a', 0o600);
    const stderr = await fs.open(path.join(data, 'server-error.log'), 'a', 0o600);
    let child;
    let spawnError;
    try {
      child = spawn('nohup', [node, server], {
        cwd: root, env: { ...process.env, HOST: host, PORT: String(port) },
        detached: true, stdio: ['ignore', stdout.fd, stderr.fd]
      });
      child.on('error', error => { spawnError = error; });
      child.unref();
    } finally { await Promise.all([stdout.close(), stderr.close()]); }
    let record;
    let ready = false;
    try {
      for (let attempt = 0; attempt < 40; attempt++) {
        if (spawnError) throw spawnError;
        if (child.pid) {
          const info = await processInfo(child.pid);
          if (info) {
            record = { pid: child.pid, root, node, server, host, port, startTime: info.startTime, startedAt: new Date().toISOString() };
            if (await ownership(record) === 'owned') break;
          }
        }
        await delay(50);
      }
      if (!record || await ownership(record) !== 'owned') throw new Error('内置 Node 未正常启动。');
      await fs.writeFile(pidFile, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
      for (let attempt = 0; attempt < 40; attempt++) {
        if (await ownership(record) !== 'owned') break;
        if (await health() && await ownership(record) === 'owned') { ready = true; break; }
        await delay(250);
      }
      if (!ready) throw new Error('服务未通过健康检查。');
    } catch (error) {
      if (record) await terminate(record);
      await fs.unlink(pidFile).catch(error => { if (!absentError(error)) throw error; });
      throw new Error(`启动失败：${error.message} 请查看 data/server-error.log；端口可能被占用或系统不兼容（需要 glibc 2.28 及以上）。`);
    }
    console.log(`网站已启动：${baseUrl}`);
    console.log(`管理地址：${baseUrl}/admin.html（首次超级管理员设置必须从本机或 SSH 本地转发访问）`);
    if (host === '0.0.0.0') {
      console.log('局域网模式：请使用本机的局域网 IPv4 地址访问。');
      for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses || []) if (address.family === 'IPv4' && !address.internal) console.log(`局域网地址：http://${address.address}:${port}`);
      }
    }
    openBrowser();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (locked) await fs.unlink(lockFile).catch(error => { if (!absentError(error)) { console.error(`无法清理启动器锁：${error.message}`); process.exitCode = 1; } });
}
PORTAL_LAUNCHER
