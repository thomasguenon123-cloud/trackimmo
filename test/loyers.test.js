/* L'état d'un loyer et le décompte des impayés.
   ⚠️ `sfLoyerEtat` est la SOURCE UNIQUE de l'état d'un loyer : un impayé se
   déduit de l'ÉCHÉANCE, jamais du libellé du statut — en base, la saisie
   courante n'écrit que « Payé » et « En attente ». */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter } = require('./charger-app.js');
const { poser, IMMEUBLE, LOCATAIRE } = require('./donnees.js');

const app = charger({ maintenant: new Date('2026-08-13T12:00:00') });
function frais(s) { return poser(injecter, app, s); }

const loc = { jour_paiement: 5 };

test('sfLoyerEtat lit le statut quand il est explicite', () => {
  assert.equal(app.sfLoyerEtat({ statut: 'Payé' },    1, 2026, loc), 'ok');
  assert.equal(app.sfLoyerEtat({ statut: 'Partiel' }, 1, 2026, loc), 'part');
});

test('un loyer non payé dont l’échéance est passée est ÉCHU', () => {
  // Juillet 2026, échéance le 5 : au 13 août, largement dépassée.
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 7, 2026, loc), 'ko');
});

test('un loyer dont l’échéance n’est pas atteinte est À VENIR', () => {
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 9, 2026, loc), 'avenir');
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 12, 2026, loc), 'avenir');
});

test('le retard ne commence QUE le lendemain de l’échéance', () => {
  // Au 13 août, l'échéance du 5 août est dépassée ; celle du 20 ne l'est pas.
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 8, 2026, { jour_paiement: 5 }),  'ko');
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 8, 2026, { jour_paiement: 20 }), 'avenir');
  // Le jour même de l'échéance, rien n'est encore en retard.
  assert.equal(app.sfLoyerEtat({ statut: 'En attente' }, 8, 2026, { jour_paiement: 13 }), 'avenir');
});

test('sans ligne ET sans échéance passée, il n’y a rien à dire', () => {
  assert.equal(app.sfLoyerEtat(null, 12, 2026, loc), 'avenir');
});

test('mfLoyersNonSoldes compte les quatre mois échus de la base', () => {
  frais();
  const ns = app.mfLoyersNonSoldes(2026);
  assert.deepEqual(Array.from(ns, x => x.mois), [2, 6, 7, 8]);
  assert.equal(ns.reduce((s, x) => s + x.reste, 0), 4 * 830);
});

test('RÉGRESSION — un loyer dû SANS ligne générée est compté', () => {
  /* L'ancienne version itérait `allLoyers` : sans ligne, rien à compter. Or la
     grille, elle, part du BAIL et peignait bien le mois en rouge. En supprimant
     la ligne de mars, la grille montrait cinq mois échus et les compteurs en
     annonçaient quatre — deux endroits du même écran en désaccord, et c'est ce
     compteur qui pilote le badge d'alerte. */
  const d = frais();
  const sansMars = d.allLoyers.filter(l => l.mois !== 3);
  injecter(app, { allLoyers: sansMars });
  const ns = app.mfLoyersNonSoldes(2026);
  assert.deepEqual(Array.from(ns, x => x.mois), [2, 3, 6, 7, 8], 'mars doit être compté');
  assert.equal(ns.find(x => x.mois === 3).sansLigne, true);
  assert.equal(ns.find(x => x.mois === 3).reste, 830, 'mois complet, pas de prorata');
});

test('un paiement partiel ne compte que le reste dû', () => {
  const d = frais();
  const modifie = d.allLoyers.map(l =>
    l.mois === 2 ? { ...l, statut: 'Partiel', montant_encaisse: 400 } : l);
  injecter(app, { allLoyers: modifie });
  const ns = app.mfLoyersNonSoldes(2026);
  const fev = ns.find(x => x.mois === 2);
  assert.equal(fev.etat, 'part');
  assert.equal(fev.reste, 430, '830 dus − 400 encaissés');
});

test('un bien vacant ne produit aucun impayé', () => {
  // Aucun loyer n'y est DÛ : il n'y a rien à ne pas encaisser.
  frais();
  const ns = app.mfLoyersNonSoldes(2026);
  assert.equal(ns.every(x => x.bien.id === IMMEUBLE.id), true);
});

test('le filtre par bien restreint bien le décompte', () => {
  frais();
  assert.equal(app.mfLoyersNonSoldes(2026, IMMEUBLE.id).length, 4);
  assert.equal(app.mfLoyersNonSoldes(2026, 'bien-lyon').length, 0);
});

test('les mois à venir ne sont jamais comptés comme impayés', () => {
  frais();
  const ns = app.mfLoyersNonSoldes(2026);
  assert.equal(ns.some(x => x.mois > 8), false,
    'au 13 août, rien après août n’est échu');
});
