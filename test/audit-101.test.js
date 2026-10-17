/* ═══════════════════════════════════════════════════════════════════════════
   GARDES DE L'AUDIT DU 16/10/2026 (v=101)
   Chaque test tient un défaut trouvé par l'audit complet de la v=100, et a été
   validé PAR MUTATION : l'ancien code réintroduit, le test tombe.
   ═══════════════════════════════════════════════════════════════════════════ */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app.js');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');

// Commentaires blanchis : ceux du dépôt citent le défaut qu'ils corrigent.
const LEURRES = ['image/*', 'audio/*', 'video/*', '*/*'];
function sansCommentaires(src) {
  const brut = LEURRES.reduce((t, l) => t.split(l).join(l.replace('*', 'x')), src);
  const c = brut.split('');
  const blanchir = (d, f) => { for (let k = d; k < f; k++) if (c[k] !== '\n') c[k] = ' '; };
  for (const m of brut.matchAll(/\/\*[\s\S]*?\*\//g)) blanchir(m.index, m.index + m[0].length);
  const t = c.join('');
  for (const m of t.matchAll(/(?<=^|[\s;{}(),])\/\/[^\n]*/g)) blanchir(m.index, m.index + m[0].length);
  return c.join('');
}
const CODE = sansCommentaires(SRC);

const BIEN = { user_id: 'u1', statut: 'Renseignements Web', is_test: false, created_at: '2026-06-01' };

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 16, 12) });
  ctx.showNotif = () => {};
  ctx.navigate = () => {};
  return ctx;
}

/* Un client Supabase qui ENREGISTRE chaque requête (table, opérations, ordre)
   et répond selon la table. Le stockage est enregistré à part. */
function dbEnregistreur(ctx, repondre = () => []) {
  const journal = [];
  const db = lire(ctx, 'db');
  db.from = (table) => {
    const ops = [];
    journal.push({ table, ops });
    const q = new Proxy({}, { get(_, prop) {
      if (prop === 'then') {
        const data = repondre(table, ops);
        return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
      }
      return (...args) => { ops.push([prop, ...args]); return q; };
    } });
    return q;
  };
  db.storage = { from: (bucket) => ({
    remove: async (chemins) => { journal.push({ stockage: bucket, chemins }); return { error: null }; },
    // v=102 : le dossier de la SCI contient aussi un fichier sans ligne (déposé deux fois).
    list: async (dossier) => ({ data: [{ id: 'f1', name: 'orphelin.pdf' }, { id: null, name: 'sous-dossier' }], error: null }),
  }) };
  return journal;
}
const op = (appel, nom) => appel.ops.find(o => o[0] === nom);

// ─── Mes biens : « Grouper par type » ───────────────────────────────────────

test('le kanban groupé par type se dessine (ReferenceError TYPES avant la v=101)', () => {
  const ctx = app();
  const biens = [{ ...BIEN, id: 'b1', titre: 'T2 Lyon', type_bien: 'T2', code_postal: '69004' },
                 { ...BIEN, id: 'b2', titre: 'Studio Nice', type_bien: 'Studio', code_postal: '06000' },
                 { ...BIEN, id: 'b3', titre: 'Sans type', type_bien: 'Château', code_postal: '69008' }];
  injecter(ctx, { allBiens: biens, kanbanGroup: 'type' });
  const h = ctx.renderKanban(biens);
  assert.match(h, /T2 Lyon/, 'témoin : les cartes sont là');
  assert.match(h, /Studio Nice/);
  assert.match(h, /Non renseigné/, 'un type hors registre tombe dans « Non renseigné »');
  // Et les deux autres regroupements restent intacts.
  for (const g of ['phase', 'ville']) {
    injecter(ctx, { kanbanGroup: g });
    assert.match(ctx.renderKanban(biens), /T2 Lyon/, `kanban groupé par ${g}`);
  }
});

// ─── Marché : un contrôle sans effet n'est pas affiché ─────────────────────

