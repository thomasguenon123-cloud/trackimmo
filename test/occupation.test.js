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
