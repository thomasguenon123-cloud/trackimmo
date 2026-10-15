/* LE SIMULATEUR DE CRÉDIT — la v=99, à la charte.

   ⚠️ CE QUE CES GARDES EMPÊCHENT DE REVENIR :
     · une mensualité, un coût ou un endettement calculés SANS l'assurance
       emprunteur ;
     · un endettement jugé à 33 % / 40 % au lieu du plafond bancaire de 35 %,
       ou « nul » quand les revenus ne sont pas saisis ;
     · deux calculs qui divergent : la liste, la lecture, la saisie, la fiche et
       le dossier banque passent tous par sfSimCalcul ;
     · une offre lue en PDF qui écrase une saisie, et la mention « Claude
       extraira automatiquement » d'une lecture qui n'a rien d'une IA ;
     · un double appui qui enregistre deux simulations ;
     · deux simulations retenues pour un même bien, ou une simulation retenue
       dont la mensualité ne passe pas sur la fiche ;
     · un taux proposé inventé, ou repris d'une réponse réseau sans contrôle ;
     · un texte libre (nom, titre de bien) interprété comme du HTML.

   Les gardes sont validées par mutation le 15/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const REEL = { id: 'b-reel', titre: 'T2 Lyon', ville: 'Lyon', is_test: false, prix_affiche: 160000, frais_notaire: 11200,
  travaux: 8000, loyer_en_etat: 780, mensualite_credit: 690, duree_credit_ans: 20, statut: '1ère offre - Envoyée' };
const TEST = { id: 'b-test', titre: 'T3 Test', ville: 'Lyon', is_test: true };

function app({ biens = [REEL, TEST], prefs = null } = {}) {
  const ctx = charger({ maintenant: new Date(2026, 9, 15, 12) });
  ctx.showNotif = () => {};
  ctx.pages = [];
  ctx.navigate = (p) => { ctx.pages.push(p); };
  injecter(ctx, {
    currentUser: { id: 'u1', email: 'membre@exemple.fr' },
    currentProfile: { role: 'user' },
    allBiens: biens.map(b => ({ ...b })), sfBiensCharges: true, currentPage: 'simulation',
    userPrefs: prefs || { notaire_pct: 7, duree_credit_ans: 20, assurance_mois: 33, seuil_rentabilite: 5 },
  });
  return ctx;
}

// Client Supabase qui enregistre les appels (même procédé que comptes-rendus.test.js).
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
const ecritures = appels => appels.filter(a => a.ops.some(o => ['insert', 'update', 'delete'].includes(o[0])));

function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/* Un écran de saisie : les champs que lit `sfsLireEcran`. */
function ecran(ctx, champs) {
  const els = {};
  for (const [id, value] of Object.entries(champs)) {
    els[id] = { id, value, hidden: false, textContent: '', innerHTML: '', disabled: false, isConnected: true,
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, focus() {} };
  }
  els['sfs-enregistrer'] = { disabled: false, textContent: '', isConnected: true };
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelector = () => null;
  ctx.document.querySelectorAll = () => [];
  return els;
}
const SAISIE = { 's-nom': 'Offre CA 25 ans', 's-bien': 'b-reel', 's-date-doc': '2026-10-02', 's-montant': '170 000',
  's-taux': '3,45', 's-duree': '25', 's-assurance': '30', 's-revenus': '3 200', 's-loyer-banque': '1 000', 's-notes': '' };

// ─── Le calcul ─────────────────────────────────────────────────────────────

test('la mensualité compte l\'assurance, le coût total aussi', () => {
  const ctx = app();
  const c = ctx.sfSimCalcul({ montant: 170000, taux: 3.45, duree: 25, assurance: 30, revenus: 3200, loyer: 1000 });
  assert.equal(c.calculable, true);
  assert.equal(Math.round(c.horsAss * 100) / 100, 846.51, 'mensualité d\'un prêt amortissable');
  assert.equal(Math.round(c.mens * 100) / 100, 876.51, 'La mensualité affichée oublie l\'assurance emprunteur.');
  assert.equal(Math.round(c.interets), 83952);
  assert.equal(Math.round(c.coutTotal), 83952 + 30 * 300, 'le coût total compte l\'assurance sur toute la durée');
  // Les revenus retenus comptent 70 % du loyer ; l'endettement porte sur la mensualité ASSURANCE COMPRISE.
  assert.equal(c.revenusRetenus, 3900);
  assert.equal(Math.round(c.te * 1000) / 1000, 22.475);
  // Prêt à taux zéro : remboursé par parts égales (la formule usuelle y divise par zéro).
  assert.equal(Math.round(ctx.sfSimCalcul({ montant: 170000, taux: 0, duree: 25 }).mens * 100) / 100, 566.67);
  // Témoin : rien à calculer sans montant ni durée.
  assert.equal(ctx.sfSimCalcul({ montant: 0, taux: 3, duree: 20 }).calculable, false);
  assert.equal(ctx.sfSimCalcul({ montant: 100000, taux: 3, duree: 0 }).calculable, false);
});

