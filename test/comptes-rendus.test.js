/* LES COMPTES RENDUS DE VISITE — la v=96, deuxième version de l'étape 1.

   ⚠️ CE QUE CES GARDES EMPÊCHENT DE REVENIR OU D'ARRIVER :
     · une grille qui partirait en base alors que la colonne `grille` n'existe
       pas encore — l'enregistrement entier serait refusé ;
     · la grille d'une visite d'achat restée sur un compte rendu devenu état
       des lieux ;
     · des valeurs hors grille, ou un montant lu par parseFloat ;
     · les comptes rendus des biens de test dans les chiffres de la page, et
       une note moyenne tirée vers le bas par les états des lieux non notés ;
     · un double appui sur « Enregistrer » qui envoyait DEUX fois le compte
       rendu — trouvé au banc d'essai le 14/10, la garde était posée après un
       `await` ;
     · un rendu périmé qui écraserait la page d'arrivée ;
     · un texte libre (notes, points forts, adresse) interprété comme du HTML.

   Les gardes sont validées par mutation le 14/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

const REEL = { id: 'b-reel', titre: 'T2 Lyon', ville: 'Lyon', is_test: false };
const TEST = { id: 'b-test', titre: 'T3 Test', ville: 'Lyon', is_test: true };

function app({ admin = false, inclure = false, biens = [REEL, TEST] } = {}) {
  const ctx = charger({ maintenant: new Date(2026, 9, 14, 12) });
  ctx.showNotif = () => {};
  ctx.pages = [];
  ctx.navigate = (p) => { ctx.pages.push(p); };
  injecter(ctx, {
    currentUser: { id: 'u1', email: 'membre@exemple.fr' },
    currentProfile: { role: admin ? 'admin' : 'user' },
    sfTestsChoix: inclure, allBiens: biens, allLocataires: [{ id: 'l1', prenom: 'Camille', nom: 'Martin', statut: 'Sorti' }],
    currentPage: 'compte-rendu', sfcGrilleDispo: null,
    // Les biens sont chargés, comme après le démarrage : sinon sfAssurerBiens
    // les relirait depuis la doublure.
    sfBiensCharges: true,
  });
  return ctx;
}

// Client Supabase qui enregistre les appels (même procédé que nouvelle-fiche.test.js).
function dbEnregistreur(ctx, repondre = () => ({ data: [] })) {
  const appels = [];
  lire(ctx, 'db').from = (table) => {
    const ops = [];
    appels.push({ table, ops });
    const q = new Proxy({}, { get(_, prop) {
      if (prop === 'then') {
        const r = repondre(table, ops);
        return (res, rej) => Promise.resolve({ data: r.data, error: r.error || null }).then(res, rej);
      }
      return (...args) => { ops.push([prop, ...args]); return q; };
    } });
    return q;
  };
  return appels;
}
const op = (x, nom) => x.ops.find(o => o[0] === nom);

/* Un écran de saisie : les champs que lit `sfcCompteRenduDepuisEcran`, et les
   choix segmentés de la grille (`aria-pressed`). */
function ecran(ctx, champs = {}, choix = {}) {
  const els = {};
  for (const [id, value] of Object.entries(champs)) {
    els[id] = { id, value, hidden: false, textContent: '', innerHTML: '', disabled: false, isConnected: true,
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
      closest() { return null; }, focus() {}, scrollIntoView() {} };
  }
  els['v-enregistrer'] = { id: 'v-enregistrer', disabled: false, isConnected: true, innerHTML: '', textContent: '' };
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelector = sel => {
    const m = /^\.sf-choix\[data-grille="(\w+)"\] \.sf-choix__o\[aria-pressed="true"\]$/.exec(sel);
    return m && choix[m[1]] ? { dataset: { v: choix[m[1]] } } : null;
  };
  ctx.document.querySelectorAll = () => [];
  return els;
}
const SAISIE_ACHAT = { 'v-type': 'achat', 'v-date': '2026-10-02', 'v-bien': 'b-reel', 'v-adresse': ' 12 rue Dumenge ',
  'v-locataire': 'l1', 'v-conforme': 'oui', 'v-notes': '', 'g-travaux': '15.000', 'g-charges_annuelles': '1 450 €',
  'g-travaux_votes': '', 'g-points_forts': '  Traversant  ', 'g-points_faibles': '' };

