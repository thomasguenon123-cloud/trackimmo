/* LA NOUVELLE FICHE — la v=95, première version de l'étape 1 du fil rouge.

   ⚠️ CE QUE CES GARDES EMPÊCHENT DE REVENIR, relevé sur l'ancien formulaire
   le 03/10/2026 :
     · des montants lus par `parseFloat` : « 168 000 » valait 168 ;
     · un champ « Prix HA » enregistré nulle part, dont les frais de notaire
       suivaient pourtant la valeur (14 000 € de frais en base pour un prix de
       199 199 €) ;
     · « −33 €/mois » de cashflow sur une fiche VIDE, par une copie de computeCF ;
     · un double appui sur « Ajouter » qui créait deux biens ;
     · `editBien` qui dessinait la fiche vide puis la fiche du bien : si les
       réponses arrivaient dans l'autre ordre, enregistrer créait un doublon ;
     · des vignettes `src="[object Object]"` à la modification.
   Et, trouvé en chemin : supprimer un bien de TEST laissait ses locataires
   sans bien — donc comptés dans les vrais chiffres depuis la v=94.

   Les gardes sont validées par mutation le 03/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ESPACE_FINE = ' ';

const NOMBRES = ['f-surface', 'f-prix', 'f-loyer', 'f-mensualite', 'f-duree', 'f-copro', 'f-assurance',
  'f-taxe', 'f-travaux', 'f-agence', 'f-sci', 'f-charges-loc', 'f-loyer-travaux', 'f-charges-travaux'];

/* Un DOM de formulaire : juste ce que getFormData, la validation et
   l'enregistrement lisent. */
function formulaire(ctx, valeurs = {}) {
  const els = {};
  const fabrique = (id, value) => (els[id] = {
    id, value, hidden: false, textContent: '', innerHTML: '', className: '', dataset: {}, style: {},
    disabled: false, isConnected: true, nombre: NOMBRES.includes(id),
    classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, closest() { return null; }, focus() {}, scrollIntoView() {},
  });
  for (const [id, v] of Object.entries(valeurs)) fabrique(id, v);
  fabrique('btn-save', undefined);
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelectorAll = sel => (sel === '.sfn .sfn-nombre' ? Object.values(els).filter(e => e.nombre) : []);
  return els;
}

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 3, 12) });
  ctx.showNotif = () => {};
  // Une déclaration `function` du contexte ne se supprime pas : on garde la
  // vraie pour les tests qui en ont besoin.
  ctx.vraiNavigate = ctx.navigate;
  ctx.navigate = () => {};
  ctx.loadSCIList = async () => {};
  injecter(ctx, { currentUser: { id: 'u1', email: 'membre@exemple.fr' }, currentProfile: { role: 'user' },
    allBiens: [], allSCI: [], allLoyers: [], editingId: null, sciOui: false, bienPhotos: [], bienDocs: [] });
  return ctx;
}

// Client Supabase qui enregistre les appels (même procédé que biens-test.test.js).
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
const a = (x, op) => x.ops.some(o => o[0] === op);

// Le corps d'une fonction, commentaires retirés : les commentaires de ce dépôt
// citent l'ancien code qu'ils remplacent.
function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

// ─── Les montants se lisent comme ils s'écrivent ───────────────────────────

