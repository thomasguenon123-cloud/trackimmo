/* L'ACCUEIL DE LA v=104 — « laisser de l'air », dire ce qui est.

   ⚠️ CE QUI ÉTAIT FAUX (capture de Thomas, 18/10).
   · Un compte sans bien acquis voyait « Votre patrimoine » : trois « non
     disponible » à la taille d'un chiffre, et le nombre de fiches que la
     section Prospection redisait juste dessous.
   · L'Agenda disait TOUJOURS « Aucune échéance administrative programmée » :
     il ne lisait pas les échéances (elles ne l'étaient qu'en ouvrant
     Administration). Deux échéances à 28 et 44 jours, au banc, et ce message.
   · Le titre d'un loyer attendu était échappé deux fois : « & » s'y lisait
     « &amp; ».
   · « Programmer une échéance » ouvrait Administration sur l'onglet Mes SCI.

   LA RÈGLE. Le patrimoine vient avec le premier bien acquis. Les prochaines
   échéances mêlent loyers attendus et échéances administratives, de la plus
   proche à la plus lointaine ; une échéance faite sort, une échéance dépassée
   reste, en retard. Chaque ligne mène là où l'on agit. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { charger, injecter, lire } = require('./charger-app');

const AUJOURDHUI = new Date(2026, 9, 18, 12);   // dimanche 18 octobre 2026
const ACQUIS = { id: 'a1', titre: 'T2 Rennes & Saint-Malo', ville: 'Rennes', statut: 'Acheté', mode_detention: 'propre',
  prix_affiche: 150000, loyer_en_etat: 700, mensualite_credit: 600, surface_m2: 40, is_test: false };
const PROSPECT = { id: 'p1', titre: 'Studio Nantes', ville: 'Nantes', statut: 'Renseignements Web', prix_affiche: 99000, is_test: false };
const LOCATAIRE = { id: 'l1', bien_id: 'a1', nom: 'Martin', prenom: 'Camille', statut: 'Actif', date_entree: '2026-01-01',
  loyer_bail_hc: 700, charges_bail: 0, jour_paiement: 5 };
const ECHEANCES = [
  { id: 'e1', titre: 'Assemblée générale', type_echeance: 'AG', date_echeance: '2026-11-15', est_faite: false },
  { id: 'e2', titre: 'Assurance PNO', type_echeance: 'Assurance', date_echeance: '2026-10-10', est_faite: false },  // dépassée
  { id: 'e3', titre: 'Déjà faite', type_echeance: 'Fiscal', date_echeance: '2026-10-25', est_faite: true },
  { id: 'e4', titre: 'Trop loin', type_echeance: 'Fiscal', date_echeance: '2027-03-01', est_faite: false },
  { id: 'e5', titre: 'Renouvellement assurance PNO TEST', type_echeance: 'Assurance', date_echeance: '2026-11-01',
    est_faite: false, notes: 'Échéance test' },                                                                   // générateur de test
];

function accueil(donnees = {}) {
  const ctx = charger({ maintenant: AUJOURDHUI });
  injecter(ctx, {
    currentUser: { id: 'u1' }, currentProfile: { role: 'user', first_name: 'Alex' }, sfBiensCharges: true,
    allBiens: [], allLoyers: [], allCharges: [], allLocataires: [], allEcheances: [], sfEcheancesLues: true,
    ...donnees,
  });
  const el = { innerHTML: '' };
  ctx.renderAccueil(el);
  return { ctx, h: el.innerHTML };
}

test('sans bien acquis, pas de patrimoine — ni aucun « non disponible »', () => {
  const { h } = accueil({ allBiens: [{ ...PROSPECT }] });
  assert.doesNotMatch(h, /Votre patrimoine/, 'un patrimoine vide s’affiche avant le premier achat');
  assert.doesNotMatch(h, /disponible/i);
  assert.match(h, /En prospection <span class="acc-sec__n">1 fiche</, 'témoin : la prospection reste');
  // Avec un bien acquis, le patrimoine revient, en tête, et parle comme la fiche.
  const avec = accueil({ allBiens: [{ ...ACQUIS }, { ...PROSPECT }] }).h;
  assert.match(avec, /Votre patrimoine/);
  assert.match(avec, /sf-kpi__label">Cashflow réel/, 'le même chiffre porte le même nom que sur la fiche');
  assert.doesNotMatch(avec, /Ce que ça rapporte/);
  assert.ok(avec.indexOf('Votre patrimoine') < avec.indexOf('Actions rapides'));
});

test('les prochaines échéances mêlent loyers et échéances administratives, dans l’ordre des dates', () => {
  const { ctx } = accueil();
  injecter(ctx, { allBiens: [{ ...ACQUIS }], allLocataires: [{ ...LOCATAIRE }], allEcheances: ECHEANCES.map(e => ({ ...e })) });
  const agenda = Array.from(ctx.sfAgenda60j());
  const ech = agenda.filter(a => a.type === 'echeance').map(a => a.id);
  assert.deepEqual(ech, ['e2', 'e1'], 'faite, trop lointaine ou de test : elle ne s’affiche pas');
  const tri = agenda.map(a => a.tri);
  assert.deepEqual(tri, [...tri].sort((x, y) => x - y), 'de la plus proche à la plus lointaine');
  const pno = agenda.find(a => a.id === 'e2');
  assert.equal(pno.enRetard, true, 'une échéance dépassée et non faite reste, en retard');
  assert.match(agenda.find(a => a.id === 'e1').meta, /^AG · dans 28 jours$/);
  // Un administrateur qui inclut les biens de test voit aussi l'échéance du générateur.
  injecter(ctx, { currentProfile: { role: 'admin' }, sfTestsChoix: true });
  ctx.sfEstAdmin = () => true;
  assert.ok(Array.from(ctx.sfAgenda60j()).some(a => a.id === 'e5'), 'l’échéance de test suit l’interrupteur des biens de test');
});

test('l’accueil rend les échéances : une ligne qui mène à Administration, un titre échappé une fois', () => {
  const { h } = accueil({ allBiens: [{ ...ACQUIS }], allLocataires: [{ ...LOCATAIRE }], allEcheances: ECHEANCES.map(e => ({ ...e })) });
  assert.match(h, /Prochaines échéances <span class="acc-sec__n">d’ici le 17 décembre</, 'l’horizon se dit en date');
  assert.match(h, /<button type="button" class="sf-ag sf-ag--lien[^"]*" onclick="sfAllerEcheances\(\)">/, 'une échéance mène à Administration › Échéances');
  assert.match(h, /Assemblée générale/);
  assert.match(h, /<span class="sf-ag__retard">En retard<\/span> · prévue le 10 oct/);
  assert.doesNotMatch(h, /Aucune échéance/, 'il y a des échéances : l’accueil ne dit plus le contraire');
  assert.match(h, /Loyer attendu — T2 Rennes &amp; Saint-Malo/, 'témoin : le titre du bien est échappé');
  assert.doesNotMatch(h, /&amp;amp;/, 'le titre est échappé deux fois : « & » se lit « &amp; »');
  assert.match(h, /onclick="sfAllerEcheances\(\{ nouvelle: true \}\)"/, '« Programmer une échéance » ouvre la saisie');
  assert.match(h, /onclick="sfOuvrirBiens\(\{ onglet: 'prospect' \}\)"|Aucune fiche en prospection/, 'la prospection mène à Mes biens');
});

test('sans rien à venir, un état vide complet — qui ne dit « aucune échéance » que s’il les a lues', () => {
  const vide = accueil({ allBiens: [{ ...PROSPECT }] }).h;
  assert.match(vide, /sf-empty__title">Aucune échéance d’ici le 17 décembre/);
  assert.match(vide, /sf-empty__icon/, 'un état vide complet : icône, titre, explication, action');
  const illisible = accueil({ allBiens: [{ ...PROSPECT }], sfEcheancesLues: false }).h;
  assert.match(illisible, /Aucun loyer attendu d’ici le 17 décembre/, 'échéances non lues : on ne prétend pas qu’il n’y en a aucune');
});

test('la prospection : deux lignes, un vrai bouton, et le lien dit sa destination', () => {
  const { h } = accueil({ allBiens: [{ ...PROSPECT }] });
  assert.match(h, /<button type="button" class="acc-pipe" onclick="openDetail\(&quot;p1&quot;\)">/);
  assert.match(h, /acc-pipe__t">Studio Nantes<\/span>\s*<span class="acc-pipe__m"><span class="sf-pill">Renseignements Web<\/span><span class="acc-pipe__v">Nantes<\/span>/);
  assert.match(h, /Tout voir dans Mes biens/);
  assert.doesNotMatch(h, /pipeline/i, 'le jargon « pipeline » est revenu');
});

test('« Programmer une échéance » ouvre Administration sur Échéances, puis la saisie', () => {
  const ctx = charger({ maintenant: AUJOURDHUI });
  const navs = [];
  ctx.navigate = p => navs.push(p);
  ctx.sfAllerEcheances({ nouvelle: true });
  assert.deepEqual(navs, ['administration']);
  assert.equal(lire(ctx, 'adminTab'), 'echeances', 'Administration s’ouvrait sur l’onglet Mes SCI');
  assert.equal(lire(ctx, 'sfEcheanceDemandee'), true);
  ctx.sfAllerEcheances();
  assert.equal(lire(ctx, 'sfEcheanceDemandee'), false, 'ouvrir une échéance existante ne lance pas une saisie');
});