test('l\'endettement se juge à 35 %, et ne vaut pas zéro sans revenus', () => {
  const ctx = app();
  const avec = te => ctx.sfSimEndettement({ calculable: true, te, dansLaLimite: te <= 35 });
  assert.equal(lire(ctx, 'SF_ENDETTEMENT_MAX'), 35);
  assert.equal(avec(35).etat, 'ok', '35 % pile reste dans la limite');
  assert.match(avec(35).texte, /dans la limite de 35 %/);
  assert.equal(avec(35.1).etat, 'alerte');
  assert.match(avec(35.1).texte, /au-dessus de la limite de 35 %/);
  assert.equal(avec(35.1).icone, 'alerte', 'la couleur ne porte jamais seule : une icône double le mot');
  const sans = ctx.sfSimEndettement(ctx.sfSimCalcul({ montant: 100000, taux: 3, duree: 20 }));
  assert.equal(sans.val, 'Non disponible', 'Sans revenus, l\'endettement s\'affiche comme un chiffre.');
  // Plus aucune trace des anciens seuils 33 / 40 dans ce qui juge l'endettement.
  for (const f of ['sfSimEndettement', 'sfsRenderLecture', 'bkdocBuildPages']) {
    assert.doesNotMatch(corps(f), /<=\s*33\b|<=\s*40\b|33 %|40 %/, `${f} juge encore l'endettement à 33 % ou 40 %`);
  }
});

test('un seul calcul pour la liste, la lecture, la saisie, la fiche et le dossier banque', () => {
  for (const f of ['sfsLigneHtml', 'sfsRenderLecture', 'bkdocBuildPages']) {
    assert.match(corps(f), /sfSimDepuisLigne\(/, `${f} recalcule la mensualité à sa façon`);
  }
  assert.match(corps('sfsMaj'), /sfSimCalcul\(/);
  assert.match(corps('saveSim'), /sfSimCalcul\(/);
  assert.match(corps('renderBienDetail'), /sims\.map\(s => sfsLigneHtml\(s, \{ surFiche: true \}\)\)/,
    'La fiche réécrit sa propre ligne de simulation : les deux affichages divergeront.');
  assert.match(corps('renderBienDetail'), /openNouvelleSimulation\(\$\{escJs\(b\.id\)\}\)/,
    '« Simuler ce crédit » ouvre la liste vide au lieu d\'une simulation pré-remplie pour ce bien.');
});

// ─── La saisie ─────────────────────────────────────────────────────────────

test('enregistrer : montants lus comme ils s\'écrivent, assurance comprise, un seul envoi', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: { bien_id: 'b-reel' }, sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
  ecran(ctx, SAISIE);
  const appels = dbEnregistreur(ctx, (table, ops) => ({ data: op({ ops }, 'insert') ? { id: 'sim-n1' } : [] }));
  ctx.sfConfirmer = async () => false;
  // Deux appuis rapprochés : la garde se pose avant le premier await.
  await Promise.all([ctx.saveSim(), ctx.saveSim()]);
  const ins = appels.filter(a => op(a, 'insert'));
  assert.equal(ins.length, 1, 'Deux appuis rapprochés ont enregistré deux simulations.');
  const p = JSON.parse(JSON.stringify(op(ins[0], 'insert')[1]));
  assert.equal(p.montant_emprunte, 170000, '« 170 000 » lu par sfLireNombre, pas par parseFloat');
  assert.equal(p.taux_interet, 3.45, 'la virgule décimale est lue');
  assert.equal(p.assurance_mensuelle, 30);
  assert.equal(p.mensualite_calculee, 876.51, 'La mensualité enregistrée oublie l\'assurance.');
  assert.equal(p.taux_endettement, 22.5);
  assert.equal(p.user_id, 'u1');
  assert.equal(lire(ctx, 'sfsEtat.mode'), 'lecture', 'un enregistrement ouvre la lecture');
});

test('sans la migration, rien n\'est envoyé pour l\'assurance ni la simulation retenue', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: false, sfsSimulation: { id: 's1', bien_id: 'b-reel', retenue: true }, sfsEtat: { id: 's1', mode: 'saisie', retour: { page: 'simulateur' } } });
  const champs = { ...SAISIE }; delete champs['s-assurance'];
  ecran(ctx, champs);
  const appels = dbEnregistreur(ctx);
  ctx.sfConfirmer = async () => false;
  await ctx.saveSim();
  const maj = appels.find(a => a.table === 'simulations_credit' && op(a, 'update'));
  assert.ok(maj, 'témoin : la simulation est enregistrée');
  const p = op(maj, 'update')[1];
  assert.ok(!('assurance_mensuelle' in p) && !('retenue' in p), 'Une colonne absente part en base : l\'enregistrement entier serait refusé.');
});

