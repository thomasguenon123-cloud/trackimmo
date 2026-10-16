/* LES AIDES « ? » — v=100, arbitrage de Thomas du 16/10.

   La règle : derrière le « ? », les EXPLICATIONS (pourquoi un chiffre manque,
   ce qu'il couvre, à quoi sert une page, un champ, une section, l'explication
   d'un état vide). Restent visibles : les chiffres, leur unité ou leur période
   quand elle en change le sens, les données et les jugements qui doublent une
   couleur.

   ⚠️ CE QUE CES GARDES EMPÊCHENT DE REVENIR :
     · une explication réaffichée en petit sous un chiffre ou un champ ;
     · un « ? » posé dans un bouton, un lien, un libellé ou un <summary> — un
       bouton dans un bouton n'est pas du HTML, et le tap déclencherait les deux ;
     · une aide de champ qui ne décrit plus son champ pour un lecteur d'écran ;
     · et surtout les deux défauts trouvés au banc le 16/10, qu'aucun test ne
       voyait parce qu'aucun ne RENDAIT ces écrans : « Mes biens » levait une
       ReferenceError (variables d'aide jamais déclarées), et la lecture d'une
       simulation aussi (`${N}` écrit à la place d'une espace fine). Les écrans
       sont donc rendus ici, pour de vrai.

   Validé par mutation le 16/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const MASQUE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const N = ' ';

const BIENS = [
  { id: 'a1', titre: 'T3 Lyon', ville: 'Lyon', statut: 'Acheté', mode_detention: 'propre', prix_affiche: 210000,
    frais_notaire: 14700, loyer_en_etat: 780, mensualite_credit: 980, is_test: false },
  { id: 'r1', titre: 'T2 Lyon', ville: 'Lyon', statut: '1ère offre - Envoyée', prix_affiche: 168000,
    frais_notaire: 11760, loyer_en_etat: 780, mensualite_credit: 690, is_test: false },
  { id: 'r2', titre: 'Studio', ville: 'Villeurbanne', statut: 'Renseignements Web', prix_affiche: 99000, is_test: false },
  { id: 't1', titre: 'T3 Test', ville: 'Lyon', statut: 'Renseignements Web', prix_affiche: 220000, loyer_en_etat: 1050, is_test: true },
];

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 16, 12) });
  injecter(ctx, {
    currentUser: { id: 'u1' }, currentProfile: { role: 'user' }, allBiens: BIENS.map(b => ({ ...b })),
    sfBiensCharges: true, userPrefs: { notaire_pct: 7, duree_credit_ans: 20, assurance_mois: 33, seuil_rentabilite: 5, taux_credit: null },
  });
  return ctx;
}

/* Un « ? » ne vit jamais dans un bouton, un lien, un libellé ou un <summary>.
   Une pile de balises suffit : les gabarits rendus sont bien formés. */
function aidesMalPlacees(html) {
  const pile = [], fautes = [];
  const vides = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'source']);
  const re = /<\/?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (m[0][1] === '/') { const i = pile.lastIndexOf(tag); if (i >= 0) pile.length = i; continue; }
    if (vides.has(tag) || m[0].endsWith('/>')) continue;
    if (tag === 'span' && /class="sf-lex sf-aide"/.test(m[2])) {
      const interdit = pile.find(t => ['button', 'a', 'label', 'summary'].includes(t));
      if (interdit) fautes.push(`<${interdit}> … ? : ${html.slice(Math.max(0, m.index - 90), m.index).replace(/\s+/g, ' ')}`);
    }
    pile.push(tag);
  }
  return fautes;
}
// Le texte VISIBLE : les bulles des « ? » retirées.
const visible = html => html.replace(/<span class="sf-lex__x"[^>]*>[\s\S]*?<\/span><\/span>/g, '');
const nbAides = html => (html.match(/class="sf-lex sf-aide"/g) || []).length;

// ─── Le composant ──────────────────────────────────────────────────────────

