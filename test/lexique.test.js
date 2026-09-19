/* LE LEXIQUE — expliquer un mot là où il est lu.

   ⚠️ POURQUOI CE COMPOSANT EXISTE. Le dépôt porte 49 attributs `title=`, et
   AUCUN ne s'affiche au doigt : l'infobulle native demande un survol, qui
   n'existe pas sur iPad — l'appareil du premier testeur. Une explication
   invisible pour son seul destinataire ne vaut rien.

   Gardes validées par mutation le 19/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-19T12:00:00') });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const CSS = fs.readFileSync(path.join(__dirname, '..', 'components.css'), 'utf8');

/* `SF_LEXIQUE` est un `const` : absent du contexte `vm`. On lit ses clés dans
   la source — c'est la même liste, et elle reste vérifiable. */
const CLES = [...APP_JS.slice(APP_JS.indexOf('const SF_LEXIQUE'),
                              APP_JS.indexOf('function sfLex('))
                       .matchAll(/^\s{2}'([a-z0-9-]+)':\s*\{/gm)].map(m => m[1]);

test('le catalogue n’est pas vide et chaque entrée est complète', () => {
  assert.ok(CLES.length >= 5, `seulement ${CLES.length} termes définis`);
  for (const cle of CLES) {
    const html = app.sfLex(cle);
    assert.match(html, /<b>[^<]{3,}<\/b>/, `${cle} : terme manquant`);
    /* ⚠️ ON MESURE LA DÉFINITION, PAS LE BALISAGE. Première version de ce
       test : `html.length > 160`. L'enveloppe et l'`aria-label` pesaient déjà
       plus que ça — la garde passait sur une définition réduite à « Au
       prorata. ». Débusqué par la mutation qui aurait dû la faire tomber. */
    const texte = /<\/b>([^<]*)<\/span>/.exec(html)?.[1] || '';
    assert.ok(texte.length > 120,
      `${cle} : définition de ${texte.length} caractères, trop courte pour expliquer quoi que ce soit`);
  }
});

test('RÉGRESSION — toute clé employée dans l’écran existe au catalogue', () => {
  /* Une clé mal orthographiée ne lève aucune erreur : `sfLex` rend alors le
     libellé nu, et l'explication disparaît SANS BRUIT. C'est exactement le
     genre de défaut qu'on ne voit jamais à l'œil. */
  const employees = [...APP_JS.matchAll(/sfLex\('([a-z0-9-]+)'/g)].map(m => m[1]);
  assert.ok(employees.length >= 5, 'le lexique n’est plus employé nulle part');
  const orphelines = [...new Set(employees)].filter(c => !CLES.includes(c));
  assert.deepEqual(orphelines, [], `clés employées mais non définies : ${orphelines.join(', ')}`);
});

test('RÉGRESSION — tout terme défini est employé quelque part', () => {
  /* Un terme défini et jamais posé est du poids mort : personne ne le lira,
     et il finira par décrire un écran qui a changé. */
  const employees = new Set([...APP_JS.matchAll(/sfLex\('([a-z0-9-]+)'/g)].map(m => m[1]));
  const inutilisees = CLES.filter(c => !employees.has(c));
  assert.deepEqual(inutilisees, [], `termes définis sans point d’usage : ${inutilisees.join(', ')}`);
});

// ── L'ancre doit être atteignable au doigt ET au clavier ───────────────────

test('RÉGRESSION — l’ancre est un vrai bouton, pas un title= ni un span', () => {
  const html = app.sfLex('prorata');
  assert.match(html, /<button type="button"/, 'sans bouton, ni clavier ni lecteur d’écran');
  assert.match(html, /aria-expanded="false"/, 'l’état ouvert/fermé doit être annoncé');
  assert.match(html, /aria-label="[^"]+"/, 'le bouton « ? » seul ne dit rien');
  assert.doesNotMatch(html, /title=/, 'le title natif ne s’affiche pas au doigt');
});

test('une clé inconnue rend le libellé seul, jamais une ancre morte', () => {
  assert.equal(app.sfLex('nexiste-pas', 'Mon libellé'), 'Mon libellé');
  assert.doesNotMatch(app.sfLex('nexiste-pas', 'X'), /<button/);
});

test('le libellé affiché peut différer du terme expliqué', () => {
  /* « Détention » à l'écran, « Mode de détention » dans l'explication : le
     champ reste court, la définition reste complète. */
  const html = app.sfLex('mode-detention', 'Détention');
  assert.match(html, /<span class="sf-lex">Détention<button/, 'le libellé doit précéder le bouton');
  assert.match(html, /<b>Mode de détention<\/b>/);
});

test('le texte des définitions est échappé', () => {
  const html = app.sfLex('cashflow-reel');
  assert.doesNotMatch(html.replace(/<\/?(span|button|b)\b[^>]*>/g, ''), /[<>]/,
    'du HTML brut dans une définition passerait dans la page');
});

// ── Le style doit exister, sinon la bulle ne s'ouvre sur rien ──────────────

test('RÉGRESSION — la cible tactile du bouton atteint 44 px', () => {
  /* Un rond de 16 px au milieu d'une phrase ne peut pas grossir sans casser la
     ligne. Il est ici ISOLÉ — aucune cible voisine à recouvrir — donc le
     pseudo-élément étendu est légitime, contrairement aux grilles denses où
     `tactile.css` l'interdit explicitement. */
  assert.match(CSS, /@media \(any-pointer: coarse\)\{[\s\S]*?\.sf-lex__b::after[\s\S]*?width:44px/,
    'au doigt, la cible reste à 16 px');
});

test('RÉGRESSION — la bulle est masquée au repos', () => {
  assert.match(app.sfLex('prorata'), /class="sf-lex__x" role="tooltip" hidden/,
    'sans `hidden`, toutes les définitions s’affichent en permanence');
});

// ── Ce que la revue a rattrapé, tout du côté iPad ──────────────────────────

test('RÉGRESSION — la cible tactile s’ancre sur le BOUTON, pas sur le mot', () => {
  /* ⚠️ Sans `position` sur `.sf-lex__b`, le pseudo-élément qui élargit la
     cible s'ancre sur `.sf-lex`, le seul parent positionné : la zone de 44 px
     recouvrait alors le TERME, le « ? » restait à 16 px, et taper le mot
     ouvrait la bulle. */
  const bloc = /\.sf-lex__b\{([\s\S]*?)\}/.exec(CSS);
  assert.ok(bloc, '.sf-lex__b a disparu');
  assert.match(bloc[1], /position:\s*relative/,
    'le pseudo-élément s’ancrerait sur .sf-lex et couvrirait le mot');
});

test('RÉGRESSION — la bulle échappe aux parents qui tronquent', () => {
  /* Trois des cinq ancres vivent dans des conteneurs en `overflow:hidden` —
     `.sff-kpis` fait 115 px de haut. Une bulle en `absolute` y était coupée
     aux deux tiers. `fixed` + placement en JS, comme le panneau de `.sf-pick`,
     qui porte déjà ce raisonnement dans son commentaire. */
  const bloc = /\.sf-lex__x\{([\s\S]*?)\}/.exec(CSS);
  assert.match(bloc[1], /position:\s*fixed/, 'une bulle en absolute serait tronquée');
  assert.match(APP_JS, /function sfLexPlacer\(/, 'une bulle fixed sans placement reste en 0,0');
  assert.match(APP_JS, /getBoundingClientRect/, 'le placement doit partir du bouton');
});

test('RÉGRESSION — la bulle est bornée des deux côtés du cadre', () => {
  /* La première version posait `right:0` sur un span de ~120 px : la bulle de
     320 px débordait de ~180 px PAR LA GAUCHE, hors de l'écran — et seulement
     au doigt, donc sur l'appareil qu'elle vise. */
  const src = APP_JS.slice(APP_JS.indexOf('function sfLexPlacer'),
                           APP_JS.indexOf('function sfLexPlacer') + 900);
  assert.match(src, /Math\.min\(Math\.max\(/, 'la position horizontale doit être bornée');
  assert.match(src, /innerWidth/, 'sans la largeur du cadre, rien ne borne à droite');
  assert.doesNotMatch(CSS, /\.sf-lex__x\{[^}]*right:\s*0/, 'right:0 pousse la bulle hors écran');
});

test('RÉGRESSION — la définition n’hérite pas des capitales d’un libellé', () => {
  /* Les ancres sont posées dans des libellés en capitales (`.sff-kpi__l`,
     `.sff-block__t`) : trois définitions sur cinq s'affichaient EN MAJUSCULES
     avec l'interlettrage d'un titre. */
  const bloc = /\.sf-lex__x\{([\s\S]*?)\}/.exec(CSS);
  assert.match(bloc[1], /text-transform:\s*none/, 'la définition hériterait des capitales');
  assert.match(bloc[1], /letter-spacing:\s*normal/, 'elle hériterait de l’interlettrage du titre');
});
