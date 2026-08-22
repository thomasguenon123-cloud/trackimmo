/* QUI OCCUPE LE BIEN — `sfEstOccupant` et `sfLocataireEnPlace`.

   ⚠️ Ces tests gardent une classe de défaut, pas une fonction : « Préavis »
   n'est pas une sortie, c'est une occupation dont la fin est annoncée. Le
   locataire habite encore le logement et doit encore son loyer. Chaque lecture
   qui écrivait `statut === 'Actif'` se mettait à mentir au premier congé
   enregistré — et toutes en même temps.

   Les quatre RÉGRESSION ci-dessous ont été validées PAR MUTATION le 22/08/2026 :
   on réintroduit `=== 'Actif'` dans la fonction visée, et le test tombe. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter } = require('./charger-app.js');
const { poser, IMMEUBLE, T3_LYON, LOCATAIRE } = require('./donnees.js');

const app = charger({ maintenant: new Date('2026-08-13T12:00:00') });
function frais(s) { return poser(injecter, app, s); }

// Le même locataire, passé en préavis avec un départ au 20 septembre 2026.
const EN_PREAVIS = { ...LOCATAIRE, statut: 'Préavis', date_sortie: '2026-09-20' };

test('sfEstOccupant — occupe le bien : actif ET préavis', () => {
  assert.equal(app.sfEstOccupant({ statut: 'Actif' }),    true);
  assert.equal(app.sfEstOccupant({ statut: 'Préavis' }),  true);
  assert.equal(app.sfEstOccupant({ statut: 'Candidat' }), false);
  assert.equal(app.sfEstOccupant({ statut: 'Sorti' }),    false);
});

test('sfEstOccupant — rien à interpréter ne vaut pas une occupation', () => {
  assert.equal(app.sfEstOccupant(null),      false);
  assert.equal(app.sfEstOccupant(undefined), false);
  assert.equal(app.sfEstOccupant({}),        false);
});

test('sfLocataireEnPlace rend le locataire du bien, préavis compris', () => {
  frais({ allLocataires: [EN_PREAVIS] });
  const l = app.sfLocataireEnPlace(IMMEUBLE.id);
  assert.equal(l?.id, LOCATAIRE.id);
});

test('sfLocataireEnPlace ne rend PAS un locataire sorti, ni un candidat', () => {
  frais({ allLocataires: [
    { ...LOCATAIRE, id: 'loc-sorti',    statut: 'Sorti',    date_sortie: '2026-05-31' },
    { ...LOCATAIRE, id: 'loc-candidat', statut: 'Candidat' },
  ]});
  assert.equal(app.sfLocataireEnPlace(IMMEUBLE.id), null);
});

test('sfLocataireEnPlace sans bien rend null plutôt que le premier venu', () => {
  frais();
  assert.equal(app.sfLocataireEnPlace(null),      null);
  assert.equal(app.sfLocataireEnPlace(undefined), null);
  // Un bien sans locataire : T3 Lyon n'en a aucun dans le jeu de données.
  assert.equal(app.sfLocataireEnPlace(T3_LYON.id), null);
});

test('RÉGRESSION — un bien en préavis n’est pas VACANT', () => {
  /* `mfStatutOccupation` lisait `statut === 'Actif'` : le badge de la fiche
     annonçait « Vacant » sur un bien occupé, qui rapporte, et juste à côté du
     nom de son occupant. */
  frais({ allLocataires: [EN_PREAVIS] });
  const occ = app.mfStatutOccupation(IMMEUBLE.id);
  assert.notEqual(occ.type, 'vacant', 'un locataire en préavis occupe le bien');
  assert.equal(occ.locataire?.id, LOCATAIRE.id);
});

test('RÉGRESSION — un bien en préavis ne remonte pas « acquis sans locataire »', () => {
  /* Le point d'attention annonçait la mensualité comme perdue — 2 800 € pour
     l'immeuble — alors que le loyer est dû jusqu'au départ. */
  frais({ allLocataires: [EN_PREAVIS] });
  const pts = app.sfPointsAttention();
  const sansLoc = pts.find(p => /sans locataire/.test(p.titre));
  // Deux des trois biens acquis n'ont effectivement aucun locataire ; le
  // troisième, en préavis, ne doit pas grossir ce compte.
  assert.ok(sansLoc, 'les biens réellement vides restent signalés');
  assert.match(sansLoc.titre, /^2 biens/, `l'immeuble en préavis ne doit pas être compté — reçu : ${sansLoc.titre}`);
});

