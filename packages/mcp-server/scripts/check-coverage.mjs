#!/usr/bin/env node
/**
 * Le garde de dérive DOCUMENTAIRE du serveur MCP.
 *
 * L'ancienne version de ce script tenait une liste de routes à la main, la comparait à la source
 * par `includes()`, et terminait sur un « COUVERTURE TOTALE: ~95-100% » écrit en dur. Elle
 * annonçait donc une couverture qui n'existait plus : elle citait des routes disparues
 * (`/git/branches`, `/tracker/association`) et des outils supprimés
 * (`cezar_associate_tracker_item`), pendant que README/COVERAGE affichaient 63 outils alors que le
 * serveur en annonçait 81.
 *
 * Le côté ROUTES est déjà tenu par `packages/cezar/src/server/mcp-endpoint-drift.test.ts`, qui
 * confronte `src/endpoints.ts` à la table de routes d'une app construite — la vraie source de
 * vérité, automatique. Ce script-ci couvre l'autre moitié, celle qui a dérivé en silence : ce que
 * la DOC dit doit correspondre à ce que le serveur ANNONCE.
 *
 * Il démarre le serveur construit (`dist/index.js`) sur stdio, demande `tools/list` et
 * `resources/list` — aucun cockpit n'est nécessaire, ces deux appels ne touchent pas l'API — puis
 * vérifie que :
 *
 *   1. le TOTAL de COVERAGE.md et le « **N outils** » de README.md valent le nombre annoncé ;
 *   2. chaque outil documenté est annoncé, et chaque outil annoncé est documenté ;
 *   3. le nombre de ressources annoncé par README.md vaut celui de `resources/list` ;
 *   4. la description de COVERAGE.md commence par celle de l'outil — la doc peut ajouter une mise
 *      en garde, mais pas garder une formulation que le code a changée.
 *
 * Usage : node packages/mcp-server/scripts/check-coverage.mjs   (après `npm run build:mcp`)
 *      ou : npm -w @open-mercato/cezar-mcp-server run check:coverage
 */
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const serverEntry = join(pkgDir, 'dist', 'index.js');

/** `tools/list` + `resources/list` over one stdio session. No cockpit required. */
function askServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [serverEntry], { stdio: ['pipe', 'pipe', 'pipe'] });
    const answers = new Map();
    let buf = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`the MCP server did not answer tools/list within 20s${stderr ? ` — ${stderr.trim()}` : ''}`));
    }, 20_000);

    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && answers.has(msg.id)) {
          answers.get(msg.id)(msg);
          answers.delete(msg.id);
        }
      }
    });

    const rpc = (id, method, params) =>
      new Promise((res) => {
        answers.set(id, res);
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });

    (async () => {
      await rpc(1, 'initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'check-coverage', version: '0' },
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
      const tools = await rpc(2, 'tools/list', {});
      const resources = await rpc(3, 'resources/list', {});
      clearTimeout(timer);
      child.kill();
      resolve({
        tools: (tools.result?.tools ?? []).map((t) => t.name),
        descriptions: new Map((tools.result?.tools ?? []).map((t) => [t.name, t.description ?? ''])),
        resources: (resources.result?.resources ?? []).map((r) => r.uri),
      });
    })().catch((err) => { clearTimeout(timer); child.kill(); reject(err); });
  });
}

const read = (name) => readFileSync(join(pkgDir, name), 'utf8');

/** The `- **\`cezar_x\`** — …` bullets of COVERAGE.md, as { name → documented description }. */
function documentedTools(markdown) {
  const found = new Map();
  for (const line of markdown.split('\n')) {
    const m = /^- \*\*`(cezar_[a-z0-9_]+)`\*\* — (.*)$/.exec(line);
    if (m) found.set(m[1], m[2].trim());
  }
  return found;
}

const flat = (text) => text.replace(/\s+/g, ' ').trim();

/** The `| **TOTAL** | **N** |` row of COVERAGE.md. */
function documentedTotal(markdown) {
  const m = /^\|\s*\*\*TOTAL\*\*\s*\|\s*\*\*(\d+)\*\*\s*\|/m.exec(markdown);
  return m ? Number(m[1]) : null;
}

/** The `**N outils**` / `**N ressources**` claims of README.md. */
function documentedCounts(markdown) {
  return {
    tools: Number(/\*\*(\d+) outils\*\*/.exec(markdown)?.[1] ?? NaN),
    resources: Number(/\*\*(\d+) ressources?\*\*/.exec(markdown)?.[1] ?? NaN),
  };
}

const { tools, resources, descriptions } = await askServer();
const coverage = read('COVERAGE.md');
const readme = read('README.md');
const documented = documentedTools(coverage);
const totals = documentedCounts(readme);
const coverageTotal = documentedTotal(coverage);

const problems = [];

if (totals.tools !== tools.length) {
  problems.push(`README.md says "${totals.tools} outils", the server advertises ${tools.length}`);
}
if (coverageTotal !== tools.length) {
  problems.push(`COVERAGE.md's TOTAL row says ${coverageTotal}, the server advertises ${tools.length}`);
}
if (totals.resources !== resources.length) {
  problems.push(`README.md says "${totals.resources} ressources", the server advertises ${resources.length}`);
}

const announced = new Set(tools);
const undocumented = tools.filter((name) => !documented.has(name));
const phantom = [...documented.keys()].filter((name) => !announced.has(name));
if (undocumented.length) problems.push(`advertised but not documented in COVERAGE.md: ${undocumented.join(', ')}`);
if (phantom.length) problems.push(`documented in COVERAGE.md but not advertised: ${phantom.join(', ')}`);

// A documented line must START with the tool's real description — the doc may add a caution after
// it, but it may not keep an older wording once the tool's own description has changed. This is the
// drift that let the `sha` argument keep advertising "any rev git accepts" after the route started
// refusing `HEAD`.
//
// Limite assumée : c'est un test de PRÉFIXE, donc un ajout faux (« Pass `HEAD` … ») passe. Il attrape
// la dérive réelle — la doc qui garde l'ancienne formulation quand le code change — pas une
// affirmation ajoutée à la main, qu'aucun test ne peut juger.
for (const name of announced) {
  const source = descriptions.get(name);
  const doc = documented.get(name);
  if (source === undefined || doc === undefined) continue;
  if (!flat(doc).startsWith(flat(source))) {
    problems.push(`${name}: COVERAGE.md's description no longer matches the tool's own`);
  }
}

console.log(`tools/list   : ${tools.length} outils`);
console.log(`resources/list: ${resources.length} ressources`);
console.log(`COVERAGE.md  : ${documented.size} outils documentés (TOTAL annoncé : ${coverageTotal})`);
console.log(`README.md    : ${totals.tools} outils, ${totals.resources} ressources annoncés`);
console.log();

if (problems.length === 0) {
  console.log('OK — la documentation et le serveur annoncent la même chose.');
  process.exit(0);
}

console.log('DÉRIVE DOCUMENTAIRE :');
for (const problem of problems) console.log(`  ✗ ${problem}`);
process.exit(1);
