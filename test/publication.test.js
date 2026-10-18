/* LA PUBLICATION CONSTRUITE (scripts/construire.mjs, préparée en v=103).

   Une fois la publication GitHub Actions activée, seul ce que le script copie
   part en ligne. Le risque : ajouter un fichier au site (une icône, une
   bibliothèque, une police) sans l'ajouter au script — il marcherait en local
   et manquerait en production. Ces gardes relisent ce que le site charge et
   vérifient que la publication l'emporte, que les noms des fonctions survivent
   à la minification (les `onclick` du HTML les appellent), que l'outil est pris
   à une version exacte et que les tests passent AVANT la construction. */
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
  assert.match(FLUX, /upload-pages-artifact@v\d[\s\S]*?path:\s*_site/, 'seul _site part en ligne');
  assert.match(lire('.gitignore'), /^_site\/$/m, 'la publication construite ne se versionne pas');
});
