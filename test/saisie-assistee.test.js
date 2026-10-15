/* LA SAISIE ASSISTÉE — la v=97, troisième version de l'étape 1.

   ⚠️ CE QUE CES GARDES RETIENNENT :
     · l'assistance ne remplace JAMAIS une valeur saisie — un champ rempli, un
       titre écrit à la main, une ville tapée restent tels quels ;
     · un prix au mètre carré n'est pas un prix, une pièce ou un balcon n'est
       pas la surface, « Prix 95000 € » n'est pas un code postal, et « charges
       comprises » qualifie un loyer, pas des charges ;
     · les charges et la taxe foncière se saisissent à l'année et se comptent
       par mois — sans perte à l'aller-retour ;
     · une source n'est déduite que du vrai domaine d'un portail ;
     · le service des communes peut se taire ou répondre en retard : rien ne
       casse, rien d'ancien n'écrase du récent, rien de ce qu'il renvoie n'est
       interprété comme du HTML ;
     · le texte d'une annonce collée ne part pas sur le réseau.

   Les gardes sont validées par mutation le 15/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const ESPACE_FINE = ' ';

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 15, 12) });
  ctx.showNotif = () => {};
  ctx.navigate = () => {};
  injecter(ctx, { currentUser: { id: 'u1', email: 'membre@exemple.fr' }, currentProfile: { role: 'user' },
    allBiens: [], allSCI: [], editingId: null, sciOui: false, bienPhotos: [], bienDocs: [], sfnModifie: false });
  return ctx;
}
const lu = (ctx, t) => JSON.parse(JSON.stringify(ctx.sfAnnonceLire(t)));
const garde = (r, cles) => Object.fromEntries(cles.map(k => [k, r[k]]));

function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* Un écran de formulaire minimal : ce que lisent getFormData, le remplissage
   et l'assistance au code postal. */
const NOMBRES = ['f-surface', 'f-prix', 'f-loyer', 'f-copro', 'f-taxe', 'f-agence', 'f-mensualite', 'f-duree', 'f-assurance',
  'f-travaux', 'f-sci', 'f-charges-loc', 'f-loyer-travaux', 'f-charges-travaux'];
const SELECTS = { 'f-type': ['', 'Studio', 'T1', 'T2', 'T3', 'T4+', 'Immeuble', 'Parking', 'Autre'],
  'f-source': ['', 'SeLoger', 'LeBonCoin', 'PAP', 'Logic-Immo', "Bien'ici", 'Jinka', 'Réseau agence', 'Particulier', 'Autre'] };
function formulaire(ctx, valeurs = {}) {
  const els = {};
  const fabrique = (id, value = '') => (els[id] = {
    id, value, dataset: {}, textContent: '', innerHTML: '', hidden: false, isConnected: true,
    tagName: SELECTS[id] ? 'SELECT' : 'INPUT', options: SELECTS[id] ? SELECTS[id].map(v => ({ value: v })) : undefined,
    classList: { contains: c => c === 'sfn-nombre' && NOMBRES.includes(id), toggle() {}, add() {}, remove() {} },
    setAttribute() {}, removeAttribute() {}, closest() { return null; }, focus() {}, scrollIntoView() {},
  });
  for (const id of ['f-titre', 'f-ville', 'f-cp', 'f-lien', 'f-statut', 'f-sci-id', 'f-balise', 'f-notes', ...NOMBRES, ...Object.keys(SELECTS),
    'f-cp-geo', 'sfn-annonce-texte', 'sfn-annonce-bilan']) fabrique(id);
  for (const [id, v] of Object.entries(valeurs)) els[id].value = v;
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelectorAll = () => [];
  return els;
}

// ─── Lire une annonce ──────────────────────────────────────────────────────

