/* LES FONCTIONS SERVEUR SE VÉRIFIENT AUSSI (v=102).

   Les trois fonctions d'origine vivaient sans test. Depuis la v=102 elles
   portent la sécurité de l'inscription libre : réservées aux comptes actifs
   (news-proxy, taux-credit), suppression définitive réservée aux
   administrateurs et confirmée par l'adresse (admin-delete-user), un compte
   bloqué ne se réactive pas par une invitation (admin-invite-user).
   Le banc (fonctions-serveur.mjs) les charge telles qu'elles se déploient, avec
   Supabase et le réseau simulés, et vérifie chaque refus ET chaque réussite. */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('les fonctions serveur refusent ce qu’elles doivent, et servent le reste', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, 'fonctions-serveur.mjs'), path.join(__dirname, '..')],
                      { encoding: 'utf8', timeout: 60000 });
  const bilan = (r.stdout.match(/(\d+) vérifications passées, (\d+) en échec/) || []);
  assert.ok(bilan.length, 'témoin : le banc a tourné jusqu’au bout\n' + r.stdout + r.stderr);
  assert.ok(Number(bilan[1]) >= 18, `témoin : ${bilan[1]} vérifications`);
  assert.equal(r.status, 0, r.stdout.split('\n').filter(l => l.startsWith('ÉCHEC')).join('\n'));
});
