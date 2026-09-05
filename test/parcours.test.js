/* LE PARCOURS DE DÉMARRAGE — ce qu'un compte neuf doit faire, dans l'ordre.

   ⚠️ CE QU'IL CORRIGE. `renderAccueil` n'avait aucune branche « première
   ouverture » : le verdict se calculait sur `pts.length === 0`, qui ne
   distingue pas « rien à signaler » de « rien du tout ». Un compte neuf lisait
   « Rien ne demande votre attention — vos loyers sont pointés et vos fiches
   sont complètes », alors qu'il n'avait rien saisi.

   Gardes validées par mutation le 05/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-05T12:00:00') });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const ACQUIS   = [{ id: 'b1', statut: 'Acheté' }];
const PROSPECT = [{ id: 'b2', statut: 'Renseignements Web' }];
const OCCUPANT = [{ id: 'l1', bien_id: 'b1', statut: 'Actif' }];
const POINTE   = [{ id: 'y1', statut: 'Payé' }];

const faits = (b, l, loc) =>
  Array.from(app.sfParcoursDemarrage(b || [], l || [], loc || [])).map(g => g.fait);

// ── Les quatre états d'un compte qui se remplit ────────────────────────────

test('un compte vide n’a rien de fait', () => {
  assert.deepEqual(faits([], [], []), [false, false, false]);
});

test('un bien EN PROSPECTION ne compte pas comme patrimoine', () => {
  /* La première étape demande un bien ACQUIS : c'est lui qui porte un bail.
     Une fiche de prospection ne produit aucun loyer à suivre. */
  assert.deepEqual(faits(PROSPECT, [], []), [false, false, false]);
});

test('un bien acquis coche la première étape, et elle seule', () => {
  assert.deepEqual(faits(ACQUIS, [], []), [true, false, false]);
});

test('un locataire en place coche la deuxième', () => {
  assert.deepEqual(faits(ACQUIS, [], OCCUPANT), [true, true, false]);
});

test('un loyer pointé coche la troisième', () => {
  assert.deepEqual(faits(ACQUIS, POINTE, OCCUPANT), [true, true, true]);
});

test('un locataire rattaché à un bien NON acquis ne coche rien', () => {
  const ailleurs = [{ id: 'l9', bien_id: 'b2', statut: 'Actif' }];
  assert.deepEqual(faits(ACQUIS, [], ailleurs), [true, false, false]);
});

test('un loyer seulement DÛ ne coche pas la troisième', () => {
  /* Toute la leçon de l'étape 3 : le cashflow réel ne compte que l'encaissé. */
  assert.deepEqual(faits(ACQUIS, [{ statut: 'En attente' }], OCCUPANT),
                   [true, true, false]);
});

// ── Le relais avec les points d'attention ──────────────────────────────────

test('RÉGRESSION — le parcours ne dépend PAS des points d’attention', () => {
  /* ⚠️ LA PREMIÈRE VERSION MASQUAIT LE PARCOURS dès qu'un point existait, en
     croyant lui « passer le relais ». C'était un CUL-DE-SAC : `sfPointsAttention`
     émet toujours quelque chose sitôt qu'un bien est acquis — « aucune charge
     saisie cette année », « fiche à compléter », « pas de mensualité de crédit ».
     Le parcours ne pouvait donc jamais dépasser sa première étape : les deux
     suivantes n'étaient atteignables dans AUCUN état de l'application.
     Les deux listes répondent à des questions différentes et cohabitent. */
  const src = APP_JS.slice(APP_JS.indexOf('function sfParcoursAMontrer'),
                           APP_JS.indexOf('function sfPointsAttention'));
  assert.doesNotMatch(src, /\bpts\b/,
    'le parcours redevient invisible dès le premier bien acquis');

  const p = app.sfParcoursDemarrage(ACQUIS, [], []);
  assert.equal(app.sfParcoursAMontrer(p), true, 'deux gestes restent à faire');
});

test('le parcours disparaît quand les trois gestes sont faits', () => {
  const p = app.sfParcoursDemarrage(ACQUIS, POINTE, OCCUPANT);
  assert.equal(app.sfParcoursAMontrer(p), false);
});