test('changer de bien, c\'est cesser d\'être la simulation retenue de l\'ancien', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: { id: 's1', bien_id: 'b-test', retenue: true }, sfsEtat: { id: 's1', mode: 'saisie', retour: { page: 'simulateur' } } });
  ecran(ctx, SAISIE);   // le bien passe à b-reel
  const appels = dbEnregistreur(ctx);
  ctx.sfConfirmer = async () => false;
  await ctx.saveSim();
  const p = op(appels.find(a => a.table === 'simulations_credit' && op(a, 'update')), 'update')[1];
  assert.equal(p.retenue, false, 'La simulation retenue d\'un bien le reste après avoir changé de bien.');
});

test('une saisie illisible est refusée, pas inventée', async () => {
  for (const [champ, valeur, message] of [
    ['s-montant', '170 000 x', /Montant illisible/],
    ['s-taux', '3,4,5', /Taux illisible/],
    ['s-duree', '0', /durée entière, de 1 à 40 ans/],
    ['s-assurance', 'trente', /Montant illisible/],
  ]) {
    const ctx = app();
    injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: {}, sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
    const els = ecran(ctx, { ...SAISIE, [champ]: valeur, [champ + '-err']: '' });
    const appels = dbEnregistreur(ctx);
    await ctx.saveSim();
    assert.equal(ecritures(appels).length, 0, `« ${valeur} » dans ${champ} a été enregistré.`);
    assert.match(els[champ + '-err'].textContent, message, `${champ} : le refus ne dit pas sa raison`);
  }
});

// ─── La simulation retenue ─────────────────────────────────────────────────

test('retenir : une seule par bien, et sa mensualité passe sur la fiche', async () => {
  const ctx = app();
  const sim = { id: 's1', bien_id: 'b-reel', nom_simulation: 'Offre CA', montant_emprunte: 170000, taux_interet: 3.45,
    duree_ans: 25, assurance_mensuelle: 30, retenue: false };
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: sim });
  const appels = dbEnregistreur(ctx);
  // Refuser : rien n'est écrit.
  ctx.sfConfirmer = async () => false;
  await ctx.sfsRetenir('s1');
  assert.equal(ecritures(appels).length, 0, 'refuser n\'écrit rien');
  // Accepter.
  ctx.sfConfirmer = async () => true;
  await ctx.sfsRetenir('s1');
  const w = ecritures(appels);
  assert.equal(w.length, 3, 'retirer les autres, retenir celle-ci, mettre la fiche à jour');
  assert.deepEqual(JSON.parse(JSON.stringify(op(w[0], 'update')[1])), { retenue: false },
    'L\'autre simulation retenue n\'est pas retirée AVANT : l\'index unique refuserait la seconde.');
  assert.ok(w[0].ops.some(o => o[0] === 'eq' && o[1] === 'bien_id' && o[2] === 'b-reel'), 'seules celles de ce bien');
  assert.deepEqual(JSON.parse(JSON.stringify(op(w[1], 'update')[1])), { retenue: true });
  assert.equal(w[2].table, 'biens');
  assert.deepEqual(JSON.parse(JSON.stringify(op(w[2], 'update')[1])), { mensualite_credit: 877, duree_credit_ans: 25 },
    'La fiche ne reçoit pas la mensualité assurance comprise et la durée de la simulation retenue.');
  assert.equal(lire(ctx, 'allBiens').find(b => b.id === 'b-reel').mensualite_credit, 877, 'la fiche en mémoire suit');
});

