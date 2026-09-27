/* LE CLOISONNEMENT DES OUTILS DESTRUCTEURS — six boutons, un seul endroit juste.

   ⚠️ POURQUOI CE FICHIER EXISTE. Le même défaut s'est produit DEUX FOIS.
   Le 05/09/2026 : « Purger les anciennes données base64 » promettait à l'écran
   de ne toucher qu'aux lignes déjà migrées, et vidait `locataires.documents`
   de TOUS les comptes. Le 27/09/2026 : six outils de test et de purge étaient
   visibles de tout utilisateur — trois dans l'en-tête d'Administration, trois
   dans Paramètres > Données — sans aucune garde de rôle.

   Deux fois le même motif : un outil de développement laissé dans le produit.
   Les deux fois, trouvé à l'œil. Un test le trouvera la troisième fois.

   La règle que ces gardes tiennent :
     · un outil qui FABRIQUE de la donnée factice est réservé aux
       administrateurs — il vit dans Paramètres > Maintenance ;
     · un outil qui EFFACE les données de l'utilisateur reste accessible à
       l'utilisateur — c'est sa donnée — mais dans une zone qui s'annonce
       comme dangereuse, jamais à côté d'un indicateur ;
     · une suppression se confirme à la charte, pas par `confirm()` ;
     · une suppression écrit le compte qu'elle vise, même quand la RLS le
       rattrape.

   Les six gardes sont validées par mutation le 27/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

/* Le corps d'une fonction de premier niveau, commentaires RETIRÉS.
   ⚠️ Les retirer n'est pas un détail : les commentaires de ce dépôt citent
   volontiers le défaut qu'ils corrigent — « `confirm()` affiche une boîte du
   NAVIGATEUR », « TROIS BOUTONS ONT QUITTÉ CET EN-TÊTE ». Une garde qui lit
   le texte brut s'accuse elle-même. Le piège s'est déjà produit sur
   `sfProfilNom` le 27/09. */
function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const FABRIQUENT = ['genTestData', 'genAdminTestData'];
const EFFACENT   = ['purgeTestData', 'purgeAllData', 'purgeAdminTestData', 'purgeAllAdminData'];

test('aucun outil de test ni de purge ne survit dans l\'en-tête d\'Administration', () => {
  const html = corps('renderAdministration');
  for (const fn of [...FABRIQUENT, ...EFFACENT]) {
    assert.ok(!html.includes(fn + '()'),
      `« ${fn} » est de retour dans renderAdministration. Cet écran est ouvert à ` +
      `TOUT utilisateur : un outil destructeur ou générateur n'y a pas sa place.`);
  }
});

test('les outils qui FABRIQUENT de la donnée factice ne vivent que dans Maintenance', () => {
  const maintenance = corps('paramsMaintenanceHtml');
  for (const fn of FABRIQUENT) {
    assert.ok(maintenance.includes(fn + '()'),
      `« ${fn} » devrait être appelé depuis paramsMaintenanceHtml.`);
  }
  /* Et nulle part ailleurs dans une surface ouverte à tous. */
  for (const fn of FABRIQUENT) {
    assert.ok(!corps('paramsDonneesHtml').includes(fn + '()'),
      `« ${fn} » est revenu dans Paramètres > Données, dont la famille ` +
      `« Données & gestion » n'est PAS adminOnly : tout utilisateur le verrait.`);
  }
});

test('la section Maintenance est bien réservée aux administrateurs', () => {
  /* La garde ne vaut que si Maintenance reste adminOnly — sinon on a déplacé
     les outils d'une surface ouverte vers une autre. */
  const entree = SRC.match(/\{\s*id:\s*'maintenance'[^}]*\}/);
  assert.ok(entree, 'entrée « maintenance » introuvable dans PARAMS_SECTIONS');
  assert.match(entree[0], /adminOnly:\s*true/,
    'La section Maintenance a perdu son adminOnly : les outils de test qu\'elle ' +
    'abrite redeviennent visibles de tout utilisateur.');
});

test('les quatre suppressions se confirment à la charte, jamais par confirm()', () => {
  for (const fn of EFFACENT) {
    const c = corps(fn);
    assert.ok(!/(?<![.\w])confirm\(/.test(c),
      `« ${fn} » est revenu à confirm(). La boîte native affiche « github.io ` +
      `indique » en tête — la seule fenêtre qui trahit l'application.`);
    assert.ok(c.includes('sfConfirmer({'),
      `« ${fn} » doit demander confirmation avec sfConfirmer.`);
  }
});

test('une suppression qui se dit irréversible passe le drapeau danger', () => {
  for (const fn of EFFACENT) {
    assert.match(corps(fn), /danger:\s*true/,
      `« ${fn} » ouvre une fenêtre sans « danger: true » : elle aura l'icône et ` +
      `le bouton d'une confirmation ordinaire pour une action irréversible.`);
  }
});

test('les suppressions de biens écrivent le compte visé, sans s\'en remettre à la RLS', () => {
  /* ⚠️ La RLS les rattrape aujourd'hui — `biens_own_delete` est
     `auth.uid() = user_id`. Cette garde ne double pas la RLS, elle empêche la
     FORME qui a rendu la purge base64 dangereuse : un `.delete()` qui ne dit
     pas de qui il parle finit par être appelé là où la RLS ne s'applique pas. */
  for (const fn of ['purgeTestData', 'purgeAllData']) {
    const c = corps(fn);
    assert.ok(/\.delete\(\)/.test(c), `${fn} ne supprime plus rien ?`);
    assert.match(c, /\.eq\('user_id',\s*currentUser\.id\)/,
      `« ${fn} » supprime sans filtrer explicitement sur user_id.`);
    assert.ok(!c.includes(".neq('id'"),
      `« ${fn} » vise « tout » par .neq('id', …) au lieu de nommer le compte.`);
  }
});
