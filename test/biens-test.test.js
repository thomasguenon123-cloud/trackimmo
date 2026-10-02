/* LES BIENS DE TEST SORTENT DES CHIFFRES — la v=94, étape 0 du fil rouge.

   ⚠️ LE DÉFAUT QUI JUSTIFIE CE FICHIER. `is_test` ne peignait qu'un ruban.
   Mesuré en base le 02/10/2026 : le compte administrateur portait cinq fiches
   de test, dont trois « Acheté », avec deux locataires, 28 loyers et une
   charge — toute sa gestion locative était factice, et ses indicateurs la
   comptaient comme vraie. Ce compte devient celui d'un vrai investissement.

   Ce que ces gardes tiennent :
     · une seule règle décide quels biens comptent (`sfBienCompte`), et ses
       fonctions sont les seules à lire le drapeau ;
     · l'interrupteur « Inclure les biens de test » ne vaut que pour un
       administrateur — un choix resté dans le navigateur ne change rien
       pour un autre compte ;
     · les loyers, charges et locataires suivent leur bien, dès le chargement ;
     · accueil, gestion, déclaration et exports ne voient plus les fiches de
       test ; la liste des biens les garde, marquées ;
     · seul un administrateur fabrique de la donnée de test ; la purge
       emporte aussi les locataires, que la base aurait laissés orphelins.

   Les gardes sont validées par mutation le 02/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');

const ADMIN = { currentUser: { id: 'u-admin', email: 'admin@exemple.fr' }, currentProfile: { role: 'admin' } };
const MEMBRE = { currentUser: { id: 'u-membre', email: 'membre@exemple.fr' }, currentProfile: { role: 'user' } };

/* Deux biens acquis dans la même SCI : l'un vrai, l'autre de test. Le vrai est
   vacant — un bien vacant se compte, son cashflow est connu. */
const BASE = { statut: 'Acheté', mode_detention: 'sci', sci_id: 'sci-1', ville: 'Lyon',
  type_bien: 'T2', surface_m2: 45, prix_affiche: 150000, loyer_en_etat: 700,
  mensualite_credit: 600, charge_copro: 20, assurance_logement: 15, taxe_fonciere: 50 };
const REEL = { ...BASE, id: 'b-reel', titre: 'T2 Lyon', is_test: false };
const TEST = { ...BASE, id: 'b-test', titre: 'T3 Nice — Test', ville: 'Nice', is_test: true };

function app({ profil = ADMIN, inclure = false, biens = [REEL, TEST] } = {}) {
  const ctx = charger({ maintenant: new Date(2026, 9, 2, 12) });
  const stock = new Map(inclure ? [['sf-inclure-tests', '1']] : []);
  ctx.localStorage = {
    getItem: k => (stock.has(k) ? stock.get(k) : null),
    setItem: (k, v) => stock.set(k, String(v)),
    removeItem: k => stock.delete(k), clear: () => stock.clear(),
  };
  ctx.showNotif = () => {};
  ctx.navigate = () => {};
  injecter(ctx, { ...profil, sfTestsChoix: null, allBiens: biens.map(b => ({ ...b })),
                  sfBiensCharges: true, allLoyers: [], allCharges: [], allLocataires: [], allSCI: [] });
  return { ctx, stock };
}

/* Un client Supabase qui ENREGISTRE ce qu'on lui demande et répond selon la
   table. `db` est une constante d'app.js, mais l'objet qu'elle désigne se
   modifie : on remplace sa méthode `from`. */
function dbEnregistreur(ctx, repondre = () => []) {
  const appels = [];
  lire(ctx, 'db').from = (table) => {
    const ops = [];
    appels.push({ table, ops });
    const q = new Proxy({}, { get(_, prop) {
      if (prop === 'then') {
        const data = repondre(table, ops);
        return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
      }
      return (...args) => { ops.push([prop, ...args]); return q; };
    } });
    return q;
  };
  return appels;
}
const a = (appel, op) => appel.ops.some(o => o[0] === op);
const arg = (appel, op) => appel.ops.find(o => o[0] === op);

