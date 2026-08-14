/* Prorata de la loi 1989 — le calcul qui fixe le loyer dû d'un mois partiel.
   ⚠️ Ces tests existent parce qu'un bug a coûté ici : voir « heure d'été ». */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-08-13T12:00:00') });
const { mfLoyerProrata, mfDaysOccupiedInMonth, mfDaysInMonth } = app;

test('un mois entièrement occupé n’est jamais mis au prorata', () => {
  // Bail entré bien avant, sans sortie : les douze mois sont complets.
  for (let m = 1; m <= 12; m++) {
    const p = mfLoyerProrata(830, m, 2026, '2020-01-01', null);
    assert.equal(p.montant, 830, `mois ${m} : loyer plein attendu`);
    assert.equal(p.prorata, false, `mois ${m} : aucun prorata attendu`);
  }
});

test('RÉGRESSION — mars n’est pas raboté par le passage à l’heure d’été', () => {
  /* Le dernier dimanche de mars ne dure que 23 heures. Le calcul comptait les
     jours en millisecondes : du 1er au 31 mars il trouvait 30 jours moins une
     heure, plancher à 30, soit un jour de moins. Un loyer de 830 € était alors
     généré à 803 € — un prorata appliqué à un mois ENTIER — et écrit en base. */
  assert.equal(mfDaysOccupiedInMonth(3, 2026, '2020-01-01', null), 31);
  assert.equal(mfLoyerProrata(830, 3, 2026, '2020-01-01', null).montant, 830);
  assert.equal(mfLoyerProrata(830, 3, 2026, '2020-01-01', null).prorata, false);
});

test('RÉGRESSION — octobre non plus, dans l’autre sens', () => {
  // Le retour à l'heure d'hiver donne une journée de 25 heures.
  assert.equal(mfDaysOccupiedInMonth(10, 2026, '2020-01-01', null), 31);
  assert.equal(mfLoyerProrata(830, 10, 2026, '2020-01-01', null).montant, 830);
});

test('aucun mois complet n’est mal compté sur quatre années', () => {
  const fautifs = [];
  for (const annee of [2024, 2025, 2026, 2027]) {
    for (let m = 1; m <= 12; m++) {
      const jours = mfDaysOccupiedInMonth(m, annee, '2020-01-01', null);
      const dans  = mfDaysInMonth(m, annee);
      if (jours !== dans) fautifs.push(`${annee}/${m} → ${jours}/${dans}`);
    }
  }
  assert.deepEqual(fautifs, [], 'des mois complets sont comptés incomplets');
});

test('le mois d’entrée est bien mis au prorata', () => {
  // Entrée le 15 mars : du 15 au 31 inclus = 17 jours sur 31.
  const p = mfLoyerProrata(830, 3, 2026, '2026-03-15', null);
  assert.equal(p.jours, 17);
  assert.equal(p.joursMois, 31);
  assert.equal(p.prorata, true);
  assert.equal(p.montant, Math.round(830 * 17 / 31));
});

test('le mois de sortie est bien mis au prorata', () => {
  // Sortie le 10 mars : du 1er au 10 inclus = 10 jours.
  const p = mfLoyerProrata(830, 3, 2026, '2020-01-01', '2026-03-10');
  assert.equal(p.jours, 10);
  assert.equal(p.montant, Math.round(830 * 10 / 31));
});

test('un mois hors période d’occupation ne doit rien', () => {
  assert.equal(mfLoyerProrata(830, 1, 2026, '2026-06-15', null).montant, 0);
  assert.equal(mfLoyerProrata(830, 12, 2026, '2020-01-01', '2026-06-30').montant, 0);
});

test('février bissextile est compté à 29 jours', () => {
  assert.equal(mfDaysInMonth(2, 2024), 29);
  assert.equal(mfDaysOccupiedInMonth(2, 2024, '2020-01-01', null), 29);
  assert.equal(mfLoyerProrata(830, 2, 2024, '2020-01-01', null).montant, 830);
});

test('entrée et sortie dans le même mois', () => {
  // Du 5 au 20 juin inclus = 16 jours sur 30.
  const p = mfLoyerProrata(900, 6, 2026, '2026-06-05', '2026-06-20');
  assert.equal(p.jours, 16);
  assert.equal(p.montant, Math.round(900 * 16 / 30));
});

test('le cas réel de la base : entrée le 11/06/2025', () => {
  // Le locataire « Test V1 » : juin 2025 vaut 553 € en base.
  const p = mfLoyerProrata(830, 6, 2025, '2025-06-11', null);
  assert.equal(p.jours, 20);
  assert.equal(p.montant, 553);
});