const ANNONCES = {
  seloger: `Appartement 2 pièces 42 m²
Lyon 4ème (69004)
168 000 €
4 000 €/m²
Au cœur de la Croix-Rousse, appartement traversant de 42 m². Séjour lumineux de 20 m², cuisine indépendante, cave.
Copropriété de 24 lots. Charges annuelles : 1 200 €. Taxe foncière : 850 €.
Honoraires à la charge du vendeur.
https://www.seloger.com/annonces/achat/appartement/lyon-4eme-69/croix-rousse/123456789.htm`,
  bienici: `Vente appartement 3 pièces 61,5 m²
Villeurbanne (69100)
229 000 €
Prix au m² : 3 724 €
Appartement T3 de 61,5 m² avec balcon de 6 m², proche métro Gratte-Ciel.
Charges de copropriété : 150 €/mois
Taxe foncière 1 100 €/an
Honoraires : 9 000 € TTC à la charge de l'acquéreur
https://www.bienici.com/annonce/vente/villeurbanne/appartement/3pieces/xyz`,
  pap: `Appartement Saint-Étienne (42000) 3 pièces 68 m²
95 000 €
Particulier vend T3 de 68 m², 2 chambres, cuisine équipée, cave et parking. Loué 620 € hors charges, locataire en place depuis 2021.
Charges : 1 300 €/an. Taxe foncière : 900 €.`,
  leboncoin: `Studio 18 m² – Lyon 69007
89 000 €
Studio de 18 m² en rez-de-chaussée, idéal investissement locatif. Actuellement loué 480 € charges comprises.
Montant moyen annuel de la quote-part de charges : 600 €
Taxe foncière : 400 €
https://www.leboncoin.fr/ad/ventes_immobilieres/2849571234`,
  jinka: `Maison 5 pièces 110 m² · Terrain 450 m²
Bron (69500)
345 000 €
Maison familiale de 110 m² sur un terrain de 450 m², garage.
Taxe foncière : 1 600 €
https://www.jinka.fr/alert_result?ad=987654`,
};

test('cinq annonces de portails sont lues comme on les lirait soi-même', () => {
  const ctx = app();
  const CLES = ['prix_affiche', 'surface_m2', 'type_bien', 'ville', 'code_postal', 'loyer_en_etat',
    'charges_annuelles', 'taxe_annuelle', 'frais_agence', 'source'];
  const attendu = {
    seloger: [168000, 42, 'T2', 'Lyon', '69004', null, 1200, 850, null, 'SeLoger'],
    bienici: [229000, 61.5, 'T3', 'Villeurbanne', '69100', null, 1800, 1100, 9000, "Bien'ici"],
    pap: [95000, 68, 'T3', 'Saint-Étienne', '42000', 620, 1300, 900, null, null],
    leboncoin: [89000, 18, 'Studio', 'Lyon', '69007', 480, 600, 400, null, 'LeBonCoin'],
    jinka: [345000, 110, 'T4+', 'Bron', '69500', null, null, 1600, null, 'Jinka'],
  };
  for (const [nom, texte] of Object.entries(ANNONCES)) {
    assert.deepEqual(garde(lu(ctx, texte), CLES), Object.fromEntries(CLES.map((k, i) => [k, attendu[nom][i]])),
      `L'annonce ${nom} n'est plus lue correctement.`);
  }
  assert.equal(lu(ctx, ANNONCES.seloger).lien_annonce,
    'https://www.seloger.com/annonces/achat/appartement/lyon-4eme-69/croix-rousse/123456789.htm');
});

test('un prix au mètre carré n\'est pas un prix, une annexe n\'est pas la surface', () => {
  const ctx = app();
  // « Prix au m² » porte le mot « prix » : sans le filtre, 3 724 € gagnait.
  assert.equal(lu(ctx, ANNONCES.bienici).prix_affiche, 229000);
  assert.equal(lu(ctx, 'Studio lumineux, 3 900 €/m², 89 000 €').prix_affiche, 89000);
  // Le prix lui-même n'est désigné par aucun mot, le prix au m² si : il ne doit pas gagner.
  assert.equal(lu(ctx, 'Appartement T2 Lyon (69004)\n168 000 €\nPrix au m² : 4 000 €').prix_affiche, 168000,
    'Le prix au mètre carré a été pris pour le prix du bien.');
  assert.equal(lu(ctx, 'Balcon de 8 m². Appartement de 52 m², 2 pièces.').surface_m2, 52,
    'Un balcon cité avant l\'appartement passe pour sa surface.');
  assert.equal(lu(ctx, 'Maison sur un terrain de 450 m², surface habitable 95 m².').surface_m2, 95);
  assert.equal(lu(ctx, 'Séjour de 25 m² dans un appartement de 70 m²').surface_m2, 70, 'une pièce n\'est pas le bien');
});

