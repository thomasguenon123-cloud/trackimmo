/* LA PAGE TIENT DANS L'ÉCRAN — ce que Safari sur iPhone ne pardonne pas (v=98).

   ⚠️ POURQUOI CETTE GARDE EXISTE. Safari sur iPhone cadre la page sur ce qui
   DÉPASSE : un seul élément plus large que l'écran, et toute l'application
   s'affiche dézoomée — serrée à gauche, une bande vide à droite. C'est ce que
   montrait la capture du 15/10/2026 (iPhone 16 Pro, 402 px de large). Trois
   causes mesurées au banc d'essai, aucune visible sur un ordinateur :
     · l'accueil : une grille en `1fr` NU laissait un titre de fiche long
       (76 caractères, en production) élargir la page à 519 px et plus ;
     · l'Administration : quatre onglets sur une ligne, 526 px ;
     · la barre de sélection des simulations, cachée par une simple opacité
       nulle et recentrée par `transform` : sa boîte allait jusqu'à 858 px,
       sur TOUS les écrans.
   Un `1fr` seul vaut `minmax(auto, 1fr)` : la colonne ne descend jamais sous
   la largeur de son contenu le plus long. `minmax(0, 1fr)` la laisse se
   partager l'espace. La règle était écrite dans CLAUDE.md (« Toujours
   minmax(0,1fr), jamais 1fr seul ») : 57 déclarations l'enfreignaient
   (55 dans les feuilles, 2 dans app.js — compté par ce même détecteur sur
   la v=97).

   Ce que la garde ne fait PAS : mesurer un rendu. Le banc d'essai (Chromium,
   émulation iPhone, données longues) le fait ; ici on tient les invariants
   qui l'ont rendu vert, pour qu'ils le restent.

   Les gardes sont validées par mutation le 15/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const FEUILLES = ['tokens.css', 'components.css', 'styles.css', 'financier.css', 'tactile.css'];
const sansCommentairesCss = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = Object.fromEntries(FEUILLES.map(f => [f, sansCommentairesCss(lire(f))]));

/* Les pistes d'une valeur de `grid-template-columns` qui sont en fr NU, au
   niveau 0 ou dans un `repeat()`. `minmax(…)` et `fit-content(…)` portent
   leur propre minimum : on ne regarde pas dedans. Les parenthèses sont
   suivies, pas devinées — `minmax(min(300px,100%),1fr)` en imbrique deux. */