// Le corps d'une fonction, commentaires retirés : les commentaires de ce dépôt
// citent l'ancien code qu'ils remplacent.
function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ─── La grille ─────────────────────────────────────────────────────────────

test('la grille ne garde que les critères connus et les valeurs permises', () => {
  const ctx = app();
  const n = g => { const r = ctx.sfGrilleNormaliser(g); return r === null ? null : JSON.parse(JSON.stringify(r)); };
  assert.deepEqual(n({ etat: 'bon', dpe: 'D', suite: 'offre', travaux: '15.000', charges_annuelles: '1 450 €',
                       points_forts: '  Traversant  ' }),
    { etat: 'bon', dpe: 'D', travaux: 15000, charges_annuelles: 1450, suite: 'offre', points_forts: 'Traversant' },
    'témoin : une grille valide traverse la normalisation, montants relus par sfLireNombre');
  assert.deepEqual(n({ etat: 'excellent', dpe: 'H', inconnu: 'x', suite: '<script>' }), null,
    'Des valeurs hors grille ou un critère inconnu entrent en base : la grille doit les écarter.');
  assert.deepEqual(n({ travaux: '12 a' }), null, 'un montant illisible n\'est pas un nombre');
  assert.deepEqual(n({ travaux: '-500' }), null, 'des travaux négatifs ne veulent rien dire');
  assert.equal(n({ points_forts: 'x'.repeat(5000) }).points_forts.length, lire(ctx, 'SF_GRILLE_TEXTE_MAX'),
    'un texte libre est borné');
  for (const vide of [null, undefined, {}, [], 'offre', { etat: '' }, { points_forts: '   ' }]) {
    assert.equal(ctx.sfGrilleNormaliser(vide), null, `« ${JSON.stringify(vide)} » est une grille non remplie : null, pas un objet vide`);
  }
});