test('l\'analyse de marché ne propose plus un « Type de bien » qui ne filtrait rien', () => {
  const ctx = app();
  const el = { innerHTML: '' };
  ctx.renderMarcheRecherche(el);
  assert.match(el.innerHTML, /id="marche-ville-input"/, 'témoin : la recherche de commune est là');
  assert.doesNotMatch(el.innerHTML, /marche-type-bien|Tous types/);
  assert.doesNotMatch(CODE, /marche-type-bien/, 'plus aucune lecture du sélecteur retiré');
});

// ─── Utilisateurs : un compte en attente se valide, il ne se « réinvite » pas ─

test('un compte en attente propose « Valider », plus « Renvoyer l\'invitation »', () => {
  const ctx = app();
  const h = ctx.buildUserRowsHtml([
    { id: 'p3', email: 'inscrit@exemple.fr', first_name: '', last_name: '', role: 'user', status: 'pending', created_at: '2026-10-01' },
    { id: 'p2', email: 'actif@exemple.fr', first_name: 'Ana', last_name: 'B', role: 'user', status: 'active', created_at: '2026-09-01' },
  ], 'admin@exemple.fr');
  assert.match(h, /admin-validate-btn[^>]*data-id="p3"/, 'témoin : le compte en attente se valide');
  assert.match(h, /admin-resetpwd-btn/, 'témoin : un compte actif garde « Reset »');
  assert.doesNotMatch(h, /admin-resend-btn|Renvoyer/, 'le bouton qui validait en silence sans envoyer de mail');
  assert.doesNotMatch(CODE, /adminResendInvite/, 'plus de chemin vers l\'ancienne fonction');
});

// ─── Données d'administration de test : la purge ne vise que l'exact ───────

test('la purge des données d\'administration de test ne vise que ce que le générateur écrit', async () => {
  const ctx = app();
  injecter(ctx, { currentUser: { id: 'u1' }, allBiens: [], allSCI: [] });
  ctx.sfConfirmer = async () => true;
  ctx.loadAdminData = async () => {};
  ctx.switchAdminTab = () => {};
  const journal = dbEnregistreur(ctx, (table, ops) => {
    if (table === 'sci' && ops[0][0] === 'select') return [{ id: 's-test' }];
    if (table === 'sci_documents') return [{ pdf_path: 'u1/s-test/statuts.pdf' }];
    return [];
  });
  await ctx.purgeAdminTestData();
  const req = journal.filter(j => j.table);
  // Aucun filtre approché : « attestation » contient « test », « SCI Testard » aussi.
  assert.ok(req.length >= 4, 'témoin : la purge a bien interrogé la base');
  assert.ok(!req.some(j => op(j, 'ilike') || op(j, 'like')), 'aucun ilike/like dans la purge');
  const lectureSci = req.find(j => j.table === 'sci' && op(j, 'select'));
  assert.deepEqual(op(lectureSci, 'eq').slice(1), ['user_id', 'u1']);
  assert.ok(lectureSci.ops.some(o => o[0] === 'eq' && o[1] === 'notes' && o[2] === 'SCI de test — à supprimer'));
  const supprSci = req.find(j => j.table === 'sci' && op(j, 'delete'));
  assert.deepEqual(Array.from(op(supprSci, 'in')[2]), ['s-test'], 'la SCI supprimée est celle qu\'on a lue, par son id');
  const ech = req.find(j => j.table === 'sci_echeances' && op(j, 'delete'));
  assert.ok(ech.ops.some(o => o[0] === 'eq' && o[1] === 'notes' && o[2] === 'Échéance test'));
  // Le générateur et la purge parlent la même langue.
  assert.equal(lire(ctx, 'SF_TEST_ADMIN').echeance, 'Échéance test');
  // Les PDF de la SCI partent APRÈS ses lignes.
  const iFichiers = journal.findIndex(j => j.stockage === 'sci-documents');
  const iSuppr = journal.indexOf(supprSci);
  assert.ok(iFichiers > iSuppr, 'les fichiers partent après la ligne de la SCI');
  assert.deepEqual(Array.from(journal[iFichiers].chemins), ['u1/s-test/statuts.pdf', 'u1/s-test/orphelin.pdf'],
    'le document ET le fichier sans ligne de son dossier');
});

