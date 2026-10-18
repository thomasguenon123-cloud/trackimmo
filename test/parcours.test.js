/* LE PARCOURS DE DÉMARRAGE — ce qu'un compte neuf doit faire, dans l'ordre.

   ⚠️ CE QU'IL CORRIGE. `renderAccueil` n'avait aucune branche « première
   ouverture » : le verdict se calculait sur `pts.length === 0`, qui ne
   distingue pas « rien à signaler » de « rien du tout ». Un compte neuf lisait
   « Rien ne demande votre attention — vos loyers sont pointés et vos fiches
   sont complètes », alors qu'il n'avait rien saisi.

   Gardes validées par mutation le 05/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-05T12:00:00') });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const ACQUIS   = [{ id: 'b1', statut: 'Acheté' }];
const PROSPECT = [{ id: 'b2', statut: 'Renseignements Web' }];
const OCCUPANT = [{ id: 'l1', bien_id: 'b1', statut: 'Actif' }];
const POINTE   = [{ id: 'y1', statut: 'Payé' }];

const faits = (b, l, loc) =>
  Array.from(app.sfParcoursDemarrage(b || [], l || [], loc || [])).map(g => g.fait);

// ── Les quatre états d'un compte qui se remplit ────────────────────────────

test('un compte vide n’a rien de fait', () => {
  assert.deepEqual(faits([], [], []), [false, false, false]);
});

test('un bien EN PROSPECTION ne compte pas comme patrimoine', () => {
  /* La première étape demande un bien ACQUIS : c'est lui qui porte un bail.
     Une fiche de prospection ne produit aucun loyer à suivre. */
  assert.deepEqual(faits(PROSPECT, [], []), [false, false, false]);
});

test('un bien acquis coche la première étape, et elle seule', () => {
  assert.deepEqual(faits(ACQUIS, [], []), [true, false, false]);
});

test('un locataire en place coche la deuxième', () => {
  assert.deepEqual(faits(ACQUIS, [], OCCUPANT), [true, true, false]);
});

test('un loyer pointé coche la troisième', () => {
  assert.deepEqual(faits(ACQUIS, POINTE, OCCUPANT), [true, true, true]);
});

test('un locataire rattaché à un bien NON acquis ne coche rien', () => {
  const ailleurs = [{ id: 'l9', bien_id: 'b2', statut: 'Actif' }];
  assert.deepEqual(faits(ACQUIS, [], ailleurs), [true, false, false]);
});

test('un loyer seulement DÛ ne coche pas la troisième', () => {
  /* Toute la leçon de l'étape 3 : le cashflow réel ne compte que l'encaissé. */
  assert.deepEqual(faits(ACQUIS, [{ statut: 'En attente' }], OCCUPANT),
                   [true, true, false]);
});

// ── Le relais avec les points d'attention ──────────────────────────────────

test('RÉGRESSION — le parcours ne dépend PAS des points d’attention', () => {
  /* ⚠️ LA PREMIÈRE VERSION MASQUAIT LE PARCOURS dès qu'un point existait, en
     croyant lui « passer le relais ». C'était un CUL-DE-SAC : `sfPointsAttention`
     émet toujours quelque chose sitôt qu'un bien est acquis — « aucune charge
     saisie cette année », « fiche à compléter », « pas de mensualité de crédit ».
     Le parcours ne pouvait donc jamais dépasser sa première étape : les deux
     suivantes n'étaient atteignables dans AUCUN état de l'application.
     Les deux listes répondent à des questions différentes et cohabitent. */
  const src = APP_JS.slice(APP_JS.indexOf('function sfParcoursAMontrer'),
                           APP_JS.indexOf('function sfPointsAttention'));
  assert.doesNotMatch(src, /\bpts\b/,
    'le parcours redevient invisible dès le premier bien acquis');

  const p = app.sfParcoursDemarrage(ACQUIS, [], []);
  assert.equal(app.sfParcoursAMontrer(p), true, 'deux gestes restent à faire');
});

test('le parcours disparaît quand les trois gestes sont faits', () => {
  const p = app.sfParcoursDemarrage(ACQUIS, POINTE, OCCUPANT);
  assert.equal(app.sfParcoursAMontrer(p), false);
});

