/* LE CONGÉ DU LOCATAIRE — `sfFinPreavis`, `sfPreavisDureeDefaut`, `sfCongeReprise`.

   Trois fonctions pures, et ce sont elles qui décident : la date à laquelle le
   bail s'arrête, et le sort de chaque ligne de loyer déjà en base. Le reste du
   workflow n'est que la fenêtre autour.

   Les deux RÉGRESSION sont validées PAR MUTATION le 22/08/2026 : on remet le
   calcul naïf, le test tombe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-08-22T12:00:00') });

// ── La date de fin de préavis ─────────────────────────────────────────────

test('sfFinPreavis — réception + N mois, au même jour du mois', () => {
  assert.equal(app.sfFinPreavis('2026-09-12', 3), '2026-12-12');
  assert.equal(app.sfFinPreavis('2026-08-22', 1), '2026-09-22');
  assert.equal(app.sfFinPreavis('2026-01-15', 3), '2026-04-15');
});

test('RÉGRESSION — un congé reçu le 30 novembre ne finit pas le 2 mars', () => {
  /* `setMonth(m + 3)` sur le 30 novembre demande « 30 février », que
     JavaScript reporte au 2 mars. On ramène au dernier jour du mois cible.
     Troisième piège de date de ce dépôt, après le prorata de mars faussé par
     l'heure d'été et la borne de fin de mois à minuit. */
  assert.equal(app.sfFinPreavis('2026-11-30', 3), '2027-02-28');
  assert.equal(app.sfFinPreavis('2027-11-30', 3), '2028-02-29', 'année bissextile');
  assert.equal(app.sfFinPreavis('2026-10-31', 1), '2026-11-30', 'novembre n’a pas de 31');
  assert.equal(app.sfFinPreavis('2026-01-31', 1), '2026-02-28');
});

test('sfFinPreavis — le passage d’année ne perd pas un mois', () => {
  assert.equal(app.sfFinPreavis('2026-12-15', 1), '2027-01-15');
  assert.equal(app.sfFinPreavis('2026-11-05', 3), '2027-02-05');
  assert.equal(app.sfFinPreavis('2026-12-31', 3), '2027-03-31');
});

test('sfFinPreavis — sans date ni durée, aucune date inventée', () => {
  assert.equal(app.sfFinPreavis(null, 3), null);
  assert.equal(app.sfFinPreavis('2026-09-12', null), null);
  assert.equal(app.sfFinPreavis('pas une date', 3), null);
});

// ── La durée par défaut ───────────────────────────────────────────────────

test('sfPreavisDureeDefaut — trois mois en vide, un en meublé', () => {
  assert.equal(app.sfPreavisDureeDefaut({ type_bail: 'Vide' }),   3);
  assert.equal(app.sfPreavisDureeDefaut({ type_bail: 'Meublé' }), 1);
});

test('sfPreavisDureeDefaut — on n’invente pas une durée sur un bail qui n’en a pas', () => {
  // Bail mobilité et saisonnier : leur préavis ne se déduit pas du type. Même
  // règle qu'à `mfEcheancesBail`, qui n'invente pas d'échéance sur ces baux.
  assert.equal(app.sfPreavisDureeDefaut({ type_bail: 'Bail mobilité' }), null);
  assert.equal(app.sfPreavisDureeDefaut({ type_bail: 'Saisonnier' }),    null);
  assert.equal(app.sfPreavisDureeDefaut({}),                             null);
  assert.equal(app.sfPreavisDureeDefaut(null),                           null);
});

// ── Le sort des lignes de loyer ───────────────────────────────────────────
// Le cas réel de la base au 22/08/2026 : T4+ Paris 16e, 3 000 € hors charges,
// douze lignes 2026, encaissées en janvier, février, mars, juin et juillet.

const PAYES = [1, 2, 3, 6, 7];
const lignes2026 = () => Array.from({ length: 12 }, (_, i) => {
  const mois = i + 1, paye = PAYES.includes(mois);
  return { id: `l-${mois}`, annee: 2026, mois, loyer_du: 3000,
           statut: paye ? 'Payé' : 'En attente', montant_encaisse: paye ? 3000 : 0 };
});

