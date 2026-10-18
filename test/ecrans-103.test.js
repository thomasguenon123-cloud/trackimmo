/* LES ÉCRANS NOUVEAUX OU REFAITS DE LA v=103, RENDUS.

   « Un écran qu'aucun test ne REND casse en silence » (v=100 : deux
   ReferenceError vues seulement au banc). La page Locataires, l'en-tête de
   l'Administration et les Paramètres allégés sont donc appelés ici, avec des
   données, et l'on regarde ce qu'ils écrivent. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter } = require('./charger-app');

const BIENS = [
  { id: 'a1', titre: 'T3 Lyon', ville: 'Lyon', statut: 'Acheté', mode_detention: 'propre', prix_affiche: 210000,
    loyer_en_etat: 780, mensualite_credit: 980, surface_m2: 64, type_bien: 'T3', is_test: false },
  { id: 'a2', titre: 'T2 Nantes', ville: 'Nantes', statut: 'Acheté', mode_detention: 'propre', prix_affiche: 150000,
    loyer_en_etat: 650, mensualite_credit: 700, surface_m2: 42, type_bien: 'T2', is_test: false },
];
const LOCATAIRES = [
  { id: 'l1', bien_id: 'a1', nom: 'Durand', prenom: 'Camille', statut: 'Actif', date_entree: '2026-01-01',
    loyer_bail_hc: 730, charges_bail: 50, depot_garantie: 730, jour_paiement: 5 },
];

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  injecter(ctx, {
    currentUser: { id: 'u1' }, currentProfile: { role: 'user' }, sfBiensCharges: true,
    allBiens: BIENS.map(b => ({ ...b })), allLocataires: LOCATAIRES.map(l => ({ ...l })), allCharges: [],
    // Septembre échu et non encaissé : la page doit le signaler.
    allLoyers: [{ id: 'y9', bien_id: 'a1', locataire_id: 'l1', annee: 2026, mois: 9, statut: 'En attente', loyer_du: 780, loyer_hc: 730, charges: 50 }],
    userPrefs: { notaire_pct: 7, duree_credit_ans: 20, assurance_mois: 33, seuil_rentabilite: 5 },
  });
  return ctx;
}

test('la page Locataires se rend : son titre, son action, et les baux', async () => {
  const ctx = app();
  const contenu = { innerHTML: '' };
  ctx.document.getElementById = id => (id === 'mf-content' ? contenu : null);
  ctx.loadBiens = async () => {};
  ctx.loadLocataires = async () => {};
  ctx.loadMfFinancialData = async () => {};
  injecter(ctx, { currentPage: 'locataires' });
  const el = { innerHTML: '' };
  await ctx.renderLocatairesPage(el);
  assert.match(el.innerHTML, /<h1 class="mfx-h1">Locataires/);
  assert.match(el.innerHTML, /id="mf-content"/, 'le conteneur garde son identifiant : les rafraîchissements le retrouvent');
  assert.ok(contenu.innerHTML.length > 200, 'le contenu de la page n’est pas rendu');
  assert.match(contenu.innerHTML, /Durand/, 'témoin : le bail en place apparaît');
  // UNE action d'ajout sur la page (il y en avait deux : en-tête et Annuaire).
  const tout = el.innerHTML + contenu.innerHTML;
  const ajouts = tout.match(/onclick="(?:sfAllerAjouterLocataire\(\)|openLocataireModal\(null\))"/g) || [];
  assert.equal(ajouts.length, 1, `${ajouts.length} boutons d’ajout d’un locataire sur la même page`);
  assert.match(tout, /onclick="sfAllerAjouterLocataire\(\)">[^<]*<svg[\s\S]*?<\/svg> Ajouter un locataire</, 'le bouton dit ce qu’il fait, comme sur l’accueil');
  // Le loyer échu mène au Suivi mensuel par sa destination : `switchMfTab` dessinait
  // le suivi DANS la page Locataires, sans son en-tête.
  assert.match(contenu.innerHTML, /onclick="sfAllerPointer\(\)">Ouvrir le suivi mensuel/, 'témoin : un loyer échu est signalé');
  assert.doesNotMatch(contenu.innerHTML, /switchMfTab\(/, 'un onglet du Suivi financier est demandé depuis la page Locataires');
  // On a quitté la page pendant le chargement : rien n'est écrit par-dessus la suivante.
  const ailleurs = app();
  ailleurs.loadBiens = ailleurs.loadLocataires = ailleurs.loadMfFinancialData = async () => {};
  injecter(ailleurs, { currentPage: 'accueil' });
  const el2 = { innerHTML: '' };
  await ailleurs.renderLocatairesPage(el2);
  assert.doesNotMatch(el2.innerHTML, /mfx-h1/, 'la page écrasait l’écran ouvert entre-temps');
});

test('l’Administration : titre, onglets soulignés, compteurs dans les onglets', async () => {
  const ctx = app();
  const els = {};
  const el = id => els[id] || (els[id] = { id, hidden: false, textContent: '', attrs: {}, classes: new Set(), innerHTML: '',
    classList: { toggle(c, on) { on ? els[id].classes.add(c) : els[id].classes.delete(c); } },
    setAttribute(k, v) { els[id].attrs[k] = String(v); }, removeAttribute(k) { delete els[id].attrs[k]; } });
  ctx.document.getElementById = id => (/^adm-/.test(id) ? el(id) : null);
  ctx.sfOngletDansLeChamp = () => {};
  ctx.renderAdmSCI = ctx.renderAdmAnnuaire = ctx.renderAdmEcheances = ctx.renderAdmBilans = () => {};
  injecter(ctx, {
    allSCI: [{ id: 's1', nom_sci: 'SCI Lumière' }], allContacts: [{ id: 'c1' }, { id: 'c2' }], allBilans: [],
    allEcheances: [{ id: 'e1', date_echeance: '2026-10-30', est_faite: false }, { id: 'e2', date_echeance: '2027-03-01', est_faite: false },
      { id: 'e3', date_echeance: '2026-10-20', est_faite: true }],
  });
  ctx.loadAdminData = async () => { ctx.admMajCompteurs(); };
  const page = { innerHTML: '' };
  await ctx.renderAdministration(page);
  const h = page.innerHTML;
  assert.match(h, /<h1 class="mfx-h1">Administration/);
  assert.match(h, /class="mfx-tabs" role="tablist" id="adm-onglets"/);
  assert.equal((h.match(/class="mfx-tab" role="tab"/g) || []).length, 4);
  assert.match(h, /id="adm-tab-sci" aria-selected="true"/, 'l’onglet ouvert le dit');
  assert.doesNotMatch(h, /adm-hero|Gestion administrative/, 'le bandeau vert de l’ancienne charte est revenu');
  assert.equal(els['adm-n-sci'].textContent, '1');
  assert.equal(els['adm-n-annuaire'].textContent, '2');
  assert.equal(els['adm-n-bilans'].hidden, true, 'zéro bilan : pas de pastille « 0 »');
  // Une échéance sous 30 jours (le 30/10), une plus lointaine, une faite.
  assert.equal(els['adm-n-echeances'].textContent, '1');
  assert.ok(els['adm-n-echeances'].classes.has('mfx-tab__n--alerte'), 'l’urgence se signale');
  assert.equal(els['adm-n-echeances'].attrs['aria-label'], '1 à traiter sous 30 jours, sur 3', 'la couleur ne porte pas seule');
  // Sans urgence, la pastille dit le total, sans alerte.
  injecter(ctx, { allEcheances: [{ id: 'e2', date_echeance: '2027-03-01', est_faite: false }] });
  ctx.admMajCompteurs();
  assert.equal(els['adm-n-echeances'].textContent, '1');
  assert.equal(els['adm-n-echeances'].classes.has('mfx-tab__n--alerte'), false);
  assert.equal(els['adm-n-echeances'].attrs['aria-label'], undefined);
  // Basculer d'onglet change aria-selected.
  ctx.switchAdminTab('echeances');
  assert.equal(els['adm-tab-echeances'].attrs['aria-selected'], 'true');
  assert.equal(els['adm-tab-sci'].attrs['aria-selected'], 'false');
});

test('les Paramètres : aucune famille d’une seule entrée vide, Maintenance sans l’outil de migration', () => {
  const ctx = app();
  const page = { innerHTML: '' };
  ctx.renderParamsSection = () => {};
  ctx.window.location.hash = '';
  ctx.renderParametres(page);
  const familles = [...page.innerHTML.matchAll(/params-nav-family-label">([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(familles, ['Mon compte', 'Aide'], 'un utilisateur voit deux familles');
  const entrees = [...page.innerHTML.matchAll(/selectParamsSection\('(\w+)'\)/g)].map(m => m[1]);
  assert.deepEqual(entrees, ['compte', 'metier', 'donnees', 'apropos']);
  injecter(ctx, { currentProfile: { role: 'admin' } });
  ctx.sfEstAdmin = () => true;
  const m = ctx.paramsMaintenanceHtml();
  assert.match(m, /Générer 5 fiches de bien/, 'témoin : les outils de test restent');
  assert.doesNotMatch(m, /migration/i, 'l’outil d’une migration terminée est revenu');
});

test('les Préférences métier : des champs texte au clavier numérique, alignés comme des montants', () => {
  const ctx = app();
  injecter(ctx, { userPrefs: { notaire_pct: 7.5, duree_credit_ans: 25, assurance_mois: 0, seuil_rentabilite: 5 } });
  const h = ctx.paramsMetierHtml();
  for (const id of ['pref-notaire', 'pref-duree', 'pref-assurance', 'pref-seuil']) {
    assert.match(h, new RegExp(`class="params-input sf-montant" id="${id}" type="text" inputmode="(decimal|numeric)"`), `${id}`);
  }
  assert.match(h, /id="pref-notaire"[^>]*value="7,5"/, 'virgule décimale');
  assert.match(h, /id="pref-assurance"[^>]*value="0"/, 'une assurance à 0 € s’affiche 0, pas vide');
});