test('RÉGRESSION — aucun état n’est stocké, le parcours se déduit', () => {
  /* Une case cochée en base mentirait le jour où l'on supprime le dernier
     bien. Ici le parcours réapparaît de lui-même, parce qu'il redevient vrai.
     On vérifie qu'aucune persistance ne s'est glissée dans la fonction. */
  const src = APP_JS.slice(APP_JS.indexOf('function sfParcoursDemarrage'),
                           APP_JS.indexOf('function sfParcoursAMontrer'));
  assert.doesNotMatch(src, /localStorage|db\.from|dataset|sessionStorage/,
    'le parcours ne doit dépendre d’aucun état stocké');
  // Et il redevient vrai si le compte se vide.
  assert.equal(app.sfParcoursAMontrer(app.sfParcoursDemarrage([], [], [])), true);
});

// ── Un seul geste actionnable à la fois ────────────────────────────────────

/* Les boutons d'ACTION : les « ? » d'aide (v=100) ne sont pas des gestes à faire. */
const actions = html => (html.match(/<button(?![^>]*class="sf-lex__b")/g) || []).length;

test('RÉGRESSION — le rendu ne propose qu’UN bouton, celui de l’étape suivante', () => {
  /* Montrer un bouton sur une étape inatteignable — déclarer un locataire sans
     bien acquis — serait promettre un raccourci qui n'existe pas. */
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage([], [], []));
  assert.equal(actions(html), 1);
  // Témoin (v=100) : l'explication de chaque étape est rangée derrière son « ? ».
  assert.equal((html.match(/class="sf-lex__b"/g) || []).length, 3, 'chaque étape garde son explication, derrière un « ? »');
  assert.match(html, /acc-pas--suivant/);
  assert.equal((html.match(/acc-pas--plus-tard/g) || []).length, 2);
});

test('le rendu marque comme faites les étapes franchies', () => {
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage(ACQUIS, [], OCCUPANT));
  assert.equal((html.match(/acc-pas--fait/g) || []).length, 2);
  assert.equal(actions(html), 1, 'reste le troisième geste');
});

test('aucun bouton quand tout est fait', () => {
  const html = app.sfParcoursHtml(app.sfParcoursDemarrage(ACQUIS, POINTE, OCCUPANT));
  assert.equal(actions(html), 0);
});

// ── L'accueil rendu (v=103 : plus de bandeau « verdict ») ─────────────────
/* Le bandeau redisait le titre « À traiter » placé juste dessous et poussait
   les chiffres sous la ligne de flottaison. Ses trois règles restent, et se
   vérifient désormais sur l'écran RENDU, pas sur le texte du code :
     · l'argent passe avant le démarrage ;
     · « Tout est à jour » ne se dit pas à un compte qui démarre ;
     · un même geste ne s'affiche qu'une fois. */
const { injecter } = require('./charger-app.js');

function accueil(donnees) {
  const ctx = charger({ maintenant: new Date('2026-09-05T12:00:00') });
  injecter(ctx, {
    currentUser: { id: 'u1' }, currentProfile: { role: 'user', first_name: 'Alex' },
    sfBiensCharges: true, allBiens: [], allLoyers: [], allCharges: [], allLocataires: [],
    ...donnees,
  });
  const el = { innerHTML: '' };
  ctx.renderAccueil(el);
  return el.innerHTML;
}
const pos = (h, motif) => { const m = h.search(motif); return m; };
const BIEN_VIDE = { id: 'b1', titre: 'T2 Nantes', ville: 'Nantes', statut: 'Acheté', mode_detention: 'propre',
  prix_affiche: 150000, loyer_en_etat: 700, mensualite_credit: 870, surface_m2: 40, is_test: false };

