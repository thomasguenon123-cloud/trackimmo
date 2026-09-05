/* LES LOYERS PASSÉS D'UN BAIL REPRIS — le piège du premier lancement.

   Un bailleur saisit un locataire en place depuis 2023. Sans ces règles,
   l'application crée toute l'année en cours « En attente » et lui annonce des
   milliers d'euros d'arriérés qu'il a pourtant encaissés, sur son premier
   écran. On lui pose la question une fois, et on n'invente rien.

   L'horloge est figée au 5 septembre 2026 : huit mois échus, septembre en
   cours. Gardes validées par mutation le 05/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-05T12:00:00') });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const BAIL_ANCIEN = { id: 'l1', bien_id: 'b1', date_entree: '2023-03-15',
                      loyer_bail_hc: 800, charges_bail: 100 };
const lignes = (loc, statut, annee = 2026) =>
  Array.from(app.sfLignesAGenerer(loc, annee, app.sfMoisDebutGeneration(loc, annee), statut))
       .map(l => ({ ...l }));

// ── Où commence la génération ──────────────────────────────────────────────

test('sfMoisDebutGeneration — entrée antérieure, dans l’année, à venir', () => {
  assert.equal(app.sfMoisDebutGeneration(BAIL_ANCIEN, 2026), 1);
  assert.equal(app.sfMoisDebutGeneration({ date_entree: '2026-06-11' }, 2026), 6);
  assert.equal(app.sfMoisDebutGeneration({ date_entree: '2027-01-05' }, 2026), null);
  assert.equal(app.sfMoisDebutGeneration({ date_entree: null }, 2026), null);
});

test('RÉGRESSION — un mois de début nul ne produit aucune ligne', () => {
  /* `null <= 12` est vrai et le premier `m++` rend 1 APRÈS avoir servi
     `m = null` : sans garde-fou, la boucle demandait un prorata sur un mois 0,
     qui n'existe pas. */
  assert.equal(app.sfLignesAGenerer(BAIL_ANCIEN, 2026, null, 'En attente').length, 0);
  assert.equal(app.sfLignesAGenerer(BAIL_ANCIEN, 2026, 0, 'En attente').length, 0);
  assert.equal(app.sfLignesAGenerer(BAIL_ANCIEN, 2026, 13, 'En attente').length, 0);
});

// ── Le comptage qui décide s'il faut poser la question ─────────────────────

test('un bail ancien a huit mois échus au 5 septembre', () => {
  assert.equal(app.sfMoisEchusAGenerer(BAIL_ANCIEN, 2026, 1), 8);
});

test('un bail entré ce mois-ci n’a rien d’échu — donc aucune question', () => {
  const loc = { ...BAIL_ANCIEN, date_entree: '2026-09-01' };
  assert.equal(app.sfMoisEchusAGenerer(loc, 2026, 9), 0);
});

// ── Ce que la réponse produit ──────────────────────────────────────────────

test('« Pas encore » laisse tout à encaisser', () => {
  const l = lignes(BAIL_ANCIEN, 'En attente');
  assert.equal(l.length, 12);
  assert.ok(l.every(x => x.statut === 'En attente'), 'tout devrait rester en attente');
  assert.ok(l.every(x => x.montant_encaisse === null));
});

test('« Déjà encaissés » ne marque QUE les mois échus', () => {
  const l = lignes(BAIL_ANCIEN, 'Payé');
  const payes = l.filter(x => x.statut === 'Payé');
  assert.equal(payes.length, 8, 'janvier à août');
  assert.ok(payes.every(x => x.mois <= 8));
  /* ⚠️ LE MOIS EN COURS RESTE À ENCAISSER. Selon le jour de paiement du bail,
     septembre peut être dû ou non — rien ici ne permet de trancher, et on ne
     devine pas un encaissement. */
  assert.equal(l.find(x => x.mois === 9).statut, 'En attente');
  assert.ok(l.filter(x => x.mois > 9).every(x => x.statut === 'En attente'));
});

test('RÉGRESSION — un loyer repris ne s’invente pas de date d’encaissement', () => {
  /* On sait QUE ces loyers ont été encaissés, pas QUAND. Écrire la date du jour
     serait un mensonge sur une date comptable. Vérifié : la déclaration fiscale
     filtre sur `statut` et `annee`, jamais sur `date_encaissement` — la ligne y
     entre, seule la colonne « Date » reste vide. */
  const paye = lignes(BAIL_ANCIEN, 'Payé').find(x => x.statut === 'Payé');
  assert.equal(paye.date_encaissement, null);
  assert.equal(paye.montant_encaisse, paye.loyer_du);
  assert.match(paye.notes, /Encaissé avant la mise en service/);
});

