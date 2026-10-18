/* UN MONTANT SE SAISIT COMME IL S'AFFICHE (v=103).

   ⚠️ CE QUI ÉTAIT FAUX.
   · Dix-neuf champs de montant hors de la fiche d'un bien (encaissement,
     charge, retenue sur dépôt, locataire, associés, capital de SCI,
     amortissements, préférences) étaient en `type="number"`. Selon l'appareil
     et la langue du navigateur, « 1 200 » ou « 850,50 » y était refusé : le
     champ rendait une valeur VIDE, enregistrée à 0 sans un mot. Le capital de
     SCI affichait même « 1 000 » en exemple — la forme exacte qu'il refusait.
   · `parseFloat(x) || 33` remplaçait une assurance saisie à 0 € par 33 €, et
     des frais de notaire à 0 par 7 % : un chiffre inventé à la place d'une
     saisie.

   LA RÈGLE. Champ texte au clavier numérique (`inputmode`), lu par
   sfLireNombre(). Vide : la valeur par défaut annoncée, ou rien. Illisible :
   refusé, en le disant. Seuls restent en `type="number"` trois entiers courts
   sans séparateur possible (jour du mois, jours de rappel, année). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const MASQUE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const ENTIERS = ['loc-jour-paiement', 'ech-rappel', 'bil-annee'];

test('aucun montant n’est saisi dans un champ `type="number"`', () => {
  const champs = [...MASQUE.matchAll(/<input\b[^>]*type="number"[^>]*>/g), ...INDEX.matchAll(/<input\b[^>]*type="number"[^>]*>/g)]
    .map(m => m[0]);
  const intrus = champs.filter(c => !ENTIERS.some(id => c.includes(`id="${id}"`)));
  assert.deepEqual(intrus, [],
    'Montant en type="number" : « 1 200 » ou « 850,50 » y est refusé selon l’appareil, et la valeur part vide.');
  // Témoin : les champs convertis sont bien des champs texte au clavier numérique.
  for (const id of ['enc-montant', 'charge-montant', 'loc-loyer', 'loc-depot', 'pref-assurance', 'dp-retenue']) {
    assert.match(MASQUE, new RegExp(`id="${id}"[^>]*inputmode="decimal"|inputmode="decimal"[^>]*id="${id}"`),
      `témoin : ${id} est un champ texte au clavier numérique`);
  }
  assert.match(INDEX, /id="sci-capital"[^>]*type="text" inputmode="decimal"/, 'le capital de SCI refusait « 1 000 », son propre exemple');
});

test('aucune saisie n’est plus lue par parseFloat', () => {
  /* `parseFloat('1 200')` vaut 1 ; `parseFloat('850,50')` vaut 850. */
  const lectures = [...MASQUE.matchAll(/parseFloat\(\s*(?:document\.getElementById\([^)]*\)[^)]*|this\.value|e\.target\.value)\)/g)].map(m => m[0]);
  assert.deepEqual(lectures, [], 'une saisie est lue par parseFloat : passer par sfLireNombre()');
});

function prefs(valeurs) {
  const ctx = charger();
  const champs = {};
  for (const [id, v] of Object.entries(valeurs)) champs[id] = { value: v, focus() { champs.__focus = id; } };
  ctx.document.getElementById = id => champs[id] || null;
  const appels = [];
  const notifs = [];
  ctx.showNotif = (m, err) => notifs.push([m, !!err]);
  injecter(ctx, { currentUser: { id: 'u1' } });
  return { ctx, champs, appels, notifs };
}