test('compte neuf : le parcours, jamais « Tout est à jour », jamais une liste vide', () => {
  const h = accueil({});
  assert.match(h, /Pour démarrer/, 'témoin : le parcours s’affiche');
  assert.doesNotMatch(h, /Tout est à jour/, 'l’état vide se félicite devant un compte qui n’a rien');
  assert.doesNotMatch(h, />À traiter</, 'une liste « À traiter » vide ne s’affiche pas pendant le démarrage');
  assert.doesNotMatch(h, /acc-verdict/, 'le bandeau verdict est revenu');
  // Sans bien acquis, le parcours passe avant les chiffres (trois « non disponible »).
  assert.ok(pos(h, /Pour démarrer/) < pos(h, /Votre patrimoine/), 'un compte neuf voit d’abord le parcours');
});

test('RÉGRESSION — l’argent passe avant le démarrage, et le même geste ne s’affiche qu’une fois', () => {
  // Un bien acquis, sans locataire, avec une mensualité : ce point coûte, et
  // il promet le geste suivant du parcours (« Déclarez son locataire »).
  const h = accueil({ allBiens: [{ ...BIEN_VIDE }] });
  assert.match(h, /Pour démarrer/, 'témoin : le parcours reste à faire');
  assert.match(h, />À traiter/, 'témoin : il reste un point à traiter (aucune charge saisie)');
  assert.ok(pos(h, /Votre patrimoine/) < pos(h, />À traiter/), 'qui possède un bien voit d’abord ce qu’il rapporte');
  assert.ok(pos(h, />À traiter/) < pos(h, /Pour démarrer/),
    'ce qui coûte doit être annoncé avant le parcours de démarrage');
  const fois = (h.match(/bien acquis sans locataire/g) || []).length;
  assert.equal(fois, 1, `« acquis sans locataire » s’affiche ${fois} fois : une fois dans À traiter, une fois dans le parcours`);
  assert.match(h, /acc-pas__why">1 bien acquis sans locataire · /, 'le parcours reprend le constat chiffré du point qu’il remplace');
  assert.match(h, /mensualités/, 'l’argent ne quitte pas l’écran');
});

test('portefeuille tenu : « Tout est à jour », sans parcours', () => {
  const h = accueil({
    allBiens: [{ ...BIEN_VIDE }],
    allLocataires: [{ id: 'l1', bien_id: 'b1', statut: 'Actif', date_entree: '2026-01-01', loyer_hc: 650, charges: 50, jour_paiement: 5 }],
    allLoyers: Array.from({ length: 9 }, (_, i) => ({ id: 'y' + i, bien_id: 'b1', locataire_id: 'l1', annee: 2026, mois: i + 1,
      statut: 'Payé', loyer_du: 700, loyer_hc: 650, charges: 50, montant_encaisse: 700, date_encaissement: `2026-0${i + 1}-05` })),
    allCharges: [{ id: 'c1', bien_id: 'b1', date_charge: '2026-02-10', montant: 120, categorie: 'Taxe foncière' }],
  });
  assert.doesNotMatch(h, /Pour démarrer/, 'le parcours disparaît quand les trois gestes sont faits');
  assert.match(h, /Tout est à jour/, 'un portefeuille tenu se le voit dire');
});

test('les actions rapides mènent à l’action, chacune avec son icône', () => {
  const h = accueil({});
  const bloc = h.slice(h.indexOf('class="acc-quick"'));
  const boutons = [...bloc.matchAll(/<button class="sf-quick" type="button" onclick="([^"]+)">\s*<span class="sf-quick__icon">([\s\S]*?)<\/span>\s*<span class="sf-quick__label">([^<]+)</g)];
  assert.equal(boutons.length, 6, 'témoin : six actions rapides');
  for (const [, cible, icone, libelle] of boutons) {
    assert.match(icone, /^<svg/, `« ${libelle} » : icône vide (clé inconnue de SF_ACC_ICONS)`);
    assert.doesNotMatch(cible, /^navigate\('module-financier'\)$/, `« ${libelle} » ouvre une page et laisse chercher le formulaire`);
  }
  const cibles = Object.fromEntries(boutons.map(([, c, , l]) => [l.trim(), c]));
  assert.equal(cibles['Pointer un loyer'], 'sfAllerPointer()');
  assert.equal(cibles['Ajouter un locataire'], 'sfAllerAjouterLocataire()');
  assert.equal(cibles['Saisir une charge'], 'sfAllerSaisirCharge()');
});
