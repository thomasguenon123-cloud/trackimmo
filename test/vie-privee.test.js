/* AUCUNE ADRESSE PERSONNELLE DANS CE QUI EST PUBLIÉ (v=102).

   ⚠️ POURQUOI. Le dépôt est public et GitHub Pages sert TOUT le dépôt :
   chaque fichier ici se lit sur Internet, et `app.js` est téléchargé par
   chaque visiteur du site, connecté ou non. Jusqu'à la v=101, l'adresse
   personnelle du propriétaire y était écrite en clair (repli du rôle admin,
   dans `app.js` et dans la fonction d'invitation). Consigne de Thomas du
   17/10/2026 : son adresse ne doit JAMAIS être publique, ni à la disposition
   des autres utilisateurs.

   La garde refuse toute adresse d'un fournisseur de messagerie personnel
   dans les fichiers du dépôt. Les exemples s'écrivent en « @exemple.fr ».
   Elle n'écrit elle-même aucune adresse : son canari la fabrique. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const EXTENSIONS = /\.(js|mjs|ts|html|css|md|sql|json|txt|py|svg|yml|yaml)$/i;
const IGNORES = new Set(['.git', 'node_modules', 'vendor']);

function fichiers(dossier) {
  const out = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (IGNORES.has(e.name)) continue;
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiers(p));
    else if (EXTENSIONS.test(e.name)) out.push(p);
  }
  return out;
}

const FOURNISSEURS = ['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'icloud',
  'me', 'aol', 'orange', 'wanadoo', 'free', 'sfr', 'neuf', 'laposte', 'bbox', 'gmx', 'proton', 'protonmail'];
const ADRESSE = new RegExp(`[A-Za-z0-9._%+-]+@(?:${FOURNISSEURS.join('|')})\\.[a-z]{2,}`, 'gi');

test('le détecteur reconnaît une adresse personnelle (canari)', () => {
  const fabriquee = ['prenom.nom', 'gmail.com'].join('@');
  assert.match(fabriquee, new RegExp(ADRESSE.source, 'i'));
  assert.doesNotMatch(['contact', 'exemple.fr'].join('@'), new RegExp(ADRESSE.source, 'i'), 'un exemple en @exemple.fr passe');
});

test('aucune adresse de messagerie personnelle dans les fichiers publiés', () => {
  const liste = fichiers(RACINE);
  assert.ok(liste.length > 40, `témoin : ${liste.length} fichiers parcourus`);
  assert.ok(liste.some(f => f.endsWith('app.js')), 'témoin : app.js est parcouru');
  const trouvees = [];
  for (const f of liste) {
    const texte = fs.readFileSync(f, 'utf8');
    const m = texte.match(ADRESSE);
    // L'adresse elle-même n'est jamais réécrite dans le message d'échec.
    if (m) trouvees.push(`${path.relative(RACINE, f)} (${m.length})`);
  }
  assert.deepEqual(trouvees, [], 'adresse personnelle publiée dans : ' + trouvees.join(', '));
});