test('préférences : une assurance à 0 € reste 0 €, un champ vide reprend la valeur annoncée', async () => {
  const essai = async (valeurs) => {
    const { ctx, notifs, champs } = prefs(valeurs);
    const rpc = [];
    const proxy = new Proxy(function () {}, { get: (_, p) => p === 'then' ? (r => Promise.resolve({ data: null, error: null }).then(r)) : () => proxy, apply: () => proxy });
    lire(ctx, 'db').rpc = (nom, args) => { rpc.push([nom, args]); return proxy; };
    lire(ctx, 'db').from = () => proxy;
    await ctx.saveMyPreferences();
    return { rpc: rpc.find(([n]) => n === 'update_my_preferences'), notifs, focus: champs.__focus };
  };
  const zero = await essai({ 'pref-notaire': '0', 'pref-duree': '25', 'pref-assurance': '0', 'pref-seuil': '4,5' });
  assert.ok(zero.rpc, 'témoin : les préférences sont envoyées');
  assert.equal(zero.rpc[1].p_assurance_mois, 0, 'une assurance saisie à 0 € devenait 33 €');
  assert.equal(zero.rpc[1].p_notaire_pct, 0, 'des frais de notaire à 0 devenaient 7 %');
  assert.equal(zero.rpc[1].p_seuil_rentabilite, 4.5, 'la virgule décimale se lit');
  assert.equal(zero.rpc[1].p_duree_credit_ans, 25);

  const vides = await essai({ 'pref-notaire': '', 'pref-duree': '', 'pref-assurance': '', 'pref-seuil': '' });
  assert.deepEqual([vides.rpc[1].p_notaire_pct, vides.rpc[1].p_duree_credit_ans, vides.rpc[1].p_assurance_mois, vides.rpc[1].p_seuil_rentabilite],
    [7, 20, 33, 5], 'un champ vide reprend la valeur par défaut annoncée dans son « ? »');

  const illisible = await essai({ 'pref-notaire': '7', 'pref-duree': '20', 'pref-assurance': 'trente', 'pref-seuil': '5' });
  assert.equal(illisible.rpc, undefined, 'une saisie illisible ne doit rien envoyer');
  assert.equal(illisible.focus, 'pref-assurance', 'le champ fautif reprend le focus');
  assert.match(illisible.notifs[0][0], /Assurance/, 'le message nomme le champ');

  const hors = await essai({ 'pref-notaire': '7', 'pref-duree': '20,5', 'pref-assurance': '33', 'pref-seuil': '5' });
  assert.equal(hors.rpc, undefined, 'une durée non entière est refusée');
});

test('locataire : « 1 200 » se lit, une saisie illisible est refusée au lieu d’être enregistrée à 0', async () => {
  const ctx = charger();
  const valeurs = { 'loc-nom': 'Durand', 'loc-loyer': '1 200', 'loc-charges': '85,50', 'loc-depot': '', 'loc-revenus': '2 800', 'loc-garant-revenus': '' };
  const champs = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, { value: v, focus() { champs.__focus = k; } }]));
  ctx.document.getElementById = id => champs[id] || null;
  ctx.document.querySelector = () => null;
  injecter(ctx, { currentUser: { id: 'u1' } });
  const d = ctx.getLocataireFormData();
  assert.equal(d.loyer_bail_hc, 1200, '« 1 200 » valait 1 avec parseFloat');
  assert.equal(d.charges_bail, 85.5, 'la virgule décimale se lit');
  assert.equal(d.depot_garantie, 0, 'un champ vide reste à 0, comme avant');
  assert.equal(d.revenus_mensuels, 2800);

  champs['loc-loyer'].value = 'mille';
  const notifs = [];
  ctx.showNotif = (m, err) => notifs.push([m, !!err]);
  let ecrit = false;
  lire(ctx, 'db').from = () => { ecrit = true; return new Proxy({}, { get: () => () => ({}) }); };
  await ctx.saveLocataire();
  assert.equal(ecrit, false, 'un loyer illisible ne doit rien écrire');
  assert.equal(champs.__focus, 'loc-loyer');
  assert.match(notifs[0][0], /Loyer illisible/);
});

test('sfValeurChamp : zéro reste zéro, rien reste vide, les milliers sont espacés', () => {
  const ctx = charger();
  assert.equal(ctx.sfValeurChamp(0), '0', 'une assurance à 0 € affichée vide repartait à 33 €');
  assert.equal(ctx.sfValeurChamp(null), '');
  assert.equal(ctx.sfValeurChamp(''), '');
  assert.equal(ctx.sfValeurChamp(1250.5), '1 250,5');
  assert.equal(ctx.sfLireNombre(ctx.sfValeurChamp(1250.5)), 1250.5, 'ce qu’un champ affiche se relit');
});
