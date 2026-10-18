/* CONSTRUIRE LE SITE PUBLIÉ (_site/) — lancé par la publication GitHub Actions,
   après `npm test`.

   POURQUOI. app.js est écrit pour être relu : ses commentaires racontent chaque
   défaut corrigé, et pèsent plus que le code. Le navigateur, lui, n'en a que
   faire : ils doublaient le poids à télécharger et à analyser sur un téléphone.
   Et GitHub Pages servait TOUT le dépôt (audits, SQL, tests, maquettes) : seul
   ce que le navigateur charge part désormais en ligne.

   CE QUE FAIT CE SCRIPT.
   · copie ce que le site charge : index.html, 404.html, les icônes, fonts/,
     vendor/ (tel quel : ses empreintes doivent rester exactes) ;
   · minifie app.js (espaces, commentaires, syntaxe — JAMAIS les noms : les
     `onclick` du HTML appellent les fonctions par leur nom) et les feuilles ;
   · retire les commentaires HTML d'index.html et de 404.html ;
   · vérifie le résultat : app.js se relit, chaque fichier référencé existe,
     les empreintes de vendor/ sont intactes.
   esbuild est pris à une version EXACTE : une montée de version est un geste
   testé, pas une surprise de production. */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = process.env.RACINE || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SORTIE = process.env.SORTIE || path.join(RACINE, '_site');
const ESBUILD = ['--yes', 'esbuild@0.24.0'];
const FICHIERS = ['index.html', '404.html', 'favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'];
const DOSSIERS = ['vendor', 'fonts'];
const FEUILLES = ['tokens.css', 'components.css', 'styles.css', 'financier.css', 'tactile.css'];

const src = f => path.join(RACINE, f);
const dst = f => path.join(SORTIE, f);
const taille = f => fs.statSync(f).size;
const ko = n => `${(n / 1024).toFixed(0)} Ko`;

fs.rmSync(SORTIE, { recursive: true, force: true });
fs.mkdirSync(SORTIE, { recursive: true });

for (const f of FICHIERS) fs.copyFileSync(src(f), dst(f));
for (const d of DOSSIERS) fs.cpSync(src(d), dst(d), { recursive: true });

// app.js : sans renommer quoi que ce soit (le HTML appelle les fonctions par leur nom).
execFileSync('npx', [...ESBUILD, src('app.js'), '--minify-whitespace', '--minify-syntax',
  '--legal-comments=none', '--charset=utf8', '--target=es2020', `--outfile=${dst('app.js')}`], { stdio: 'inherit' });
for (const f of FEUILLES) {
  execFileSync('npx', [...ESBUILD, src(f), '--minify', '--charset=utf8', `--outfile=${dst(f)}`], { stdio: 'inherit' });
}
for (const f of ['index.html', '404.html']) {
  const html = fs.readFileSync(dst(f), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\n\s*\n+/g, '\n');
  fs.writeFileSync(dst(f), html);
}

// ── Vérifications : une publication cassée ne part pas ──────────────────────
execFileSync(process.execPath, ['--check', dst('app.js')], { stdio: 'inherit' });
const index = fs.readFileSync(dst('index.html'), 'utf8');
const references = [...index.matchAll(/(?:src|href)="([^"#:]+?)(?:\?[^"]*)?"/g)].map(m => m[1]);
const manquants = references.filter(r => !fs.existsSync(dst(r)));
if (manquants.length) throw new Error('Fichiers référencés absents de la publication : ' + manquants.join(', '));
const empreintes = JSON.parse(fs.readFileSync(src('vendor/empreintes.json'), 'utf8'));
for (const [f, attendue] of Object.entries(empreintes)) {
  const vue = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(dst(f))).digest('base64');
  if (vue !== attendue) throw new Error(`Empreinte modifiée dans la publication : ${f}`);
}
// Les fonctions appelées depuis le HTML (onclick) existent toujours sous leur nom.
const js = fs.readFileSync(dst('app.js'), 'utf8');
for (const nom of ['navigate', 'doLogin', 'sfAllerPointer', 'sfExporterDonnees', 'openDetail']) {
  if (!new RegExp(`function ${nom}\\(`).test(js)) throw new Error(`Fonction renommée ou perdue : ${nom}`);
}

console.log(`app.js : ${ko(taille(src('app.js')))} → ${ko(taille(dst('app.js')))}`);
console.log(`feuilles : ${ko(FEUILLES.reduce((a, f) => a + taille(src(f)), 0))} → ${ko(FEUILLES.reduce((a, f) => a + taille(dst(f)), 0))}`);
console.log(`index.html : ${ko(taille(src('index.html')))} → ${ko(taille(dst('index.html')))}`);
console.log('Publication prête dans', SORTIE);
