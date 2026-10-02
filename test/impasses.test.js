/* PLUS D'IMPASSE DEVANT UN PREMIER UTILISATEUR — la v=92.

   ⚠️ POURQUOI CE FICHIER EXISTE. Le premier testeur extérieur clique tout,
   sur iPad. Deux familles d'impasses l'attendaient :
     · QUATRE ENTRÉES « BIENTÔT » — Sécurité, Notifications, Intégrations, et la
       Carte de France — qui répondaient toutes « pas encore » ;
     · VINGT-DEUX BOÎTES `confirm()` du navigateur, avec leur bannière
       « github.io indique », au moment précis où il valide une suppression.

   Et une troisième, trouvée en migrant la seconde, plus grave que les deux :
   la fenêtre de confirmation à la charte vivait au z-index 200, sous les
   fenêtres d'ancienne charte (2000 et 2001). Posée depuis l'une d'elles, la
   question s'ouvrait DERRIÈRE — invisible, focus sur « Confirmer ». Migrer
   les `confirm()` sans régler cela aurait remplacé une boîte laide par une
   boîte invisible.

   Les gardes sont validées par mutation le 02/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app');

const RACINE = path.join(__dirname, '..');
const lire = f => fs.readFileSync(path.join(RACINE, f), 'utf8');
const SRC = lire('app.js');
const INDEX = lire('index.html');

function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  return SRC.slice(debut, suite === -1 ? undefined : debut + 1 + suite);
}

// ─── Les entrées « Bientôt » ───────────────────────────────────────────────

test('une section des Paramètres pas encore construite n\'est proposée à personne', () => {
  const app = charger();
  for (const id of ['securite', 'notifications', 'integrations']) {
    assert.equal(app.sfParamAccessible(id, true), false,
      `« ${id} » est encore proposée, même à un administrateur. Une entrée qui ` +
      `répond « Bientôt » est une impasse : on la masque tant qu'elle n'existe pas.`);
  }
  // Témoins : la règle ne masque pas ce qui existe, ni ne lève le cloisonnement.
  assert.equal(app.sfParamAccessible('compte', false), true, 'Compte doit rester proposé.');
  assert.equal(app.sfParamAccessible('maintenance', false), false,
    'Maintenance est réservée aux administrateurs : le masquage des « Bientôt » ne doit pas lever ce cloisonnement.');
  assert.equal(app.sfParamAccessible('maintenance', true), true, 'Maintenance doit rester proposée à un admin.');
});

test('les trois lecteurs de PARAMS_SECTIONS passent par la même règle', () => {
  /* La roue dentée, la navigation de la page et la résolution de l'URL lisaient
     chacun la liste à leur façon. Une règle lue en trois endroits finit par
     diverger : c'est la leçon de l'audit du 05/08. */
  assert.match(corps('sfBuildParamsMenu'), /sfParamPropose\(/, 'la roue dentée ne passe pas par sfParamPropose');
  const page = corps('renderParametres');
  assert.match(page, /sfParamPropose\(/, 'la navigation de la page ne passe pas par sfParamPropose');
  assert.match(page, /sfParamAccessible\(/, 'la résolution de l\'URL ne passe pas par sfParamAccessible');
  assert.doesNotMatch(corps('renderParamsSection'), /Bientôt disponible/,
    'renderParamsSection affiche de nouveau un écran « Bientôt disponible ».');
});

test('la Carte de France n\'est plus proposée tant qu\'elle n\'existe pas', () => {
  assert.doesNotMatch(INDEX, /nav-marche-carte/, 'l\'entrée de menu « Carte de France » est revenue.');
  assert.doesNotMatch(INDEX, /sf-menu__soon/, 'un badge « Bientôt » est revenu dans le bandeau.');
  assert.doesNotMatch(SRC, /function renderMarcheCarte\b/, 'l\'écran d\'attente de la carte est revenu.');
  // Une référence ancienne retombe sur la recherche, pas sur du vide.
  assert.match(corps('navigate'), /page === 'marche-carte'\) page = 'marche-recherche'/,
    'navigate ne redirige plus « marche-carte » : un ancien lien ouvrirait un écran vide.');
});