test('« 168 000 », « 1 200,50 » et « 168.000 » sont des montants', () => {
  const ctx = app();
  const n = t => ctx.sfLireNombre(t);
  assert.equal(n('168 000'), 168000, 'parseFloat lisait 168 : un prix tel que l\'annonce l\'écrit doit valoir 168 000.');
  assert.equal(n('168' + ESPACE_FINE + '000'), 168000, 'l\'espace fine que pose le formatage doit se relire');
  assert.equal(n('168 000 €'), 168000);
  assert.equal(n('1 200,50'), 1200.5);
  assert.equal(n('168.000'), 168000, 'des groupes de trois chiffres derrière un point sont des milliers');
  assert.equal(n('1.5'), 1.5);
  assert.equal(n('41,5'), 41.5);
  assert.equal(n(''), null, 'un champ vide n\'est pas un zéro');
  assert.equal(n('   '), null);
  for (const illisible of ['12 a', '-5', '1,2,3', 'abc']) {
    assert.ok(Number.isNaN(n(illisible)), `« ${illisible} » doit être refusé, pas lu comme un nombre`);
  }
  // Ce que le champ affiche après saisie doit se relire à l'identique.
  for (const v of [168000, 1234567.5, 41.5, 20]) {
    assert.equal(n(ctx.sfnFormaterNombre(v)), v, `aller-retour du formatage pour ${v}`);
  }
});

test('la fiche enregistre ce qui est saisi, ni plus ni moins', () => {
  const ctx = app();
  formulaire(ctx, {
    'f-titre': '  T2 Lyon Croix-Rousse  ', 'f-ville': 'Lyon', 'f-type': 'T2', 'f-statut': 'Renseignements Web',
    'f-prix': '168 000', 'f-loyer': '780', 'f-surface': '41,5', 'f-assurance': '', 'f-duree': '25', 'f-sci-id': 'propre',
  });
  const d = ctx.getFormData();
  assert.equal(d.prix_affiche, 168000, 'Le prix est lu « 168 » : getFormData doit passer par sfLireNombre.');
  assert.equal(d.surface_m2, 41.5);
  assert.equal(d.titre, 'T2 Lyon Croix-Rousse', 'le titre est enregistré sans ses espaces de bord');
  assert.equal(d.frais_notaire, 11760,
    'Les frais de notaire suivent le PRIX AFFICHÉ (7 %), comme l\'édition en ligne de la fiche.');
  assert.equal(d.assurance_logement, 0, 'Une assurance VIDÉE est une réponse : « ||33 » la réécrivait.');
  assert.equal(d.duree_credit_ans, 25);
  assert.equal(d.creation_sci, 0, 'un bien en propre ne porte pas de frais de SCI');
  assert.ok(!SRC.includes("'f-ha'"), 'le champ « Prix HA », enregistré nulle part, est revenu');

  // Témoin : la détention SCI applique la règle du premier bien.
  formulaire(ctx, { 'f-titre': 'X', 'f-type': 'T2', 'f-prix': '100 000', 'f-sci-id': '7bd53e38-47c6-49fe-8c89-78ceb0197b03' });
  assert.equal(ctx.getFormData().creation_sci, lire(ctx, 'SF_FRAIS_CREATION_SCI'));
});

// ─── La synthèse ne calcule rien elle-même ─────────────────────────────────

test('une fiche vide n\'affiche aucun cashflow', () => {
  /* L'assurance se préremplit (33 €) : l'ancien aperçu en tirait
     « −33 €/mois » sur une fiche où rien d'autre n'était saisi. */
  const ctx = app();
  formulaire(ctx, { 'f-assurance': '33', 'f-statut': 'Renseignements Web' });
  const s = ctx.sfnSynthese();
  assert.equal(s.cf.val, 'Non disponible', 'Un cashflow s\'affiche sur une fiche vide : un chiffre inventé.');
  assert.match(s.cf.sub, /prix/, 'la synthèse dit ce qui manque');
  assert.equal(s.rendement, null);

  // Témoin positif : complète, la fiche est chiffrée par les fonctions de la fiche.
  formulaire(ctx, { 'f-assurance': '33', 'f-statut': 'Renseignements Web', 'f-ville': 'Lyon',
    'f-prix': '168 000', 'f-loyer': '780', 'f-titre': 'T2', 'f-type': 'T2' });
  const p = ctx.sfnSynthese();
  assert.equal(p.cf.val, '+' + ctx.sfEur(747), 'cashflow prévisionnel : 780 de loyer moins 33 d\'assurance');
  assert.equal(p.total, 168000 + 11760, 'coût total : prix et frais de notaire (mfMontantAcquisition)');
  assert.equal(Array.from(p.manque).length, 0);
});

