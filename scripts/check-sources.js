#!/usr/bin/env node
// Parses every JavaScript file under src/ (plus App.js) with Babel and checks that each relative
// import points at a file that exists and, for named imports, that the file exports that name.
// Catches the typos and broken imports that otherwise only show up as a red screen on a phone.
// Usage: npm install --prefix /tmp/tools @babel/parser && NODE_PATH=/tmp/tools/node_modules node scripts/check-sources.js

const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');

const ROOT = path.resolve(__dirname, '..');
const files = ['App.js'];
(function walk(dir) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.(js|jsx)$/.test(entry.name)) files.push(rel);
  }
})('src');

const parsed = new Map();
function ast(rel) {
  if (!parsed.has(rel)) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    parsed.set(rel, parse(code, { sourceType: 'module', plugins: ['jsx', 'classProperties'] }));
  }
  return parsed.get(rel);
}

function exportsOf(rel) {
  const names = new Set();
  for (const node of ast(rel).program.body) {
    if (node.type === 'ExportDefaultDeclaration') names.add('default');
    if (node.type === 'ExportNamedDeclaration') {
      if (node.declaration?.id) names.add(node.declaration.id.name);
      for (const d of node.declaration?.declarations || []) if (d.id?.name) names.add(d.id.name);
      for (const s of node.specifiers || []) names.add(s.exported.name);
    }
    if (node.type === 'ExportAllDeclaration') names.add('*');
  }
  return names;
}

function resolve(fromRel, spec) {
  const base = path.join(path.dirname(fromRel), spec);
  for (const candidate of [base, `${base}.js`, path.join(base, 'index.js')]) {
    if (fs.existsSync(path.join(ROOT, candidate)) && fs.statSync(path.join(ROOT, candidate)).isFile()) return candidate;
  }
  return null;
}

const problems = [];
for (const rel of files) {
  let tree;
  try {
    tree = ast(rel);
  } catch (err) {
    problems.push(`${rel}: does not parse: ${err.message}`);
    continue;
  }
  for (const node of tree.program.body) {
    if (node.type !== 'ImportDeclaration' || !node.source.value.startsWith('.')) continue;
    const target = resolve(rel, node.source.value);
    if (!target) {
      problems.push(`${rel}: import '${node.source.value}' points at no file`);
      continue;
    }
    if (!/\.js$/.test(target)) continue;
    let names;
    try {
      names = exportsOf(target);
    } catch {
      continue; // reported when that file itself is checked
    }
    if (names.has('*')) continue;
    for (const s of node.specifiers) {
      const wanted = s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportSpecifier' ? s.imported.name : null;
      if (wanted && !names.has(wanted)) problems.push(`${rel}: '${wanted}' is not exported by ${target}`);
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Checked ${files.length} files: all parse and every relative import resolves.`);
