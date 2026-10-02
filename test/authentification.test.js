/* L'ÉCRAN DE CONNEXION, LES MOTS DE PASSE, ET L'INFOBULLE AU DOIGT — la v=93.

   ⚠️ LE DÉFAUT QUI JUSTIFIE CE FICHIER : une faille PAR LIEN. Le message
   d'erreur d'une connexion Google est lu dans l'URL (`error_description`) et
   affiché par `showAuthAlert`, qui écrit du HTML. Un lien piégé vers
   Stonefolio exécutait donc du script sur la plateforme — là où vit la
   session Supabase de la personne qui clique. Aucun compte, aucun accès
   préalable : il suffisait de faire cliquer un lien. Trouvé le 02/10/2026 en
   relisant l'écran de connexion pour tout autre chose.

   Le reste du fichier :
     · les erreurs de mot de passe disent la VRAIE raison du refus ;
     · un mot de passe connu des fuites publiques est refusé, sans que le mot
       de passe quitte le navigateur, et sans bloquer personne si le service
       ne répond pas ;
     · sur un écran tactile, toucher un élément titré en affiche le texte.

   Les gardes sont validées par mutation le 02/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const { charger, lire } = require('./charger-app');

const RACINE = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(RACINE, 'app.js'), 'utf8');
const HOSTILE = '<img src=x onerror=alert(1)>';

function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  return SRC.slice(debut, suite === -1 ? undefined : debut + 1 + suite);
}

function app() {
  const ctx = charger();
  // Ce que le chargeur ne fournit pas et dont ces fonctions ont besoin.
  Object.assign(ctx, { URLSearchParams, TextEncoder, AbortController, crypto: webcrypto });
  return ctx;
}

// ─── La faille par lien ────────────────────────────────────────────────────

test('RÉGRESSION — une erreur lue dans l\'URL ne devient jamais du HTML', () => {
  for (const [ou, forme] of [['search', '?'], ['hash', '#']]) {
    const ctx = app();
    ctx.location[ou] = `${forme}error=server_error&error_description=${encodeURIComponent(HOSTILE)}`;
    const msg = ctx.checkOAuthErrorInUrl();
    assert.ok(msg, `aucun message pour une erreur passée dans ${ou}`);
    assert.doesNotMatch(msg, /<img/,
      `Le message d'erreur OAuth reprend l'URL BRUTE (${ou}) : un lien piégé exécute du script ` +
      `sur la plateforme, là où vit la session. Tout texte venu de l'URL passe par esc().`);
    assert.ok(msg.includes('&lt;img'), 'témoin : le texte de l\'URL doit apparaître, échappé');
  }
});

test('le code d\'erreur seul, sans description, est échappé lui aussi', () => {
  const ctx = app();
  ctx.location.search = '?error=' + encodeURIComponent(HOSTILE);
  assert.doesNotMatch(ctx.checkOAuthErrorInUrl(), /<img/);
});

test('les adresses e-mail réaffichées sur l\'écran de connexion sont échappées', () => {
  /* L'expression qui valide une adresse accepte `<img/src=x/onerror=…>@x.fr` :
     il n'y a pas d'espace. Elle repartait ensuite dans un message en HTML. */
  for (const fn of ['doSignup', 'doReset']) {
    const c = corps(fn);
    assert.doesNotMatch(c, /<strong>'\s*\+\s*email\s*\+/, `${fn} réaffiche l'adresse saisie sans esc().`);
  }
});

// ─── Les erreurs de mot de passe ───────────────────────────────────────────

test('une erreur de mot de passe dit la VRAIE raison du refus', () => {
  const ctx = app();
  const t = e => ctx.authErrorToFr(e);
  assert.match(t({ code: 'weak_password', reasons: ['characters'],
                   message: 'Password should contain at least one character of each: abc, ABC, 123' }),
    /plusieurs sortes de caractères/,
    'Un refus pour composition se lisait « au moins 8 caractères » — un message faux.');
  assert.match(t({ message: 'Password should be at least 10 characters.' }), /au moins 10 caractères/,
    'La longueur exigée doit être celle du serveur, pas un 8 écrit en dur.');
  assert.equal(t({ code: 'weak_password', reasons: ['pwned'], message: 'Password is known to be weak and easy to guess' }),
    lire(ctx, 'SF_MDP_COMPROMIS'));
});

test('un message serveur inconnu est affiché comme du texte', () => {
  const ctx = app();
  assert.doesNotMatch(ctx.authErrorToFr({ message: HOSTILE }), /<img/,
    'Le message brut du serveur part dans showAuthAlert, qui écrit du HTML.');
});

// ─── Les mots de passe déjà fuités ─────────────────────────────────────────

test('la réponse du service se lit ligne à ligne, sans faux positif', () => {
  const ctx = app();
  const rep = '0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n00D4F6E8FA6EECAD2A3AA415EEC418D38EC:0';
  assert.equal(ctx.sfSuffixeCompromis(rep, '1e4c9b93f3f0682250b6cf8331b7ee68fd8'), true, 'casse indifférente');
  assert.equal(ctx.sfSuffixeCompromis(rep, '00D4F6E8FA6EECAD2A3AA415EEC418D38EC'), false,
    'une ligne à 0 est du remplissage, pas une fuite');
  assert.equal(ctx.sfSuffixeCompromis(rep, 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF'), false);
});

test('seuls CINQ caractères de l\'empreinte quittent le navigateur', async () => {
  /* « password » a pour SHA-1 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8 :
     on n'envoie que 5BAA6, et la comparaison du reste se fait ici. */
  const ctx = app();
  const appels = [];
  ctx.fetch = async (url) => { appels.push(url);
    return { ok: true, text: async () => '1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824' }; };
  assert.equal(await ctx.sfMotDePasseCompromis('password'), true);
  assert.deepEqual(appels, ['https://api.pwnedpasswords.com/range/5BAA6']);
  // (Le nom du service contient lui-même « password » : on lit ce qui suit /range/.)
  assert.equal(appels[0].split('/range/')[1], '5BAA6',
    'ni le mot de passe ni la fin de son empreinte ne doivent partir');

  ctx.fetch = async () => ({ ok: true, text: async () => '0018A45C4D1DEF81644B54AB7F969B88D65:3' });
  assert.equal(await ctx.sfMotDePasseCompromis('password'), false, 'absent de la liste → pas compromis');
});

test('un service qui ne répond pas ne bloque personne', async () => {
  const ctx = app();
  ctx.fetch = async () => { throw new Error('réseau'); };
  assert.equal(await ctx.sfMotDePasseCompromis('password'), null);
  ctx.fetch = async () => ({ ok: false, text: async () => '' });
  assert.equal(await ctx.sfMotDePasseCompromis('password'), null);
  // Et les deux appelants ne refusent que sur un `true` explicite.
  for (const fn of ['doSignup', 'doSetNewPwd']) {
    assert.match(corps(fn), /await sfMotDePasseCompromis\(pwd\) === true/,
      `${fn} doit ne refuser que sur un \`true\` : null veut dire « on ne sait pas ».`);
  }
});