function pistesNues(valeur) {
  const jetons = v => {
    const out = []; let cur = '', prof = 0;
    for (const ch of v) {
      if (ch === '(') prof++;
      if (ch === ')') prof--;
      if (prof === 0 && /\s/.test(ch)) { if (cur) out.push(cur); cur = ''; } else cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  };
  const nues = [];
  for (const t of jetons(valeur.replace(/!important/, '').trim())) {
    if (/^\d*\.?\d+fr$/.test(t)) { nues.push(t); continue; }
    const rep = /^repeat\((.*)\)$/s.exec(t);
    if (rep) {
      let prof = 0;
      for (let i = 0; i < rep[1].length; i++) {
        const ch = rep[1][i];
        if (ch === '(') prof++; else if (ch === ')') prof--;
        else if (ch === ',' && prof === 0) { nues.push(...pistesNues(rep[1].slice(i + 1))); break; }
      }
    }
  }
  return nues;
}

/* Les déclarations d'un texte. Dans app.js, une valeur peut contenir un
   gabarit (`repeat(${nb},1fr)`) : ses accolades ne terminent pas la valeur. */
function declarations(texte) {
  const re = /grid-template-columns\s*:\s*((?:\$\{[^}]*\}|[^;"`}])+)/g;
  return [...texte.matchAll(re)].map(m => ({ valeur: m[1].trim(), ligne: texte.slice(0, m.index).split('\n').length }));
}

/* Les commentaires d'app.js citent volontiers le défaut qu'ils corrigent : on
   les masque, en gardant les sauts de ligne. Le masquage ne connaît pas les
   chaînes — `accept="image/*"` contient une ouverture de commentaire ; elle
   est neutralisée d'abord, et le canari plus bas vérifie qu'aucun code
   n'a disparu (même parade que emojis.test.js). */
function sansCommentairesJs(src) {
  const brut = ['image/*', 'audio/*', 'video/*', '*/*'].reduce((t, l) => t.split(l).join(l.replace('*', 'x')), src);
  const c = brut.split('');
  const blanchir = (a, b) => { for (let k = a; k < b; k++) if (c[k] !== '\n') c[k] = ' '; };
  for (const m of brut.matchAll(/\/\*[\s\S]*?\*\//g)) blanchir(m.index, m.index + m[0].length);
  let t = c.join('');
  for (const m of t.matchAll(/(?<=^|[\s;{}(),])\/\/[^\n]*/g)) blanchir(m.index, m.index + m[0].length);
  t = c.join('');
  for (const m of t.matchAll(/<!--[\s\S]*?-->/g)) blanchir(m.index, m.index + m[0].length);
  return c.join('');
}
const APP = sansCommentairesJs(lire('app.js'));
const INDEX = sansCommentairesJs(lire('index.html'));

/* Règles `sélecteur { corps }` d'une feuille, avec la requête média qui les
   englobe (même découpe que tactile.test.js). */
function regles(css) {
  const out = []; let i = 0, media = [], sel = '';
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const tete = sel.trim(); sel = '';
      if (tete.startsWith('@')) { media.push(tete); i++; continue; }
      let j = css.indexOf('}', i); if (j < 0) j = css.length;
      out.push({ sel: tete, corps: css.slice(i + 1, j), media: media.join(' ') });
      i = j + 1; continue;
    }
    if (c === '}') { media.pop(); sel = ''; i++; continue; }
    sel += c; i++;
  }
  return out;
}
const REGLES = Object.entries(CSS).flatMap(([f, css]) => regles(css).map(r => ({ ...r, f })));
const regle = (sel, media = '') => REGLES.filter(r => r.sel.split(',').map(s => s.trim()).includes(sel) && r.media === media);

// ── 1. Aucune colonne de grille ne se règle sur son contenu le plus long ────

test('le détecteur de pistes nues reconnaît ce qu’il doit (canari)', () => {
  assert.deepEqual(pistesNues('1fr'), ['1fr']);
  assert.deepEqual(pistesNues('auto 1fr auto'), ['1fr']);
  assert.deepEqual(pistesNues('repeat(3,1fr)'), ['1fr']);
  assert.deepEqual(pistesNues('minmax(130px,1fr) 2fr auto'), ['2fr']);
  assert.deepEqual(pistesNues('1.2fr 1fr !important'), ['1.2fr', '1fr']);
  assert.deepEqual(pistesNues('repeat(${nb},1fr)'), ['1fr']);
  assert.deepEqual(pistesNues('minmax(0,1fr) minmax(0,1fr)'), []);
  assert.deepEqual(pistesNues('repeat(auto-fill,minmax(min(300px,100%),1fr))'), []);
  assert.deepEqual(pistesNues('262px minmax(0,1fr)'), []);
});

test('aucune grille ne laisse un contenu long élargir la page', () => {
  const fautes = [];
  let vues = 0;
  for (const [f, css] of Object.entries(CSS)) {
    for (const d of declarations(css)) {
      vues++;
      if (pistesNues(d.valeur).length) fautes.push(`${f}:${d.ligne} → ${d.valeur}`);
    }
  }
  let vuesJs = 0;
  for (const [f, src] of [['app.js', APP], ['index.html', INDEX]]) {
    for (const d of declarations(src)) {
      vuesJs++;
      if (pistesNues(d.valeur).length) fautes.push(`${f}:${d.ligne} → ${d.valeur}`);
    }
  }
  // Témoins : le balayage voit bien les déclarations (un balayage vide passerait).
  assert.ok(vues > 100, `seulement ${vues} déclarations lues dans les feuilles — le balayage est cassé`);
  assert.ok(vuesJs >= 3, `seulement ${vuesJs} déclarations lues dans app.js — le balayage est cassé`);
  assert.deepEqual(fautes, [],
    'Une colonne en « fr » nu ne descend jamais sous son contenu le plus long : un titre long élargit la page, '
    + 'et Safari sur iPhone dézoome toute l\'application. Écrire minmax(0,1fr).\n' + fautes.join('\n'));
});

test('le masquage des commentaires d’app.js n’efface pas de code (canari)', () => {
  const brut = lire('app.js');
  const compter = (t, re) => (t.match(re) || []).length;
  assert.equal(compter(APP, /sfAccIcon\(\s*'/g), compter(brut, /sfAccIcon\(\s*'/g));
  assert.equal(compter(APP, /grid-template-columns/g) > 0, true);
});

// ── 2. Ce qui est caché ne reste pas dans la page ─────────────────────────

/* La barre de sélection des simulations, cachée par une opacité nulle et
   recentrée par `transform`, restait dans la page : sa boîte allait jusqu'à
   858 px sur un iPhone de 402 px. Elle a disparu avec la sélection multiple
   (v=99) ; la règle reste : un élément FIXE recentré par translate ne se
   cache jamais par la seule opacité. */
function fixesCachesParOpacite(regles) {
  return regles.filter(r => /position\s*:\s*fixed/.test(r.corps)
    && /translate(X)?\(\s*-50%/.test(r.corps)
    && /opacity\s*:\s*0(\.0*)?\s*(;|$)/.test(r.corps)
    && !/display\s*:\s*none/.test(r.corps)).map(r => r.sel);
}

test('un élément fixe caché ne reste pas dans la page', () => {
  // Canari : le détecteur reconnaît le défaut qu'il garde.
  const piege = regles('.x{ position:fixed; left:50%; transform:translateX(-50%) translateY(80px); opacity:0; }'
    + '.y{ position:fixed; left:50%; transform:translateX(-50%); display:none; }');
  assert.deepEqual(fixesCachesParOpacite(piege), ['.x'], 'le détecteur ne voit plus le défaut');
  assert.deepEqual(fixesCachesParOpacite(REGLES), [],
    'Un élément fixe recentré par transform est caché par une opacité nulle : sa boîte reste dans la page et Safari dézoome.');
  assert.ok(!/id="sim-action-bar"/.test(lire('index.html')), 'la barre de sélection des simulations est revenue');
});

test('sur téléphone, les chiffres clés passent sur deux colonnes', () => {
  const tel = REGLES.filter(r => /max-width\s*:\s*560px/.test(r.media));
  const deuxColonnes = tel.filter(r => /grid-template-columns\s*:\s*repeat\(\s*2\s*,\s*minmax\(0,\s*1fr\)\)/.test(r.corps));
  const couverts = new Set(deuxColonnes.flatMap(r => r.sel.split(',').map(x => x.trim())));
  for (const sel of ['.sff-kpis', '.sfb-kpis', '.mf-page .mfx-kpis', '.acc-kpis']) {
    assert.ok(couverts.has(sel), `${sel} : quatre chiffres empilés repoussent la liste sous l'écran du téléphone.`);
  }
  // Le Suivi financier : sa feuille est chargée après styles.css, la règle doit y être plus précise.
  const base = regles(CSS['financier.css']).find(r => r.sel === '.mfx-kpis' && !r.media);
  assert.ok(base, 'témoin : la règle de base des chiffres du Suivi financier est trouvée');
  const dernier = tel.find(r => /:last-child:nth-child\(odd\)/.test(r.sel) && /grid-column\s*:\s*1\s*\/\s*-1/.test(r.corps));
  assert.ok(dernier, 'le dernier chiffre, seul sur sa ligne, prend toute la largeur');
});

test('les onglets de l’Administration tiennent sur un téléphone', () => {
  const [base] = regle('.adm-tab');
  assert.ok(base, 'témoin : la règle des onglets est trouvée');
  assert.match(base.corps, /white-space\s*:\s*nowrap/, 'témoin : au large, les libellés tiennent sur une ligne');
  const tel = REGLES.filter(r => /max-width\s*:\s*(\d+)px/.test(r.media) && Number(/max-width\s*:\s*(\d+)px/.exec(r.media)[1]) >= 440);
  const rangee = tel.find(r => r.sel === '.adm-tabs');
  assert.ok(rangee, 'Aucune règle pour téléphone : quatre onglets sur une ligne débordent de l\'écran (« Bilans comptables » coupé).');
  assert.match(rangee.corps, /grid-template-columns\s*:\s*repeat\(\s*2\s*,\s*minmax\(0,\s*1fr\)\)/, 'deux rangées de deux');
  const onglet = tel.find(r => r.sel === '.adm-tab' && r.media === rangee.media);
  assert.ok(onglet && /white-space\s*:\s*normal/.test(onglet.corps), 'un libellé long passe à la ligne dans sa case');
});

// ── 3. Les contrôles natifs portent la charte ──────────────────────────────

test('les contrôles natifs suivent le thème sombre', () => {
  const racine = regles(CSS['tokens.css']).find(r => r.sel === ':root' && !r.media && /--sf-bg\s*:/.test(r.corps));
  assert.ok(racine, 'témoin : le bloc du thème sombre est trouvé');
  assert.match(racine.corps, /color-scheme\s*:\s*dark/,
    'Sans color-scheme, le système dessine la liste d\'un menu, un calendrier, une barre de défilement en CLAIR sur la charte sombre.');
});

test('aucun menu déroulant n’est laissé au dessin du système', () => {
  /* Au doigt, AUCUN select n'est habillé (sfAmeliorerSelects s'arrête sous
     SF_SEUIL_MOBILE) : un select sans classe reste le bouton clair du système,
     en police système — l'exercice du Suivi financier sur la capture. */
  const balises = [...APP.matchAll(/<select\b[^>]*>/g), ...INDEX.matchAll(/<select\b[^>]*>/g)].map(m => m[0]);
  assert.ok(balises.length >= 20, `seulement ${balises.length} menus trouvés — le balayage est cassé`);
  const nus = balises.filter(b => !/\bclass="[^"]*\S[^"]*"/.test(b));
  assert.deepEqual(nus, [], 'Ces menus n\'ont aucune classe : sur iPhone, ils gardent le dessin du système.');
});

// ── 4. Le filet de sécurité, et le cadre ───────────────────────────────────

test('le filet de sécurité coupe sans casser le défilement ni le bandeau collant', () => {
  const filet = REGLES.find(r => !r.media && /^html\s*,\s*body$/.test(r.sel));
  assert.ok(filet && /overflow-x\s*:\s*clip/.test(filet.corps),
    'html et body coupent ce qui dépasse en largeur (dernier rempart contre le dézoom de Safari)');
  // `hidden` ferait de body un conteneur de défilement : le bandeau collant cesserait de coller.
  const casse = REGLES.filter(r => /(^|,)\s*(html|body)\s*(,|$)/.test(r.sel) && /overflow(-x)?\s*:\s*(hidden|auto|scroll)/.test(r.corps));
  assert.deepEqual(casse.map(r => r.sel), []);
});

test('la page se cadre sur la largeur de l’appareil', () => {
  const meta = /<meta name="viewport" content="([^"]+)"/.exec(lire('index.html'));
  assert.ok(meta, 'témoin : la balise viewport existe');
  assert.match(meta[1], /width=device-width/);
  assert.match(meta[1], /initial-scale=1/);
  assert.doesNotMatch(meta[1], /user-scalable=no|maximum-scale=1\b/, 'le zoom de l\'utilisateur n\'est jamais interdit');
});

test('les champs écrivent dans la police de la page', () => {
  /* Sans règle, le navigateur donne aux zones de texte une police à chasse
     fixe : le commentaire d'un échange s'écrivait en machine à écrire. */
  const base = REGLES.find(r => !r.media && r.sel.split(',').map(x => x.trim()).sort().join(',') === 'button,input,select,textarea');
  assert.ok(base && /font-family\s*:\s*inherit/.test(base.corps), 'button, input, select et textarea héritent de la police');
});

test('sur téléphone, ce qu\'on choisit s\'affiche : on y descend s\'il est hors de l\'écran', () => {
  const { charger } = require('./charger-app');
  const ctx = charger({ maintenant: new Date(2026, 9, 15, 12) });
  let defile = 0;
  const el = top => ({ getBoundingClientRect: () => ({ top }), scrollIntoView: () => { defile++; } });
  ctx.window.innerHeight = 874;
  ctx.sfAmenerDansLeChamp(el(1067));
  assert.equal(defile, 1, 'Ce qu\'on vient de choisir s\'affiche sous le sommaire, hors de l\'écran : rien ne semble se passer.');
  ctx.sfAmenerDansLeChamp(el(300));
  ctx.sfAmenerDansLeChamp(null);
  assert.equal(defile, 1, 'témoin : déjà à l\'écran (grand écran), rien ne bouge');
  // Les Paramètres : choisir une section, ou y arriver par la roue dentée.
  const corpsDe = nom => { const i = APP.search(new RegExp('^function ' + nom + '\\(', 'm')); return APP.slice(i, APP.indexOf('\n}', i)); };
  for (const f of ['selectParamsSection', 'sfGoParam']) {
    assert.match(corpsDe(f), /sfAmenerDansLeChamp\(document\.getElementById\('params-content'\)\)/,
      `${f} : sur téléphone, la section choisie reste sous le sommaire des Paramètres.`);
  }
  assert.match(corpsDe('bdDefilerVersOnglets'), /sfAmenerDansLeChamp\(document\.querySelector\('\.sff-tabs'\)\)/);
});

test('« Pour démarrer » : sur téléphone, le texte reste à côté de sa pastille', () => {
  /* Vu dès que la colonne de l'accueil a cessé de déborder : sans base de
     flex, le texte passait SOUS la pastille et le bouton, décalé pour
     s'aligner sur lui, restait seul en retrait. */
  const tel = REGLES.filter(r => /max-width\s*:\s*640px/.test(r.media));
  const bouton = tel.find(r => r.sel === '.acc-pas__a');
  assert.ok(bouton && /margin-left\s*:\s*calc\(26px/.test(bouton.corps), 'témoin : le bouton s\'aligne sur le texte');
  const texte = tel.find(r => r.sel === '.acc-pas__body');
  assert.ok(texte && /flex\s*:\s*1 1 calc\(100% - 26px/.test(texte.corps),
    'Le texte d\'une étape n\'a pas de base de flex : il passe sous la pastille, le bouton reste en retrait.');
});
