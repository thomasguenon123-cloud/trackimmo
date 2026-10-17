/* LA GESTION DES COMPTES SOUS L'INSCRIPTION LIBRE (v=102).

   Arbitrage de Thomas du 17/10/2026 : l'inscription libre reste ouverte. Il
   faut donc (1) voir vite qu'un compte attend, (2) pouvoir le refuser, le
   bloquer ou le supprimer pour de bon, (3) ne rien révéler à qui teste des
   adresses, (4) ne jamais exposer l'adresse du propriétaire. Ces gardes
   tiennent la partie site ; la partie serveur est tenue par
   fonctions-serveur.test.js, la partie base par GARDE-*.sql. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter, lire } = require('./charger-app.js');

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  ctx.showNotif = () => {};
  ctx.navigate = () => {};
  return ctx;
}
const COMPTE = (statut, role = 'user', id = 'p-' + statut) =>
  ({ id, email: `${statut}@exemple.fr`, first_name: '', last_name: '', role, status: statut, created_at: '2026-10-01' });

test('chaque état de compte propose ses gestes, et la suppression n’atteint jamais un administrateur', () => {
  const ctx = app();
  const h = ctx.buildUserRowsHtml([COMPTE('pending'), COMPTE('active'), COMPTE('disabled'),
                                   COMPTE('disabled', 'admin', 'p-admin2'), COMPTE('active', 'admin', 'p-moi')], 'active@exemple.fr'.replace('active', 'moi'));
  // En attente : valider, ou refuser (suppression définitive).
  assert.match(h, /admin-validate-btn[^>]*data-id="p-pending"/);
  assert.match(h, /admin-delete-btn[^>]*data-id="p-pending"[^>]*>[\s\S]*?Refuser/);
  // Actif : réinitialiser, bloquer — le mot « Archiver » a disparu.
  assert.match(h, /admin-disable-btn[^>]*data-id="p-active"[^>]*>[\s\S]*?Bloquer/);
  assert.doesNotMatch(h, /Archiv/);
  // Bloqué : réactiver, ou supprimer.
  assert.match(h, /admin-enable-btn[^>]*data-id="p-disabled"/);
  assert.match(h, /admin-delete-btn[^>]*data-id="p-disabled"/);
  // Un administrateur bloqué se réactive, il ne se supprime pas d'ici.
  assert.match(h, /admin-enable-btn[^>]*data-id="p-admin2"/, 'témoin : l’administrateur bloqué est bien listé');
  assert.doesNotMatch(h, /admin-delete-btn[^>]*data-id="p-admin2"/);
  assert.match(h, /Bloqué/, 'le statut se lit « Bloqué »');
});

test('la suppression d’un compte demande l’adresse en saisie de contrôle, et passe par la fonction serveur', async () => {
  const ctx = app();
  let question = null, appel = null;
  ctx.sfConfirmer = async (q) => { question = q; return true; };
  ctx.renderAdmin = () => {};
  ctx.sfMajAttente = () => {};
  lire(ctx, 'db').functions = { invoke: async (nom, opts) => { appel = { nom, opts }; return { data: { success: true }, error: null }; } };
  await ctx.adminDeleteUser('p-1', 'suspect@exemple.fr');
  assert.ok(question, 'témoin : une confirmation est demandée');
  assert.equal(question.danger, true);
  assert.equal(question.saisie?.attendu, 'suspect@exemple.fr', 'la saisie de contrôle est l’adresse du compte');
  assert.equal(appel?.nom, 'admin-delete-user');
  assert.deepEqual(JSON.parse(JSON.stringify(appel.opts.body)), { profileId: 'p-1', confirmation: 'suspect@exemple.fr' });
  // Refusée : rien n'est appelé.
  appel = null; ctx.sfConfirmer = async () => false;
  await ctx.adminDeleteUser('p-1', 'suspect@exemple.fr');
  assert.equal(appel, null, 'une confirmation refusée n’appelle rien');
});

test('le nombre de comptes en attente s’affiche sur l’icône, pour l’administrateur seulement', async () => {
  const ctx = app();
  const btn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const pastille = { hidden: true, textContent: '' };
  ctx.document.getElementById = id => (id === 'nav-admin-users' ? btn : id === 'sf-attente-n' ? pastille : null);
  let filtre = null;
  lire(ctx, 'db').from = () => { const q = { select: () => q, eq: (c, v) => { filtre = [c, v]; return q; },
    then: (res) => Promise.resolve({ count: 2, error: null }).then(res) }; return q; };
  injecter(ctx, { currentProfile: { role: 'admin' }, currentUser: { id: 'u1', app_metadata: { role: 'admin' } } });
  await ctx.sfMajAttente();
  assert.deepEqual(filtre, ['status', 'pending']);
  assert.equal(pastille.hidden, false);
  assert.equal(pastille.textContent, '2');
  assert.match(btn.attrs['aria-label'], /2 comptes en attente/, 'le nombre se dit aussi aux lecteurs d’écran');
  // Un utilisateur ordinaire ne voit rien, et ne demande rien.
  filtre = null;
  injecter(ctx, { currentProfile: { role: 'user' }, currentUser: { id: 'u2', app_metadata: {} } });
  await ctx.sfMajAttente();
  assert.equal(pastille.hidden, true);
  assert.equal(filtre, null, 'aucune requête pour un non-administrateur');
});

test('le rôle administrateur se lit dans le profil ou le jeton, jamais dans une adresse', () => {
  const ctx = app();
  injecter(ctx, { currentProfile: null, currentUser: { id: 'u1', app_metadata: { role: 'admin' } } });
  assert.equal(ctx.sfEstAdmin(), true, 'le jeton suffit, avant même le chargement du profil');
  injecter(ctx, { currentProfile: { role: 'user' }, currentUser: { id: 'u2', email: 'qui@exemple.fr', app_metadata: {} } });
  assert.equal(ctx.sfEstAdmin(), false);
  injecter(ctx, { currentProfile: { role: 'admin' }, currentUser: { id: 'u3', app_metadata: {} } });
  assert.equal(ctx.sfEstAdmin(), true, 'témoin : le profil suffit aussi');
});

test('aucun message ne dit si une adresse a déjà un compte', () => {
  const ctx = app();
  const deja = ctx.authErrorToFr({ message: 'User already registered' });
  const absent = ctx.authErrorToFr({ message: 'User not found' });
  assert.doesNotMatch(deja, /existe déjà/i);
  assert.doesNotMatch(absent, /aucun compte/i);
  assert.match(deja, /Si cette adresse/, 'témoin : une réponse est bien donnée');
  assert.match(ctx.authErrorToFr({ message: 'Invalid login credentials' }), /incorrect/, 'témoin : l’erreur de connexion reste générique');
});

test('un mot de passe choisi fait 12 caractères au moins', () => {
  const ctx = app();
  assert.equal(lire(ctx, 'SF_MDP_MIN'), 12);
  const SRC = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'app.js'), 'utf8');
  const seuils = [...SRC.matchAll(/pwd\.length < (\w+)/g)].map(m => m[1]);
  assert.ok(seuils.length >= 2, 'témoin : inscription et nouveau mot de passe');
  assert.deepEqual([...new Set(seuils)], ['SF_MDP_MIN'], 'un seul seuil, partout');
});
