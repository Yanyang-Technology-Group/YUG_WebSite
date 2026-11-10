 'use client';
import { useEffect } from 'react';
export default function Portal({ html, admin }) {
  useEffect(() => { const script = document.createElement('script'); script.type = 'module'; script.src = admin ? '/admin.js' : '/app.js'; document.body.appendChild(script); return () => script.remove(); }, [admin]);
  return <><link rel="stylesheet" href={admin ? '/admin.css' : '/styles.css'} /><div dangerouslySetInnerHTML={{ __html: html }} /></>;
}