// ─── Les confirmations ─────────────────────────────────────────────────────

test('plus aucune boîte confirm() du navigateur', () => {
  /* On cherche un APPEL — `confirm(` suivi d'un argument. Les commentaires du
     dépôt citent `confirm()` avec des parenthèses vides pour expliquer ce
     qu'on a retiré : ils ne sont pas des appels. */
  const appels = SRC.split('\n')
    .map((l, i) => [i + 1, l.trim()])
    .filter(([, l]) => /(^|[^.\w$])confirm\(\s*[^)\s]/.test(l));
  assert.deepEqual(appels, [],
    'Des boîtes natives sont revenues — leur bannière « github.io indique » ' +
    'trahit l\'application au moment d\'une suppression. Utilisez sfConfirmer().');
});

test('la confirmation s\'ouvre AU-DESSUS de toute autre fenêtre', () => {
  /* La garde qui compte le plus. On ne vérifie pas une valeur arbitraire :
     on compare le plan de la confirmation au plus haut plan de TOUTES les
     fenêtres et popups déclarées dans les feuilles livrées. */
  const fn = corps('sfConfirmer');
  assert.doesNotMatch(fn, /modal-detail/,
    'sfConfirmer emprunte de nouveau `modal-detail`, au z-index 200 : posée depuis ' +
    'une fenêtre d\'ancienne charte, la question s\'ouvrirait DERRIÈRE, invisible.');
  assert.match(fn, /'sf-confirm'/, 'sfConfirmer n\'a plus sa propre fenêtre.');

  const CSS = ['tokens.css', 'components.css', 'styles.css', 'financier.css', 'tactile.css']
    .map(lire).join('\n');
  const jeton = CSS.match(/--sf-z-confirm:\s*(\d+)/);
  assert.ok(jeton, 'jeton --sf-z-confirm introuvable');
  /* ⚠️ LA RÈGLE DOIT GAGNER LA CASCADE, PAS SEULEMENT EXISTER. `styles.css`,
     chargé après `components.css`, pose `.modal-overlay{z-index:200}` : une
     règle `.sf-confirm{…}` de même spécificité perd. C'est arrivé, et seul un
     vrai navigateur l'a montré. On exige donc deux classes dans le sélecteur. */
  assert.match(CSS, /\.modal-overlay\.sf-confirm\s*\{[^}]*z-index:\s*var\(--sf-z-confirm\)/,
    'Le plan de la confirmation doit être porté par `.modal-overlay.sf-confirm` : ' +
    'écrit `.sf-confirm` seul, il perd la cascade face à `.modal-overlay` de styles.css.');
  const plans = [...CSS.matchAll(/z-index:\s*(\d+)/g)].map(m => +m[1]);
  const plusHaut = Math.max(...plans);
  assert.ok(+jeton[1] > plusHaut,
    `La confirmation est au plan ${jeton[1]}, une autre couche monte à ${plusHaut} : ` +
    `la question pourrait s'ouvrir dessous.`);
});

test('sur un acte destructeur, Entrée ne valide pas', () => {
  /* Le focus allait toujours à « Confirmer ». Sur une suppression, une
     touche Entrée réflexe ne doit rien effacer : le focus va au bouton sûr. */
  assert.match(corps('sfConfirmer'), /danger \? '\[data-rep="non"\]' : '\[data-rep="oui"\]'/,
    'Le focus initial ne dépend plus de `danger` : une touche Entrée validerait une suppression.');
});

test('Échap refuse la question sans refermer la fenêtre d\'où elle vient', () => {
  const fn = corps('sfConfirmer');
  assert.match(fn, /addEventListener\('keydown', surTouche, true\)/,
    'Échap doit être écouté en CAPTURE, avant les fenêtres en dessous.');
  assert.match(fn, /stopImmediatePropagation\(\)/,
    'Échap doit s\'arrêter à la question, sans refermer aussi la fenêtre d\'origine.');
});