test('les montants se classent par le mot qui les désigne, et « charges comprises » qualifie un loyer', () => {
  const ctx = app();
  const r = lu(ctx, 'Vendu loué. Loyer : 650 € charges comprises, soit 600 € hors charges. Charges de copropriété : 900 € par an. Prix 120 000 €');
  assert.equal(r.loyer_en_etat, 650);
  assert.equal(r.charges_annuelles, 900,
    '« soit 600 € hors charges » a été pris pour des charges de copropriété.');
  assert.equal(r.prix_affiche, 120000);
  // La période : par mois → l'année ; non dite → l'année (loi ALUR).
  assert.equal(lu(ctx, 'Charges : 100 € par mois').charges_annuelles, 1200);
  assert.equal(lu(ctx, 'Charges de copropriété : 1 500 €').charges_annuelles, 1500);
  assert.equal(lu(ctx, 'Loyer annuel : 7 200 €/an').loyer_en_etat, 600);
  // Copié depuis une page web, les milliers sont séparés par des espaces insécables.
  const web = lu(ctx, 'Appartement 2\u00a0pièces 42\u00a0m²\nLyon (69004)\n168\u202f000\u00a0€\nCharges annuelles\u00a0: 1\u00a0200\u00a0€');
  assert.deepEqual([web.prix_affiche, web.surface_m2, web.charges_annuelles], [168000, 42, 1200],
    'Les espaces insécables d\'une page web empêchent de lire les montants.');
  // Les frais de notaire cités ne deviennent pas le prix : le plus grand montant gagne.
  assert.equal(lu(ctx, 'Lyon 69004 168 000 € appartement 2 pièces, frais de notaire 12 600 €.').prix_affiche, 168000);
});

test('ville et code postal : sous toutes leurs formes, et jamais un montant', () => {
  const ctx = app();
  const lieu = t => { const r = lu(ctx, t); return [r.ville, r.code_postal]; };
  assert.deepEqual(lieu('Lyon 4ème (69004)'), ['Lyon', '69004']);
  assert.deepEqual(lieu('Appartement à Aix en Provence 13100 T2'), ['Aix en Provence', '13100']);
  assert.deepEqual(lieu('13100 Aix en Provence, T2 45 m²'), ['Aix en Provence', '13100']);
  assert.deepEqual(lieu('Le Havre (76600) maison 4 pièces'), ['Le Havre', '76600'], 'l\'article fait partie du nom');
  assert.deepEqual(lieu('Lyon 69004 168 000 €'), ['Lyon', '69004']);
  assert.deepEqual(lieu('Prix 95000 €, appartement 3 pièces'), [null, null],
    '« Prix 95000 € » est un montant, pas le code postal de Cergy.');
  assert.deepEqual(lieu('Appartement T3. Exceptionnel 95000 € net vendeur'), [null, null],
    'Un nombre suivi de l\'euro a été lu comme un code postal.');
  assert.deepEqual(lieu('<img src=x onerror=alert(1)> (69004)'), [null, null], 'une balise ne devient jamais une ville');
  assert.deepEqual(lieu('Bonjour, merci de me rappeler.'), [null, null]);
});

test('un texte sans annonce ne remplit rien, et le type vient de TI_BIENS', () => {
  const ctx = app();
  const vide = lu(ctx, 'Bonjour, je vous contacte au sujet de votre annonce.');
  assert.ok(Object.values(vide).every(v => v === null), 'rien de reconnu : tout vaut null, jamais 0');
  const types = Array.from(lire(ctx, 'TI_BIENS.TYPES'));
  for (const t of ['Studio 20 m²', 'T1 bis', 'Appartement 2 pièces', 'F3 lumineux', '4 pièces', 'Maison 6 pièces',
                   'Vente parking en sous-sol', 'Immeuble de rapport de 5 lots']) {
    const r = lu(ctx, t).type_bien;
    assert.ok(r && types.includes(r), `« ${t} » donne « ${r} », absent de TI_BIENS.TYPES`);
  }
  assert.equal(lu(ctx, 'Bel appartement de 3 pièces dans un immeuble ancien').type_bien, 'T3',
    '« dans un immeuble » ne fait pas un immeuble de rapport');
});

// ─── La source et le titre ─────────────────────────────────────────────────

