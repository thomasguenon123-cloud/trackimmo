/* DÉMARRAGE, PHOTOS ET VUE DE MES BIENS (v=103).

   ⚠️ CE QUI ÉTAIT LENT OU MAL CADRÉ.
   · Le démarrage enchaînait cinq vagues de requêtes, chacune attendant la
     précédente (profil, profil encore, préférences, biens, puis le reste) :
     0,9 s d'attente en 4G pour des lectures de quelques millisecondes.
   · Une photo partait telle quelle : 3 à 5 Mo depuis un iPad.
   · Mes biens s'ouvrait en tableau sur iPad en portrait, où il demande 970 px
     pour 738 visibles : Rendement, Cashflow et Statut hors de l'écran.

   LA RÈGLE.
   · Profil, préférences et données partent ENSEMBLE ; rien n'est gardé avant
     que le profil ait dit « actif ».
   · Le plus grand côté d'une photo est ramené à 1 600 px ; si l'appareil ne
     sait pas la lire, l'original part — la réduction ne perd jamais de photo.
   · Sous 1 000 px, Mes biens s'ouvre en grille ; une vue choisie prime. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter, lire } = require('./charger-app');

// ─── Le démarrage en une vague ──────────────────────────────────────────────

function banc(statut) {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  const journal = [];
  let libererProfil;
  const profilEnAttente = new Promise(ok => { libererProfil = ok; });
  const db = lire(ctx, 'db');
  const lot = (nom) => {
    const q = new Proxy({}, { get(_, p) {
      if (p === 'then') return res => Promise.resolve({ data: [{ id: nom + '-1', user_id: 'u1', statut: 'Acheté' }], error: null }).then(res);
      return () => q;
    } });
    return q;
  };
  db.from = (table) => { journal.push('from:' + table); return lot(table); };
  db.rpc = (nom) => {
    journal.push('rpc:' + nom);
    if (nom === 'get_my_profile') return profilEnAttente.then(() => ({ data: { user_id: 'u1', status: statut, role: 'user' }, error: null }));
    return Promise.resolve({ data: { notaire_pct: 7 }, error: null });
  };
  db.auth.signOut = async () => { journal.push('signOut'); return { error: null }; };
  ctx.showAuthAlert = () => {};
  const entrees = [];
  ctx.onAuthSuccess = async (user, demarrage) => { entrees.push({ user, demarrage }); };
  return { ctx, journal, entrees, libererProfil };
}

test('profil, préférences et données partent ensemble, avant la réponse du profil', async () => {
  const { ctx, journal, entrees, libererProfil } = banc('active');
  const entree = ctx.sfEntrer({ id: 'u1' });
  // Le profil n'a pas encore répondu : tout doit déjà être parti.
  for (const attendu of ['rpc:get_my_profile', 'rpc:get_my_preferences', 'from:biens', 'from:locataires', 'from:loyers_mensuels', 'from:charges_reelles']) {
    assert.ok(journal.includes(attendu), `${attendu} attend la réponse du profil : une vague de plus au démarrage`);
  }
  libererProfil();
  assert.equal(await entree, true);
  assert.equal(entrees.length, 1, 'un compte actif entre');
  const d = entrees[0].demarrage;
  assert.equal(d.profil.status, 'active', 'le profil lu est transmis (il n’est pas relu)');
  assert.ok(d.chargement && typeof d.chargement.then === 'function', 'le chargement déjà lancé est transmis');
  assert.deepEqual({ ...(await d.prefs) }, { notaire_pct: 7 });
  assert.equal(journal.filter(x => x === 'rpc:get_my_profile').length, 1, 'le profil se lit une fois, pas deux');
});

for (const statut of ['pending', 'disabled']) {
  test(`un compte « ${statut} » n’entre pas, et rien de ce qui est revenu n’est gardé`, async () => {
    const { ctx, journal, entrees, libererProfil } = banc(statut);
    const entree = ctx.sfEntrer({ id: 'u1' });
    libererProfil();
    assert.equal(await entree, false);
    assert.equal(entrees.length, 0, 'onAuthSuccess appelé pour un compte non actif');
    assert.equal(lire(ctx, 'currentUser'), null, 'la session reste ouverte côté écran');
    assert.ok(journal.includes('signOut'), 'le compte est déconnecté');
    assert.equal(Array.from(lire(ctx, 'allBiens')).length, 0, 'des données ont été appliquées pour un compte non actif');
  });
}

// ─── Les photos ─────────────────────────────────────────────────────────────

test('une photo se réduit à 1 600 px sur son plus grand côté, proportions gardées', () => {
  const ctx = charger();
  assert.deepEqual({ ...ctx.sfDimensionsReduites(4032, 3024) }, { largeur: 1600, hauteur: 1200, reduite: true }, 'photo d’iPhone en paysage');
  assert.deepEqual({ ...ctx.sfDimensionsReduites(3024, 4032) }, { largeur: 1200, hauteur: 1600, reduite: true }, 'en portrait');
  assert.deepEqual({ ...ctx.sfDimensionsReduites(1200, 800) }, { largeur: 1200, hauteur: 800, reduite: false }, 'une photo déjà petite n’est pas agrandie');
  assert.equal(ctx.sfDimensionsReduites(0, 800), null);
  assert.equal(ctx.sfDimensionsReduites(NaN, 800), null);
});

test('une photo que l’appareil ne sait pas lire part telle quelle', async () => {
  const ctx = charger();
  ctx.window.createImageBitmap = async () => { throw new Error('format illisible'); };
  const original = { name: 'IMG_0001.HEIC', type: 'image/heic', size: 4e6 };
  assert.equal(await ctx.sfReduirePhoto(original), original, 'la réduction a fait perdre la photo');
});

test('les photos choisies gardent leur ordre, et un fichier qui n’est pas une image est ignoré', async () => {
  const ctx = charger();
  ctx.sfReduirePhoto = async f => ({ ...f, name: f.name.replace(/\.\w+$/, '.jpg') });
  ctx.sfLireDataUrl = async f => 'data:' + f.name;
  const liste = [];
  let rendus = 0;
  await ctx.sfAjouterPhotos([{ name: 'a.heic', type: 'image/heic' }, { name: 'notes.pdf', type: 'application/pdf' }, { name: 'b.png', type: 'image/png' }],
    liste, () => { rendus++; });
  assert.deepEqual(liste.map(p => p.name), ['a.jpg', 'b.jpg']);
  assert.deepEqual(liste.map(p => p.data), ['data:a.jpg', 'data:b.jpg']);
  assert.ok(liste.every(p => p._file && p.kind === 'b64'), 'le fichier réduit est celui qui partira dans le stockage');
  assert.equal(rendus, 2, 'chaque photo apparaît dès qu’elle est prête');
});

// ─── La vue de Mes biens ────────────────────────────────────────────────────

test('sous 1 000 px, Mes biens s’ouvre en grille ; une vue choisie prime', () => {
  const ctx = charger();
  const stock = {};
  ctx.localStorage.getItem = k => stock[k] ?? null;
  ctx.localStorage.setItem = (k, v) => { stock[k] = String(v); };
  let etroit = true;
  ctx.matchMedia = q => ({ matches: q === lire(ctx, 'SF_VUE_ETROITE') && etroit, addEventListener() {}, addListener() {} });
  assert.equal(ctx.sfVueParDefaut(), 'grille', 'iPad en portrait : le tableau déborde de 230 px');
  etroit = false;
  assert.equal(ctx.sfVueParDefaut(), 'tableau', 'sur grand écran, le tableau compare les biens');
  ctx.applyFilters = () => {};
  ctx.setView('kanban');
  assert.equal(stock.sf_vue_biens, 'kanban', 'la vue choisie est retenue sur cet appareil');
  etroit = true;
  assert.equal(ctx.sfVueParDefaut(), 'kanban', 'une vue choisie prime sur la largeur');
  stock.sf_vue_biens = 'n’importe quoi';
  assert.equal(ctx.sfVueParDefaut(), 'grille', 'une valeur inconnue en mémoire est ignorée');
  // Le patrimoine n'a pas de kanban : il retombe sur la vue de la largeur.
  injecter(ctx, { bienOnglet: 'prospect', currentView: 'kanban' });
  ctx.sfSetOnglet('detenus');
  assert.equal(lire(ctx, 'currentView'), 'grille');
});