test('supprimer une SCI efface aussi ses PDF du stockage, après sa ligne', async () => {
  const ctx = app();
  injecter(ctx, { currentUser: { id: 'u1' }, currentSCIId: 's1',
                  allSCI: [{ id: 's1', nom_sci: 'SCI Monplaisir' }], allBiens: [] });
  ctx.sfConfirmer = async () => true;
  ctx.loadAdminData = async () => {};
  ctx.switchAdminTab = () => {};
  ctx.closeSCIModal = () => {};
  const bouton = { disabled: false };
  ctx.document.getElementById = id => (id === 'sci-btn-delete' ? bouton : null);
  const journal = dbEnregistreur(ctx, (table) => table === 'sci_documents'
    ? [{ pdf_path: 'u1/s1/kbis.pdf' }, { pdf_path: null }] : []);
  await ctx.deleteSCI();
  const iSuppr = journal.findIndex(j => j.table === 'sci' && op(j, 'delete'));
  const iFichiers = journal.findIndex(j => j.stockage === 'sci-documents');
  assert.ok(iSuppr >= 0, 'témoin : la SCI est supprimée');
  assert.ok(iFichiers > iSuppr, 'ses fichiers partent, après elle');
  assert.deepEqual(Array.from(journal[iFichiers].chemins), ['u1/s1/kbis.pdf', 'u1/s1/orphelin.pdf'],
    'v=102 : tout le dossier de la SCI, pas seulement ses documents enregistrés');
});

test('une suppression refusée par la base ne s\'annonce pas réussie', async () => {
  const ctx = app();
  injecter(ctx, { currentUser: { id: 'u1' }, allBiens: [], allSCI: [] });
  ctx.sfConfirmer = async () => true;
  ctx.loadAdminData = async () => {};
  ctx.switchAdminTab = () => {};
  const notes = [];
  ctx.showNotif = (m, err) => notes.push([m, !!err]);
  // Les lectures passent, les SUPPRESSIONS sont refusées : Supabase ne lève
  // pas, il rend { error } — c'est ce chemin-là que la purge ignorait.
  const db = lire(ctx, 'db');
  let suppressions = 0;
  db.from = () => { let supprime = false; const q = new Proxy({}, { get(_, p) {
    if (p === 'then') { if (supprime) suppressions++;
      return (res) => Promise.resolve(supprime ? { data: null, error: { message: 'refusé' } } : { data: [], error: null }).then(res); }
    return () => { if (p === 'delete') supprime = true; return q; }; } }); return q; };
  db.storage = { from: () => ({ remove: async () => ({ error: null }) }) };
  await ctx.purgeAdminTestData();
  assert.ok(suppressions >= 1, 'témoin : une suppression a bien été tentée');
  assert.ok(notes.length, 'témoin : un message est affiché');
  assert.ok(notes.every(([, err]) => err), 'aucun « supprimé » sur un refus : ' + JSON.stringify(notes));
});

// ─── Dépendances ───────────────────────────────────────────────────────────

test('supabase-js est épinglé à une version exacte', () => {
  // v=102 : hébergé dans vendor/, la version est dans le nom du dossier.
  const m = INDEX.match(/<script src="vendor\/supabase-js-([^"/]+)\/supabase\.js"/);
  assert.ok(m, 'témoin : le script de supabase-js est chargé depuis vendor/');
  assert.match(m[1], /^\d+\.\d+\.\d+$/, `version flottante « ${m[1]} » : une sortie de la veille part en production sans test`);
});

test('pdf.js ne compile pas les polices d\'un PDF en code (CVE-2024-4367)', () => {
  const appels = [...CODE.matchAll(/getDocument\(\{([^}]*)\}\)/g)].map(m => m[1]);
  assert.ok(appels.length >= 1, 'témoin : la lecture de l\'offre PDF existe');
  for (const a of appels) assert.match(a, /isEvalSupported:\s*false/);
});

// ─── Chargement : au-delà de 1 000 lignes, rien ne disparaît ───────────────