test('la source ne vient que du vrai domaine d\'un portail', () => {
  const ctx = app();
  const s = u => ctx.sfSourceDepuisLien(u);
  assert.equal(s('https://www.seloger.com/annonces/123.htm'), 'SeLoger');
  assert.equal(s('https://m.leboncoin.fr/ad/1'), 'LeBonCoin');
  assert.equal(s('https://www.bienici.com/annonce/x'), "Bien'ici");
  assert.equal(s('http://pap.fr/annonce'), 'PAP');
  for (const faux of ['https://faux-pap.fr/a', 'https://seloger.com.exemple.fr/a', 'javascript:alert(1)//seloger.com',
                      'seloger.com/annonce', '', null, 'https://www.exemple.fr/']) {
    assert.equal(s(faux), null, `« ${faux} » ne doit donner aucune source`);
  }
  const sources = Array.from(lire(ctx, 'TI_BIENS.SOURCES'));
  for (const [, v] of Array.from(lire(ctx, 'SF_SOURCES_DOMAINES'))) {
    assert.ok(sources.includes(v), `« ${v} » n'est pas une valeur de TI_BIENS.SOURCES`);
  }
});

test('le titre se propose d\'après le type, la ville et la surface', () => {
  const ctx = app();
  assert.equal(ctx.sfnTitrePropose({ type_bien: 'T2', ville: 'Lyon', surface_m2: 42 }), `T2 Lyon · 42${ESPACE_FINE}m²`);
  assert.equal(ctx.sfnTitrePropose({ type_bien: 'T3', ville: ' Bron ' }), 'T3 Bron');
  assert.equal(ctx.sfnTitrePropose({ type_bien: 'Autre', ville: 'Lyon' }), 'Bien Lyon');
  assert.equal(ctx.sfnTitrePropose({ ville: 'Lyon' }), '', 'sans type, rien à proposer');
  assert.equal(ctx.sfnTitrePropose({ type_bien: 'T2' }), '', 'sans ville, rien à proposer');
});

test('un titre écrit à la main n\'est plus jamais remplacé', () => {
  const ctx = app();
  const els = formulaire(ctx, { 'f-type': 'T2', 'f-ville': 'Lyon', 'f-surface': '42' });
  els['f-titre'].dataset.auto = '1';
  ctx.sfnTitreAuto();
  assert.equal(els['f-titre'].value, `T2 Lyon · 42${ESPACE_FINE}m²`, 'témoin : un titre vide se propose');
  // L'utilisateur écrit le sien : sfnSaisie lève la marque.
  els['f-titre'].value = 'Mon T2 traversant';
  ctx.sfnSaisie({ target: els['f-titre'], type: 'input' });
  els['f-surface'].value = '45';
  ctx.sfnSaisie({ target: els['f-surface'], type: 'input' });
  assert.equal(els['f-titre'].value, 'Mon T2 traversant', 'Le titre écrit à la main a été remplacé par la proposition.');
  // Le vider relance la proposition.
  els['f-titre'].value = '';
  ctx.sfnSaisie({ target: els['f-titre'], type: 'input' });
  ctx.sfnSaisie({ target: els['f-surface'], type: 'input' });
  assert.equal(els['f-titre'].value, `T2 Lyon · 45${ESPACE_FINE}m²`);
});

// ─── Les montants saisis à l'année ─────────────────────────────────────────

test('charges et taxe foncière : saisies à l\'année, comptées par mois, sans perte', () => {
  const ctx = app();
  const annuels = Array.from(lire(ctx, 'SFN_SECTIONS')).flatMap(s => Array.from(s.champs)).filter(c => c.annuel).map(c => c.k);
  assert.deepEqual(annuels, ['charge_copro', 'taxe_fonciere']);
  formulaire(ctx, { 'f-titre': 'T2', 'f-type': 'T2', 'f-copro': '1 200', 'f-taxe': '800' });
  const d = ctx.getFormData();
  assert.equal(d.charge_copro, 100, 'Les charges annuelles sont enregistrées telles quelles : la fiche les compte par mois.');
  assert.ok(Math.abs(d.taxe_fonciere * 12 - 800) < 1e-9, 'la taxe revient à 800 € par an, sans arrondi perdu');
  // L'aller-retour : une fiche à 30 €/mois s'affiche à 360 €/an et revient à 30.
  const champ = { k: 'charge_copro', id: 'f-copro', annuel: true, aide: 'x' };
  const html = ctx.sfnChamp(champ, { charge_copro: 30 });
  assert.match(html, /value="360"/, 'le champ annuel affiche douze fois la valeur mensuelle');
  assert.match(html, /€\/an/);
  formulaire(ctx, { 'f-copro': '360' });
  assert.equal(ctx.getFormData().charge_copro, 30);
  // Et la synthèse lit la valeur mensuelle, par getFormData (source unique).
  formulaire(ctx, { 'f-titre': 'T2', 'f-type': 'T2', 'f-ville': 'Lyon', 'f-prix': '100 000', 'f-loyer': '700', 'f-copro': '1 200', 'f-assurance': '' });
  assert.equal(ctx.sfnSynthese().data.charge_copro, 100);
  assert.match(corps('getFormData'), /charge_copro:m\('f-copro'\)[\s\S]*taxe_fonciere:m\('f-taxe'\)/,
    'getFormData ne passe plus les montants annuels par sfnChampAnnuel');
});