test('l\'achat rappelle le crédit retenu, sinon la mensualité de la fiche, sinon rien', () => {
  const ctx = app();
  const b = lire(ctx, 'allBiens')[0];
  injecter(ctx, { bdAcq: { credit: { nom_simulation: 'Offre CA', montant_emprunte: 170000, taux_interet: 3.45, duree_ans: 25, assurance_mensuelle: 30 } } });
  assert.match(ctx.bdAcqCreditHtml(b), /Votre crédit : <strong>877 €<\/strong> par mois, assurance comprise, sur 25 ans à 3,45 %/);
  // Le Suivi financier lit la fiche : la phrase dit ce qu'il suivra vraiment.
  assert.match(ctx.bdAcqCreditHtml(b), /La fiche compte encore <strong>690 €<\/strong> par mois : c’est ce montant que suivra le Suivi financier/,
    'L\'achat promet que le Suivi financier suivra la simulation, alors que la fiche compte une autre mensualité.');
  assert.match(ctx.bdAcqCreditHtml({ ...b, mensualite_credit: 877 }), /C’est sa mensualité que compte la fiche, et que suivra le Suivi financier\./);
  injecter(ctx, { bdAcq: { credit: null } });
  assert.match(ctx.bdAcqCreditHtml(b), /La mensualité de la fiche, <strong>690 €<\/strong>/);
  assert.equal(ctx.bdAcqCreditHtml({ ...b, mensualite_credit: 0 }), '', 'pas de crédit, pas de chiffre inventé');
});

// ─── Le taux proposé ───────────────────────────────────────────────────────

test('le taux proposé : le vôtre, sinon la moyenne officielle, sinon la dernière simulation', async () => {
  const ctx = app({ prefs: { duree_credit_ans: 20, taux_credit: 3.1 } });
  ctx.sfTauxReference = async () => ({ taux: 3.32, periode: '2026-08' });
  dbEnregistreur(ctx, () => ({ data: [{ taux_interet: 3.9 }] }));
  assert.deepEqual(JSON.parse(JSON.stringify(await ctx.sfTauxParDefaut())),
    { taux: 3.1, origine: 'preference', mention: 'Votre taux, réglé dans Préférences métier' });
  injecter(ctx, { userPrefs: { duree_credit_ans: 20, taux_credit: null } });
  const ref = await ctx.sfTauxParDefaut();
  assert.equal(ref.origine, 'reference');
  assert.equal(ref.mention, 'Taux moyen des nouveaux crédits immobiliers en France, août 2026 — Banque de France',
    'la source du taux se dit, avec son mois');
  ctx.sfTauxReference = async () => null;
  assert.equal((await ctx.sfTauxParDefaut()).origine, 'simulation', 'la source muette : le taux de la dernière simulation');
  dbEnregistreur(ctx, () => ({ data: [] }));
  assert.equal(await ctx.sfTauxParDefaut(), null, 'Sans aucune source, un taux est inventé.');
});

test('une réponse réseau n\'est reprise que contrôlée', async () => {
  const essai = async data => {
    const ctx = app();
    lire(ctx, 'db').functions = { invoke: async () => ({ data, error: null }) };
    return ctx.sfTauxReference();
  };
  assert.deepEqual(JSON.parse(JSON.stringify(await essai({ taux: 3.3215, periode: '2026-08' }))), { taux: 3.32, periode: '2026-08' });
  assert.equal(await essai({ taux: 33, periode: '2026-08' }), null, 'un taux hors bornes est rejeté');
  assert.equal(await essai({ taux: 3.3, periode: '<img src=x>' }), null, 'une période illisible est rejetée');
  assert.equal(await essai({ taux: 'abc', periode: '2026-08' }), null);
  // Le libellé affiché est écrit côté client : rien de la réponse n'entre en HTML.
  assert.doesNotMatch(corps('sfTauxMention'), /libelle|source/);
});

test('une nouvelle simulation part de ce qu\'on sait déjà du bien', async () => {
  const ctx = app();
  ctx.sfTauxParDefaut = async () => ({ taux: 3.32, origine: 'reference', mention: 'm' });
  dbEnregistreur(ctx, () => ({ data: [{ revenus_mensuels: 3200 }] }));
  const { s, taux } = await ctx.sfsPreremplir('b-reel');
  const v = JSON.parse(JSON.stringify(s));
  assert.equal(v.bien_id, 'b-reel');
  assert.equal(v.montant_emprunte, 179200, 'le coût total de l\'opération (mfMontantAcquisition)');
  assert.equal(v.loyer_exige_banque, 780, 'le loyer de la fiche');
  assert.equal(v.duree_ans, 20, 'la durée de la fiche');
  assert.equal(v.taux_interet, 3.32);
  assert.equal(v.revenus_mensuels, 3200, 'les revenus de la dernière simulation');
  assert.equal(v.nom_simulation, 'Crédit — T2 Lyon');
  assert.equal(taux.origine, 'reference');
});

