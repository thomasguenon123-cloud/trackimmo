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
  // v=103 : deux scripts au démarrage, supabase-js et app.js ; le reste se
  // charge à la demande (garde suivante).
  assert.ok(scripts.length >= 2, 'témoin : les scripts sont trouvés');
  assert.ok(scripts.some(([, src]) => src.startsWith('vendor/supabase-js-')), 'témoin : supabase-js est chargé depuis vendor/');
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

/* v=103 — LES BIBLIOTHÈQUES LOURDES SE CHARGENT À LA DEMANDE. Chart.js, pdf.js,
   html2canvas, jsPDF et pdf-lib pesaient 1,2 Mo que chaque ouverture
   téléchargeait et analysait, pour trois écrans qui s'en servent (Marché,
   offre PDF, dossier banque). Elles sont maintenant décrites dans
   SF_BIBLIOS et chargées par sfChargerBiblio(), une fois, AVEC leur empreinte. */
function biblios() {
  const bloc = SRC.slice(SRC.indexOf('const SF_BIBLIOS'), SRC.indexOf('const sfBibliosEnCours'));
  return [...bloc.matchAll(/(\w+):\s*\{\s*src:\s*'([^']+)',\s*integrity:\s*'([^']+)'/g)]
    .map(([, nom, src, integrite]) => ({ nom, src, integrite }));
}

test('app.js ne charge ni script ni police d’un autre site', () => {
  const liste = biblios();
  assert.ok(liste.length >= 5, `témoin : ${liste.length} bibliothèques à la demande`);
  for (const { nom, src, integrite } of liste) {
    assert.match(src, /^vendor\//, `${nom} : script tiers chargé à la demande (${src})`);
    assert.ok(fs.existsSync(path.join(RACINE, src)), `${nom} : ${src} n’existe pas`);
    assert.equal(integrite, EMPREINTES[src], `${nom} : l’empreinte de SF_BIBLIOS diffère de vendor/empreintes.json`);
    assert.equal(integrite, empreinte(src), `${nom} : l’empreinte ne correspond pas au fichier — chargement refusé`);
  }
  const worker = (SRC.match(/workerSrc\s*=\s*'([^']+)'/) || [])[1];
  assert.ok(worker && worker.startsWith('vendor/') && fs.existsSync(path.join(RACINE, worker)), 'le travailleur de pdf.js est hébergé ici');
  assert.doesNotMatch(SRC, /fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|cdn\.jsdelivr|unpkg\.com/, 'appel à un CDN ou à Google Fonts');
});

test('les bibliothèques lourdes ne se chargent plus à l’ouverture, mais quand un écran en a besoin', () => {
  for (const { nom, src } of biblios()) {
    assert.ok(!INDEX.includes(src), `${nom} est de nouveau chargée par index.html : ${src} pèse sur chaque ouverture`);
  }
  // Chaque usage passe par sfChargerBiblio, sinon la première utilisation lève.
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /await sfChargerBiblio\('pdfjs'\)[\s\S]{0,200}pdfjsLib\.GlobalWorkerOptions/, 'l’offre PDF lit pdf.js sans l’avoir chargé');
  assert.match(code, /sfChargerBiblio\('chart'\)[\s\S]{0,800}new Chart\(/, 'les graphiques du Marché utilisent Chart.js sans l’avoir chargé');
  assert.match(code, /function bkdocEnsureLibs[\s\S]{0,900}\['html2canvas',\s*'jspdf',\s*'pdflib'\]\.map\(sfChargerBiblio\)/,
    'le dossier banque n’attend plus ses trois bibliothèques');
  assert.match(code, /s\.integrity = b\.integrity/, 'un script chargé à la demande doit porter son empreinte');
  // Scripts différés : la page se dessine avant que app.js ne s’exécute.
  for (const [balise] of INDEX.matchAll(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g)) {
    assert.match(balise, /\bdefer\b/, `script bloquant au démarrage : ${balise}`);
  }
});

test('sfChargerBiblio charge une fois, avec l’empreinte, et réessaie après un échec', async () => {
  const { charger, lire } = require('./charger-app');
  const ctx = charger();
  const ajoutes = [];
  ctx.document.createElement = () => ({});
  ctx.document.head.appendChild = s => ajoutes.push(s);
  ctx.pdfjsLib = undefined;
  const p1 = ctx.sfChargerBiblio('pdfjs');
  const p2 = ctx.sfChargerBiblio('pdfjs');
  assert.equal(ajoutes.length, 1, 'deux demandes simultanées ne chargent le fichier qu’une fois');
  assert.equal(ajoutes[0].src, 'vendor/pdfjs-3.11.174/pdf.min.js');
  assert.equal(ajoutes[0].integrity, EMPREINTES['vendor/pdfjs-3.11.174/pdf.min.js']);
  ajoutes[0].onerror();
  await assert.rejects(p1, /Échec de chargement/);
  await assert.rejects(p2);
  const p3 = ctx.sfChargerBiblio('pdfjs');
  assert.equal(ajoutes.length, 2, 'après un échec réseau, une nouvelle demande doit retenter');
  ctx.pdfjsLib = {};
  ajoutes[1].onload();
  await p3;
  await ctx.sfChargerBiblio('pdfjs');
  assert.equal(ajoutes.length, 2, 'une bibliothèque déjà là ne se recharge pas');
  await assert.rejects(ctx.sfChargerBiblio('inconnue'), /inconnue/);
  void lire;
});

test('la page 404 ne charge rien d’un autre site non plus', () => {
  /* Servie à toute adresse inconnue et pendant chaque déploiement : elle
     chargeait encore la police Inter chez Google Fonts (v=103). */
  const page = lire('404.html').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(page, /<title>/, 'témoin : la page est lue');
  assert.doesNotMatch(page, /(?:href|src)="https?:\/\//, 'ressource tierce dans 404.html');
  assert.doesNotMatch(page, /fonts\.googleapis|fonts\.gstatic|jsdelivr|cdnjs|unpkg/);
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
