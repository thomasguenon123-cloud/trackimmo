/* Le calcul du réel sur un exercice — le cœur chiffré du Suivi financier.
   Les valeurs attendues viennent d'un recalcul SQL sur les mêmes données. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter } = require('./charger-app.js');
const { poser, IMMEUBLE, T3_LYON, T4_PARIS, EN_PROSPECTION, LOCATAIRE } = require('./donnees.js');

// 13 août 2026 : huit mois écoulés sur l'exercice en cours.
const app = charger({ maintenant: new Date('2026-08-13T12:00:00') });

// Repose un jeu de données neuf avant chaque cas : les tests se modifient
// mutuellement sinon, puisqu'ils partagent le même contexte chargé une fois.
function frais() { return poser(injecter, app); }

test('mfMoisEcoules borne l’exercice au mois courant', () => {
  const d = frais();
  assert.equal(app.mfMoisEcoules(2025), 12, 'année révolue : douze mois');
  assert.equal(app.mfMoisEcoules(2026), 8,  'année en cours : jusqu’au mois courant');
  assert.equal(app.mfMoisEcoules(2030), 0,  'année à venir : aucun mois écoulé');
});

test('mfReelExercice reproduit les chiffres de la base', () => {
  const d = frais();
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  const r = app.mfReelExercice(imm, 2026);
  assert.equal(r.mois, 8);
  assert.equal(r.loyer_du, 6640,          'huit mois à 830 €');
  assert.equal(r.loyer_encaisse, 3320,    'quatre mois encaissés');
  assert.equal(r.charges_payees, 55);
  assert.equal(r.mensualites_credit, 22400, '2 800 € × 8 mois');
  assert.equal(r.cashflow, -19135,        '3 320 − 55 − 22 400');
});

test('RÉGRESSION — les mensualités sont bornées aux mois écoulés', () => {
  /* L'ancien `mfCashflowReel12M` imputait DOUZE mois de mensualités quoi qu'il
     arrive : un bien avec huit mois de loyers était confronté à douze mois de
     crédit. Visible en production : « 43 800 € » pour 3 650 €/mois au mois
     d'août. */
  const d = frais();
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  assert.equal(app.mfReelExercice(imm, 2026).mensualites_credit, 2800 * 8);
  assert.notEqual(app.mfReelExercice(imm, 2026).mensualites_credit, 2800 * 12);
});

test('un exercice à venir ne produit aucun chiffre, et surtout aucune erreur', () => {
  const d = frais();
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  const r = app.mfReelExercice(imm, 2030);
  assert.equal(r.mois, 0);
  assert.equal(r.cashflow, 0);
  assert.equal(app.mfRendementNet(imm, 2030), null,
    'un rendement incalculable vaut null, jamais 0');
});

test('mfRendementNet est hors crédit et porte sur le loyer DÛ', () => {
  /* L'ancien calcul retranchait les mensualités — dont la part de capital est
     de l'épargne, pas une perte — et divisait par le coût total. D'où les
     « −4,14 % » affichés en production. */
  const d = frais();
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  // (6 640 dus − 55 de charges) annualisés / 728 200 de coût
  const attendu = ((6640 - 55) * 12 / 8) / 728200 * 100;
  assert.ok(Math.abs(app.mfRendementNet(imm, 2026) - attendu) < 1e-9);
  assert.ok(app.mfRendementNet(imm, 2026) > 0, 'le rendement reste positif');
});

test('un bien vacant a un rendement de 0, pas null', () => {
  const d = frais();
  const lyon = d.allBiens.find(b => b.id === T3_LYON.id);
  assert.equal(app.mfRendementNet(lyon, 2026), 0,
    'aucun loyer dû : le rendement est nul, et c’est une information');
});

test('RÈGLE DE PÉRIMÈTRE — un bien vacant est COMPTÉ', () => {
  const d = frais();
  const lyon = d.allBiens.find(b => b.id === T3_LYON.id);
  const t4   = d.allBiens.find(b => b.id === T4_PARIS.id);
  assert.equal(app.mfDansLePerimetre(lyon, 2026), true,
    'on sait qu’il ne rapporte rien et que son crédit court');
  assert.equal(app.mfDansLePerimetre(t4, 2026), true);
});

test('RÈGLE DE PÉRIMÈTRE — un bien non acquis est écarté', () => {
  const d = frais();
  const nice = d.allBiens.find(b => b.id === EN_PROSPECTION.id);
  assert.equal(app.mfDansLePerimetre(nice, 2026), false);
});

test('RÈGLE DE PÉRIMÈTRE — un bien loué sans aucun loyer saisi est écarté', () => {
  // Là on ignore vraiment ce qui s'est passé.
  const d = poser(injecter, app, { allLoyers: [] });
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  assert.equal(app.mfDansLePerimetre(imm, 2026), false);
});

test('RÉGRESSION — « loué » s’entend SUR L’EXERCICE, pas aujourd’hui', () => {
  /* L'ancien calcul lisait `statut === 'Actif'`, c'est-à-dire l'état actuel du
     locataire. Sur un exercice passé dont le locataire est depuis parti, un
     bien loué toute l'année comptait comme vacant : occupation 0 %, et le
     bandeau annonçait « trois de vos trois biens sont vacants ». */
  const d = poser(injecter, app, {
    allLocataires: [{ ...LOCATAIRE, statut: 'Sorti',
                      date_entree: '2025-01-01', date_sortie: '2025-12-31' }],
    allLoyers: [{ id: 'l', bien_id: IMMEUBLE.id, locataire_id: LOCATAIRE.id,
                  annee: 2025, mois: 1, loyer_du: 830, montant_encaisse: 830,
                  statut: 'Payé', date_encaissement: '2025-01-05' }],
  });
  const imm = d.allBiens.find(b => b.id === IMMEUBLE.id);
  assert.equal(app.mfLoueSurExercice(imm, 2025), true,
    'le bail couvrait toute l’année 2025');
  assert.equal(app.mfLoueSurExercice(imm, 2026), false,
    'le bail était terminé en 2026');
});

test('le consolidé du bandeau reproduit les chiffres validés', () => {
  frais();
  const k = app.mfConsolide(2026);
  assert.equal(k.biens.length, 3,      'trois biens acquis dans le périmètre');
  assert.equal(k.encaisse, 3320);
  assert.equal(k.charges, 55);
  assert.equal(k.mensualites, (2800 + 850 + 3600) * 8);
  assert.equal(k.cashflow, -54735);
  assert.equal(k.loues, 1);
  assert.equal(k.vacants, 2);
  assert.equal(Math.round(k.occupation), 33);
  assert.equal(k.mensuVacants, (850 + 3600) * 8, '35 600 € de crédit à vide');
});