// ─── L'offre en PDF ────────────────────────────────────────────────────────

test('l\'offre lue en PDF : des montants reconnus, aucune saisie écrasée, aucune IA annoncée', () => {
  const ctx = app();
  const texte = `Offre de prêt
    Montant emprunté : 170 000,00 €   Taux nominal fixe : 3,45 %   Durée : 300 mois
    Assurance emprunteur : 30,50 € par mois   Revenus mensuels : 3 200 €
    Offre valable à compter du 02/10/2026`;
  const r = JSON.parse(JSON.stringify(ctx.sfsLireOffre(texte)));
  assert.equal(r.montant, 170000);
  assert.equal(r.taux, 3.45);
  assert.equal(r.duree, 25);
  assert.equal(r.assurance, 30.5);
  assert.equal(r.revenus, 3200);
  assert.equal(r.date, '2026-10-02');
  // Un taux d'assurance invalidité (66 %) n'est pas un taux d'intérêt.
  assert.equal(ctx.sfsLireOffre('taux d\'intérêt garanti invalidité 66,00 %').taux, null);
  assert.match(corps('extractPDF'), /if \(sfLireNombre\(el\.value\) > 0\) \{ gardes\.push\(lab\); continue; \}/,
    'L\'offre lue écrase un champ déjà saisi.');
  const masque = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  assert.doesNotMatch(masque, /Claude extraira/, 'La lecture par motifs s\'annonce comme une IA.');
});

// ─── La page ───────────────────────────────────────────────────────────────

test('les textes libres ne sont jamais interprétés comme du HTML', () => {
  const ctx = app({ biens: [{ ...REEL, titre: '<img src=x onerror=alert(1)>' }] });
  const ligne = ctx.sfsLigneHtml({ id: 's1', bien_id: 'b-reel', nom_simulation: '<b>Offre</b>', montant_emprunte: 1000, taux_interet: 1, duree_ans: 10 });
  assert.ok(!ligne.includes('<img') && !ligne.includes('<b>Offre'), 'Un nom ou un titre passe brut dans la ligne.');
  assert.ok(ligne.includes('&lt;b&gt;Offre'), 'témoin : le nom est affiché, échappé');
});

test('une simulation détachée de son bien supprimé n\'est plus « retenue »', () => {
  const ctx = app();
  const sim = { id: 's1', bien_id: 'b-reel', nom_simulation: 'Offre', montant_emprunte: 1000, taux_interet: 1, duree_ans: 10, retenue: true };
  assert.match(ctx.sfsLigneHtml(sim), /sf-pill--brand/, 'témoin : retenue pour un bien qui existe');
  // ON DELETE SET NULL : le bien supprimé, bien_id passe à NULL, le drapeau reste.
  assert.doesNotMatch(ctx.sfsLigneHtml({ ...sim, bien_id: null }), /sf-pill--brand/,
    'Une simulation rattachée à aucun bien s\'affiche « Retenue ».');
});