test('sfCongeReprise — le mois de sortie passe au prorata, les suivants tombent', () => {
  const r = app.sfCongeReprise(lignes2026(), '2026-08-22', 3000);
  assert.equal(r.prorata.ligne.mois, 8);
  assert.equal(r.prorata.ancien, 3000);
  assert.equal(r.prorata.nouveau, 2129, '3 000 € × 22/31 jours');
  assert.equal(r.prorata.jours, 22);
  assert.deepEqual(Array.from(r.aSupprimer, l => l.mois), [9, 10, 11, 12]);
  assert.equal(r.encaissees.length, 0);
});

test('RÉGRESSION — une échéance ENCAISSÉE après la sortie n’est jamais supprimée', () => {
  /* La seule écriture destructrice du chantier. Un `delete` par période aurait
     emporté un encaissement réel : l'argent est entré, la ligne en est la
     trace. On la signale, on n'y touche pas. */
  const lignes = lignes2026();
  lignes[8] = { ...lignes[8], statut: 'Payé', montant_encaisse: 3000 };   // septembre
  const r = app.sfCongeReprise(lignes, '2026-08-22', 3000);
  assert.deepEqual(Array.from(r.encaissees, l => l.mois), [9]);
  assert.deepEqual(Array.from(r.aSupprimer, l => l.mois), [10, 11, 12]);
});

test('un encaissement partiel compte comme encaissé, même sans le libellé', () => {
  // « Encaissé » ne se lit pas sur le seul statut : un montant reçu est un
  // montant reçu. Même prudence qu'à `sfLoyerEtat`.
  const lignes = lignes2026();
  lignes[9] = { ...lignes[9], statut: 'En attente', montant_encaisse: 500 };  // octobre
  const r = app.sfCongeReprise(lignes, '2026-08-22', 3000);
  assert.deepEqual(Array.from(r.encaissees, l => l.mois), [10]);
  assert.deepEqual(Array.from(r.aSupprimer, l => l.mois), [9, 11, 12]);
});

test('une sortie en fin de mois ne déclenche aucun prorata', () => {
  const r = app.sfCongeReprise(lignes2026(), '2026-08-31', 3000);
  assert.equal(r.prorata, null, 'le mois est entier, le loyer est plein');
  assert.deepEqual(Array.from(r.aSupprimer, l => l.mois), [9, 10, 11, 12]);
});

test('le mois de sortie déjà encaissé n’est pas recalculé', () => {
  // Août encaissé : on ne rogne pas un loyer que le locataire a payé.
  const lignes = lignes2026();
  lignes[7] = { ...lignes[7], statut: 'Payé', montant_encaisse: 3000 };
  const r = app.sfCongeReprise(lignes, '2026-08-22', 3000);
  assert.equal(r.prorata, null);
});

test('une sortie sur une autre année emporte bien l’année suivante', () => {
  const lignes = [...lignes2026(),
    { id: 'l-2027-1', annee: 2027, mois: 1, loyer_du: 3000, statut: 'En attente', montant_encaisse: 0 }];
  const r = app.sfCongeReprise(lignes, '2026-12-15', 3000);
  assert.deepEqual(Array.from(r.aSupprimer, l => `${l.annee}-${l.mois}`), ['2027-1']);
});

test('sans date de sortie, rien n’est proposé à la suppression', () => {
  const r = app.sfCongeReprise(lignes2026(), null, 3000);
  assert.deepEqual(Array.from(r.aSupprimer, l => l.mois), []);
  assert.equal(r.prorata, null);
});

test('un locataire entré ET sorti dans le même mois ne paie que ses jours', () => {
  // Sans la date d'entrée, le prorata partirait du 1er : 22 jours au lieu de 18.
  const lignes = [{ id: 'l-8', annee: 2026, mois: 8, loyer_du: 3000,
                    statut: 'En attente', montant_encaisse: 0 }];
  const r = app.sfCongeReprise(lignes, '2026-08-22', 3000, '2026-08-05');
  assert.equal(r.prorata.jours, 18);
  assert.equal(r.prorata.nouveau, 1742, '3 000 € × 18/31 jours');
});

