/* UNE DATE SE LIT À L'HEURE DE L'APPAREIL — défaut n°6 du backlog (v=99).

   ⚠️ LE DÉFAUT. Treize lectures de « la date du jour » passaient par
   `new Date().toISOString().slice(0, 10)`. `toISOString()` donne l'instant en
   temps universel : entre minuit et 2 h l'été (1 h l'hiver), sa date est celle
   de la VEILLE. Un loyer marqué payé à 0 h 30, une charge saisie, une sortie
   de locataire, le nom d'un export : tous datés du jour d'avant.
   Mesuré le 15/10/2026 : `grep -c "toISOString().slice(0, *10)\|split('T')\[0\]" app.js`
   → 13 lignes (12 dates du jour, 1 date calculée).

   ⚠️ LE TEST DOIT REPRODUIRE LE DÉFAUT, sinon il ne prouve rien : le
   conteneur de tests vit en temps universel, où les deux lectures coïncident.
   On se place donc à Paris, à 0 h 30 un soir d'été — et un témoin vérifie
   que, dans ces conditions, l'ancienne lecture donne bien la veille.

   Validé par mutation le 15/10/2026. */
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app');

const NUIT_D_ETE = new Date('2026-07-01T00:30:00+02:00');   // 0 h 30 à Paris, 22 h 30 la veille en UTC

test('à 0 h 30 un soir d\'été, « aujourd\'hui » est bien aujourd\'hui', () => {
  // Témoin : les conditions reproduisent le défaut.
  assert.equal(NUIT_D_ETE.toISOString().slice(0, 10), '2026-06-30', 'le test ne se place pas dans la nuit d\'été à Paris');
  const ctx = charger({ maintenant: NUIT_D_ETE });
  assert.equal(ctx.sfAujourdhuiIso(), '2026-07-01', 'La date du jour lue en temps universel est celle de la veille.');
  assert.equal(ctx.sfDateIso(new Date(2026, 11, 31, 23, 59)), '2026-12-31', 'une date calculée se lit aussi à l\'heure locale');
  assert.equal(ctx.sfDateIso(new Date(2027, 0, 1, 0, 5)), '2027-01-01');
});

test('aucune date du jour ne se lit plus en temps universel', () => {
  const brut = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  // Les commentaires racontent le défaut : on les masque (en gardant les lignes).
  const masque = brut
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, a) => a + ' '.repeat(m.length - a.length));
  const fautes = masque.split('\n').map((l, i) => [i + 1, l])
    .filter(([, l]) => /toISOString\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*10\s*\)|toISOString\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/.test(l))
    .map(([n, l]) => `app.js:${n} → ${l.trim().slice(0, 90)}`);
  // Témoins : le masquage laisse le code, et la date du jour passe par la fonction.
  assert.ok((masque.match(/sfAujourdhuiIso\(\)/g) || []).length >= 12, 'la date du jour ne passe plus par sfAujourdhuiIso — ou le masquage a effacé du code');
  assert.ok((masque.match(/toISOString\(\)/g) || []).length >= 1, 'témoin : les horodatages (instants) restent en toISOString');
  assert.deepEqual(fautes, [], 'Une date du jour lue en temps universel donne la veille entre minuit et 2 h :\n' + fautes.join('\n'));
});