test('les loyers et les charges se lisent en entier, au-delà de 1 000 lignes', async () => {
  const ctx = app();
  injecter(ctx, { currentUser: { id: 'u1' }, allBiens: [], sfBiensCharges: true, sfTestsChoix: null });
  const journal = [];
  // La base plafonne chaque réponse à 1 000 lignes, comme PostgREST.
  const stock = { loyers_mensuels: 2345, charges_reelles: 12 };
  lire(ctx, 'db').from = (table) => {
    const ops = []; journal.push({ table, ops });
    const q = new Proxy({}, { get(_, p) {
      if (p === 'then') {
        const r = ops.find(o => o[0] === 'range');
        const [d, f] = r ? [r[1], r[2]] : [0, 999];
        const n = Math.max(0, Math.min(stock[table], f + 1, d + 1000) - d);
        const data = Array.from({ length: n }, (_, i) => ({ id: `${table}-${d + i}`, bien_id: null, annee: 2020, mois: 1 }));
        return (res) => Promise.resolve({ data, error: null }).then(res);
      }
      return (...a) => { ops.push([p, ...a]); return q; };
    } });
    return q;
  };
  await ctx.loadMfFinancialData();
  assert.equal(lire(ctx, 'allLoyers').length, 2345, 'toutes les lignes de loyers, pas les 1 000 premières');
  assert.equal(lire(ctx, 'allCharges').length, 12, 'témoin : une petite table se lit en une page');
  assert.equal(new Set(Array.from(lire(ctx, 'allLoyers')).map(l => l.id)).size, 2345, 'aucune ligne lue deux fois');
  const loyers = journal.filter(j => j.table === 'loyers_mensuels');
  assert.equal(loyers.length, 3, 'trois pages');
  for (const j of journal) assert.ok(j.ops.some(o => o[0] === 'order' && o[1] === 'id'), `${j.table} : l'id départage l'ordre`);
});

// ─── Un loyer dû le 30 n'est pas en retard le 29 ────────────────────────────

test('un loyer dû en fin de mois n\'est en retard que le lendemain de son échéance', () => {
  const loc = { id: 'l1', bien_id: 'b1', jour_paiement: 30, date_entree: '2025-01-01', statut: 'Actif' };
  const ligne = { statut: 'En attente', loyer_du: 800 };
  const etat = (quand, mois, annee) => charger({ maintenant: quand }).sfLoyerEtat(ligne, mois, annee, loc);
  assert.equal(etat(new Date(2026, 9, 29, 12), 10, 2026), 'avenir', 'le 29 octobre, un loyer dû le 30 n\'est pas en retard');
  assert.equal(etat(new Date(2026, 9, 30, 12), 10, 2026), 'avenir', 'le jour même non plus');
  assert.equal(etat(new Date(2026, 9, 31, 12), 10, 2026), 'ko', 'témoin : le 31, il l\'est');
  // Février n'a pas de 30 : l'échéance tombe le dernier jour du mois.
  assert.equal(etat(new Date(2027, 1, 28, 12), 2, 2027), 'avenir');
  assert.equal(etat(new Date(2027, 2, 1, 12), 2, 2027), 'ko', 'dû le 28 février, en retard le 1er mars');
  const ctx = app();
  assert.equal(ctx.sfJourEcheance({ jour_paiement: 31 }, 4, 2026), 30);
  assert.equal(ctx.sfJourEcheance({ jour_paiement: 31 }, 2, 2028), 29, 'année bissextile');
  assert.equal(ctx.sfJourEcheance({}, 10, 2026), 5, 'sans jour saisi : le 5, comme avant');
  assert.equal(ctx.sfJourEcheance({ jour_paiement: 5 }, 10, 2026), 5, 'témoin : un loyer dû le 5 ne bouge pas');
});

// ─── Échappement : la ville d'une carte du kanban ──────────────────────────

test('la carte du kanban échappe la ville et le code postal (seule injection trouvée au banc)', () => {
  const ctx = app();
  const piege = '"><img src=x onerror="alert(1)">';
  const b = { ...BIEN, id: 'b1', titre: 'T2 Lyon', type_bien: 'T2', ville: 'Lyon' + piege, code_postal: '69' + piege };
  injecter(ctx, { allBiens: [b] });
  const h = ctx.renderKanbanCard(b, true);
  assert.match(h, /Lyon&quot;&gt;&lt;img/, 'témoin : la ville est bien affichée, échappée');
  assert.doesNotMatch(h, /<img src=x/, 'aucune balise injectée ne passe');
});