test('RÉGRESSION — les loyers d’un locataire en préavis restent à l’agenda', () => {
  /* `sfLoyersAttendus` filtrait sur « Actif » : les dernières échéances, celles
     qu'il reste justement à encaisser avant le départ, disparaissaient de
     l'agenda 60 jours au moment où le locataire donnait son congé. */
  frais({ allLocataires: [EN_PREAVIS] });
  const att = app.sfLoyersAttendus();
  assert.ok(att.length > 0, 'un locataire en préavis doit encore ses loyers');
  assert.deepEqual(Array.from(att, a => a.mois), [8, 9]);
});

test('RÉGRESSION — aucun loyer annoncé APRÈS la date de sortie', () => {
  /* La boucle partait du mois courant sans regarder le bail : elle aurait
     annoncé le loyer d'octobre pour un locataire parti le 20 septembre — et
     les lignes d'octobre existent bel et bien en base, générées jusqu'à
     décembre à la mise en location. */
  frais({ allLocataires: [EN_PREAVIS] });
  const att = app.sfLoyersAttendus();
  assert.equal(att.some(a => a.mois === 10), false, 'octobre est postérieur au départ');
});

test('aucun loyer annoncé AVANT la date d’entrée', () => {
  // Même règle, à l'autre bout du bail : un locataire qui entre le 1er octobre
  // ne doit rien pour août ni septembre.
  frais({ allLocataires: [{ ...LOCATAIRE, date_entree: '2026-10-01', date_sortie: null }] });
  const att = app.sfLoyersAttendus();
  assert.deepEqual(Array.from(att, a => a.mois), [10]);
});

test('un locataire sorti ne doit plus rien, même avec des lignes en base', () => {
  frais({ allLocataires: [{ ...LOCATAIRE, statut: 'Sorti', date_sortie: '2026-05-31' }] });
  assert.equal(app.sfLoyersAttendus().length, 0);
});

/* ═══════════════════════════════════════════════════════════════════════════
   LE BAIL COUVRE-T-IL CE MOIS ? — `sfBailCouvre`.
   Cas réel du 22/08/2026 : un locataire sortant le 22 août laissait en base
   quatre lignes de septembre à décembre, générées jusqu'à décembre à la mise
   en location. L'échéancier les annonçait « attendues » et les compteurs
   allaient les réclamer. 12 000 € de loyer promis sur un logement vide.      */

const SORTANT = { ...LOCATAIRE, statut: 'Sorti', date_sortie: '2026-08-22' };

test('sfBailCouvre — le mois est couvert, ou il ne l’est pas', () => {
  const loc = { date_entree: '2025-06-11', date_sortie: '2026-08-22' };
  assert.equal(app.sfBailCouvre(loc, 8, 2026),  true,  'le mois de sortie est couvert');
  assert.equal(app.sfBailCouvre(loc, 9, 2026),  false, 'après le départ, plus rien');
  assert.equal(app.sfBailCouvre(loc, 5, 2025),  false, 'avant l’entrée, rien non plus');
});

test('sfBailCouvre — sans locataire, on ne juge pas', () => {
  // Une ligne orpheline reste visible : cacher une donnée qu'on ne sait pas
  // interpréter est pire que de la montrer.
  assert.equal(app.sfBailCouvre(null, 9, 2026), true);
});

test('RÉGRESSION — un loyer postérieur à la sortie n’est pas un impayé', () => {
  /* Validé par mutation : sans la garde, septembre à décembre remontent comme
     impayés — quatre mois réclamés à un locataire parti en août. */
  const appDecembre = charger({ maintenant: new Date('2026-12-15T12:00:00') });
  poser(injecter, appDecembre, { allLocataires: [SORTANT] });
  const mois = Array.from(appDecembre.mfLoyersNonSoldes(2026), x => x.mois);
  assert.deepEqual(mois, [2, 6, 7, 8], 'seuls les mois couverts par le bail sont dus');
  assert.equal(mois.some(m => m > 8), false, 'aucun mois après la sortie');
});

/* ── Les trois écrans qui lisaient la ligne SANS regarder le bail ──────────
   Une ligne de loyer restée après une sortie n'est pas une dette : c'est un
   vestige de la génération jusqu'à décembre. Tant qu'elle n'est pas supprimée
   (workflow de congé, étape 3), aucun écran ne doit la réclamer — et surtout
   pas certains oui et d'autres non. */