// ─── Coller l'annonce ──────────────────────────────────────────────────────

test('coller l\'annonce remplit les champs vides et laisse les autres tels quels', () => {
  const ctx = app();
  const els = formulaire(ctx, { 'f-prix': '150 000', 'f-surface': '12 a', 'sfn-annonce-texte': ANNONCES.seloger });
  const r = ctx.sfnRemplirDepuisAnnonce();
  assert.equal(els['f-prix'].value, '150 000', 'Un prix déjà saisi a été remplacé par celui de l\'annonce.');
  assert.equal(els['f-surface'].value, '12 a', 'Une saisie illisible n\'est pas vide : on ne l\'écrase pas.');
  assert.equal(els['f-ville'].value, 'Lyon', 'témoin : un champ vide est rempli');
  assert.equal(els['f-cp'].value, '69004');
  assert.equal(els['f-type'].value, 'T2');
  assert.equal(ctx.sfLireNombre(els['f-copro'].value), 1200, 'les charges annuelles vont au champ annuel, telles quelles');
  assert.equal(els['f-source'].value, 'SeLoger');
  assert.deepEqual(Array.from(r.gardes), ['Prix', 'Surface']);
  assert.match(els['sfn-annonce-bilan'].innerHTML, /Déjà renseignés, laissés tels quels : Prix, Surface/);
});

test('le bilan de l\'annonce échappe ce qu\'il affiche', () => {
  const ctx = app();
  const els = formulaire(ctx, { 'sfn-annonce-texte': 'x' });
  ctx.sfAnnonceLire = () => ({ ville: '<img src=x onerror=alert(1)>', code_postal: null, prix_affiche: null, surface_m2: null,
    type_bien: null, loyer_en_etat: null, charges_annuelles: null, taxe_annuelle: null, frais_agence: null, lien_annonce: null, source: null });
  ctx.sfnRemplirDepuisAnnonce();
  assert.ok(els['sfn-annonce-bilan'].innerHTML.includes('&lt;img'), 'témoin : la valeur est bien affichée');
  assert.ok(!els['sfn-annonce-bilan'].innerHTML.includes('<img'), 'Le bilan interprète un texte lu comme du HTML.');
});

