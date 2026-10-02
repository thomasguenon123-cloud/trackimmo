/* PLUS D'EMOJI DANS CE QUI S'AFFICHE — la garde qui empêche la troisième fois.

   ⚠️ POURQUOI ELLE EXISTE. Le lot a été compté trois fois et mal compté deux
   fois : « 209 dont 59 flèches » au backlog, « 228 » un matin, 198 en réalité.
   Le premier chiffre comptait des flèches de commentaires ; le second comptait
   les SÉLECTEURS DE VARIATION — ces caractères invisibles qui suivent un
   emoji et qu'un scanner naïf additionne. Un inventaire faux sur un lot qu'on
   veut traiter « d'un coup » se paie au moment de la reprise.

   Ce que la garde tient, et qu'aucune relecture ne tiendra :
     · un emoji tombe en POLICE SYSTÈME. Son dessin dépend de l'OS, pas de la
       charte — et sur certains Android il ne s'affiche pas du tout ;
     · il ne suit JAMAIS `currentColor`. Sur fond sombre il reste coloré, sur
       un bouton vert il jure ;
     · il ne se met pas à l'échelle : un 📄 à 11 px et un 📄 à 26 px ne sont
       pas le même dessin.

   ⚠️ LE PIÈGE DU MASQUAGE. Cette garde doit ignorer les commentaires — sinon
   elle s'accuse elle-même, puisque ce fichier et app.js EXPLIQUENT le défaut
   avec des ⚠️. Trois formes à masquer, pas une : le commentaire de bloc, le
   commentaire de ligne EN DÉBUT de ligne, et le même EN FIN de ligne. La
   troisième a failli manquer — et c'est elle qui porte la flèche tolérée.

   Les quatre gardes sont validées par mutation le 27/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');

/* ⚠️ APP.JS N'EST PAS LE SEUL FICHIER LIVRÉ, et s'y limiter laissait passer
   des emojis dans le bandeau d'index.html — celui que le testeur voit sur
   CHAQUE écran — et un `content:'✓'` en CSS, qu'aucune recherche dans le JS
   ne trouve. La garde lit désormais tout ce qui part en production. */
const LIVRES = ['app.js', 'index.html', '404.html',
                'tokens.css', 'components.css', 'styles.css',
                'financier.css', 'tactile.css'];

/* Plage LARGE, et c'est délibéré : la plage étroite du premier inventaire
   ratait ⏳ (U+23F3, 7 fois), ℹ (U+2139, 3 fois), ▼▲ (U+25BC/B2) et ○
   (U+25CB). Tout symbole non latin susceptible d'être un pictogramme. */
const PICTO = /[℀-⅏←-⇿⌀-⏿■-◿☀-➿⤀-⯿\u{1F000}-\u{1FAFF}]/u;

/* Masque les commentaires EN PRÉSERVANT les sauts de ligne — sinon les
   numéros de ligne de ce qui reste ne veulent plus rien dire.

   ⚠️ CE MASQUEUR EST FAIT D'EXPRESSIONS RÉGULIÈRES, et il faut savoir ce que
   cela coûte. Il ne sait pas s'il est dans une chaîne : il cherche le motif
   d'ouverture de commentaire de bloc n'importe où. `accept="image/*"` en
   contient un, et le premier jet de ce fichier s'y est fait prendre — 3 396
   lignes d'app.js, 22 % du fichier, masquées. Il passait au vert avec des
   emojis dedans. Même faiblesse côté ligne : un ` //` à l'intérieur d'une
   chaîne efface la fin de sa ligne.

   (Une version antérieure de ce commentaire décrivait un « vrai balayage »
   qui suit les chaînes simples, doubles et les gabarits. Ce balayage n'a
   jamais été écrit. Le commentaire mentait sur le code qu'il coiffait.)

   Deux parades, et c'est le canari plus bas qui les rend sûres :
     · LEURRES neutralise les séquences connues avant de masquer ;
     · `zonesSuspectes` repère, dans les huit fichiers livrés, toute ouverture
       qui n'a pas la tête d'un commentaire — c'est elle qui attrapera la
       séquence que personne n'a encore vue. */