test('RÉGRESSION — le prorata du mois d’entrée survit à la reprise', () => {
  /* ⚠️ LE BAIL DOIT COMMENCER DANS L'ANNÉE GÉNÉRÉE, sinon ce test ne teste
     rien : pour un bail de 2023, mars 2026 est un mois PLEIN et le prorata
     vaut le loyer entier — les deux branches rendent alors la même valeur quoi
     qu'on fasse. Première version de ce test, vide sans le paraître, débusquée
     par la mutation qui aurait dû la faire tomber.
     Ici l'entrée est au 15 mars 2026 : le mois est partiel, échu, et marqué
     payé. Le montant repris doit rester le prorata, pas le loyer plein. */
  const recent = { ...BAIL_ANCIEN, date_entree: '2026-03-15' };
  const attente = lignes(recent, 'En attente').find(x => x.mois === 3);
  const paye    = lignes(recent, 'Payé').find(x => x.mois === 3);

  assert.equal(paye.statut, 'Payé', 'mars 2026 est échu au 5 septembre');
  assert.ok(attente.loyer_du < recent.loyer_bail_hc,
    `le mois d'entrée doit être proratisé, or ${attente.loyer_du} = loyer plein`);
  assert.equal(paye.loyer_du, attente.loyer_du);
  assert.equal(paye.charges_dues, attente.charges_dues);
  assert.equal(paye.montant_encaisse, attente.loyer_du,
    'on encaisse ce qui était dû, pas le loyer plein');
});

// ── La question ne se pose que sur le bon chemin ───────────────────────────

test('RÉGRESSION — seule la fiche locataire pose la question', () => {
  /* `sfCongeRevoquer` régénère un bail existant : le bailleur annule un congé,
     il ne déclare pas son parc. Et `bdAcqConfirmer` vit dans `modal-detail`,
     la fenêtre que `sfConfirmer` réutilise — y ouvrir la question écraserait
     le workflow d'acquisition en cours. */
  const appels = APP_JS.match(/sfDemanderLoyersPasses\(/g) || [];
  assert.equal(appels.length, 2, 'un appel dans la définition, un seul sur un chemin');
});

// ── Ce que la revue a rattrapé ─────────────────────────────────────────────

test('RÉGRESSION — aucune question si les lignes existent déjà', () => {
  /* ⚠️ `autoGenerateLoyers` pose `ignoreDuplicates: true` : une ligne déjà en
     base n'est jamais réécrite. Sans ce filtre, corriger un numéro de téléphone
     sur un locataire en place rouvrait la question — et répondre « oui, déjà
     encaissés » n'aurait RIEN changé, les lignes restant « En attente ».
     L'écran aurait promis l'inverse de ce qui se passe. */
  const existantes = [];
  for (let m = 1; m <= 8; m++) existantes.push({ bien_id: 'b1', mois: m, annee: 2026 });
  assert.equal(app.sfMoisEchusAGenerer(BAIL_ANCIEN, 2026, 1, existantes), 0);

  // Trois mois manquants sur les huit échus : trois à créer, donc on demande.
  const partielles = existantes.filter(l => l.mois > 3);
  assert.equal(app.sfMoisEchusAGenerer(BAIL_ANCIEN, 2026, 1, partielles), 3);
});

test('RÉGRESSION — le formulaire est refermé avant que la question s’ouvre', () => {
  /* La confirmation vit dans `#modal-detail` (z-index 200), le formulaire
     locataire dans `#adm-modal-overlay` (z-index 2001). Posée avant la
     fermeture, la question s'ouvrait DERRIÈRE : invisible, incliquable, et
     `sfConfirmer` plaçant le focus sur « Oui », une touche Entrée marquait
     huit mois encaissés sans que personne ne voie rien.
     On vérifie l'ordre dans la source : fermer, puis demander. */
  const bloc = APP_JS.slice(APP_JS.indexOf('async function saveLocataire'));
  const ferme  = bloc.indexOf('closeAdmModal();');
  const demande = bloc.indexOf('sfDemanderLoyersPasses(');
  assert.ok(ferme > -1 && demande > -1, 'les deux gestes doivent exister');
  assert.ok(ferme < demande,
    'la question s’ouvrirait derrière le formulaire : la fermeture doit venir avant');
});