// ── L'échéance de restitution du dépôt ────────────────────────────────────

test('RÉGRESSION — la restitution du dépôt ne déborde pas sur le mois suivant', () => {
  /* `mfEcheancesBail` posait la restitution à `setMonth(+1)` : une sortie au
     31 janvier donnait « 31 février », reporté au 3 mars. Même débordement que
     celui du préavis, corrigé par la même fonction — une seule arithmétique de
     date dans le fichier, pas une juste et une fausse. */
  const jour = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const loc = { nom: 'Test', statut: 'Sorti', type_bail: 'Vide',
                date_entree: '2025-01-01', date_sortie: '2026-01-31', depot_garantie: 1000 };
  const dep = app.mfEcheancesBail(loc, null).find(e => e.type === 'depot');
  assert.equal(jour(dep.d), '2026-02-28', 'février n’a pas de 31');

  const loc2 = { ...loc, date_sortie: '2026-08-22' };
  const dep2 = app.mfEcheancesBail(loc2, null).find(e => e.type === 'depot');
  assert.equal(jour(dep2.d), '2026-09-22');
});

/* ═══════════════════════════════════════════════════════════════════════════
   LA SORTIE — `sfEcheanceDepot` et `sfDepotDetail`.
   Deux règles de la loi de 1989, dont une seule était appliquée : le délai
   court depuis la REMISE DES CLÉS, et il vaut deux mois si l'état des lieux
   n'est pas conforme. L'échéancier disait « un mois après la sortie, état des
   lieux conforme » — la mauvaise date, et une affirmation que rien n'établissait.
   ═══════════════════════════════════════════════════════════════════════════ */

const SORTI = { nom: 'Test', statut: 'Sorti', type_bail: 'Meublé',
                date_entree: '2025-06-11', date_sortie: '2026-09-23',
                depot_garantie: 1600 };

test('sfEcheanceDepot — le délai part des CLÉS, pas de la fin de bail', () => {
  const e = app.sfEcheanceDepot({ ...SORTI, date_remise_cles: '2026-09-20',
                                  edl_sortie_conforme: true });
  assert.equal(e.date, '2026-10-20', 'un mois après le 20/09, pas après le 23/09');
  assert.equal(e.surCles, true);
  assert.equal(e.mois, 1);
});

test('sfEcheanceDepot — un état des lieux NON conforme double le délai', () => {
  const e = app.sfEcheanceDepot({ ...SORTI, date_remise_cles: '2026-09-20',
                                  edl_sortie_conforme: false });
  assert.equal(e.mois, 2);
  assert.equal(e.date, '2026-11-20');
});

test('sfEcheanceDepot — tant que rien n’est constaté, on retient le plus court', () => {
  // Un rappel qui arrive trop tôt est utile ; l'inverse coûte 10 % du loyer
  // par mois commencé. Et la phrase le dit : « au plus tôt ».
  const e = app.sfEcheanceDepot({ ...SORTI, date_remise_cles: '2026-09-20' });
  assert.equal(e.mois, 1);
  assert.equal(e.constate, false);
  assert.match(app.sfDepotDetail(e), /^Au plus tôt un mois après la remise des clés/);
});

test('sfEcheanceDepot — sans clés, la sortie sert d’ancre, et l’écran le dit', () => {
  const e = app.sfEcheanceDepot(SORTI);
  assert.equal(e.surCles, false);
  assert.equal(e.date, '2026-10-23');
  assert.match(app.sfDepotDetail(e), /après la sortie/);
});

test('sfEcheanceDepot — sans dépôt ni ancre, aucune échéance inventée', () => {
  assert.equal(app.sfEcheanceDepot({ ...SORTI, depot_garantie: 0 }), null);
  assert.equal(app.sfEcheanceDepot({ ...SORTI, date_sortie: null }), null);
  assert.equal(app.sfEcheanceDepot(null), null);
});