test('RÉGRESSION — aucun état n’est stocké, le parcours se déduit', () => {
  /* Une case cochée en base mentirait le jour où l'on supprime le dernier
     bien. Ici le parcours réapparaît de lui-même, parce qu'il redevient vrai.
     On vérifie qu'aucune persistance ne s'est glissée dans la fonction. */
  const src = APP_JS.slice(APP_JS.indexOf('function sfParcoursDemarrage'),
                           APP_JS.indexOf('function sfParcoursAMontrer'));
  assert.doesNotMatch(src, /localStorage|db\.from|dataset|sessionStorage/,
    'le parcours ne doit dépendre d’aucun état stocké');
  // Et il redevient vrai si le compte se vide.
  assert.equal(app.sfParcoursAMontrer(app.sfParcoursDemarrage([], [], [])), true);
});

// ── Un seul geste actionnable à la fois ────────────────────────────────────

test('RÉGRESSION — le rendu ne propose qu’UN bouton, celui de l’étape suivante', () => {
  /* Montrer un bouton sur une étape inatteignable — déclarer un locataire sans
     bien acquis — serait promettre un raccourci qui n'existe pas. */
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage([], [], []));
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.match(html, /acc-pas--suivant/);
  assert.equal((html.match(/acc-pas--plus-tard/g) || []).length, 2);
});

test('le rendu marque comme faites les étapes franchies', () => {
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage(ACQUIS, [], OCCUPANT));
  assert.equal((html.match(/acc-pas--fait/g) || []).length, 2);
  assert.equal((html.match(/<button/g) || []).length, 1, 'reste le troisième geste');
});

test('aucun bouton quand tout est fait', () => {
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage(ACQUIS, POINTE, OCCUPANT));
  assert.equal((html.match(/<button/g) || []).length, 0);
});

// ── Le verdict cesse de mentir ─────────────────────────────────────────────

test('RÉGRESSION — « Rien ne demande votre attention » ne s’affiche plus à vide', () => {
  /* La phrase existe toujours, mais derrière `demarrage` : elle ne peut plus
     s'afficher tant qu'un geste de démarrage reste à faire. */
  const i = APP_JS.indexOf('const verdict = coutent');
  assert.ok(i > -1, 'le verdict ne suit plus l’ordre attendu');
  const bloc = APP_JS.slice(i, i + 1400);
  /* ⚠️ L'ARGENT PASSE AVANT LE DÉMARRAGE. Un loyer en retard coûte pendant
     qu'on apprend à se servir de l'outil : annoncer « plus que deux gestes »
     au-dessus d'un impayé enterrerait le seul point qui presse. */
  assert.ok(bloc.indexOf('vous coûte') < bloc.indexOf('pour démarrer'),
    'ce qui coûte de l’argent doit être annoncé avant le démarrage');
  assert.ok(bloc.indexOf('pour démarrer') < bloc.indexOf('Rien ne demande votre attention'),
    'la branche « compte neuf » doit être évaluée avant celle des points');
});

test('RÉGRESSION — le verdict de démarrage porte un habillage qui existe', () => {
  /* ⚠️ `type:''` rendait `class="acc-verdict acc-verdict--"`, qui ne
     correspond à aucune règle : plus de fond, et surtout une pastille SANS
     couleur de fond — dont l'icône est dessinée en `--sf-bg`, donc invisible
     sur le fond de la page, qui est ce même `--sf-bg`. Exactement sur l'écran
     d'un compte neuf, le seul que ce code sert. */
  assert.match(APP_JS, /type:\s*'demarrage'/, 'le verdict de démarrage a perdu son type');
  const css = fs.readFileSync(path.join(__dirname, '..', 'components.css'), 'utf8');
  assert.match(css, /\.acc-verdict--demarrage\s*\{[^}]*background/,
    'le modificateur n’a pas de fond : le bandeau perdrait son aplat');
  assert.match(css, /\.acc-verdict--demarrage\s+\.acc-verdict__ic\s*\{[^}]*background/,
    'sans fond sur la pastille, l’icône se dessine en --sf-bg sur --sf-bg : invisible');
});

test('RÉGRESSION — « Tout est à jour » ne se dit pas à un compte qui n’a rien', () => {
  /* La liste « À traiter » est vide sur un compte neuf comme sur un
     portefeuille tenu. La même phrase ne convient pas aux deux : « prospectez
     l'esprit tranquille » suppose qu'il y a quelque chose à tenir. */
  assert.match(APP_JS, /demarrage \? 'Rien à signaler pour l’instant' : 'Tout est à jour'/,
    'l’état vide se félicite de nouveau devant un compte vide');
});
