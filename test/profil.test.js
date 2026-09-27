/* LE NOM DE L'UTILISATEUR — lu aux clés que la base rend vraiment.

   ⚠️ LE DÉFAUT. Trois endroits lisaient les clés « prenom » et « nom » du
   profil. Or get_my_profile() fait un row_to_json() sur la table profiles :
   les clés rendues sont les NOMS DE COLONNES — first_name, last_name. Les
   trois lectures valaient donc `undefined` DEPUIS TOUJOURS, en silence. Le
   prénom était pourtant bien en base, saisi à la création du compte.

   Gardes validées par mutation le 27/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-27T12:00:00') });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* ⚠️ LES COMMENTAIRES D'ABORD, pour toutes les gardes qui lisent la source.
   Ce dépôt commente abondamment, et le commentaire de `sfProfilNom` CITE le
   défaut qu'il corrige : la garde s'accuserait elle-même. Même piège que
   l'analyseur CSS de `tactile.test.js`. */
const CODE = APP_JS.replace(/\/\*[\s\S]*?\*\//g, '')
                   .replace(/<!--[\s\S]*?-->/g, '')
                   .replace(/^\s*\/\/.*$/gm, '');

/* Le profil tel que get_my_profile() le rend : row_to_json sur la table, donc
   les noms de colonnes. Vérifiés en base le 19/09/2026. */
const PROFIL = { user_id: 'u1', email: 'x@y.fr', first_name: 'Thomas',
                 last_name: 'Guénon', role: 'admin', status: 'active' };

test('le nom se lit sur first_name et last_name', () => {
  const id = app.sfProfilNom(PROFIL);
  assert.equal(id.prenom, 'Thomas');
  assert.equal(id.nom, 'Guénon');
  assert.equal(id.complet, 'Thomas Guénon');
  assert.equal(id.initiales, 'TG');
});

test('RÉGRESSION — les clés « prenom »/« nom » ne rendent plus rien', () => {
  /* Le défaut exact : un profil qui ne porte QUE ces clés — celles que le code
     cherchait — ne doit rien donner, parce que la base ne les rend jamais. */
  const id = app.sfProfilNom({ prenom: 'Thomas', nom: 'Guénon' });
  assert.equal(id.complet, '', 'le code lit de nouveau des clés que la base ne rend pas');
  assert.equal(id.initiales, '');
});

test('un profil incomplet ne produit ni espace ni initiale fantôme', () => {
  assert.equal(app.sfProfilNom({ first_name: 'Thomas' }).complet, 'Thomas');
  assert.equal(app.sfProfilNom({ first_name: 'Thomas' }).initiales, 'T');
  assert.equal(app.sfProfilNom({ last_name: 'Guénon' }).complet, 'Guénon');
  assert.equal(app.sfProfilNom({}).complet, '');
  assert.equal(app.sfProfilNom(null).complet, '');
});

test('RÉGRESSION — le double espace ne peut plus se produire', () => {
  /* Le document bancaire concaténait `prénom + ' ' + nom` : une espace
     parasite dans un champ donnait « Thomas  Guénon », que `.trim()` ne
     nettoie pas — il ne touche que les bords. */
  const id = app.sfProfilNom({ first_name: 'Thomas ', last_name: ' Guénon' });
  assert.equal(id.complet, 'Thomas Guénon');
  assert.doesNotMatch(id.complet, /  /, 'deux espaces au milieu du nom');
});

test('RÉGRESSION — une seule fonction compose le nom d’affichage', () => {
  /* ⚠️ Le point ET le point-optionnel : une garde qui ne cherche que
     `currentProfile?.x` laisse passer `currentProfile.x`. */
  const enDirect = CODE.match(/currentProfile\??\.(first_name|last_name|prenom|nom)\b/g) || [];
  assert.deepEqual(enDirect, [],
    `lecture directe du nom hors de sfProfilNom : ${enDirect.join(', ')}`);

  /* ⚠️ On compte les APPELS, pas la déclaration : `>= 3` l'incluait et
     n'exigeait donc en réalité que deux appelants, alors qu'il y en a quatre. */
  const appels = (CODE.match(/(?<!function )sfProfilNom\(/g) || []).length;
  assert.ok(appels >= 4, `seulement ${appels} appels : un consommateur recompose le nom lui-même`);

  assert.doesNotMatch(CODE, /\(d\.profil\?\.first_name \|\| ''\) \+ ' '/,
    'le document bancaire recompose de nouveau le nom');
  assert.doesNotMatch(CODE, /\[u\.first_name, u\.last_name\]\.filter/,
    'la liste d’administration recompose de nouveau le nom');
});

test('RÉGRESSION — le bouton « Relancer » a disparu', () => {
  /* Il promettait de réactiver un guide d'accueil et se bornait à notifier
     « bientôt disponible ». Depuis v=86 le parcours de démarrage réapparaît
     de lui-même : un bouton pour rallumer ce qui s'allume seul n'a rien à
     rallumer. */
  assert.doesNotMatch(CODE, /Tutoriel : bientôt disponible/,
    'la promesse tenue par une notification est revenue');
});
