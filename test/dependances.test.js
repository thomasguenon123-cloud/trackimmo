/* LE CODE EXÉCUTÉ VIENT DE CE DÉPÔT, ET DE LUI SEUL (v=102).

   ⚠️ POURQUOI. Jusqu'à la v=101, sept bibliothèques arrivaient de jsDelivr et
   de cdnjs, et la police du dossier banque de Google Fonts. Un CDN compromis,
   ou une version publiée la veille (supabase-js le 15/10/2026), s'exécutait
   dans la page même où vit la session ; et chaque visiteur donnait son
   adresse IP à trois tiers. Depuis la v=102 : tout est dans vendor/, versions
   exactes prises sur npm, empreintes consignées (vendor/empreintes.json), et
   une politique de sécurité du contenu (CSP) refuse tout script d'ailleurs.

   Monter une bibliothèque de version : remplacer le fichier, mettre à jour
   son empreinte (ici et dans index.html), passer au banc. Ces gardes le
   rappellent si on l'oublie. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RACINE = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const INDEX = lire('index.html');
const SRC = lire('app.js');
const EMPREINTES = JSON.parse(lire('vendor/empreintes.json'));
const empreinte = f => 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(RACINE, f))).digest('base64');

test('chaque fichier de vendor/ correspond à son empreinte consignée', () => {
  const fichiers = Object.keys(EMPREINTES);
  assert.ok(fichiers.length >= 12, `témoin : ${fichiers.length} fichiers consignés`);
  for (const f of fichiers) assert.equal(empreinte(f), EMPREINTES[f], `${f} a changé sans que son empreinte suive`);
});

test('index.html ne charge aucun script d’un autre site, et chacun porte la bonne empreinte', () => {
  const scripts = [...INDEX.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)];
  assert.ok(scripts.length >= 4, 'témoin : les scripts sont trouvés');
  for (const [balise, src] of scripts) {
    assert.doesNotMatch(src, /^(https?:)?\/\//, `script tiers : ${src}`);
    if (src.startsWith('vendor/')) {
      const integrite = (balise.match(/\bintegrity="([^"]+)"/) || [])[1];
      assert.ok(integrite, `${src} : empreinte integrity absente`);
      assert.equal(integrite, empreinte(src), `${src} : l’empreinte d’index.html ne correspond pas au fichier — page blanche assurée`);
    }
  }
  assert.doesNotMatch(INDEX, /<link[^>]+href="https?:\/\/[^"]*(fonts\.googleapis|cdnjs|jsdelivr|unpkg)/, 'feuille de style tierce');
});

test('app.js ne charge ni script ni police d’un autre site', () => {
  const charges = [...SRC.matchAll(/bkdocLoadScript\('([^']+)'\)/g)].map(m => m[1]);
  assert.ok(charges.length >= 3, 'témoin : les bibliothèques du dossier banque sont chargées à la demande');
  for (const c of charges) {
    assert.match(c, /^vendor\//, `script tiers chargé à la demande : ${c}`);
    assert.ok(fs.existsSync(path.join(RACINE, c)), `${c} n’existe pas`);
  }
  const worker = (SRC.match(/workerSrc\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(worker && worker.startsWith('vendor/') && fs.existsSync(path.join(RACINE, worker)), 'le travailleur de pdf.js est hébergé ici');
  assert.doesNotMatch(SRC, /fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com/, 'appel à un CDN ou à Google Fonts');
});

test('la politique de sécurité refuse les scripts tiers et laisse passer chaque service appelé', () => {
  const csp = (INDEX.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
  assert.ok(csp, 'témoin : la politique de sécurité est posée');
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([n, ...v]) => [n, v]));
  assert.deepEqual(dir['script-src'].filter(v => /^https?:|\*/.test(v)), [], 'script-src ne nomme aucun site tiers');
  assert.deepEqual(dir['object-src'], ["'none'"]);
  assert.ok(dir['base-uri'] && dir['form-action'], 'base-uri et form-action sont bornés');
  // Les services que app.js interroge réellement.
  const hotes = new Set();
  for (const m of SRC.matchAll(/(?:fetch|apiFetch)\(\s*['`]https:\/\/([^/'`?]+)/g)) hotes.add(m[1]);
  for (const m of SRC.matchAll(/const (?:BASE|SF_GEO_COMMUNES|SUPABASE_URL|url)\s*=\s*['`]https:\/\/([^/'`?]+)/g)) hotes.add(m[1]);
  assert.ok(hotes.size >= 5, `témoin : ${[...hotes].join(', ')}`);
  for (const h of hotes) assert.ok(dir['connect-src'].includes('https://' + h), `connect-src oublie ${h} : la fonction qui l’appelle casserait en silence`);
});
