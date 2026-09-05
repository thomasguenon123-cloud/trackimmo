/* LE TACTILE — trois invariants qui ne se vérifient pas à l'œil.

   Ce ne sont pas des tests de rendu : on ne rend rien ici. Ce sont des
   invariants STRUCTURELS sur les feuilles de style, du même genre que ceux
   qu'on a posés en base — ils disent ce qui doit rester vrai quand quelqu'un
   ajoutera une règle dans six mois.

   ⚠️ POURQUOI ILS EXISTENT. Le défaut « action révélée au seul survol » s'est
   produit DEUX FOIS dans ce dépôt : sur `.mfx-charge__a`, corrigé sous 720 px
   le mois dernier, et sur `.mfx-cell__more`, trouvé le 05/09/2026. Deux fois
   le même motif, deux fois découvert par hasard. Un test le trouvera la
   troisième fois.

   Les trois gardes sont validées par mutation le 05/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');

const FEUILLES = ['tokens.css', 'components.css', 'styles.css', 'financier.css', 'tactile.css'];
const CSS = Object.fromEntries(FEUILLES.map(f => [f, lire(f)]));
const TOUT = FEUILLES.map(f => CSS[f]).join('\n');

/* Découpe en règles `sélecteur { corps }`, EN GARDANT LA REQUÊTE MÉDIA qui les
   englobe.

   ⚠️ LE CONTEXTE MÉDIA N'EST PAS UN DÉTAIL, c'est le cœur du défaut qu'on
   garde. `.mfx-charge__a` EST rendu visible sans survol — mais uniquement sous
   `@media (max-width:720px)`. Un test qui ignore l'englobant conclut « il y a
   un repli » et laisse passer exactement le trou de l'iPad Pro, qui fait
   1024 px. Le premier jet de ce fichier avait ce défaut ; la revue l'a trouvé.

   On suit donc la profondeur d'accolades pour savoir dans quel at-rule chaque
   règle se trouve. */
function regles(css) {
  /* ⚠️ LES COMMENTAIRES D'ABORD. Ce dépôt commente abondamment, et ses
     commentaires CITENT DU CSS — « `.form-group input{font-size:13px}` » en est
     un. Leurs accolades déséquilibrent le suivi de profondeur, et le contexte
     média se décale silencieusement : le test s'est mis à accuser une règle
     parfaitement correcte. Trouvé en écrivant ce fichier. */
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0, media = [], sel = '';
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const tete = sel.trim(); sel = '';
      if (tete.startsWith('@')) { media.push(tete); i++; continue; }
      // Règle ordinaire : on lit son corps jusqu'à l'accolade fermante.
      let j = css.indexOf('}', i);
      if (j < 0) j = css.length;
      out.push({ sel: tete, corps: css.slice(i + 1, j), media: media.join(' ') });
      i = j + 1; continue;
    }
    if (c === '}') { media.pop(); sel = ''; i++; continue; }
    sel += c; i++;
  }
  return out;
}

/* Le dernier sélecteur simple d'un sélecteur composé, sans pseudo-classes. */
function cibleDe(sel) {
  return sel.trim().split(/\s*[>+~]\s*|\s+/).pop().replace(/:{1,2}[a-z-]+(\([^)]*\))?/gi, '');
}

// ── 1. Aucune action ne doit dépendre du seul survol ───────────────────────