test('la liste : une seule action principale, les biens de test hors des chiffres, un état vide complet', async () => {
  const ctx = app();
  injecter(ctx, { currentPage: 'simulateur' });
  ctx.sfTauxReference = async () => ({ taux: 3.32, periode: '2026-08' });
  const sims = [
    { id: 's1', bien_id: 'b-reel', nom_simulation: 'Offre CA', montant_emprunte: 170000, taux_interet: 3.45, duree_ans: 25 },
    { id: 's2', bien_id: 'b-test', nom_simulation: 'Offre test', montant_emprunte: 100000, taux_interet: 1.0, duree_ans: 20 },
  ];
  dbEnregistreur(ctx, () => ({ data: sims }));
  const el = { innerHTML: '' };
  await ctx.renderSimulateur(el);
  assert.equal((el.innerHTML.match(/sf-btn--primary/g) || []).length, 1, 'une seule action principale par écran');
  assert.match(el.innerHTML, /sff-kpi__l">Meilleur taux<\/span>\s*<span class="sff-kpi__v">3,45 %</,
    'Le meilleur taux est celui d\'une simulation de bien de test.');
  assert.match(el.innerHTML, /Offre test[\s\S]*?sf-pill--test">Test</, 'la simulation d\'un bien de test reste listée, marquée');
  assert.match(el.innerHTML, /<em class="sf-source">Taux moyen des nouveaux crédits immobiliers en France, août 2026 — Banque de France<\/em>/,
    'le taux moyen affiché dit sa source, en italique');
  assert.ok(!/accent-g|linear-gradient/.test(el.innerHTML), 'le bandeau vert plein est revenu');
  dbEnregistreur(ctx, () => ({ data: [] }));
  await ctx.renderSimulateur(el);
  for (const piece of ['sff-empty__ic', 'sff-empty__t', 'sff-empty__x', 'sf-btn']) {
    assert.ok(el.innerHTML.includes(piece), `état vide incomplet : ${piece} manque`);
  }
});

test('on revient d\'où l\'on vient : la fiche, sur l\'onglet Finances', () => {
  const ctx = app();
  injecter(ctx, { currentPage: 'bien-detail', currentBienId: 'b-reel', bienDetailBack: 'biens' });
  ctx.openNouvelleSimulation('b-reel');
  assert.deepEqual(JSON.parse(JSON.stringify(lire(ctx, 'sfsEtat.retour'))), { page: 'bien-detail', id: 'b-reel', back: 'biens' });
  injecter(ctx, { currentPage: 'simulation', bdVersOnglets: false });
  ctx.sfsAller(lire(ctx, 'sfsEtat.retour'));
  assert.equal(ctx.pages.at(-1), 'bien-detail');
  assert.equal(lire(ctx, 'bienDetailTab'), 'finances', 'Le retour ne rouvre pas l\'onglet du plan de financement.');
  assert.equal(lire(ctx, 'bdVersOnglets'), true, 'sur téléphone, le retour descend jusqu\'aux onglets');
  assert.equal(lire(ctx, 'bienDetailBack'), 'biens', 'la fiche retrouve son propre retour');
});

// ─── Le dossier banque et le formulaire du bien ────────────────────────────

test('le dossier banque : pas d\'entrée « bientôt », la simulation retenue choisie d\'office', () => {
  const c = corps('openDossierModal');
  assert.match(c, /bkdocCtx\.presets\.filter\(p => p\.actif\)/, 'Une banque dont la charte n\'est pas prête est proposée « (bientôt) ».');
  assert.doesNotMatch(c, /bientôt/);
  assert.match(c, /sort\(\(x, y\) => \(y\.retenue \? 1 : 0\) - \(x\.retenue \? 1 : 0\)\)/, 'la simulation retenue vient en tête');
  assert.match(c, /const choisie = duBien\[0\]\?\.id \|\| ''/, 'et elle est choisie d\'office');
});

test('le formulaire d\'un bien PROPOSE une mensualité estimée, il ne la pose jamais seul', () => {
  const ctx = app();
  const data = { prix_affiche: 160000, frais_notaire: 11200, travaux: 8000, duree_credit_ans: 20 };
  injecter(ctx, { sfnTauxEstim: null });
  assert.equal(ctx.sfnEstimationMensualite(data), null, 'sans taux, pas d\'estimation');
  injecter(ctx, { sfnTauxEstim: { taux: 3.32, origine: 'reference', mention: 'm' } });
  const e = JSON.parse(JSON.stringify(ctx.sfnEstimationMensualite(data)));
  assert.equal(e.total, 179200);
  assert.equal(e.mens, Math.round(ctx.calcMensualite(179200, 3.32, 20)));
  assert.doesNotMatch(corps('sfnEstimationMaj'), /sfnPoser\(|\.value\s*=(?!=)/, 'L\'estimation remplit la mensualité toute seule.');
  // À l'écran : une proposition sous une mensualité vide, rien sous une mensualité saisie.
  const bloc = { hidden: true, innerHTML: '' }, champ = { value: '' };
  ctx.document.getElementById = id => ({ 'f-mensualite-estim': bloc, 'f-mensualite': champ })[id] || null;
  ctx.sfnEstimationMaj(data);
  assert.equal(bloc.hidden, false);
  assert.match(bloc.innerHTML, /Utiliser cette estimation/, 'témoin : la proposition s\'affiche sous une mensualité vide');
  assert.equal(champ.value, '', 'la proposition ne touche pas au champ');
  champ.value = '690';
  ctx.sfnEstimationMaj(data);
  assert.equal(bloc.hidden, true, 'Une mensualité déjà saisie reçoit encore une proposition.');
  assert.match(corps('sfnUtiliserEstimation'), /sfnPoser\('f-mensualite'/, 'témoin : seul le bouton « Utiliser » la pose');
});