test('la vérification a lieu AVANT que le mot de passe ne parte chez Supabase', () => {
  for (const [fn, envoi] of [['doSignup', 'db.auth.signUp('], ['doSetNewPwd', 'db.auth.updateUser(']]) {
    const c = corps(fn);
    const verif = c.indexOf('sfMotDePasseCompromis(');
    assert.ok(verif > -1 && verif < c.indexOf(envoi),
      `${fn} enregistre le mot de passe avant de l'avoir vérifié.`);
  }
});

// ─── L'infobulle au doigt ──────────────────────────────────────────────────

/* Un DOM minimal, juste ce que sfBulleCible lit : parentElement, attributs,
   closest() et matches() sur les sélecteurs simples qu'elle emploie. */
function noeud(tag, attrs = {}, parent = null) {
  const n = { tagName: tag.toUpperCase(), attrs, parentElement: parent,
    getAttribute: k => (k in attrs ? attrs[k] : null) };
  n.matches = sel => sel.split(',').map(x => x.trim()).some(x => {
    const m = x.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
    if (m) return m[2] === undefined ? m[1] in attrs : attrs[m[1]] === m[2];
    return n.tagName === x.toUpperCase();
  });
  n.closest = sel => { for (let c = n; c; c = c.parentElement) if (c.matches(sel)) return c; return null; };
  return n;
}

test('toucher un élément titré non interactif en révèle le texte', () => {
  const ctx = app();
  const carte = noeud('div', { onclick: 'ouvrir()' });          // un ancêtre cliquable, PLUS HAUT
  const colonne = noeud('div', {}, carte);
  const barre = noeud('span', { title: 'Mars : −850 €' }, colonne);
  assert.equal(ctx.sfBulleCible(barre), barre,
    'La valeur d\'une barre de graphique doit se lire au doigt : sur iPad, `title` ne s\'affiche jamais.');
  const etiquette = noeud('span', {}, noeud('div', { title: 'Mars : encaissé' }));
  assert.equal(ctx.sfBulleCible(etiquette).getAttribute('title'), 'Mars : encaissé',
    'Toucher le texte DANS une case titrée doit révéler le titre de la case.');
});

test('un bouton, un lien ou une case cliquable gardent leur action', () => {
  const ctx = app();
  assert.equal(ctx.sfBulleCible(noeud('td', { title: 'Mars — clic pour pointer', onclick: 'x()' })), null,
    'Une cellule cliquable doit agir, pas afficher une bulle.');
  const icone = noeud('svg', {}, noeud('button', { title: 'Supprimer' }));
  assert.equal(ctx.sfBulleCible(icone), null, 'Toucher l\'icône d\'un bouton doit déclencher le bouton.');
  assert.equal(ctx.sfBulleCible(noeud('a', { title: 'Appeler', href: 'tel:0' })), null);
  assert.equal(ctx.sfBulleCible(noeud('span', { title: '  ' })), null, 'un titre vide ne mérite pas de bulle');
});

test('la bulle et tactile.css répondent à la même question, avec la même requête', () => {
  /* « Y a-t-il un survol ? » — si les deux côtés divergent, des actions
     révélées au survol réapparaissent d'un côté pendant que la bulle reste
     muette de l'autre. */
  const css = fs.readFileSync(path.join(RACINE, 'tactile.css'), 'utf8');
  const requete = lire(app(), 'SF_SANS_SURVOL');
  assert.ok(css.includes(`@media ${requete} {`),
    `La requête de la bulle (${requete}) n'est plus celle de tactile.css pour les actions révélées au survol.`);
  assert.match(SRC, /b\.textContent = cible\.getAttribute\('title'\)/,
    'La bulle doit écrire du TEXTE : un `title` peut porter un titre de bien saisi.');
});
