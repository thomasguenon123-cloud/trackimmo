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
  /* v=103 : l'Administration prend les onglets soulignés du Suivi financier.
     Sur téléphone, quatre onglets en ligne débordaient de 125 px (« Bilans
     comptables » coupé, page dézoomée par Safari) : la rangée contient son
     débordement (elle défile) et ramène l'onglet ouvert dans le champ. */
  const rangee = regles(CSS['financier.css']).find(r => r.sel === '.mfx-tabs' && !r.media);
  assert.ok(rangee, 'témoin : la règle de la rangée d’onglets est trouvée');
  assert.match(rangee.corps, /overflow-x\s*:\s*auto/, 'la rangée doit défiler, pas élargir la page');
  const corps = APP.slice(APP.indexOf('async function renderAdministration'), APP.indexOf('async function loadAdminData'));
  assert.match(corps, /class="mfx-tabs" role="tablist" id="adm-onglets"/, 'l’Administration a quitté les onglets de la charte');
  assert.match(corps, /class="mfx-tab" role="tab"[^>]*aria-selected=/, 'chaque onglet dit s’il est ouvert');
  assert.doesNotMatch(corps, /adm-hero|adm-tabs/, 'le bandeau ou les onglets en boîte de l’ancienne charte sont revenus');
  const bascule = APP.slice(APP.indexOf('function switchAdminTab'), APP.indexOf('function switchAdminTab') + 500);
  assert.match(bascule, /sfOngletDansLeChamp\(document\.getElementById\('adm-onglets'\)\)/,
    'au téléphone, l’onglet ouvert doit rester visible dans la rangée qui défile');
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

/* v=102 — UN TITRE SEUL SE CENTRE SUR SA PASTILLE. Depuis que l'explication
   passe derrière le « ? » (v=100), les étapes de « Pour démarrer » et les
   points de « À traiter » n'ont souvent plus qu'une ligne : alignées en haut,
   elles restaient 4 et 8 px au-dessus du centre de leur numéro ou de leur
   icône (capture de Thomas du 17/10). Mesuré au banc sur 56 écrans × 2
   largeurs : ces deux composants seulement. */
test('les lignes à pastille de l’accueil centrent leur titre', () => {
  const regle = sel => {
    const m = CSS['components.css'].match(new RegExp('(^|\\})\\s*' + sel.replace('.', '\\.') + '\\{([^}]*)\\}', 'm'));
    assert.ok(m, `témoin : la règle ${sel} existe`);
    return m[2];
  };
  for (const sel of ['.acc-pas', '.sf-alert']) {
    const r = regle(sel);
    assert.match(r, /display:\s*flex/, `témoin : ${sel} est bien une ligne flex`);
    assert.match(r, /align-items:\s*center/, `${sel} : un titre seul doit se centrer sur sa pastille`);
  }
});

/* v=103 — CHIFFRES CLÉS SANS CASE VIDE. Une rangée en `auto-fit` ne regarde
   pas combien de chiffres elle porte : sur iPad en portrait, quatre chiffres
   tombaient en « 3 + 1 », cinq en « 3 + 2 », et la case vide laissait voir le
   fond qui dessine les séparateurs (mesuré au banc : l'accueil, les 24 onglets
   de fiche, le Suivi financier, les Comptes rendus). La règle compte les
   cases ; la sonde des grilles du banc l'a vérifiée sur 58 écrans à 15
   largeurs, de 360 à 1 440 px. */