/* Le source, commentaires BLANCHIS (même logique que emojis.test.js). Les
   commentaires de ce dépôt citent le défaut qu'ils corrigent — « `is_test` ne
   peignait qu'un ruban » : une garde qui lit le texte brut s'accuse elle-même.
   Les LEURRES sont des littéraux qui ressemblent à une ouverture de commentaire. */
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

// Chaque fonction de premier niveau et son corps, dans le source blanchi.
function fonctions(code) {
  const re = /^(?:async )?function ([A-Za-z0-9_$]+)\s*\(/gm;
  const pos = [...code.matchAll(re)].map(m => [m.index, m[1]]);
  return pos.map(([d, nom], i) => [nom, code.slice(d, i + 1 < pos.length ? pos[i + 1][0] : undefined)]);
}
const corps = nom => {
  const f = fonctions(CODE).find(([n]) => n === nom);
  assert.ok(f, `fonction ${nom} introuvable`);
  return f[1];
};

// ─── La règle et son cloisonnement ─────────────────────────────────────────

test('un bien de test ne compte pas, sauf si un administrateur l\'inclut', () => {
  const { ctx } = app();
  assert.equal(ctx.sfBienCompte(TEST), false,
    'Un bien de test entre de nouveau dans les chiffres : `is_test` ne doit pas être un simple ruban.');
  assert.equal(ctx.sfBienCompte(REEL), true, 'témoin : un vrai bien compte toujours');
  assert.equal(ctx.sfBienCompte({ id: 'x', is_test: null }), true, 'un drapeau absent n\'est pas un bien de test');

  assert.equal(app({ inclure: true }).ctx.sfBienCompte(TEST), true,
    'L\'interrupteur « Inclure les biens de test » doit les réintégrer pour un administrateur.');
});

test('CLOISONNEMENT — le réglage d\'un administrateur ne vaut rien pour un autre compte', () => {
  /* Le choix vit dans le navigateur. Un membre qui se connecte après une
     session admin, sur le même appareil, ne doit pas en hériter. */
  const { ctx } = app({ profil: MEMBRE, inclure: true });
  assert.equal(ctx.sfTestsInclus(), false,
    'Un non-administrateur lit le réglage « inclure les biens de test » : sfTestsInclus doit d\'abord vérifier le rôle.');
  assert.equal(ctx.sfBienCompte(TEST), false);
});

test('seul un administrateur peut basculer l\'interrupteur', async () => {
  const membre = app({ profil: MEMBRE });
  await membre.ctx.sfInclureTests(true);
  assert.equal(membre.stock.size, 0, 'Un non-administrateur a pu enregistrer le réglage.');
  assert.equal(lire(membre.ctx, 'sfTestsChoix'), null);

  const admin = app();
  dbEnregistreur(admin.ctx);
  await admin.ctx.sfInclureTests(true);
  assert.equal(admin.stock.get('sf-inclure-tests'), '1', 'témoin : un administrateur enregistre son choix');
  assert.equal(admin.ctx.sfBienCompte(TEST), true);
  await admin.ctx.sfInclureTests(false);
  assert.equal(admin.stock.size, 0);
  assert.equal(admin.ctx.sfBienCompte(TEST), false);
});

test('l\'interrupteur est dans Maintenance, et le bandeau rappelle quand il est actif', () => {
  assert.match(corps('paramsMaintenanceHtml'), /onchange="sfInclureTests\(this\.checked\)"/,
    'L\'interrupteur « Inclure les biens de test » a quitté Paramètres › Maintenance.');
  /* Un chiffre gonflé de données factices ne doit jamais passer pour un vrai :
     le rappel est du TEXTE visible — un `title` ne s'affiche pas au doigt. */
  const bouton = INDEX.match(/<button[^>]*id="sf-tests-inclus"[\s\S]*?<\/button>/);
  assert.ok(bouton, 'le rappel « Biens de test inclus » a disparu du bandeau');
  assert.match(bouton[0], /<span>Biens de test inclus<\/span>/, 'le rappel doit être écrit, pas seulement titré');
  assert.match(bouton[0], /onclick="sfInclureTests\(false\)"/);
  assert.match(corps('sfRefreshTopnav'), /sf-tests-inclus[\s\S]{0,160}sfTestsInclus\(\)/,
    'sfRefreshTopnav ne règle plus l\'affichage du rappel sur sfTestsInclus().');
});

// ─── Les lignes suivent leur bien ──────────────────────────────────────────

test('un loyer, une charge ou un locataire suit son bien', () => {
  const lignes = [{ id: 1, bien_id: 'b-test' }, { id: 2, bien_id: 'b-reel' }, { id: 3, bien_id: null }];
  const ids = c => Array.from(c.sfLignesComptees(lignes), l => l.id);
  assert.deepEqual(ids(app().ctx), [2, 3],
    'Les lignes d\'un bien de test doivent sortir ; une ligne sans bien reste (rien ne la dit factice).');
  assert.deepEqual(ids(app({ inclure: true }).ctx), [1, 2, 3], 'témoin : tout revient avec l\'interrupteur');
});

test('les chargeurs filtrent les lignes des biens de test, biens chargés d\'abord', async () => {
  const { ctx } = app({ biens: [] });
  injecter(ctx, { sfBiensCharges: false });
  const lignes = [{ id: 'l-test', bien_id: 'b-test' }, { id: 'l-reel', bien_id: 'b-reel' }];
  const appels = dbEnregistreur(ctx, table => (table === 'biens' ? [REEL, TEST] : lignes));

  await ctx.loadLocataires();
  assert.equal(appels[0].table, 'biens',
    'Le filtre a besoin des biens : sans eux, il laisse tout passer. loadLocataires doit les charger d\'abord.');
  assert.deepEqual(Array.from(lire(ctx, 'allLocataires'), l => l.id), ['l-reel'],
    'loadLocataires garde les locataires des biens de test.');

  await ctx.loadMfFinancialData();
  assert.deepEqual(Array.from(lire(ctx, 'allLoyers'), l => l.id), ['l-reel'], 'loadMfFinancialData garde les loyers de test.');
  assert.deepEqual(Array.from(lire(ctx, 'allCharges'), l => l.id), ['l-reel'], 'loadMfFinancialData garde les charges de test.');
});

// ─── Les écrans qui agrègent ───────────────────────────────────────────────

test('la gestion locative ne voit plus les biens de test', () => {
  const ids = c => Array.from(c.mfBiensExercice(2026), b => b.id);
  assert.deepEqual(ids(app().ctx), ['b-reel'],
    'mfBiensExercice compte un bien de test : le périmètre du module doit appliquer sfBienCompte.');
  assert.deepEqual(ids(app({ inclure: true }).ctx), ['b-reel', 'b-test'], 'témoin : l\'interrupteur les réintègre');
});

test('une SCI qui ne porte que des biens de test n\'a rien à déclarer', () => {
  const sci = [{ id: 'sci-1', nom_sci: 'SCI Exemple' }];
  const decl = opts => { const { ctx } = app(opts); injecter(ctx, { allSCI: sci }); return Array.from(ctx.mfDeclarants(), d => d.cle); };
  assert.deepEqual(decl({ biens: [TEST] }), [],
    'La déclaration fiscale liste une SCI pour ses seuls biens de test.');
  assert.deepEqual(decl({ biens: [REEL, TEST] }), ['sci-1'], 'témoin : un vrai bien la fait déclarer');
});

test('le parcours de l\'accueil ne se dit pas commencé grâce à un bien de test', () => {
  assert.equal(app({ biens: [TEST] }).ctx.sfParcoursDemarrage()[0].fait, false,
    '« Déclarez un bien » est coché par une fiche de test.');
  assert.equal(app({ biens: [TEST], inclure: true }).ctx.sfParcoursDemarrage()[0].fait, true, 'témoin');
});

test('les lectures agrégées de allBiens passent toutes par sfBiensComptes', () => {
  /* La garde qui trouvera la PROCHAINE lecture oubliée. Toute fonction qui
     parcourt allBiens est soit un agrégat — elle doit passer par
     sfBiensComptes() —, soit l'une de celles-ci, chacune pour sa raison. Une
     nouvelle entrée se justifie ici, par écrit. (Chercher un bien par son id
     avec `.find` n'agrège rien : ce n'est pas compté.) */
  const AUTORISEES = {
    sfBiensComptes: 'la règle elle-même',
    sfLignesComptees: 'la règle elle-même : elle repère les biens de test',
    sfFraisCreationSci: 'une écriture : règle « même monde », hors interrupteur',
    getFilteredBiens: 'la LISTE des biens, qui garde les fiches de test, marquées',
    renderBiensContent: 'le compteur de la liste, « N fiches sur M »',
    sfBiensSelectionnes: 'une sélection faite à la main dans la liste',
    renderMarcheResults: 'la liste des fiches suivies dans une commune',
    visiteForm: 'une liste de choix d\'un bien',
    renderSimulateur: 'une liste de choix d\'un bien',
    showSimModal: 'une liste de choix d\'un bien',
    mfBiensExercice: 'filtrée par mfDansLePerimetre, qui applique sfBienCompte',
    mfLoyersNonSoldes: 'filtrée par mfDansLePerimetre, qui applique sfBienCompte',
    renderModuleFinancier: 'teste seulement si les biens sont chargés',
    loadAdminData: 'teste seulement si les biens sont chargés',
    purgeTestData: 'supprime les fiches de test',
    purgeAllData: 'supprime TOUT : doit compter tous les biens',
    purgeAllAdminData: 'annonce les biens rattachés avant suppression',
    sciDetacherBiens: 'une écriture : détacher TOUS les biens d\'une SCI',
    deleteSCI: 'annonce TOUS les biens qu\'une suppression détache',
  };
  /* Toute lecture de allBiens qui n'est ni une recherche par id (`.find`,
     `.findIndex`), ni une affectation, ni un `typeof`, ni un accès indexé.
     Large exprès : un alias (`const x = allBiens`) échappait à une première
     version qui ne cherchait que `.filter`, `.map`… — la mutation l'a montré. */
  const LECTURE = /(?<!typeof )\ballBiens\b(?!\s*\.\s*find(?:Index)?\s*\()(?!\s*=[^=])(?!\s*\[)/;
  const lecteurs = fonctions(CODE).filter(([, c]) => LECTURE.test(c)).map(([n]) => n);
  assert.ok(lecteurs.includes('getFilteredBiens'), 'témoin : le balayage doit voir la liste des biens');
  const intrus = lecteurs.filter(n => !(n in AUTORISEES));
  assert.deepEqual(intrus, [],
    `Ces fonctions parcourent allBiens sans passer par sfBiensComptes() : ${intrus.join(', ')}. ` +
    'Un agrégat qui lit allBiens compte les biens de test. Sinon, dites pourquoi dans AUTORISEES.');
  const perimees = Object.keys(AUTORISEES).filter(n => !lecteurs.includes(n));
  assert.deepEqual(perimees, [], `Entrées périmées dans AUTORISEES : ${perimees.join(', ')} — à retirer.`);
  assert.match(corps('mfDansLePerimetre'), /if \(!sfBienCompte\(bien\)\) return false;/,
    'mfDansLePerimetre n\'applique plus sfBienCompte : deux entrées de AUTORISEES perdent leur raison.');
});

test('sur la page Biens, la liste garde les fiches de test, les indicateurs non', () => {
  const c = corps('renderBiensContent');
  assert.match(c, /const comptes\s*=\s*l\.filter\(sfBienCompte\)/, 'les indicateurs de « Mes biens » comptent les fiches de test');
  for (const v of ['chiffres', 'aFaire', 'capital']) {
    assert.match(c, new RegExp(`const ${v}\\s*=\\s*comptes\\.`), `« ${v} » ne part plus des fiches comptées`);
  }
  // Et elles restent marquées, dans les trois vues comme sur la fiche.
  assert.match(corps('renderBiensTableau'), /sfBienDeTest\(b\)\?' <span class="sf-pill sf-pill--test">Test<\/span>'/,
    'le tableau des biens ne marque plus les fiches de test');
  assert.match(corps('renderBienDetail'), /sf-pill--test">Bien de test/, 'la fiche ne dit plus qu\'elle est de test');
});

// ─── Une écriture ne dépend pas de l'interrupteur ──────────────────────────

test('les frais de constitution de SCI ignorent les biens de test', () => {
  /* Deux fiches de test sont rattachées à la vraie SCI du compte : sans ce
     filtre, sa première VRAIE acquisition enregistrait 0 € au lieu de 200. */
  const NEUF = { ...REEL, id: 'b-neuf', statut: 'Dossier déposé' };
  for (const inclure of [false, true]) {
    const { ctx } = app({ biens: [TEST, NEUF], inclure });
    assert.equal(ctx.sfFraisCreationSci('b-neuf', 'sci', 'sci-1'), lire(ctx, 'SF_FRAIS_CREATION_SCI'),
      `Un bien de test passe pour le premier bien de la SCI (interrupteur ${inclure ? 'actif' : 'coupé'}) : ` +
      'c\'est une écriture, elle ne doit dépendre ni de l\'interrupteur ni des fiches de test.');
  }
  assert.equal(app({ biens: [REEL, NEUF] }).ctx.sfFraisCreationSci('b-neuf', 'sci', 'sci-1'), 0,
    'témoin : un vrai bien déjà détenu porte les frais, le suivant non');
  const TEST2 = { ...TEST, id: 'b-test2', statut: 'Dossier déposé' };
  assert.equal(app({ biens: [TEST, TEST2] }).ctx.sfFraisCreationSci('b-test2', 'sci', 'sci-1'), 0,
    'entre fiches de test, la règle du premier bien s\'applique aussi');
});

// ─── Les exports ───────────────────────────────────────────────────────────

test('l\'export des biens laisse les fiches de test dans le compte', () => {
  const exporter = (opts, biens) => {
    const { ctx } = app(opts);
    const sortie = { csv: null, notes: [] };
    ctx.tiTelechargerCsv = (base, contenu) => { sortie.csv = contenu; return 'f.csv'; };
    ctx.showNotif = m => sortie.notes.push(m);
    ctx.exportBiensCSV(biens);
    return sortie;
  };
  const s = exporter({}, [REEL, TEST]);
  assert.ok(s.csv && s.csv.includes('T2 Lyon'), 'témoin : le vrai bien est exporté');
  assert.ok(!s.csv.includes('Nice'), 'Une fiche de test part dans l\'export CSV.');
  const seul = exporter({}, [TEST]);
  assert.equal(seul.csv, null);
  assert.deepEqual(seul.notes, ['Les fiches de test ne sont pas exportées']);
  assert.ok(exporter({ inclure: true }, [REEL, TEST]).csv.includes('Nice'), 'témoin : l\'interrupteur les réintègre');
});

// ─── Fabriquer et purger ───────────────────────────────────────────────────

test('CLOISONNEMENT — seul un administrateur fabrique de la donnée de test', async () => {
  const { ctx } = app({ profil: MEMBRE });
  const appels = dbEnregistreur(ctx);
  await ctx.genTestData();
  await ctx.genAdminTestData();
  assert.deepEqual(appels.filter(x => a(x, 'insert')).map(x => x.table), [],
    'Un non-administrateur a pu insérer des données de test : l\'écran se contourne par la console, ' +
    'la fonction doit refuser d\'elle-même.');

  const admin = app();
  const ecrits = dbEnregistreur(admin.ctx);
  await admin.ctx.genTestData();
  const ins = ecrits.find(x => x.table === 'biens' && a(x, 'insert'));
  assert.ok(ins, 'témoin : un administrateur génère ses fiches');
  const lignes = arg(ins, 'insert')[1];
  assert.ok(lignes.length > 0 && lignes.every(l => l.is_test === true && l.user_id === 'u-admin'),
    'chaque fiche générée doit être marquée de test ET écrite sur le compte de l\'administrateur');
});

test('la purge emporte les locataires des fiches de test, sur ce compte seulement', async () => {
  /* `locataires.bien_id` est en ON DELETE SET NULL : supprimer les biens
     laissait leurs locataires sans bien — et un locataire sans bien compte. */
  const { ctx } = app();
  const questions = [];
  ctx.sfConfirmer = async q => { questions.push(q); return true; };
  const retires = [];
  lire(ctx, 'TI_STORAGE').remove = async (seau, chemins) => { retires.push([seau, chemins]); };
  const appels = dbEnregistreur(ctx, (table, ops) =>
    (table === 'locataires' && ops.some(o => o[0] === 'select')
      ? [{ id: 'l-test', documents: [{ storage_path: 'u-admin/bail.pdf' }] }] : []));
  await ctx.purgeTestData();

  const lecture = appels.find(x => x.table === 'locataires' && a(x, 'select'));
  assert.ok(lecture, 'la purge ne cherche plus les locataires des fiches de test');
  assert.deepEqual(Array.from(arg(lecture, 'in')[2]), ['b-test'], 'seuls les locataires des fiches de TEST sont visés');
  assert.deepEqual(arg(lecture, 'eq'), ['eq', 'user_id', 'u-admin']);

  const iLoc = appels.findIndex(x => x.table === 'locataires' && a(x, 'delete'));
  const iBiens = appels.findIndex(x => x.table === 'biens' && a(x, 'delete'));
  assert.ok(iLoc > -1, 'Les locataires des fiches de test restent après la purge, sans bien — et entrent alors dans les chiffres.');
  assert.ok(iLoc < iBiens, 'les locataires partent AVANT leurs biens');
  assert.deepEqual(appels[iLoc].ops.find(o => o[0] === 'eq'), ['eq', 'user_id', 'u-admin'],
    'la suppression des locataires doit écrire le compte visé, sans s\'en remettre à la RLS');
  assert.deepEqual(retires, [['locataires-documents', ['u-admin/bail.pdf']]], 'leurs documents partent avec eux');
  assert.match(questions[0].detail, /1 locataire/, 'la confirmation doit dire que le locataire part aussi');
});

// ─── Un seul lecteur du drapeau ────────────────────────────────────────────

test('`is_test` n\'est lu qu\'à un seul endroit', () => {
  /* Le canari d'abord : le blanchiment des commentaires ne doit pas effacer
     de code. On compte les appels d'icône avant et après. */
  const icones = t => (t.match(/sfAccIcon\(\s*'/g) || []).length;
  assert.equal(icones(CODE), icones(SRC), 'le masquage des commentaires a effacé du code');

  const lieux = fonctions(CODE).flatMap(([nom, c]) =>
    [...c.matchAll(/[^\n]*\bis_test\b[^\n]*/g)].map(m => `${nom} : ${m[0].trim()}`));
  assert.deepEqual(lieux, [
    'sfBienDeTest : function sfBienDeTest(b) { return !!(b && b.is_test); }',
    'genTestData : is_test:true,',
    "purgeTestData : const{error}=await db.from('biens').delete().eq('is_test',true).eq('user_id',currentUser.id);",
  ], 'Une nouvelle lecture du drapeau `is_test` : c\'est une seconde règle, qui divergera. ' +
     'Passer par sfBienDeTest() ou sfBienCompte().');
});