test('le texte collé ne part pas sur le réseau et ne modifie pas la fiche', () => {
  const ctx = app();
  let appels = 0;
  ctx.fetch = async () => { appels++; return { ok: true, json: async () => [] }; };
  const els = formulaire(ctx, { 'f-ville': 'Lyon', 'sfn-annonce-texte': ANNONCES.seloger });
  ctx.sfnSaisie({ target: els['sfn-annonce-texte'], type: 'input' });
  assert.equal(lire(ctx, 'sfnModifie'), false, 'Coller le texte de l\'annonce marque la fiche modifiée.');
  ctx.sfnRemplirDepuisAnnonce();
  assert.equal(appels, 0, 'le texte de l\'annonce ne déclenche aucun appel réseau');
  for (const f of ['sfAnnonceLire', 'sfAnnonceMontants', 'sfnRemplirDepuisAnnonce']) {
    assert.doesNotMatch(corps(f), /fetch\(|db\./, `${f} appelle le réseau`);
  }
});

// ─── Le code postal et la ville ────────────────────────────────────────────

function geo(ctx, reponses) {
  const appels = [];
  ctx.fetch = async (url) => {
    appels.push(url);
    const r = typeof reponses === 'function' ? await reponses(url) : reponses;
    if (r instanceof Error) throw r;
    return { ok: r !== 500, json: async () => r };
  };
  return appels;
}
const LYON = { nom: 'Lyon', code: '69123', codesPostaux: ['69001', '69002', '69003', '69004', '69005', '69006', '69007', '69008', '69009'] };

test('le code postal remplit une ville vide, et propose quand il y en a plusieurs', async () => {
  const ctx = app();
  let els = formulaire(ctx, { 'f-cp': '69004' });
  const appels = geo(ctx, [LYON]);
  await ctx.sfnGeoDepuisCp();
  assert.equal(els['f-ville'].value, 'Lyon');
  assert.match(appels[0], /^https:\/\/geo\.api\.gouv\.fr\/communes\?codePostal=69004&/);
  els = formulaire(ctx, { 'f-cp': '01090' });
  geo(ctx, [{ nom: 'Guéreins', codesPostaux: ['01090'] }, { nom: 'Montmerle-sur-Saône', codesPostaux: ['01090'] }]);
  await ctx.sfnGeoDepuisCp();
  assert.equal(els['f-ville'].value, '', 'plusieurs communes : on propose, on ne choisit pas');
  assert.match(els['f-cp-geo'].innerHTML, /data-v="Montmerle-sur-Saône"/);
});

test('une ville saisie n\'est jamais remplacée par le code postal', async () => {
  const ctx = app();
  const els = formulaire(ctx, { 'f-cp': '69004', 'f-ville': 'Caluire-et-Cuire' });
  const appels = geo(ctx, [LYON]);
  await ctx.sfnGeoDepuisCp();
  assert.equal(els['f-ville'].value, 'Caluire-et-Cuire', 'Le code postal a remplacé une ville saisie.');
  assert.equal(appels.length, 0, 'et la question n\'est même pas posée');
});

test('la ville donne son code postal seulement si le nom correspond exactement', async () => {
  const ctx = app();
  let els = formulaire(ctx, { 'f-ville': 'villeurbanne' });
  geo(ctx, [{ nom: 'Villeurbanne', codesPostaux: ['69100'] }]);
  await ctx.sfnGeoDepuisVille();
  assert.equal(els['f-cp'].value, '69100', 'témoin : casse et accents mis à part, le nom correspond');
  els = formulaire(ctx, { 'f-ville': 'Villeurban' });
  geo(ctx, [{ nom: 'Villeurbanne', codesPostaux: ['69100'] }]);
  await ctx.sfnGeoDepuisVille();
  assert.equal(els['f-cp'].value, '', '« Villeurban », un nom inachevé, a reçu le code postal de Villeurbanne.');
  els = formulaire(ctx, { 'f-ville': 'Lyon' });
  geo(ctx, [LYON]);
  await ctx.sfnGeoDepuisVille();
  assert.equal(els['f-cp'].value, '', 'plusieurs codes postaux : on propose');
  assert.equal((els['f-cp-geo'].innerHTML.match(/class="sf-choix__o"/g) || []).length, 9);
});

test('RÉGRESSION — une réponse en retard n\'écrase pas une saisie plus récente', async () => {
  const ctx = app();
  const els = formulaire(ctx, { 'f-cp': '69004' });
  let lacher;
  geo(ctx, url => (/69004/.test(url) ? new Promise(r => { lacher = () => r([LYON]); }) : [{ nom: 'Bron', codesPostaux: ['69500'] }]));
  const premiere = ctx.sfnGeoDepuisCp();
  els['f-cp'].value = '69500';
  await ctx.sfnGeoDepuisCp();
  assert.equal(els['f-ville'].value, 'Bron');
  els['f-ville'].value = '';
  lacher();
  await premiere;
  assert.equal(els['f-ville'].value, '', 'La réponse pour 69004, arrivée en retard, a écrit sa ville.');
});

test('un service muet ou une réponse inattendue ne remplissent rien et ne lèvent rien', async () => {
  for (const reponse of [500, new Error('réseau'), { erreur: 'pas un tableau' }, [{ nom: 42 }, null, { codesPostaux: ['x'] }]]) {
    const ctx = app();
    const els = formulaire(ctx, { 'f-cp': '69004' });
    geo(ctx, reponse);
    await ctx.sfnGeoDepuisCp();
    assert.equal(els['f-ville'].value, '', `réponse ${JSON.stringify(String(reponse))} : rien ne doit être rempli`);
  }
});

test('les noms renvoyés par le service sont échappés', async () => {
  const ctx = app();
  const els = formulaire(ctx, { 'f-cp': '69999' });
  geo(ctx, [{ nom: '<img src=x onerror=alert(1)>', codesPostaux: ['69999'] }, { nom: 'Ville" onclick="alert(2)', codesPostaux: ['69999'] }]);
  await ctx.sfnGeoDepuisCp();
  const html = els['f-cp-geo'].innerHTML;
  assert.ok(html.includes('&lt;img'), 'témoin : les choix sont bien proposés');
  assert.ok(!html.includes('<img') && !html.includes('" onclick="alert'), 'Un nom de commune est interprété comme du HTML.');
});