test('sfAide : un vrai bouton, fermé, nommé, qui ne déclenche pas la ligne', () => {
  const ctx = app();
  const h = ctx.sfAide('Les loyers <b>encaissés</b>.', 'Loyers « encaissés »', 'f-x-aide');
  assert.match(h, /^<span class="sf-lex sf-aide"><button type="button" class="sf-lex__b"/);
  assert.match(h, /aria-label="En savoir plus : Loyers « encaissés »"/, 'le bouton dit ce qu\'il explique');
  assert.match(h, /aria-expanded="false"/);
  assert.match(h, /onclick="event\.stopPropagation\(\); sfLexOuvrir\(this\)"/, 'Dans une ligne cliquable, toucher le « ? » ouvrirait aussi la fiche.');
  assert.match(h, /<span class="sf-lex__x" role="tooltip" id="f-x-aide" hidden>Les loyers <b>encaissés<\/b>\.<\/span>/,
    'la bulle est fermée, et son id permet à un champ de s\'en servir comme description');
  assert.equal(ctx.sfAide('', 'x'), '', 'sans explication, pas de « ? » qui n\'explique rien');
  assert.match(ctx.sfAide('a', '<img>'), /aria-label="En savoir plus : &lt;img&gt;"/, 'le sujet est échappé');
});

test('Échap referme la bulle ouverte et rend le focus à son « ? »', () => {
  const i = MASQUE.indexOf("document.addEventListener('keydown'");
  assert.ok(i > 0, 'aucun écouteur clavier pour les bulles');
  const corps = MASQUE.slice(i, MASQUE.indexOf('}, true);', i));
  assert.match(corps, /e\.key !== 'Escape'/);
  assert.match(corps, /\.sf-lex__b\[aria-expanded="true"\]/);
  assert.match(corps, /if\(!ouverts\.length\) return;/, 'sans bulle ouverte, Échap garde son rôle (fermer une fenêtre)');
  assert.match(corps, /b\.focus\(\)/);
});

// ─── Les écrans, rendus ────────────────────────────────────────────────────