test('toute action révélée au survol l’est aussi sans survol', () => {
  const toutesRegles = regles(TOUT);

  /* Une règle « qui révèle » : son corps rend un élément visible
     (`opacity:1`) et son sélecteur passe par `:hover`. */
  const reveles = new Set();
  for (const r of toutesRegles) {
    if (!/opacity\s*:\s*1\b/.test(r.corps)) continue;
    for (const sel of r.sel.split(',')) {
      if (!sel.includes(':hover')) continue;
      const cible = cibleDe(sel);
      if (cible) reveles.add(cible);
    }
  }
  assert.ok(reveles.size > 0, 'le détecteur ne trouve aucune règle de survol — il est cassé');

  /* ⚠️ ON N'EXAMINE QUE LES SÉLECTEURS RÉELLEMENT RENDUS. Une action
     inatteignable au doigt n'est un défaut que si l'action existe : le dépôt
     porte encore des règles de l'ancienne grille du Suivi mensuel (`.mfs-cell`,
     remplacée par `.mfx-cell`) que plus aucune ligne de app.js ne produit.
     Les inclure ferait échouer ce test sur du CSS mort, et la seule façon de
     le faire passer serait alors de supprimer des règles — un tout autre
     chantier, qui n'a pas sa place dans un correctif tactile.
     Ce n'est pas un filet qu'on baisse : si quelqu'un remet `.mfs-cell` à
     l'écran, le test recommence à l'examiner. */
  const rendu = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
  /* ⚠️ Le nom de classe doit être un JETON ENTIER, pas une sous-chaîne :
     chercher « more » trouve `mfx-cell__more` et déclarerait vivante la classe
     `.more`, qui ne l'est pas. Les classes se séparent par des espaces ou des
     guillemets dans un attribut `class`. */
  const utilisee = (cls) => {
    const nom = cls.replace(/^\./, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`[\\s"'\`]${nom}[\\s"'\`]`).test(rendu);
  };
  const vivantes = [...reveles].filter(utilisee);
  assert.ok(vivantes.length > 0, 'plus aucun sélecteur vivant à vérifier — le filtre est trop large');

  /* Pour chacune, existe-t-il une règle qui la rend visible SANS survol ? */
  /* Un repli VALABLE remplit trois conditions. Les trois ont été trouvées
     manquantes à la revue, chacune laissant passer un faux positif :
       1. il rend visible (opacité non nulle) ;
       2. il ne dépend NI du survol NI d'une largeur d'écran — sinon il ne
          couvre pas l'iPad Pro, qui survole mal et mesure 1024 px ;
       3. il porte EXACTEMENT sur la cible, et non sur un de ses états.
          `.inline-edit.saving{opacity:.55}` décrit une sauvegarde en cours ;
          le prendre pour un repli, c'est déclarer atteignable un crayon qui
          reste invisible au repos. */
  /* ⚠️ UN ÉTAT D'INTERACTION N'EST PAS UN REPLI. `:focus-within` révèle bien
     `.mfx-charge__a` — mais pour focaliser un bouton, il faut l'atteindre, et
     c'est précisément ce qu'on ne peut pas faire quand il est invisible. Le
     raisonnement tourne en rond. Le pseudo peut porter sur un ANCÊTRE
     (`.mfx-charge:focus-within .mfx-charge__a`) : on inspecte donc le sélecteur
     entier, pas seulement sa cible. */
  const INTERACTION = /:(hover|focus|focus-within|focus-visible|active|target)\b/;

  const estRepli = (r, cible) =>
    /opacity\s*:\s*(1|0?\.[1-9])/.test(r.corps) &&
    !/max-width/.test(r.media) &&
    r.sel.split(',').some(s => !INTERACTION.test(s) && cibleDe(s) === cible);

  const orphelines = vivantes.filter(cible => !toutesRegles.some(r => estRepli(r, cible)));
  assert.deepEqual(orphelines, [],
    `révélées au seul survol, donc inatteignables au doigt : ${orphelines.join(', ')}`);
});

// ── 2. Les champs de saisie ne doivent pas faire zoomer Safari ─────────────

test('les champs de saisie passent à 16 px sur pointeur grossier', () => {
  const t = CSS['tactile.css'];
  const bloc = /@media\s*\(any-pointer:\s*coarse\)\s*\{([\s\S]*?)\n\}/.exec(t);
  assert.ok(bloc, 'le bloc `any-pointer: coarse` a disparu de tactile.css');

  const regle = /input\s*,\s*select\s*,\s*textarea\s*\{[^}]*font-size:\s*(\d+)px\s*!important/.exec(bloc[1]);
  assert.ok(regle, 'la règle qui porte les champs à 16 px a disparu');
  assert.ok(Number(regle[1]) >= 16,
    `${regle[1]}px : sous 16, Safari zoome à chaque focus — c’est tout l’objet de la règle`);
});