test('RÉGRESSION — l’échéancier n’affirme plus un état des lieux conforme', () => {
  /* Le détail était écrit en dur : « Un mois après la sortie, état des lieux
     conforme ». Deux approximations dans une phrase de six mots. */
  const jour = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const dep = app.mfEcheancesBail({ ...SORTI, date_remise_cles: '2026-09-20',
                                    edl_sortie_conforme: false }, null)
                 .find(e => e.type === 'depot');
  assert.equal(jour(dep.d), '2026-11-20', 'deux mois après les clés');
  assert.match(dep.detail, /non conforme/);

  const sansConstat = app.mfEcheancesBail({ ...SORTI, date_remise_cles: '2026-09-20' }, null)
                         .find(e => e.type === 'depot');
  assert.match(sansConstat.detail, /Au plus tôt/, 'on n’affirme pas ce qui n’est pas constaté');
});

/* ═══════════════════════════════════════════════════════════════════════════
   CE QUI RESTE OUVERT SUR UN BAIL QUI SE TERMINE — `sfBauxQuiSeTerminent`.
   Née du test du 23/08/2026 : un état des lieux non conforme repousse la
   restitution du dépôt de 1 600 € au-delà des trois mois de l'échéancier, et
   l'obligation disparaît de tous les écrans. Plus le constat est défavorable,
   plus l'échéance s'éloigne — et moins elle est visible.
   ═══════════════════════════════════════════════════════════════════════════ */
const { poser: poser2, injecter: inj2 } = (() => {
  const d = require('./donnees.js'); const c = require('./charger-app.js');
  return { poser: d.poser, injecter: c.injecter };
})();

test('sfBauxQuiSeTerminent — un préavis en cours, avec ce qu’il reste à encaisser', () => {
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [{ ...require('./donnees.js').LOCATAIRE,
    statut: 'Préavis', date_sortie: '2026-09-23', preavis_mois: 1 }] });
  const f = a.sfBauxQuiSeTerminent();
  assert.equal(f.length, 1);
  assert.equal(f[0].etape, 'preavis');
  assert.equal(f[0].jours, 31);
  /* Le jeu de données porte douze lignes de 830 € de loyer, encaissées en
     janvier, mars, avril et mai : restent cinq mois dus jusqu'à la sortie.
     ⚠️ LE LOYER SEUL — `montant_encaisse` solde `loyer_du` partout ailleurs,
     l'encaissement des charges n'étant suivi nulle part. Compter les charges
     ici ferait dire « 490 € encore dus » sur chaque mois pourtant payé. */
  assert.equal(f[0].reste, 5 * 830);
});

test('RÉGRESSION — un dépôt à rendre reste visible quand l’échéance sort des trois mois', () => {
  /* Le cas réel : clés le 20/09, état des lieux NON conforme, échéance au
     20/11. L'échéancier s'arrête au 31/10 — sans cette liste, 1 600 € et une
     date butoir n'apparaissaient plus nulle part. */
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [{ ...require('./donnees.js').LOCATAIRE,
    statut: 'Sorti', date_sortie: '2026-09-23', date_remise_cles: '2026-09-20',
    edl_sortie_conforme: false, depot_garantie: 1600 }] });
  const f = a.sfBauxQuiSeTerminent();
  assert.equal(f.length, 1);
  assert.equal(f[0].etape, 'depot');
  assert.equal(f[0].date, '2026-11-20', 'deux mois après les clés');
  assert.equal(f[0].aConstater, false);
});

test('un état des lieux non constaté est signalé, et fige le délai au plus court', () => {
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [{ ...require('./donnees.js').LOCATAIRE,
    statut: 'Sorti', date_sortie: '2026-09-23', date_remise_cles: '2026-09-20',
    depot_garantie: 1600 }] });
  const f = a.sfBauxQuiSeTerminent();
  assert.equal(f[0].aConstater, true);
  assert.equal(f[0].date, '2026-10-20', 'un mois — le plus court, tant que rien n’est constaté');
});