test('sfLoyerEtat — hors bail, rien n’est dû, même avec une ligne en base', () => {
  const loc = { jour_paiement: 5, date_entree: '2025-06-11', date_sortie: '2026-08-22' };
  const ligne = { statut: 'En attente' };
  assert.equal(app.sfLoyerEtat(ligne, 8, 2026, loc), 'ko',   'août est couvert : échu et non soldé');
  assert.equal(app.sfLoyerEtat(ligne, 9, 2026, loc), 'none', 'septembre ne l’est plus');
});

test('sfLoyerEtat — un encaissement reste un encaissement', () => {
  // L'argent est entré : on ne le fait pas disparaître parce que le mois est
  // mal saisi. On ne réclame pas, on n'efface pas.
  const loc = { jour_paiement: 5, date_entree: '2025-06-11', date_sortie: '2026-08-22' };
  assert.equal(app.sfLoyerEtat({ statut: 'Payé' }, 9, 2026, loc), 'ok');
});

test('sfLocataireDuLoyer — la ligne sait de qui elle parle', () => {
  frais({ allLocataires: [SORTANT] });
  // Après la sortie, l'occupant du mois n'existe plus : sans la ligne, plus
  // aucun bail contre lequel juger.
  assert.equal(app.mfLocataireForBienMonth(IMMEUBLE.id, 9, 2026), undefined);
  const l = { locataire_id: LOCATAIRE.id };
  assert.equal(app.sfLocataireDuLoyer(l, IMMEUBLE.id, 9, 2026)?.id, LOCATAIRE.id);
  assert.equal(app.sfLocataireDuLoyer(null, IMMEUBLE.id, 9, 2026), null);
});

test('RÉGRESSION — le loyer DÛ de l’exercice s’arrête à la sortie', () => {
  /* `mfLoyerDuMois` lisait `loyer_du` sans regarder le bail : le loyer dû
     montait jusqu'à 9 960 € (douze mois) sur un bien vide depuis août, et avec
     lui le RENDEMENT NET, qui se calcule sur le loyer dû moins les charges. */
  const appDecembre = charger({ maintenant: new Date('2026-12-15T12:00:00') });
  poser(injecter, appDecembre, { allLocataires: [SORTANT] });
  const r = appDecembre.mfReelExercice({ ...IMMEUBLE }, 2026);
  assert.equal(r.loyer_du, 8 * 830, 'huit mois couverts, pas douze');
});

test('RÉGRESSION — le tableau de bord compte les mêmes loyers que le module', () => {
  /* Le point d'attention filtrait `allLoyers` sur le statut et le mois, sans
     bail : il annonçait sept loyers échus là où le Suivi mensuel en comptait
     quatre. Deux écrans, un même chiffre, deux réponses. */
  const appDecembre = charger({ maintenant: new Date('2026-12-15T12:00:00') });
  poser(injecter, appDecembre, { allLocataires: [SORTANT] });
  const pt = appDecembre.sfPointsAttention().find(p => /loyer/i.test(p.titre));
  const nonSoldes = appDecembre.mfLoyersNonSoldes(2026).length;
  assert.equal(nonSoldes, 4);
  assert.match(pt.titre, /^4 loyers échus non pointés$/, `reçu : ${pt.titre}`);
});

test('RÉGRESSION — la grille ne peint pas en rouge un mois hors bail', () => {
  /* La cellule résolvait son locataire par le seul occupant du mois : après la
     sortie il n'y en a plus, donc plus de bail, donc septembre virait au rouge
     « échu, non soldé » — juste au-dessus d'un compteur qui, lui, ne le
     comptait pas. La cellule RESTE visible : le Suivi mensuel est la surface de
     saisie, c'est là qu'on corrige. Elle cesse d'être réclamée, pas d'exister. */
  const appDecembre = charger({ maintenant: new Date('2026-12-15T12:00:00') });
  poser(injecter, appDecembre, { allLocataires: [SORTANT] });
  const classe = m => (appDecembre.mfSuiviCelluleLoyer({ ...IMMEUBLE }, m, 2026)
                        .match(/mfx-cell--(\w+)/) || [])[1];
  assert.equal(classe(8), 'ko',   'août est couvert, dû et non soldé');
  assert.equal(classe(9), 'none', 'septembre est hors bail');
  assert.match(appDecembre.mfSuiviCelluleLoyer({ ...IMMEUBLE }, 9, 2026), /hors bail/);
});