test('la règle vise les champs, pas toute la typographie', () => {
  /* Agrandir libellés et boutons casserait la densité des écrans financiers
     sans rien résoudre : seuls les champs de saisie déclenchent le zoom. */
  const t = CSS['tactile.css'];
  assert.ok(!/(^|\n)\s*(body|\*|html)\s*\{[^}]*font-size[^}]*!important/.test(t),
    'une surcharge de police globale s’est glissée dans tactile.css');
});

// ── 3. La feuille doit être chargée, et chargée EN DERNIER ─────────────────

test('tactile.css est chargée après les quatre autres feuilles', () => {
  const html = lire('index.html');
  const pos = f => html.indexOf(`href="${f}?v=`);
  for (const f of FEUILLES) assert.ok(pos(f) > -1, `${f} n’est pas chargée par index.html`);
  const autres = FEUILLES.filter(f => f !== 'tactile.css').map(pos);
  assert.ok(pos('tactile.css') > Math.max(...autres),
    'tactile.css ne surcharge plus rien : à spécificité égale, c’est l’ordre qui tranche');
});

test('toutes les feuilles portent la même version de cache', () => {
  const html = lire('index.html');
  const versions = new Set([...html.matchAll(/\.css\?v=(\d+)/g)].map(m => m[1]));
  assert.equal(versions.size, 1, `versions divergentes entre feuilles : ${[...versions].join(', ')}`);
});

// ── 4. Le sélecteur natif doit revenir au doigt, pas seulement en étroit ───

test('le sélecteur rend la main au natif sur pointeur grossier', () => {
  /* `.sf-pick` remplace chaque <select> à l'exécution. Son repli natif — que le
     dépôt justifie par « au doigt, le natif fait mieux » — était conditionné à
     `max-width: 720px`, une largeur. Un iPad Pro fait 1024 px : il gardait le
     bouton personnalisé à 38 px et des options à 36. La condition doit porter
     sur le POINTEUR, pas sur la place disponible. */
  const bloc = /@media([^{]*)\{\s*\/\*[^*]*\*\/\s*\.sf-pick__btn\s*\{\s*display:\s*none/
    .exec(CSS['components.css']);
  assert.ok(bloc, 'le repli natif du sélecteur a disparu de components.css');
  assert.match(bloc[1], /any-pointer:\s*coarse/,
    `condition « ${bloc[1].trim()} » : sans « any-pointer: coarse », l'iPad garde le sélecteur personnalisé`);
});

test('le seuil du sélecteur est le MÊME en CSS et en JS', () => {
  /* ⚠️ L'INVARIANT QUI A CASSÉ LE 05/09/2026. Élargir la seule règle CSS a
     suffi à désaccorder les deux moitiés : le JS habillait encore le select,
     le CSS cachait son bouton, et le panneau se posait dans le coin de la
     fenêtre depuis un `getBoundingClientRect()` d'élément masqué — pendant
     qu'aucun select n'était plus atteignable au clavier.
     Les deux chaînes décrivent le même arbitrage : elles doivent être égales. */
  const enJs = /const SF_SEUIL_MOBILE = '([^']+)'/.exec(lire('app.js'));
  assert.ok(enJs, 'SF_SEUIL_MOBILE a disparu de app.js');

  const enCss = /@media([^{]*)\{\s*\/\*[^*]*\*\/\s*\.sf-pick__btn\s*\{\s*display:\s*none/
    .exec(lire('components.css'));
  assert.ok(enCss, 'le repli natif du sélecteur a disparu de components.css');

  const normalise = q => q.replace(/\s+/g, ' ').trim();
  assert.equal(normalise(enJs[1]), normalise(enCss[1]),
    'le CSS et le JS ne décrivent plus le même seuil : le panneau se détachera de son champ');
});
