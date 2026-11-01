import fs from 'node:fs';
import path from 'node:path';
const root = process.argv[2] || 'dist';
const files = [];
function walk(dir) { for (const item of fs.readdirSync(dir,{withFileTypes:true})) { const full=path.join(dir,item.name); if(item.isSymbolicLink()) throw Error('Symlink in bootstrap: '+full); if(item.isDirectory()) walk(full); else files.push(path.relative(root,full).replaceAll('\\','/')); } }
walk(root);
const allowed = files.every(f => f === 'index.html' || /^assets\/(?:index|main|web)-[^/]+\.(?:js|css)$/.test(f));
if (!allowed || !files.includes('index.html')) throw Error('Bootstrap includes unexpected files: '+files.join(', '));
if (!files.some(f => /^assets\/(?:index|main|web)-[^/]+\.js$/.test(f))) throw Error('Bootstrap missing executable JavaScript');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
if (!html.includes('PokéVoid') || !/<script\b/i.test(html)) throw Error('Bootstrap HTML missing title or script');
if (/\b(?:src|href)\s*=\s*['"]https?:/i.test(html)) throw Error('Bootstrap references external scripts or assets');
console.log('Bootstrap allowlist passed:', files.join(', '));