test('la synthèse passe par les fonctions de la fiche, et la fiche par la même rédaction', () => {
  const syn = corps('sfnSynthese');
  for (const f of ['cfDisplayData(', 'sfRendement(', 'mfMontantAcquisition(', 'sfManquants(', 'sfResumeCashflow(']) {
    assert.ok(syn.includes(f), `sfnSynthese ne passe plus par ${f}) : une formule recopiée finit par diverger.`);
  }
  assert.doesNotMatch(corps('sfnMaj') + syn, /computeCF\(|loyer_en_etat\s*[-*]/,
    'le formulaire recalcule de nouveau un cashflow ou un rendement à sa façon');
  assert.match(corps('renderBienDetail'), /sfResumeCashflow\(dHero\)/,
    'La fiche ne résume plus son cashflow par sfResumeCashflow : fiche et formulaire divergeront.');
});

// ─── L'enregistrement ──────────────────────────────────────────────────────

test('un montant illisible ou un titre absent sont refusés, avec leur raison', async () => {
  const ctx = app();
  formulaire(ctx, { 'f-titre': '', 'f-type': 'T2', 'f-mensualite': '12 a' });
  const erreurs = Array.from(ctx.sfnValider(), e => Array.from(e));
  assert.deepEqual(erreurs.map(e => e[0]), ['f-titre', 'f-mensualite']);
  assert.match(erreurs[1][1], /« 12 a » n'est pas un nombre/, 'l\'erreur doit citer ce qui a été saisi');
  const appels = dbEnregistreur(ctx);
  await ctx.saveBien();
  assert.equal(appels.length, 0, 'une fiche refusée ne part pas en base');
});

test('RÉGRESSION — un double appui sur « Ajouter » ne crée qu\'un bien', async () => {
  const ctx = app();
  formulaire(ctx, { 'f-titre': 'T2 Lyon', 'f-type': 'T2', 'f-statut': 'Renseignements Web', 'f-prix': '168 000' });
  const appels = dbEnregistreur(ctx, (table, ops) =>
    (table === 'biens' && ops.some(o => o[0] === 'insert') ? { data: { id: 'b-neuf' } } : { data: [] }));
  await Promise.all([ctx.saveBien(), ctx.saveBien()]);
  assert.equal(appels.filter(x => x.table === 'biens' && a(x, 'insert')).length, 1,
    'Deux biens créés pour un double appui : saveBien doit refuser un envoi pendant un autre.');
});

test('RÉGRESSION — après un échec d\'envoi des fichiers, un nouvel appui met à jour le bien', async () => {
  const ctx = app();
  formulaire(ctx, { 'f-titre': 'T2 Lyon', 'f-type': 'T2', 'f-statut': 'Renseignements Web' });
  let echec = true;
  const appels = dbEnregistreur(ctx, (table, ops) => {
    if (table === 'biens' && ops.some(o => o[0] === 'insert')) return { data: { id: 'b-neuf' } };
    if (table === 'biens' && ops.some(o => o[0] === 'update') && echec) { echec = false; return { data: null, error: { message: 'réseau' } }; }
    return { data: [] };
  });
  await ctx.saveBien();
  assert.equal(lire(ctx, 'editingId'), 'b-neuf', 'le bien créé doit devenir le bien en cours de modification');
  await ctx.saveBien();
  const inserts = appels.filter(x => x.table === 'biens' && a(x, 'insert')).length;
  assert.equal(inserts, 1, 'Le second appui a créé un second bien au lieu de mettre à jour le premier.');
});

test('quitter une fiche modifiée demande confirmation', async () => {
  const ctx = app();
  let quitte = 0, question = 0;
  ctx.navigate = () => { quitte++; };
  ctx.sfConfirmer = async () => { question++; return false; };
  injecter(ctx, { sfnModifie: true, sfnRetour: { page: 'biens' } });
  await ctx.sfnQuitter();
  assert.equal(question, 1, 'Une saisie se perd sans un mot : sfnQuitter doit confirmer.');
  assert.equal(quitte, 0, 'refuser la confirmation garde la fiche ouverte');
  injecter(ctx, { sfnModifie: false });
  await ctx.sfnQuitter();
  assert.deepEqual([question, quitte], [1, 1], 'témoin : sans saisie, on quitte sans question');
});

// ─── Le rendu ──────────────────────────────────────────────────────────────

function ecran() {
  return { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
}

test('RÉGRESSION — un rendu périmé n\'écrase pas la fiche en cours', async () => {
  /* editBien dessinait la fiche VIDE puis celle du bien ; les deux
     attendaient les SCI. Réponses dans l'autre ordre : la fiche vide gagnait,
     et enregistrer créait un second bien. */
  const ctx = app();
  formulaire(ctx, {});
  const bien = { id: 'r1', titre: 'T2 Lyon', type_bien: 'T2', statut: 'Renseignements Web', prix_affiche: 168000 };
  injecter(ctx, { currentPage: 'nouveau', allBiens: [bien] });
  const attentes = [];
  ctx.loadSCIList = () => new Promise(ok => attentes.push(ok));
  const el = ecran();
  const vide = ctx.renderNouveau(el, null, 'biens');
  const modif = ctx.renderNouveau(el, bien, 'bien-detail');
  attentes[1]();  await modif;   // la seconde réponse arrive d'abord
  attentes[0]();  await vide;
  assert.equal(lire(ctx, 'editingId'), 'r1', 'Le rendu périmé (fiche vide) a écrasé la fiche du bien.');
  assert.match(el.innerHTML, /Modifier la fiche/);
});

test('editBien ne dessine qu\'une fois, et confie le bien à navigate', () => {
  const ctx = app();
  const bien = { id: 'r1', titre: 'T2 Lyon', type_bien: 'T2', statut: 'Renseignements Web' };
  injecter(ctx, { allBiens: [bien] });
  ctx.navigate = ctx.vraiNavigate;   // le vrai navigate, cette fois
  const rendus = [];
  ctx.renderNouveau = (el, b, precedente) => { rendus.push([b && b.id, precedente]); };
  injecter(ctx, { currentPage: 'bien-detail' });
  ctx.editBien('r1');
  assert.deepEqual(rendus, [['r1', 'bien-detail']],
    'editBien doit produire UN rendu, celui du bien — pas une fiche vide suivie d\'un second rendu.');
  assert.doesNotMatch(corps('editBien'), /setTimeout/);
});

test('chaque colonne de TI_BIENS a son champ dans la fiche, avec son libellé', async () => {
  const ctx = app();
  formulaire(ctx, {});
  injecter(ctx, { currentPage: 'nouveau' });
  const el = ecran();
  await ctx.renderNouveau(el, null, 'biens');
  const html = el.innerHTML;
  const champs = Array.from(lire(ctx, 'TI_BIENS.CHAMPS'));
  assert.ok(champs.length > 20, 'témoin : la liste des colonnes doit être lue');
  const absents = champs.filter(c => !html.includes(`data-k="${c.k}"`)).map(c => c.k);
  assert.deepEqual(absents, [], `Colonnes sans champ dans la fiche : ${absents.join(', ')}`);
  for (const c of champs) {
    assert.ok(html.includes(ctx.esc(c.lab)), `le libellé « ${c.lab} » ne vient plus de TI_BIENS`);
  }
  const inconnus = Array.from(lire(ctx, 'SFN_SECTIONS'))
    .flatMap(s => Array.from(s.champs, f => f.k)).filter(k => k !== 'detention' && !champs.some(c => c.k === k));
  assert.deepEqual(inconnus, [], 'la fiche porte un champ que TI_BIENS ne connaît pas');
});

test('les montants ne sont plus des champs `type="number"`, et une seule action principale', async () => {
  const ctx = app();
  formulaire(ctx, {});
  injecter(ctx, { currentPage: 'nouveau' });
  const el = ecran();
  await ctx.renderNouveau(el, null, 'biens');
  assert.doesNotMatch(el.innerHTML, /type="number"/,
    '`type="number"` refuse « 168 000 » et fait dépendre la virgule du navigateur.');
  const decimaux = (el.innerHTML.match(/class="sf-input sfn-nombre" id="[^"]+" type="text"\s+inputmode="(decimal|numeric)"/g) || []).length;
  assert.equal(decimaux, NOMBRES.length, 'chaque montant doit être un champ texte au clavier numérique');
  assert.equal((el.innerHTML.match(/sf-btn--primary/g) || []).length, 1,
    'Deux boutons « Ajouter » : un seul se désactivait pendant l\'envoi.');
});

test('à la modification, les vignettes se dessinent par leur URL signée', async () => {
  const ctx = app();
  const grille = { innerHTML: '' };
  ctx.document.getElementById = id => (id === 'bien-photos-grid' ? grille : null);
  lire(ctx, 'TI_STORAGE').signedUrl = async () => 'https://exemple.supabase.co/signe/salon.jpg';
  injecter(ctx, { bienPhotos: [{ kind: 'storage', bucket: 'biens-photos', path: 'u1/r1/salon.jpg', name: 'salon.jpg' }] });
  await ctx.refreshBienPhotos();
  assert.match(grille.innerHTML, /src="https:\/\/exemple\.supabase\.co\/signe\/salon\.jpg"/);
  assert.doesNotMatch(grille.innerHTML, /\[object Object\]/);
  // Et le rendu de la fiche les confie à cette fonction plutôt que de les écrire lui-même.
  const rendu = corps('renderNouveau');
  assert.match(rendu, /refreshBienPhotos\(\);/, 'renderNouveau ne dessine plus les vignettes par refreshBienPhotos');
  assert.doesNotMatch(rendu, /<img/, 'renderNouveau écrit de nouveau ses propres <img> : `src="[object Object]"`');
});

// ─── La suppression d'un bien de test ──────────────────────────────────────

test('supprimer un bien de TEST emporte ses locataires ; un vrai bien garde les siens', async () => {
  for (const deTest of [true, false]) {
    const ctx = app();
    const b = { id: 'b1', titre: 'T3 Nice — Test', is_test: deTest, photos_paths: [], documents_paths: [] };
    injecter(ctx, { allBiens: [b] });
    ctx.sfConfirmer = async () => true;
    lire(ctx, 'TI_STORAGE').remove = async () => {};
    const appels = dbEnregistreur(ctx, (table, ops) =>
      (table === 'locataires' && ops.some(o => o[0] === 'select') ? { data: [{ id: 'l1', documents: [] }] } : { data: [] }));
    await ctx.deleteBienPage('b1');
    const iLoc = appels.findIndex(x => x.table === 'locataires' && a(x, 'delete'));
    const iBien = appels.findIndex(x => x.table === 'biens' && a(x, 'delete'));
    assert.ok(iBien > -1, 'témoin : le bien est supprimé');
    if (deTest) {
      assert.ok(iLoc > -1 && iLoc < iBien,
        'Les locataires d\'un bien de test restent, sans bien — et entrent alors dans les vrais chiffres.');
      assert.deepEqual(appels[iLoc].ops.find(o => o[0] === 'eq'), ['eq', 'user_id', 'u1']);
    } else {
      assert.equal(iLoc, -1, 'un vrai bien garde ses locataires (ON DELETE SET NULL, voulu)');
    }
  }
});
