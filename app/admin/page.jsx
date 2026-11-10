import { readFile } from 'node:fs/promises';
import Portal from '../../public/next/portal.jsx';
export const metadata = { title: '管理模式 · 晏阳联合政府' };
export default async function Admin() { const html = (await readFile('public/admin.html', 'utf8')).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]; return <Portal html={html} admin />; }