test('RÉGRESSION — un dépôt RESTITUÉ quitte la liste', () => {
  // Sans cela, la liste ne se vide jamais — et une liste qui ne se vide pas
  // cesse d'être lue.
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [{ ...require('./donnees.js').LOCATAIRE,
    statut: 'Sorti', date_sortie: '2026-09-23', date_remise_cles: '2026-09-20',
    edl_sortie_conforme: true, depot_garantie: 1600, depot_restitue_le: '2026-10-15' }] });
  assert.deepEqual(Array.from(a.sfBauxQuiSeTerminent()), []);
});

test('un locataire actif ou candidat n’a rien qui se termine', () => {
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [
    { ...require('./donnees.js').LOCATAIRE, statut: 'Actif' },
    { ...require('./donnees.js').LOCATAIRE, id: 'c1', statut: 'Candidat' },
  ]});
  assert.deepEqual(Array.from(a.sfBauxQuiSeTerminent()), []);
});

test('le plus urgent d’abord — un retard passe devant', () => {
  const L = require('./donnees.js').LOCATAIRE;
  const a = charger({ maintenant: new Date('2026-12-15T12:00:00') });
  poser2(inj2, a, { allLocataires: [
    { ...L, id: 'l-futur',   statut: 'Préavis', date_sortie: '2027-02-28' },
    { ...L, id: 'l-retard',  statut: 'Sorti',   date_sortie: '2026-09-23',
      date_remise_cles: '2026-09-20', edl_sortie_conforme: true, depot_garantie: 1600 },
  ]});
  const f = a.sfBauxQuiSeTerminent();
  assert.equal(f[0].loc.id, 'l-retard', 'l’échéance dépassée passe en tête');
  assert.ok(f[0].jours < 0);
});

test('RÉGRESSION — un loyer « Payé » sans montant encaissé est SOLDÉ', () => {
  /* `sfResteAEncaisser` comparait `loyer_du` à `montant_encaisse` sans passer
     par `sfLoyerEtat` : une ligne pointée « Payé » dont le montant était resté
     vide comptait comme une dette, et la box annonçait un reste que l'alerte
     du dessus — elle, gardée — ne comptait pas. */
  const L = require('./donnees.js').LOCATAIRE;
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  const lignes = Array.from({ length: 9 }, (_, i) => ({
    id: `p-${i+1}`, bien_id: L.bien_id, locataire_id: L.id, annee: 2026, mois: i + 1,
    loyer_du: 830, charges_dues: 490, statut: 'Payé', montant_encaisse: null }));
  poser2(inj2, a, { allLoyers: lignes,
    allLocataires: [{ ...L, statut: 'Préavis', date_sortie: '2026-09-23' }] });
  assert.equal(a.sfBauxQuiSeTerminent()[0].reste, 0);
});

test('RÉGRESSION — les mois SANS ligne générée comptent aussi', () => {
  /* `autoGenerateLoyers` s'arrête au 31 décembre : un départ en mars 2027 n'a
     aucune ligne pour janvier à mars. Parcourir `allLoyers` seul les rendait
     invisibles — 2 490 € dus, annoncés nulle part. */
  const L = require('./donnees.js').LOCATAIRE;
  const a = charger({ maintenant: new Date('2027-01-10T12:00:00') });
  poser2(inj2, a, { allLoyers: [],
    allLocataires: [{ ...L, statut: 'Préavis', date_sortie: '2027-03-31' }] });
  // Janvier, février, mars 2027 : trois mois pleins à 830 €.
  assert.equal(a.sfBauxQuiSeTerminent()[0].reste, 3 * 830);
});

test('un dépôt oublié depuis plus d’un an ne remonte plus', () => {
  // Une ligne rouge que personne ne peut faire disparaître apprend à ne plus
  // lire la liste — c'est l'inverse du but.
  const L = require('./donnees.js').LOCATAIRE;
  const a = charger({ maintenant: new Date('2026-08-23T12:00:00') });
  poser2(inj2, a, { allLocataires: [{ ...L, statut: 'Sorti', date_sortie: '2024-01-31',
    date_remise_cles: '2024-01-31', edl_sortie_conforme: true, depot_garantie: 1600 }] });
  assert.deepEqual(Array.from(a.sfBauxQuiSeTerminent()), []);
});
