/* LA PUBLICATION CONSTRUITE (scripts/construire.mjs, préparée en v=103).

   Une fois la publication GitHub Actions activée, seul ce que le script copie
   part en ligne. Le risque : ajouter un fichier au site (une icône, une
   bibliothèque, une police) sans l'ajouter au script — il marcherait en local
   et manquerait en production. Ces gardes relisent ce que le site charge et
   vérifient que la publication l'emporte, que les noms des fonctions survivent
   à la minification (les `onclick` du HTML les appellent), que l'outil est pris
   à une version exacte et que les tests passent AVANT la construction.

   ⚠️ LES ACTIONS DU WORKFLOW (18/10/2026, après la v=105). GitHub abandonne
   Node.js 20 : nos cinq actions y étaient encore (checkout@v4, setup-node@v4,
   configure-pages@v5, upload-pages-artifact@v3 → upload-artifact@v4,
   deploy-pages@v4), exécutées d'office sous Node.js 24 avec un avertissement à
   chaque publication. Elles sont montées aux versions qui déclarent `node24`
   (lu dans leur action.yml, au dépôt officiel) et ÉPINGLÉES par empreinte de
   commit : une étiquette `@v7` suit la dernière v7.x publiée, sans test. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const SCRIPT = lire('scripts/construire.mjs');
const FLUX = lire('.github/workflows/publication.yml');
const liste = nom => JSON.parse((SCRIPT.match(new RegExp(`const ${nom} = (\\[[^\\]]*\\])`)) || [])[1].replace(/'/g, '"'));
const FICHIERS = liste('FICHIERS'), DOSSIERS = liste('DOSSIERS'), FEUILLES = liste('FEUILLES');
const publie = f => f === 'app.js' || FICHIERS.includes(f) || FEUILLES.includes(f) || DOSSIERS.some(d => f.startsWith(d + '/'));

test('tout fichier que le site charge part dans la publication', () => {
  const charges = new Set();
  const index = lire('index.html').replace(/<!--[\s\S]*?-->/g, '');
  for (const m of index.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)) charges.add(m[1]);
  for (const f of FEUILLES) for (const m of lire(f).matchAll(/url\(\s*["']?([^"')]+?)["']?\s*\)/g)) if (!/^(data:|https?:)/.test(m[1])) charges.add(m[1]);
  const app = lire('app.js');
  for (const m of app.matchAll(/'(vendor\/[^']+)'/g)) charges.add(m[1]);
  assert.ok(charges.size >= 15, `témoin : ${charges.size} fichiers chargés relevés`);
  assert.ok([...charges].some(c => c.startsWith('vendor/pdfjs')), 'témoin : les bibliothèques à la demande sont relevées');
  const oublies = [...charges].filter(c => !publie(c));
  assert.deepEqual(oublies, [], 'chargés par le site mais absents de la publication : ' + oublies.join(', '));
  for (const c of charges) assert.ok(fs.existsSync(path.join(RACINE, c)), `${c} est chargé mais n’existe pas`);
});

test('la minification ne renomme rien, et l’outil est à une version exacte', () => {
  const ligneApp = SCRIPT.split('\n').find(l => l.includes("src('app.js')"));
  assert.ok(ligneApp, 'témoin : la construction d’app.js est trouvée');
  assert.match(ligneApp, /--minify-whitespace/);
  assert.doesNotMatch(ligneApp, /'--minify'|--minify-identifiers|--bundle/,
    'app.js minifié avec renommage : les onclick du HTML appelleraient des fonctions disparues');
  assert.match(SCRIPT, /esbuild@\d+\.\d+\.\d+'/, 'esbuild doit être pris à une version exacte');
  // vendor/ part tel quel : ses empreintes (integrity, SF_BIBLIOS) doivent rester exactes.
  assert.match(SCRIPT, /empreintes\.json/, 'la publication revérifie les empreintes de vendor/');
});

test('la publication passe les tests avant de construire, et ne publie que _site', () => {
  const iTests = FLUX.indexOf('npm test'), iConstruire = FLUX.indexOf('node scripts/construire.mjs');
  assert.ok(iTests > 0 && iConstruire > iTests, 'les tests doivent passer AVANT la construction');
  assert.match(FLUX, /upload-pages-artifact@[0-9a-f]{40}[^\n]*\n\s+with:\s*\n\s+path:\s*_site\s*$/m, 'seul _site part en ligne');
  assert.match(lire('.gitignore'), /^_site\/$/m, 'la publication construite ne se versionne pas');
  // Activée le 18/10 : chaque push sur main se publie par ce fichier (et lui seul).
  assert.match(FLUX, /\non:\s*\n\s+push:\s*\n\s+branches:\s*\[main\]/, 'la publication ne se déclenche plus sur main');
  assert.match(FLUX, /workflow_dispatch/, 'la relance à la main a disparu');
});

// La plus ancienne version de chaque action qui déclare `using: node24`
// (checkout et setup-node : v5 ; configure-pages : v6 ; deploy-pages : v5 ;
// upload-pages-artifact : v5, qui appelle upload-artifact v7).
const NODE24_DES = { checkout: 5, 'setup-node': 5, 'configure-pages': 6, 'upload-pages-artifact': 5, 'deploy-pages': 5 };

test('les actions de la publication tournent sous Node.js 24, épinglées par empreinte de commit', () => {
  const sansCommentaires = FLUX.split('\n').filter(l => !/^\s*#/.test(l));
  const usages = sansCommentaires.filter(l => /\buses:/.test(l));
  assert.equal(usages.length, Object.keys(NODE24_DES).length, `témoin : ${usages.length} actions relevées`);
  const vues = new Set();
  for (const l of usages) {
    const m = l.match(/uses:\s*actions\/([a-z-]+)@([^\s#]+)\s*(?:#\s*v(\d+)\.(\d+)\.(\d+))?\s*$/);
    assert.ok(m, `action inattendue : ${l.trim()}`);
    const [, nom, ref, majeure] = m;
    vues.add(nom);
    assert.ok(nom in NODE24_DES, `action non répertoriée : ${nom}`);
    assert.match(ref, /^[0-9a-f]{40}$/,
      `actions/${nom}@${ref} : une étiquette suit la dernière version publiée, sans test — épingler l'empreinte du commit`);
    assert.ok(majeure, `actions/${nom} : sa version doit être dite en commentaire (« # vX.Y.Z »)`);
    assert.ok(Number(majeure) >= NODE24_DES[nom],
      `actions/${nom} v${majeure} tourne encore sous Node.js 20 (Node.js 24 dès la v${NODE24_DES[nom]})`);
  }
  assert.deepEqual([...vues].sort(), Object.keys(NODE24_DES).sort(), 'témoin : chaque action est relevée une fois');
  // Ni cache automatique (aucune dépendance, et un workflow qui déploie), ni jeton laissé dans le dépôt cloné.
  assert.match(FLUX, /setup-node@[0-9a-f]{40}[^\n]*\n\s+with:(?:\n\s+[a-z-]+:.*)*?\n\s+package-manager-cache:\s*false/,
    'le cache automatique de setup-node doit rester coupé');
  assert.match(FLUX, /checkout@[0-9a-f]{40}[^\n]*\n\s+with:(?:\n\s+[a-z-]+:.*)*?\n\s+persist-credentials:\s*false/,
    'le jeton GitHub ne doit pas rester dans le dépôt cloné');
});
