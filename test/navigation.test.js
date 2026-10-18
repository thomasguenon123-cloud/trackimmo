/* LA NAVIGATION DE LA v=103.

   ⚠️ CE QUI ÉTAIT FAUX.
   · Le bandeau rangeait onze pages sous quatre menus déroulants : il fallait
     deux gestes — et deviner le bon menu — pour tout, y compris l'accueil.
   · Les locataires étaient le quatrième onglet du Suivi financier : qui
     cherche un locataire ne pense pas « finance ».
   · Sept boutons de l'accueil (« Pointer », « Saisir », « Ajouter un
     locataire », « Compléter »…) ouvraient une PAGE et laissaient chercher
     l'onglet, le mois ou le formulaire.
   · Paramètres proposait « Apparence » (une phrase, rien à régler) et « Mes
     SCI » (la liste d'Administration, une seconde fois).

   LA RÈGLE. Cinq entrées à plat (Accueil, Mes biens, Suivi financier,
   Locataires, Administration) et un menu Outils ; le libellé d'une entrée est
   le titre de la page qu'elle ouvre ; la page courante se dit (`active` et
   `aria-current`), sous-pages comprises. Une action mène à l'endroit où elle
   se fait : chaque destination est écrite une fois (`sfAller*`). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const MASQUE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

function corps(nom) {
  const i = SRC.search(new RegExp(`(?:async )?function ${nom}\\(`));
  assert.ok(i >= 0, `${nom} introuvable`);
  const j = SRC.indexOf('\n}\n', i);
  return SRC.slice(i, j + 2);
}

// Un faux document qui retient ce que navigate() écrit sur chaque entrée.
function bandeau() {
  const els = {};
  const element = id => els[id] || (els[id] = {
    id, attrs: {}, classes: new Set(), innerHTML: '',
    classList: { toggle(c, on) { on ? els[id].classes.add(c) : els[id].classes.delete(c); }, add(c) { els[id].classes.add(c); }, remove(c) { els[id].classes.delete(c); }, contains: c => els[id].classes.has(c) },
    setAttribute(k, v) { els[id].attrs[k] = String(v); }, removeAttribute(k) { delete els[id].attrs[k]; },
    getAttribute: k => els[id].attrs[k] ?? null,
  });
  return { els, element };
}
const ENTREES = ['accueil', 'biens', 'locataires', 'simulateur', 'visites', 'portails', 'administration', 'module-financier', 'marche-recherche'];

function appNav() {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  const { els, element } = bandeau();
  ctx.document.getElementById = id => (id.startsWith('nav-') || id.startsWith('menubtn-') || id === 'content' ? element(id) : null);
  const rendus = [];
  for (const f of ['renderAccueil', 'renderBiens', 'renderBienDetail', 'renderNouveau', 'renderSimulateur', 'renderSimulation',
    'renderAdmin', 'renderVisites', 'renderCompteRendu', 'renderPortails', 'renderAdministration', 'renderModuleFinancier',
    'renderLocatairesPage', 'renderMarcheRecherche', 'renderParametres']) ctx[f] = () => rendus.push(f);
  ctx.closeMobileSidebar = () => {};
  return { ctx, els, rendus };
}

test('le bandeau : cinq entrées à plat et un menu Outils, chaque libellé est le titre de sa page', () => {
  const lien = id => (INDEX.match(new RegExp(`<a class="sf-menu__btn sf-nav__lien" id="nav-${id}"[^>]*>([^<]+)</a>`)) || [])[1];
  assert.equal(lien('accueil'), 'Accueil');
  assert.equal(lien('biens'), 'Mes biens');
  assert.equal(lien('module-financier'), 'Suivi financier');
  assert.equal(lien('locataires'), 'Locataires');
  assert.equal(lien('administration'), 'Administration');
  // Le libellé de l'entrée est le titre de la page qu'elle ouvre.
  assert.match(corps('mfRenderShell'), /<h1 class="mfx-h1">Suivi financier/);
  assert.match(corps('renderLocatairesPage'), /<h1 class="mfx-h1">Locataires/);
  assert.match(SRC, /<h1 class="mfx-h1">Administration/);
  assert.match(corps('renderBiens'), /<h1>Mes biens<\/h1>/);
  // Le menu Outils et ses quatre pages.
  const outils = INDEX.slice(INDEX.indexOf('id="menu-outils"'), INDEX.indexOf('</div>', INDEX.indexOf('id="menu-outils"') + 1200));
  for (const id of ['simulateur', 'visites', 'marche-recherche', 'portails']) {
    assert.match(outils, new RegExp(`id="nav-${id}" role="menuitem"`), `Outils › ${id} manque`);
  }
  assert.deepEqual(Array.from(lire(charger(), 'SF_MENU_PAGES').outils).sort(),
    ['compte-rendu', 'marche-recherche', 'portails', 'simulateur', 'simulation', 'visites'],
    'le bouton Outils doit se surligner sur chacune de ses pages, sous-pages comprises');
});

test('la page courante se dit dans le bandeau, sous-pages comprises', () => {
  const { ctx, els } = appNav();
  const attendu = { 'bien-detail': 'biens', 'nouveau': 'biens', 'compte-rendu': 'visites', 'simulation': 'simulateur',
    'locataires': 'locataires', 'module-financier': 'module-financier', 'accueil': 'accueil' };
  for (const [page, entree] of Object.entries(attendu)) {
    ctx.navigate(page);
    for (const e of ENTREES) {
      const el = els['nav-' + e];
      assert.ok(el, `témoin : nav-${e} est visitée`);
      assert.equal(el.classes.has('active'), e === entree, `${page} : nav-${e} ${e === entree ? 'devrait' : 'ne devrait pas'} être surlignée`);
      assert.equal(el.attrs['aria-current'], e === entree ? 'page' : undefined, `${page} : aria-current de nav-${e}`);
    }
    const outils = ['simulateur', 'simulation', 'visites', 'compte-rendu', 'portails', 'marche-recherche'].includes(page);
    assert.equal(els['menubtn-outils'].classes.has('sf-menu__btn--active'), outils, `${page} : le bouton Outils`);
  }
});

test('la page Locataires a sa route, et l’ancien onglet du Suivi financier n’existe plus', () => {
  const { ctx, rendus } = appNav();
  ctx.navigate('locataires');
  assert.deepEqual(rendus, ['renderLocatairesPage']);
  // L'ancien onglet retombe sur Performance, au lieu d'une page vide.
  assert.match(corps('mfRenderShell'), /if \(mfTab === 'locataires'\) mfTab = 'performance';/);
  assert.doesNotMatch(corps('mfRenderShell'), /\['locataires',/, 'l’onglet Locataires est revenu dans le Suivi financier');
  // Les rafraîchissements après une écriture visent la page, plus l'onglet.
  assert.doesNotMatch(MASQUE, /mfTab\s*===\s*'locataires'(?![^\n]*mfTab = 'performance')/, 'un rafraîchissement vise encore l’ancien onglet');
  const versLaPage = (MASQUE.match(/currentPage === 'locataires'/g) || []).length;
  assert.ok(versLaPage >= 6, `témoin : ${versLaPage} rafraîchissements visent la page Locataires`);
});

test('une action de l’accueil mène là où elle se fait', () => {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  const navs = [];
  ctx.navigate = p => navs.push(p);
  // Pointer un loyer : le Suivi mensuel de l'exercice en cours, tous biens.
  injecter(ctx, { mfTab: 'performance', mfExercice: 2024, mfSuiviBienFilter: 'b9' });
  ctx.sfAllerPointer();
  assert.deepEqual(navs, ['module-financier']);
  assert.equal(lire(ctx, 'mfTab'), 'suivi', '« Pointer » ouvrait le dernier onglet visité, Performance par défaut');
  assert.equal(lire(ctx, 'mfExercice'), 2026);
  assert.equal(lire(ctx, 'mfSuiviBienFilter'), null);

  const BIEN = (id, extra) => ({ id, titre: id, statut: 'Acheté', mode_detention: 'propre', is_test: false, ...extra });
  // Saisir une charge : la fenêtre de saisie, déjà sur le bien quand il n'y en a qu'un.
  const charges = [];
  ctx.mfOpenChargeModal = p => charges.push(p);
  const notifs = [];
  ctx.showNotif = m => notifs.push(m);
  injecter(ctx, { allBiens: [], sfBiensCharges: true });
  ctx.sfAllerSaisirCharge();
  assert.equal(charges.length, 0, 'sans bien acquis, pas de fenêtre vide');
  assert.match(notifs[0], /bien acquis/);
  injecter(ctx, { allBiens: [BIEN('a1')] });
  ctx.sfAllerSaisirCharge();
  assert.deepEqual({ ...charges[0] }, { bien_id: 'a1' });
  injecter(ctx, { allBiens: [BIEN('a1'), BIEN('a2')] });
  ctx.sfAllerSaisirCharge();
  assert.deepEqual({ ...charges[1] }, {}, 'plusieurs biens : la fenêtre s’ouvre, le bien se choisit');

  // Ajouter un locataire : la fenêtre, sur le seul bien acquis qui n'en a pas.
  const locs = [];
  ctx.openLocataireModal = (id, bien) => locs.push([id, bien]);
  injecter(ctx, { allBiens: [BIEN('a1'), BIEN('a2')], allLocataires: [{ id: 'l1', bien_id: 'a2', statut: 'Actif' }] });
  ctx.sfAllerAjouterLocataire();
  assert.deepEqual(locs[0], [null, 'a1']);

  // Compléter : la fiche, sur l'onglet du premier champ manquant ; plusieurs, la liste filtrée.
  const fiches = [];
  ctx.openDetail = id => fiches.push([id, lire(ctx, '_reopenDetailTab')]);
  injecter(ctx, { allBiens: [BIEN('a1', { prix_affiche: null })] });
  ctx.sfAllerCompleter();
  assert.equal(fiches.length, 1, 'une seule fiche incomplète : on l’ouvre');
  const onglet = fiches[0][1];
  assert.ok(['bien', 'finances', 'nego'].includes(onglet), `onglet inconnu : ${onglet}`);
  injecter(ctx, { allBiens: [BIEN('a1', { prix_affiche: null }), BIEN('a2', { prix_affiche: null })] });
  ctx.sfAllerCompleter();
  assert.equal(navs[navs.length - 1], 'biens');
  assert.equal(lire(ctx, 'sfbEtatDemande'), 'ko', 'la liste s’ouvre filtrée sur les fiches à compléter');
  assert.equal(lire(ctx, 'bienOnglet'), 'detenus');
});

test('chaque onglet demandé par un lien direct existe dans la fiche', () => {
  const cles = [...corps('renderBienDetail').match(/const TAB_DEFS = \{([\s\S]*?)\n  \};/)[1]
    .matchAll(/^\s{4}(\w+):\s*\{/gm)].map(m => m[1]);
  assert.ok(cles.length >= 6, `témoin : ${cles}`);
  const demandes = [...MASQUE.matchAll(/sfOuvrirFiche\([^,()]+(?:\([^)]*\))?[^,()]*,\s*'(\w+)'\)/g)].map(m => m[1]);
  assert.ok(demandes.includes('finances'), 'témoin : les liens directs littéraux sont trouvés');
  assert.deepEqual(demandes.filter(t => !cles.includes(t)), [],
    'un lien direct demande un onglet que la fiche ne connaît pas : elle retombe en silence sur « Le bien »');
  // Le champ manquant porte son onglet : chaque valeur doit en être un.
  const onglets = [...MASQUE.matchAll(/\btab:\s*'(\w+)'/g)].map(m => m[1]);
  assert.ok(onglets.length >= 10, 'témoin : les onglets des champs essentiels sont lus');
  assert.deepEqual([...new Set(onglets)].filter(t => !cles.includes(t)), []);
});

test('Paramètres : ni Apparence ni Mes SCI, et un ancien lien vers Mes SCI mène à Administration', () => {
  const ctx = charger();
  const ids = Array.from(lire(ctx, 'PARAMS_SECTIONS')).flatMap(f => Array.from(f.items).map(i => i.id));
  assert.ok(ids.includes('compte') && ids.includes('donnees') && ids.includes('metier'), `témoin : ${ids}`);
  assert.ok(!ids.includes('apparence'), 'Apparence ne contenait qu’une phrase : rien à régler');
  assert.ok(!ids.includes('sci'), 'les SCI se gèrent à un seul endroit, Administration');
  const navs = [];
  ctx.navigate = p => navs.push(p);
  ctx.window.location.hash = '#parametres/sci';
  injecter(ctx, { currentUser: { id: 'u1' } });
  ctx.renderParametres({ innerHTML: '' });
  assert.deepEqual(navs, ['administration']);
  assert.equal(lire(ctx, 'adminTab'), 'sci');
  assert.doesNotMatch(MASQUE, /tiMigrateToStorage|Lancer la migration base64/, 'l’outil d’une migration terminée est revenu');
  assert.doesNotMatch(MASQUE, /paramsApparenceHtml|paramsSciHtml|renderSCIList/);
});