const LEURRES = ['image/*', 'audio/*', 'video/*', '*/*'];
const BLOC = /\/\*[\s\S]*?\*\//g;
const LIGNE = /(?<=^|[\s;{}(),])\/\/[^\n]*/g;
const sansLeurres = src => LEURRES.reduce((t, l) => t.split(l).join(l.replace('*', 'x')), src);

function sansCommentaires(src) {
  /* ⚠️ UN LITTÉRAL PEUT CONTENIR CE QUI RESSEMBLE À UNE OUVERTURE DE
     COMMENTAIRE. `accept="image/*"` en est un, et le premier jet de cette
     garde s'y est fait prendre : elle masquait tout jusqu'au prochain `*` `/`,
     soit 3 396 lignes — 22 % d'app.js — invisibles. Elle passait au vert avec
     des emojis dedans. On neutralise donc ces séquences connues avant de
     masquer ; le CANARI plus bas vérifie qu'aucune autre n'est apparue. */
  const brut = sansLeurres(src);
  const c = brut.split('');
  const blanchir = (a, b) => { for (let k = a; k < b; k++) if (c[k] !== '\n') c[k] = ' '; };
  for (const m of brut.matchAll(BLOC)) blanchir(m.index, m.index + m[0].length);
  let t = c.join('');
  for (const m of t.matchAll(LIGNE)) blanchir(m.index, m.index + m[0].length);
  t = c.join('');
  for (const m of t.matchAll(/<!--[\s\S]*?-->/g)) blanchir(m.index, m.index + m[0].length);
  return c.join('');
}

/* Les zones que le masqueur s'apprête à effacer et qui n'ont PAS la tête d'un
   commentaire. Deux signatures, mesurées à zéro sur les huit fichiers livrés
   le 02/10/2026 — tout signalement est donc une nouveauté à regarder :
     · une ouverture de bloc collée à une lettre, un chiffre, un guillemet, un
       `*` ou un `/` : c'est un littéral (`text/*`, `application/*`, une URL),
       pas un commentaire. C'est la forme exacte du défaut du 27/09 ;
     · un `//` dont le début de ligne laisse une chaîne OUVERTE (nombre impair
       de guillemets d'une même sorte) : il est dans la chaîne, pas après. */
function zonesSuspectes(src) {
  const brut = sansLeurres(src);
  const ligneDe = i => brut.slice(0, i).split('\n').length;
  const suspects = [];
  for (const m of brut.matchAll(BLOC)) {
    const avant = brut[m.index - 1] || '';
    if (avant && !/[\s;{}(),=:>]/.test(avant)) {
      suspects.push(`ligne ${ligneDe(m.index)} : « ${brut.slice(Math.max(0, m.index - 20), m.index + 4).replace(/\n/g, ' ')} »`);
    }
  }
  const c = brut.split('');
  for (const m of brut.matchAll(BLOC)) for (let k = m.index; k < m.index + m[0].length; k++) if (c[k] !== '\n') c[k] = ' ';
  c.join('').split('\n').forEach((l, i) => {
    LIGNE.lastIndex = 0;
    const m = LIGNE.exec(l);
    if (!m) return;
    const debut = l.slice(0, m.index);
    if (["'", '"', '`'].some(q => (debut.split(q).length - 1) % 2)) {
      suspects.push(`ligne ${i + 1} : « ${l.trim().slice(0, 80)} »`);
    }
  });
  return suspects;
}

/* ⚠️ LE CANARI. Un masqueur qui déraille ne se voit pas : il rend une garde
   VERTE en effaçant le code qu'elle devait lire. C'est exactement ce qui
   s'est produit ici le 27/09/2026. On mesure donc que le masquage laisse
   intact ce qui est indubitablement du code — les appels d'icône, qui n'ont
   aucune raison de disparaître — et on refuse tout écart. */