test('la grille est définie une seule fois : quatre sections, celles validées le 14/10', () => {
  const ctx = app();
  const g = Array.from(lire(ctx, 'SF_GRILLE'), s => [s.titre, Array.from(s.champs, c => c.k)]);
  assert.deepEqual(JSON.parse(JSON.stringify(g)), [
    ['Le bien', ['etat', 'dpe', 'luminosite', 'bruit', 'travaux']],
    ['Copropriété', ['charges_annuelles', 'parties_communes', 'procedures', 'travaux_votes']],
    ['Quartier', ['transports', 'commerces', 'ecoles', 'securite']],
    ['Verdict', ['suite', 'points_forts', 'points_faibles']],
  ]);
  // La saisie, la lecture et la normalisation lisent toutes SF_GRILLE.
  for (const f of ['sfcRenderSaisie', 'sfcRenderLecture']) {
    assert.match(corps(f), /SF_GRILLE\.map\(/, `${f} ne lit plus SF_GRILLE : une seconde liste de critères divergera`);
  }
  assert.match(corps('sfGrilleNormaliser'), /SF_GRILLE_CHAMPS/);
});

test('le résumé d\'une grille dit d\'abord la suite à donner', () => {
  const ctx = app();
  assert.equal(ctx.sfGrilleResume({ etat: 'travaux', travaux: 12000, dpe: 'F', suite: 'attendre' }),
    `Attendre · DPE F · ${ctx.sfEur(12000)} de travaux · Gros travaux`);
  assert.equal(ctx.sfGrilleResume(null), '');
  assert.equal(ctx.sfGrilleResume({ luminosite: 'sombre' }), '', 'seuls les critères qui pèsent sur la décision résument');
});

// ─── Les chiffres de la page ───────────────────────────────────────────────

const VISITES = [
  { id: 'v1', type_visite: 'achat', bien_id: 'b-reel', note_sur_5: 4 },
  { id: 'v2', type_visite: 'locataire', bien_id: 'b-reel', note_sur_5: 3 },
  { id: 'v3', type_visite: 'edl_entree', bien_id: 'b-reel', note_sur_5: null },
  { id: 'v4', type_visite: 'achat', bien_id: 'b-test', note_sur_5: 1 },
  { id: 'v5', type_visite: 'achat', bien_id: null, note_sur_5: 5 },
];

test('les comptes rendus des biens de test sortent des chiffres', () => {
  const ind = opts => JSON.parse(JSON.stringify(app(opts).sfCrIndicateurs(VISITES)));
  const sans = ind({ admin: true });
  assert.equal(sans.total, 4, 'Le compte rendu d\'un bien de test est compté (v=94 : il sort de tout ce qui agrège).');
  assert.deepEqual(sans.parNature.map(x => x.n), [2, 1, 1, 0], 'par nature, dans l\'ordre de SF_CR_TYPES');
  assert.equal(sans.moyenne, 4, 'moyenne de 4, 3 et 5 : la note du bien de test n\'y entre pas');
  // Témoin : un administrateur qui les réintègre les retrouve.
  const avec = ind({ admin: true, inclure: true });
  assert.equal(avec.total, 5);
  assert.equal(avec.moyenne, 13 / 4);
  // Et l'interrupteur ne vaut que pour un administrateur.
  assert.equal(ind({ admin: false, inclure: true }).total, 4);
});

test('la note moyenne ne porte que sur les visites notées', () => {
  /* Un état des lieux n'a pas de note : l'inclure à zéro annonçait « 2,7 »
     sur des visites toutes notées 4. */
  const ctx = app();
  const ind = ctx.sfCrIndicateurs([{ type_visite: 'achat', note_sur_5: 4 }, { type_visite: 'edl_sortie', note_sur_5: null },
                                   { type_visite: 'locataire', note_sur_5: 4 }]);
  assert.equal(ind.moyenne, 4, 'Les comptes rendus sans note tirent la moyenne vers le bas.');
  assert.equal(ctx.sfCrIndicateurs([{ type_visite: 'edl_entree', note_sur_5: null }]).moyenne, null,
    'sans visite notée, la moyenne est « non disponible », pas 0');
});

// ─── Ce qui part en base ───────────────────────────────────────────────────

test('sans la colonne `grille`, rien n\'est envoyé pour elle', () => {
  const ctx = app();
  ecran(ctx, SAISIE_ACHAT, { etat: 'bon', suite: 'offre' });
  const { payload, erreurs } = ctx.sfcCompteRenduDepuisEcran(false);
  assert.equal(erreurs.length, 0);
  assert.ok(!('grille' in payload),
    'La grille part alors que la colonne n\'existe pas : PostgREST refuserait le compte rendu entier.');
  // Témoin : avec la colonne, la grille saisie part, normalisée.
  const avec = ctx.sfcCompteRenduDepuisEcran(true).payload;
  assert.deepEqual(JSON.parse(JSON.stringify(avec.grille)),
    { etat: 'bon', travaux: 15000, charges_annuelles: 1450, suite: 'offre', points_forts: 'Traversant' });
});

test('la grille et le locataire suivent la nature du compte rendu', () => {
  const ctx = app();
  ecran(ctx, SAISIE_ACHAT, { etat: 'bon' });
  const achat = ctx.sfcCompteRenduDepuisEcran(true).payload;
  assert.equal(achat.locataire_id, null, 'une visite d\'achat ne concerne aucun locataire, même si le champ caché en garde un');
  assert.equal(achat.conforme, null, '`conforme` n\'a de sens que sur un état des lieux de sortie');
  assert.equal(achat.adresse, '12 rue Dumenge');

  ecran(ctx, { ...SAISIE_ACHAT, 'v-type': 'locataire' }, { etat: 'bon' });
  const loc = ctx.sfcCompteRenduDepuisEcran(true).payload;
  assert.ok('grille' in loc && loc.grille === null,
    'Hors visite d\'achat, la grille est VIDÉE : celle d\'une nature abandonnée resterait en base.');
  assert.equal(loc.locataire_id, 'l1');
  assert.equal(loc.conforme, null);

  ecran(ctx, { ...SAISIE_ACHAT, 'v-type': 'edl_sortie' });
  const sortie = ctx.sfcCompteRenduDepuisEcran(true).payload;
  assert.equal(sortie.conforme, true, 'témoin : un état des lieux de sortie porte son constat');
});

test('ce qui empêche d\'enregistrer se dit sous le champ, avec sa raison', async () => {
  const ctx = app();
  ecran(ctx, { ...SAISIE_ACHAT, 'v-date': '', 'g-travaux': '12 a' });
  const erreurs = Array.from(ctx.sfcCompteRenduDepuisEcran(true).erreurs, e => Array.from(e));
  assert.deepEqual(erreurs.map(e => e[0]), ['v-date', 'g-travaux']);
  assert.match(erreurs[1][1], /« 12 a » n'est pas un montant/);

  ecran(ctx, { ...SAISIE_ACHAT, 'v-type': 'edl_entree', 'v-locataire': '' });
  const edl = Array.from(ctx.sfcCompteRenduDepuisEcran(true).erreurs, e => e[0]);
  assert.deepEqual(edl, ['v-locataire'], 'un état des lieux sans locataire est refusé (visites_edl_a_un_locataire)');
  const appels = dbEnregistreur(ctx);
  await ctx.saveVisite();
  assert.equal(appels.filter(x => op(x, 'insert') || op(x, 'update')).length, 0, 'un compte rendu refusé ne part pas en base');
});

test('RÉGRESSION — un double appui sur « Enregistrer » n\'envoie qu\'une fois', async () => {
  /* Trouvé au banc d'essai le 14/10 : la garde `sfcEnvoi` était posée APRÈS
     la vérification de la colonne (un `await`) ; deux appuis rapprochés
     passaient tous les deux. */
  const ctx = app();
  injecter(ctx, { sfcEtat: { id: null, mode: 'saisie', retour: { page: 'visites' } } });
  ecran(ctx, SAISIE_ACHAT, { suite: 'offre' });
  const appels = dbEnregistreur(ctx, (table, ops) =>
    (table === 'visites' && ops.some(o => o[0] === 'insert') ? { data: { id: 'v-neuf' } } : { data: [] }));
  await Promise.all([ctx.saveVisite(), ctx.saveVisite()]);
  assert.equal(appels.filter(x => x.table === 'visites' && op(x, 'insert')).length, 1,
    'Deux comptes rendus créés pour un double appui : la garde doit précéder le premier await.');
});

test('RÉGRESSION — après un échec d\'envoi des photos, un nouvel appui met à jour le compte rendu', async () => {
  const ctx = app();
  injecter(ctx, { sfcEtat: { id: null, mode: 'saisie', retour: { page: 'visites' } } });
  ecran(ctx, SAISIE_ACHAT);
  let echec = true;
  const appels = dbEnregistreur(ctx, (table, ops) => {
    if (table === 'visites' && ops.some(o => o[0] === 'insert')) return { data: { id: 'v-neuf' } };
    if (table === 'visites' && ops.some(o => o[0] === 'update') && echec) { echec = false; return { data: null, error: { message: 'réseau' } }; }
    return { data: [] };
  });
  await ctx.saveVisite();
  assert.equal(lire(ctx, 'sfcEtat.id'), 'v-neuf', 'le compte rendu créé devient celui qu\'on modifie');
  await ctx.saveVisite();
  assert.equal(appels.filter(x => x.table === 'visites' && op(x, 'insert')).length, 1,
    'Un second compte rendu créé après un échec : il fallait mettre à jour le premier.');
  assert.ok(appels.some(x => x.table === 'visites' && op(x, 'update') && op(x, 'eq')?.[2] === 'v-neuf'));
});

test('sans colonne en base, l\'enregistrement part sans grille ; avec, la grille part', async () => {
  for (const colonne of [false, true]) {
    const ctx = app();
    injecter(ctx, { sfcEtat: { id: null, mode: 'saisie', retour: { page: 'visites' } } });
    ecran(ctx, SAISIE_ACHAT, { etat: 'bon' });
    const appels = dbEnregistreur(ctx, (table, ops) => {
      if (table === 'visites' && ops.some(o => o[0] === 'select' && o[1] === 'grille') && !colonne)
        return { data: null, error: { message: 'column visites.grille does not exist', code: '42703' } };
      if (table === 'visites' && ops.some(o => o[0] === 'insert')) return { data: { id: 'v-neuf' } };
      return { data: [] };
    });
    await ctx.saveVisite();
    const ins = appels.find(x => x.table === 'visites' && op(x, 'insert'));
    assert.ok(ins, 'le compte rendu est enregistré');
    assert.equal('grille' in op(ins, 'insert')[1], colonne,
      colonne ? 'témoin : la colonne existe, la grille part' : 'La grille part alors que la vérification a dit « pas de colonne ».');
  }
});

test('le constat de sortie met à jour le délai de restitution du dépôt', async () => {
  const ctx = app();
  injecter(ctx, { sfcEtat: { id: null, mode: 'saisie', retour: { page: 'module-financier' } } });
  ecran(ctx, { ...SAISIE_ACHAT, 'v-type': 'edl_sortie', 'v-conforme': 'non' });
  const appels = dbEnregistreur(ctx, (table, ops) =>
    (table === 'visites' && ops.some(o => o[0] === 'insert') ? { data: { id: 'v-neuf' } } : { data: [] }));
  await ctx.saveVisite();
  const maj = appels.find(x => x.table === 'locataires' && op(x, 'update'));
  assert.ok(maj, 'Le constat n\'est plus reporté sur le bail : le délai de restitution ne serait jamais recalculé.');
  assert.deepEqual(JSON.parse(JSON.stringify(op(maj, 'update')[1])), { edl_sortie_conforme: false });
  assert.equal(lire(ctx, 'allLocataires[0].edl_sortie_conforme'), false);
});

// ─── La page ───────────────────────────────────────────────────────────────

test('RÉGRESSION — un rendu périmé n\'écrase pas la page d\'arrivée', async () => {
  const ctx = app();
  dbEnregistreur(ctx, (table, ops) => {
    const id = op({ ops }, 'eq')?.[2];
    return { data: table === 'visites' && id ? { id, type_visite: 'achat', date_visite: '2026-10-02', notes: 'Compte rendu ' + id } : [] };
  });
  const el = () => ({ innerHTML: '', querySelector: () => ({ addEventListener() {} }) });
  // Une saisie demandée, puis aussitôt une autre page de compte rendu.
  injecter(ctx, { sfcEtat: { id: 'v1', mode: 'saisie', retour: { page: 'visites' } } });
  const el1 = el(), el2 = el();
  const p1 = ctx.renderCompteRendu(el1);
  injecter(ctx, { sfcEtat: { id: 'v2', mode: 'lecture', retour: { page: 'visites' } } });
  const p2 = ctx.renderCompteRendu(el2);
  await Promise.all([p1, p2]);
  assert.match(el2.innerHTML, /Compte rendu v2/, 'témoin : le dernier rendu s\'affiche');
  assert.doesNotMatch(el1.innerHTML, /Compte rendu v1/,
    'Le premier rendu, périmé, a écrit sa page : une navigation plus récente est arrivée entre-temps.');

  // Quitter la page pendant le chargement : rien n'est écrit.
  const el3 = el();
  injecter(ctx, { sfcEtat: { id: 'v1', mode: 'saisie', retour: { page: 'visites' } } });
  const p3 = ctx.renderCompteRendu(el3);
  injecter(ctx, { currentPage: 'accueil' });
  await p3;
  assert.doesNotMatch(el3.innerHTML, /Compte rendu v1/);

  // La lecture attend encore ses photos : elle revérifie avant d'écrire.
  injecter(ctx, { currentPage: 'compte-rendu' });
  const el4 = el();
  await ctx.sfcRenderLecture(el4, { id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', notes: 'Compte rendu v1' }, true,
    lire(ctx, 'sfcJeton') - 1);
  assert.equal(el4.innerHTML, '', 'une lecture dont le jeton est dépassé écrit quand même sa page');
  await ctx.sfcRenderLecture(el4, { id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', notes: 'Compte rendu v1' }, true,
    lire(ctx, 'sfcJeton'));
  assert.match(el4.innerHTML, /Compte rendu v1/, 'témoin : avec le jeton courant, elle s\'écrit');
});

test('les textes libres ne sont jamais interprétés comme du HTML', async () => {
  const ctx = app();
  const piege = '<img src=x onerror=alert(1)>';
  const ligne = ctx.sfcLigneHtml({ id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', adresse: piege, notes: piege });
  assert.ok(!ligne.includes('<img'), 'Une adresse ou une note passe brute dans la liste des comptes rendus.');
  assert.ok(ligne.includes('&lt;img'), 'témoin : le texte est bien affiché, échappé');
  const ligne2 = ctx.sfcLigneHtml({ id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', grille: { points_forts: piege } });
  assert.ok(!ligne2.includes('<img'), 'les points forts servent d\'extrait : ils s\'échappent aussi');

  injecter(ctx, { sfcGrilleDispo: true });
  dbEnregistreur(ctx, () => ({ data: { id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', adresse: piege, notes: piege,
    grille: { points_faibles: piege, travaux_votes: piege }, biens: { titre: piege, ville: piege } } }));
  injecter(ctx, { sfcEtat: { id: 'v1', mode: 'lecture', retour: { page: 'visites' } } });
  const el = { innerHTML: '' };
  await ctx.renderCompteRendu(el);
  assert.match(el.innerHTML, /&lt;img/, 'témoin : la lecture a bien été rendue');
  assert.ok(!el.innerHTML.includes('<img'), 'La lecture d\'un compte rendu interprète un texte saisi comme du HTML.');
  assert.equal(ctx.sfcUrlCss("https://x/a'b(c).jpg"), 'https://x/a%27b%28c%29.jpg',
    'une apostrophe refermerait url(\'…\') : elle est encodée');
});

test('la grille ne s\'affiche que si la colonne existe — et jamais « bientôt »', () => {
  const ctx = app();
  const v = { id: 'v1', type_visite: 'achat', date_visite: '2026-10-02', bien_id: 'b-reel', grille: { etat: 'bon' } };
  const el = { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
  ctx.sfcRenderSaisie(el, v, false);
  assert.ok(!/sfc-grille|sf-choix/.test(el.innerHTML), 'La grille s\'affiche sans colonne pour l\'enregistrer.');
  assert.ok(!/bient[oô]t/i.test(el.innerHTML), 'pas d\'entrée « Bientôt » (sfParamPropose)');
  ctx.sfcRenderSaisie(el, v, true);
  assert.equal((el.innerHTML.match(/class="sff-block sfc-grille"/g) || []).length, 4, 'témoin : avec la colonne, les quatre sections');
  assert.match(el.innerHTML, /data-grille="etat"[\s\S]*?data-v="bon" aria-pressed="true"/, 'la valeur enregistrée revient cochée');
  assert.equal((el.innerHTML.match(/sf-btn--primary/g) || []).length, 1, 'une seule action principale, en barre collante');
});

test('la liste : une seule action principale, les biens de test marqués, un état vide complet', async () => {
  const ctx = app({ admin: true });
  injecter(ctx, { currentPage: 'visites' });
  dbEnregistreur(ctx, (table) => ({ data: table !== 'visites' ? [] : VISITES.map(v => ({ ...v, date_visite: '2026-10-01',
    biens: v.bien_id ? { titre: v.bien_id === 'b-test' ? 'T3 Test' : 'T2 Lyon', ville: 'Lyon' } : null })) }));
  const el = { innerHTML: '' };
  await ctx.renderVisites(el);
  assert.equal((el.innerHTML.match(/sf-btn--primary/g) || []).length, 1, 'une seule action principale par écran');
  assert.match(el.innerHTML, /T3 Test[^]*?sf-pill sf-pill--test">Test</, 'le groupe d\'un bien de test est marqué « Test »');
  assert.match(el.innerHTML, /sff-kpi__l">Comptes rendus<\/span>\s*<span class="sff-kpi__v">4</,
    'Le compteur de la page compte le compte rendu d\'un bien de test.');
  assert.ok(!/accent-g|linear-gradient/.test(el.innerHTML), 'le bandeau vert plein est revenu : un seul vert lumineux, réservé aux valeurs positives');
  assert.ok(el.innerHTML.indexOf('Sans bien rattaché') > el.innerHTML.indexOf('T3 Test'), 'les comptes rendus sans bien viennent en dernier');

  dbEnregistreur(ctx, () => ({ data: [] }));
  await ctx.renderVisites(el);
  for (const piece of ['sff-empty__ic', 'sff-empty__t', 'sff-empty__x', 'sf-btn']) {
    assert.ok(el.innerHTML.includes(piece), `état vide incomplet : ${piece} manque (icône, titre, explication, action)`);
  }
});

test('la fiche du bien et la liste montrent la même ligne de compte rendu', () => {
  assert.match(corps('renderBienDetail'), /visites\.map\(sfcLigneHtml\)/,
    'L\'onglet Visites de la fiche réécrit sa propre ligne : les deux affichages divergeront.');
  assert.match(corps('sfcGroupeHtml'), /\.map\(sfcLigneHtml\)/);
  // La ligne est un bouton : elle s'ouvre au clavier comme au doigt, en lecture.
  assert.match(corps('sfcLigneHtml'), /<button type="button" class="sff-row sfc-row" onclick="openReadVisite\(/);
});

test('on revient d\'où l\'on vient : la fiche du bien, sur l\'onglet Visites', () => {
  const ctx = app();
  injecter(ctx, { currentPage: 'bien-detail', currentBienId: 'b-reel', bienDetailBack: 'biens' });
  ctx.openNouvelleVisite('b-reel');
  assert.deepEqual(JSON.parse(JSON.stringify(lire(ctx, 'sfcEtat.retour'))), { page: 'bien-detail', id: 'b-reel', back: 'biens' });
  assert.equal(lire(ctx, 'sfcEtat.bienId'), 'b-reel', 'le bien est présélectionné');
  injecter(ctx, { currentPage: 'compte-rendu', bienDetailTab: 'bien', bienDetailBack: 'compte-rendu' });
  ctx.sfcAller(lire(ctx, 'sfcEtat.retour'));
  assert.equal(ctx.pages.at(-1), 'bien-detail');
  assert.equal(lire(ctx, 'bienDetailTab'), 'visites', 'le retour rouvre l\'onglet des comptes rendus');
  assert.equal(lire(ctx, 'bienDetailBack'), 'biens', 'la fiche retrouve son propre retour');
  // RÉGRESSION — une fiche ouverte depuis un compte rendu ne renvoie pas vers
  // lui en boucle : elle revient à la liste.
  ctx.sfcAller({ page: 'bien-detail', id: 'b-reel', back: 'compte-rendu' });
  assert.equal(lire(ctx, 'bienDetailBack'), 'visites',
    'Fiche et compte rendu se renvoient l\'un à l\'autre : le bouton retour tourne en boucle.');
  // Depuis le Suivi financier (état des lieux après une sortie), on y revient.
  injecter(ctx, { currentPage: 'module-financier' });
  ctx.openNouvelleVisite('b-reel', { type: 'edl_sortie', locataireId: 'l1', date: '2026-10-01', conforme: true });
  assert.equal(lire(ctx, 'sfcEtat.retour.page'), 'module-financier');
  assert.equal(lire(ctx, 'sfcEtat.preset.type'), 'edl_sortie');
  // Ouvrir la modification depuis la lecture garde le retour d'origine.
  injecter(ctx, { currentPage: 'compte-rendu' });
  ctx.openDetailVisite('v1');
  assert.equal(lire(ctx, 'sfcEtat.retour.page'), 'module-financier');
});