test('l\'accueil : les explications derrière les « ? », les unités et les chiffres visibles', () => {
  const ctx = app();
  const el = { innerHTML: '' };
  ctx.renderAccueil(el);
  const h = el.innerHTML;
  assert.ok(nbAides(h) >= 6, `trop peu d'aides sur l'accueil (${nbAides(h)})`);
  assert.deepEqual(aidesMalPlacees(h), []);
  assert.doesNotMatch(h, /sf-quick__sub/, 'Les boutons d\'action rapide ont retrouvé une sous-ligne.');
  assert.doesNotMatch(visible(h), /loyers moins charges et crédit|mois loués sur|sans loyer estimé|les dates qui coûtent cher/,
    'Une explication de l\'accueil est réaffichée en petit.');
  assert.match(h, /sf-kpi__sub">par mois</, 'témoin : l\'unité du cashflow reste visible');
  assert.match(h, /les dates qui coûtent cher/, 'témoin : l\'explication existe toujours, dans sa bulle');
});

test('Mes biens : les chiffres clés se rendent, chacun avec son « ? »', () => {
  const ctx = app();
  const els = { 'sfb-kpis': { innerHTML: '', style: {} }, 'sfb-foot': { innerHTML: 'ancien pied', style: {} } };
  ctx.document.getElementById = id => els[id] || null;
  const rendu = {};
  for (const onglet of ['prospect', 'detenus']) {
    injecter(ctx, { bienOnglet: onglet, currentView: 'tableau' });
    ctx.renderBiensContent(ctx.allBiens || BIENS);   // ⚠️ levait une ReferenceError le 16/10
    const k = els['sfb-kpis'].innerHTML;
    assert.equal(nbAides(k), 4, `onglet ${onglet} : chaque chiffre clé porte son « ? »`);
    assert.doesNotMatch(k, /sfb-kpi__s\b/, 'une explication est revenue sous un chiffre clé');
    assert.deepEqual(aidesMalPlacees(k), []);
    assert.equal(els['sfb-foot'].innerHTML, '', 'le pied de tableau ne répète plus les exclusions');
    rendu[onglet] = k;
  }
  // La prospection compte une fiche de test et une fiche incomplète : leurs « ? » le disent.
  assert.match(rendu.prospect, /1 fiche de test figure dans la liste sans entrer dans les indicateurs/,
    'ce que les indicateurs écartent se dit dans leur « ? »');
  assert.match(rendu.prospect, /Elle est exclue des indicateurs/);
});

test('la lecture d\'une simulation se rend, l\'endettement expliqué derrière son « ? »', () => {
  const ctx = app();
  const el = { innerHTML: '' };
  const s = { id: 's1', bien_id: 'r1', nom_simulation: 'Offre', montant_emprunte: 170000, taux_interet: 3.45, duree_ans: 25,
    assurance_mensuelle: 30, revenus_mensuels: 3200, loyer_exige_banque: 780, retenue: false };
  ctx.sfsRenderLecture(el, s, true);   // ⚠️ levait « N is not defined » le 16/10
  const h = el.innerHTML;
  assert.match(h, new RegExp(`Le plafond est de 35${N}%`), 'l\'aide de l\'endettement dit le plafond, avec son espace fine');
  assert.doesNotMatch(h, /\$\{/, 'un gabarit non interprété est passé à l\'écran');
  assert.match(visible(h), /dans la limite de 35/, 'témoin : le jugement reste visible');
  assert.deepEqual(aidesMalPlacees(h), []);
});

test('Préférences métier : chaque champ a son « ? », hors du libellé', () => {
  const ctx = app();
  const h = ctx.paramsMetierHtml();
  assert.doesNotMatch(h, /params-field-hint/, 'une aide est revenue sous un champ des Préférences');
  for (const id of ['pref-notaire', 'pref-duree', 'pref-assurance', 'pref-seuil', 'pref-taux']) {
    assert.match(h, new RegExp(`<span class="sf-tete"><label class="params-field-label" for="${id}">[^<]+</label><span class="sf-lex sf-aide">`),
      `${id} : le libellé n'est plus relié à son champ, ou son « ? » manque`);
  }
  assert.deepEqual(aidesMalPlacees(h), []);
});

test('formulaire d\'un bien : l\'aide d\'un champ reste sa description, la donnée calculée reste visible', () => {
  const ctx = app();
  const loyer = ctx.sfnChamp({ k: 'loyer_en_etat', id: 'f-loyer', aide: 'Hors charges, tel qu’annoncé ou estimé.' }, null);
  assert.match(loyer, /id="f-loyer"[^>]*aria-describedby="f-loyer-aide f-loyer-err"|aria-describedby="f-loyer-aide f-loyer-err"[^>]*id="f-loyer"/,
    'le champ n\'est plus décrit par son aide');
  assert.match(loyer, /role="tooltip" id="f-loyer-aide" hidden>Hors charges/, 'la bulle porte l\'id que le champ cite');
  assert.doesNotMatch(loyer, /<p class="sf-hint" id="f-loyer-aide"/, 'l\'aide est revenue en petit sous le champ');
  assert.deepEqual(aidesMalPlacees(loyer), []);
  const copro = ctx.sfnChamp({ k: 'charge_copro', id: 'f-copro', annuel: true, aide: 'Le montant annuel.' }, null);
  assert.match(copro, /<p class="sf-hint sfn-mois" id="f-copro-mois"><\/p>/, '« Soit X € par mois » est une donnée : elle reste sous le champ');
});

// ─── Le code source ────────────────────────────────────────────────────────

test('les familles d\'explications ne reviennent pas dans le code', () => {
  // Témoin : le masquage des commentaires laisse le code.
  assert.ok((MASQUE.match(/sfAide\(/g) || []).length >= 60, 'le masquage a effacé du code, ou les aides ont disparu');
  assert.doesNotMatch(MASQUE, /sf-quick__sub/, 'les sous-lignes des actions rapides');
  assert.doesNotMatch(MASQUE, /sfb-kpi__s\b/, 'les explications sous les chiffres de Mes biens');
  const vides = MASQUE.match(/class="sff-empty__x">[^<]*/g) || [];
  assert.deepEqual(vides.filter(v => !/error\.message/.test(v)), [],
    'un état vide réaffiche son explication au lieu de la ranger derrière le « ? » de son titre (seules les erreurs restent lues)');
  assert.deepEqual((MASQUE.match(/class="params-field-hint">[^<]*/g) || []).filter(v => !/sfAccIcon\('lock'/.test(v + MASQUE.slice(MASQUE.indexOf(v), MASQUE.indexOf(v) + 60))), [],
    'une aide de champ des Paramètres est revenue en petit');
  assert.doesNotMatch(SRC, /\$\{N\}/, 'un « ${N} » de script est passé dans le code de l\'application');
});