function verifierMasquage(src, masque) {
  const compter = (t, re) => (t.match(re) || []).length;
  const APPELS = /sfAccIcon\(\s*'/g;
  return { avant: compter(src, APPELS), apres: compter(masque, APPELS) };
}

/* ⚠️ LA LISTE DES SURVIVANTS EST COURTE ET MOTIVÉE. Chaque entrée dit
   pourquoi le caractère reste. Y ajouter une ligne doit coûter une
   justification, pas un copier-coller. */
const TOLERES = new Map([
  ['→', 'flèche « de … à … » entre deux dates ou deux valeurs : c’est de la '
           + 'typographie, pas une icône. « 2010 → 2022 », « entrée → sortie ».'],
  ['←', 'idem, dans une trace console ou un libellé de retour.'],
]);

test('LE CANARI — le masquage des commentaires n\'efface pas de code', () => {
  /* Cette garde protège les trois autres. Si le masqueur déraille, elles
     passent au vert sur un fichier à moitié effacé — et c'est arrivé. */
  const { avant, apres } = verifierMasquage(SRC, sansCommentaires(SRC));
  assert.ok(avant > 200, `appels d'icône anormalement peu nombreux : ${avant}`);
  assert.equal(apres, avant,
    `Le masquage des commentaires a effacé ${avant - apres} appel(s) sfAccIcon. ` +
    `Une séquence ressemblant à une ouverture de commentaire est apparue dans ` +
    `un littéral — ajoutez-la à LEURRES. Sans ce contrôle, les gardes ` +
    `ci-dessous passeraient au vert sur un fichier amputé.`);

  const fn = t => (t.match(/\bfunction /g) || []).length;
  assert.equal(fn(sansCommentaires(SRC)), fn(SRC),
    'Le masquage a fait disparaître des déclarations de fonction.');
});

test('LE CANARI, dans les huit fichiers livrés — aucune zone masquée n\'est un littéral', () => {
  /* Le canari précédent ne lit qu'app.js : il compte des appels d'icône, qui
     n'existent pas dans une feuille de style. Or le masqueur passe sur les
     huit fichiers, et un `accept="application/*"` dans index.html y aurait
     rejoué le défaut du 27/09 sans que rien ne le voie. Celui-ci ne dépend
     d'aucun contenu propre à un fichier : il lit la FORME des zones masquées. */
  const fautifs = [];
  for (const fichier of LIVRES) {
    for (const z of zonesSuspectes(fs.readFileSync(path.join(RACINE, fichier), 'utf8'))) {
      fautifs.push(`  ${fichier}, ${z}`);
    }
  }
  assert.deepEqual(fautifs, [],
    'Le masqueur va effacer une zone qui n\'a pas la tête d\'un commentaire :\n' +
    fautifs.join('\n') + '\n\n  C\'est sans doute un littéral. Ajoutez la séquence à LEURRES.');

  // Et le canari doit savoir aboyer : les deux formes connues du défaut.
  assert.equal(zonesSuspectes('<input accept="application/*">\n<p>x</p>\n<!-- */ -->').length, 1,
    'zonesSuspectes ne voit plus une ouverture de bloc dans un littéral.');
  assert.equal(zonesSuspectes("const s = 'a // b';").length, 1,
    'zonesSuspectes ne voit plus un // à l\'intérieur d\'une chaîne.');
  assert.equal(zonesSuspectes('x(); /* vrai */\ny(); // vrai aussi').length, 0,
    'zonesSuspectes accuse de vrais commentaires.');
});

test('aucun emoji ne subsiste dans ce qui part en production', () => {
  const fautifs = [];
  for (const fichier of LIVRES) {
    const brut = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    const propre = sansCommentaires(brut);
    const brutes = brut.split('\n');
    propre.split('\n').forEach((l, i) => {
      for (const ch of l) {
        if (PICTO.test(ch) && !TOLERES.has(ch)) {
          fautifs.push(`  ${fichier}:${i + 1}  « ${ch} » (U+${ch.codePointAt(0).toString(16).toUpperCase()})`
                     + `\n      ${brutes[i].trim().slice(0, 110)}`);
        }
      }
    });
  }
  assert.deepEqual(fautifs, [],
    'Des emojis sont revenus dans du code rendu :\n' + fautifs.join('\n') +
    '\n\n  Un emoji tombe en police système : son dessin dépend de l’OS, il ne suit' +
    '\n  pas currentColor, et il ne se met pas à l’échelle. Utilisez une CLÉ de' +
    '\n  SF_ACC_ICONS via sfAccIcon(cle, taille).');
});

test('les caractères tolérés le sont pour une raison écrite', () => {
  /* Une tolérance sans motif est une porte ouverte. */
  for (const [ch, motif] of TOLERES) {
    assert.ok(motif.length > 40,
      `Le caractère « ${ch} » est toléré sans justification sérieuse.`);
  }
  assert.ok(TOLERES.size <= 3,
    'La liste des caractères tolérés grossit. Chaque ajout doit être un choix, ' +
    'pas une échappatoire pour faire passer un test.');
});

test('les tables qui associent une clé métier à un dessin portent des CLÉS', () => {
  /* ⚠️ Trois tables associaient une clé métier à un EMOJI : roleIcons de
     l'annuaire, typeIcons des échéances, et LOC_DOC_TYPES. Remplacer
     l'affichage sans les toucher aurait laissé la table derrière — c'est
     exactement là que ce genre de lot reste à moitié fait. */
  const propre = sansCommentaires(SRC);
  for (const nom of ['roleIcons', 'typeIcons']) {
    const m = propre.match(new RegExp('const ' + nom + '\\s*=\\s*\\{[\\s\\S]*?\\};'));
    assert.ok(m, `table ${nom} introuvable`);
    assert.ok(!PICTO.test(m[0]),
      `La table « ${nom} » porte de nouveau des emojis. Elle doit contenir des ` +
      `clés de SF_ACC_ICONS : c'est de la donnée, pas de l'ornement.`);
  }
});

test('un état qui change change le DESSIN, pas seulement la couleur', () => {
  /* ⚠️ RÈGLE 4 DE LA PLANCHE DE MARQUE : « la couleur ne porte jamais seule ».
     Tant que l'étoile était un emoji dont on faisait varier l'opacité, basculer
     une classe suffisait. Depuis qu'elle est un tracé, `setRating` doit
     REDESSINER : sinon baisser une note de 5 à 2 laisse cinq étoiles pleines à
     l'écran, et seul un changement de teinte dit le reste — ce qu'un daltonien
     ne voit pas. La revue a trouvé ce défaut ; cette garde le retient. */
  const propre = sansCommentaires(SRC);
  const m = propre.match(/function setRating\([\s\S]*?\n\}/);
  assert.ok(m, 'setRating introuvable');
  assert.match(m[0], /etoile-pleine/,
    'setRating ne redessine pas l\'étoile : il ne bascule qu\'une classe, et ' +
    'l\'état repose alors sur la seule couleur.');
  assert.match(m[0], /'etoile'/,
    'setRating ne repose jamais l\'étoile VIDE : une note abaissée garderait ' +
    'des étoiles pleines à l\'écran.');

  /* Et le corollaire : plus aucune opacité pour éteindre une étoile. C'est le
     motif que tout ce lot retire — gris pâle sur fond clair, invisible sur
     fond sombre. */
  const CSS = ['styles.css', 'components.css']
    .map(f => fs.readFileSync(path.join(RACINE, f), 'utf8')).join('\n');
  const regleEtoile = CSS.match(/\.star-btn\s*\{[^}]*\}/);
  assert.ok(regleEtoile, '.star-btn introuvable');
  assert.ok(!/opacity/.test(regleEtoile[0]),
    '`.star-btn` éteint de nouveau son étoile par l\'opacité. L\'état doit se ' +
    'dire par le dessin — plein ou vide — et la couleur être posée ' +
    'explicitement, car un <button> n\'hérite pas `color`.');
});

test('le jeu d\'icônes couvre tout ce que le code lui demande', () => {
  /* Une clé inconnue ne rend RIEN — un trou invisible à la relecture. Cette
     garde attrape la faute de frappe que l'œil ne voit pas. */
  const bloc = SRC.slice(SRC.indexOf('const SF_ACC_ICONS'));
  const fin = bloc.indexOf('\n};');
  const cles = new Set([...bloc.slice(0, fin).matchAll(/(?:^|\n)\s*'?([A-Za-z0-9_-]+)'?\s*:/g)]
                       .map(m => m[1]));
  assert.ok(cles.size >= 60, `jeu d'icônes anormalement petit : ${cles.size}`);

  const propre = sansCommentaires(SRC);
  const demandees = new Set([...propre.matchAll(/sfAccIcon\(\s*'([A-Za-z0-9_-]+)'/g)].map(m => m[1]));
  const manquantes = [...demandees].filter(c => !cles.has(c));
  assert.deepEqual(manquantes, [],
    `sfAccIcon est appelé avec des clés qui n'existent pas : ${manquantes.join(', ')}. ` +
    `Une clé inconnue ne dessine rien, et rien ne le signale à l'écran.`);
});
