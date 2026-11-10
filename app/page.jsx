import { readFile } from 'node:fs/promises';
import Portal from '../public/next/portal.jsx';
export default async function Home() { const html = (await readFile('public/index.html', 'utf8')).match(/<body[^>]*>([\s\S]*)<\/body>/i)[1]; return <Portal html={html} admin={false} />; }