test('une rangée de chiffres clés se règle sur leur nombre', () => {
  const GRILLES = ['.acc-kpis', '.sfb-kpis', '.sff-kpis', '.mfx-kpis'];
  const quant = n => REGLES.filter(r => r.sel.includes(`:has(> :nth-child(${n}):last-child)`) && !/>\s*:nth-child\((?:-n|n)/.test(r.sel.split(':has(')[1].slice(r.sel.split(':has(')[1].indexOf(')') + 1)));
  const colonnes = (n, media) => {
    const r = quant(n).find(x => x.media.replace(/\s/g, '') === media.replace(/\s/g, '') && /grid-template-columns/.test(x.corps));
    assert.ok(r, `aucune règle pour ${n} chiffres sous « ${media} »`);
    for (const g of GRILLES) assert.ok(r.sel.includes(g), `${g} échappe à la règle des ${n} chiffres`);
    return (r.corps.match(/repeat\(\s*(\d+)/) || [])[1];
  };
  assert.equal(colonnes(3, '@media (min-width:561px)'), '3');
  assert.equal(colonnes(4, '@media (min-width:561px)'), '2', '4 chiffres sur tablette : deux par deux, jamais « 3 + 1 »');
  assert.equal(colonnes(4, '@media (min-width:900px)'), '4');
  assert.equal(colonnes(5, '@media (min-width:561px)'), '6', '5 chiffres : grille de 6, « 3 + 2 » sans trou');
  assert.equal(colonnes(5, '@media (min-width:1180px)'), '5');
  assert.equal(colonnes(6, '@media (min-width:561px)'), '3');
  // Les 5 chiffres : les trois premiers sur deux pistes, les deux derniers sur trois.
  const span = REGLES.filter(r => r.sel.includes(':has(> :nth-child(5):last-child) >') && /grid-column\s*:\s*span/.test(r.corps));
  assert.ok(span.some(r => /:nth-child\(-n\+3\)/.test(r.sel) && /span 2/.test(r.corps)), 'les trois premiers sur deux pistes');
  assert.ok(span.some(r => /:nth-child\(n\+4\)/.test(r.sel) && /span 3/.test(r.corps)), 'les deux derniers sur trois pistes');
  // Et l'annulation sur grand écran a la même précision que ce qu'elle annule.
  const annule = REGLES.find(r => /min-width:1180px/.test(r.media) && r.sel.includes(':has(> :nth-child(5):last-child) >') && /grid-column\s*:\s*auto/.test(r.corps));
  assert.ok(annule && /> :nth-child\(n\)/.test(annule.sel), '`> *` perd contre `> :nth-child(-n+3)` : les cases garderaient leur étendue');
});

test('les six actions rapides de l’accueil : 3 par ligne, 6 sur grand écran, 2 au téléphone', () => {
  const r = (media) => REGLES.find(x => x.sel === '.acc-quick' && x.media.replace(/\s/g, '') === media && /grid-template-columns/.test(x.corps));
  assert.match(r('').corps, /repeat\(3,\s*minmax\(0,\s*1fr\)\)/, 'une grille auto-fill mettait cinq actions puis une seule');
  assert.match(r('@media(min-width:1400px)').corps, /repeat\(6,/);
  assert.match(r('@media(max-width:560px)').corps, /repeat\(2,/);
});

test('le tableau de Mes biens ne défile pas d’un pixel pour rien', () => {
  /* Un texte de cellule dépassait sa case d'un pixel (arrondi des colonnes) :
     Windows affichait une barre de défilement sous le tableau de 1 024 à
     1 280 px. `clip`, pas `hidden` : la cellule ne devient pas un conteneur
     de défilement, et un vrai débord fait toujours défiler l'enveloppe. */
  const td = REGLES.filter(r => r.sel === '.sfb-t td' && !r.media);
  assert.ok(td.some(r => /overflow-x\s*:\s*clip/.test(r.corps)), 'les cellules ne rognent plus leur pixel de trop');
  const wrap = REGLES.find(r => r.sel === '.sfb-tablewrap' && !r.media);
  assert.match(wrap.corps, /overflow-x\s*:\s*auto/, 'témoin : un tableau plus large que l’écran défile toujours');
});

/* v=103 — UNE FEUILLE DE STYLE MUTILÉE NE SE VOIT PAS. En retirant une ligne
   d'une liste de sélecteurs, sa déclaration était partie avec elle : la liste
   restante se collait à la règle suivante, et le « ? » des états vides prenait
   la taille d'un titre de page (28 à 46 px). Et un bloc sans sélecteur
   (`{display:flex…}`, Paramètres › Mes SCI) traînait depuis des mois. Aucun
   des deux ne lève d'erreur : le navigateur ignore ou recolle en silence. */
test('aucune liste de sélecteurs interrompue, aucun bloc sans sélecteur', () => {
  const fautes = [];
  for (const [f, css] of Object.entries(CSS)) {
    const t = lire(f).replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''));
    for (const m of t.matchAll(/,[ \t]*\n[ \t]*\n/g)) fautes.push(`${f}:${t.slice(0, m.index).split('\n').length} liste de sélecteurs interrompue par une ligne vide`);
    for (const m of t.matchAll(/(^|[};])\s*\{/g)) fautes.push(`${f}:${t.slice(0, m.index + m[0].length).split('\n').length} bloc sans sélecteur`);
    void css;
  }
  assert.deepEqual(fautes, []);
  // Témoin : la règle du « ? » des états vides a gardé sa taille.
  const vide = REGLES.find(r => r.sel.split(',').map(s => s.trim()).includes('.sff-empty__t .sf-lex__b'));
  assert.ok(vide && /width\s*:\s*18px/.test(vide.corps), 'le « ? » d’un état vide a perdu sa taille');
  assert.ok(!vide.sel.includes('.sff-h1'), 'la règle du « ? » des états vides est recollée à celle des titres');
});
