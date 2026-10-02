/* CE QUE L'UTILISATEUR — OU UN TIERS — ÉCRIT NE DEVIENT JAMAIS DU HTML.

   ⚠️ POURQUOI CE FICHIER EXISTE. La conclusion « plus aucune interpolation
   sans `esc()` » a été publiée TROIS fois, et elle était fausse trois fois :
     · le 03/08/2026, l'audit ne couvrait que les ATTRIBUTS ;
     · le 13/08/2026, la revue manquait les huit `<textarea>` ;
     · le 27/09/2026, la v=90 annonçait « deux noms de fichier échappés »
       pendant qu'une vingtaine d'autres valeurs passaient brutes dans
       `innerHTML` — dont, la plus sérieuse, les ARTICLES DE NEWSAPI : titre,
       nom de la source, adresse de l'image. Ce n'est pas le bailleur qui les
       écrit, c'est n'importe quel éditeur indexé par NewsAPI.

   Trois relectures à l'œil, trois oublis. Ce fichier remplace l'œil.

   Deux étages, parce qu'aucun ne suffit seul :
     · des gardes de COMPORTEMENT : on appelle les vrais rendus avec une donnée
       hostile, et on lit le HTML produit. Chacune exige aussi un TÉMOIN
       POSITIF — la donnée doit apparaître, échappée. Un rendu qui
       n'afficherait plus rien passerait sinon au vert ;
     · une garde de MOTIF, sur tout app.js : elle attrape la forme du défaut
       là où aucun rendu n'est testable (écrans qui lisent la base).

   Les gardes sont validées par mutation le 02/10/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// La charge hostile, et la forme qu'elle doit prendre une fois échappée.
const HOSTILE = '<img src=x onerror=alert(1)>';
const BRUT = /<img src=x onerror=alert\(1\)/;
const ECHAPPE = '&lt;img src=x onerror=alert(1)&gt;';

function elementTemoin() {
  return { innerHTML: '', style: {}, dataset: {},
           classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
           querySelector(){ return null; }, querySelectorAll(){ return []; } };
}

function verifierInerte(html, quoi) {
  assert.doesNotMatch(html, BRUT,
    `${quoi} : la donnée hostile est passée BRUTE dans le HTML. ` +
    `Toute valeur saisie ou reçue d'un tiers passe par esc() avant innerHTML.`);
  assert.ok(html.includes(ECHAPPE),
    `${quoi} : la donnée n'apparaît plus du tout. La garde ne prouve rien si ` +
    `le rendu a cessé d'afficher ce qu'il devait afficher.`);
}

test('les documents d\'un locataire : le nom du fichier déposé', () => {
  /* Le vecteur le plus crédible de tout l'inventaire : le bailleur dépose un
     fichier REÇU de son locataire, dont c'est le locataire qui a choisi le nom. */
  const ctx = charger();
  const liste = elementTemoin();
  ctx.document.getElementById = id => (id === 'loc-docs-list' ? liste : null);
  injecter(ctx, { locataireDocsPending: [
    { name: 'bail' + HOSTILE + '.pdf', type: 'bail', size: 1024, uploaded_at: '2026-09-01' }] });
  ctx.refreshLocDocsView();
  verifierInerte(liste.innerHTML, 'refreshLocDocsView');
});

test('l\'annuaire : prénom, nom, société', () => {
  const ctx = charger();
  injecter(ctx, { allContacts: [
    { id: 'c1', role: 'Notaire', prenom: HOSTILE, nom: 'Durand', societe: 'Étude ' + HOSTILE }] });
  const c = elementTemoin();
  ctx.renderAdmAnnuaire(c);
  verifierInerte(c.innerHTML, 'renderAdmAnnuaire');
  // L'initiale de l'avatar est une donnée comme une autre : un « < » seul
  // ouvre une balise si la suite s'y prête.
  assert.doesNotMatch(c.innerHTML, /contact-avatar[^>]*>\s*</,
    'renderAdmAnnuaire : l\'initiale de l\'avatar passe brute.');
});

test('les échéances : titre et nom de la SCI', () => {
  const ctx = charger({ maintenant: new Date('2026-10-02T12:00:00') });
  injecter(ctx, {
    allSCI: [{ id: 's1', nom_sci: 'SCI ' + HOSTILE }],
    allEcheances: [{ id: 'e1', sci_id: 's1', titre: 'PNO ' + HOSTILE, type_echeance: 'Assurance',
                     date_echeance: '2026-11-15', est_faite: false, recurrence: 'Annuelle' }],
  });
  const c = elementTemoin();
  ctx.renderAdmEcheances(c);
  verifierInerte(c.innerHTML, 'renderAdmEcheances');
  assert.equal(c.innerHTML.split(ECHAPPE).length - 1, 2,
    'renderAdmEcheances : le titre ET le nom de la SCI doivent être échappés.');
});

test('le Marché : ce que NewsAPI renvoie est une donnée tierce', () => {
  /* ⚠️ LE CAS QUI COMPTE LE PLUS. Les autres valeurs sont saisies par le
     bailleur sur son propre compte ; celles-ci sont écrites par n'importe quel
     éditeur indexé par NewsAPI. Le titre passait par un filtre
     `replace(/<[^>]+>/g, '')` qui ne retire qu'une balise FERMÉE : une balise
     sans `>` final lui échappait, et le navigateur la refermait sur le `>`
     suivant du gabarit. */
  const ctx = charger();
  const el = elementTemoin();
  const article = {
    title: 'Usine ' + HOSTILE.slice(0, -1),          // balise volontairement non fermée
    source: { name: HOSTILE },
    url: 'javascript:alert(1)',
    urlToImage: 'x" onerror="alert(1)',
    publishedAt: '2026-09-01',
  };
  ctx.renderMarcheResults(el, 'Poitiers', '86', '86194', '86000', {}, null,
                          { source: 'newsapi', articles: [article] });
  const html = el.innerHTML;
  verifierInerte(html, 'renderMarcheResults (source de l\'article)');
  assert.ok(html.includes('Usine &lt;img src=x onerror=alert(1)'),
    'renderMarcheResults : le titre d\'un article doit être échappé, pas seulement filtré.');
  assert.doesNotMatch(html, /onerror="alert\(1\)"/,
    'renderMarcheResults : l\'adresse de l\'image est sortie de son attribut.');
  assert.doesNotMatch(html, /href="javascript:/i,
    'renderMarcheResults : un lien d\'article en javascript: est passé.');
});

test('escJs : un argument JavaScript dans un onclick reste un argument', () => {
  /* On reproduit ce que fait le navigateur : il lit l'attribut, en défait les
     entités, PUIS exécute le gestionnaire. Si l'échappement est faux, soit
     l'attribut se referme trop tôt, soit la chaîne JS se referme — et
     l'argument reçu n'est plus celui qu'on a passé. */
  const ctx = charger();
  const decoder = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
                        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  const cas = ["L'Haÿ-les-Roses", 'Saint-"Quote"', '</div>' + HOSTILE,
               'barre\\oblique', 'deux\nlignes', '&amp; déjà échappé', ''];
  for (const valeur of cas) {
    const html = `<button onclick="f(${ctx.escJs(valeur)})">x</button>`;
    const m = html.match(/onclick="([^"]*)"/);
    assert.ok(m && html.slice(m.index + m[0].length).startsWith('>'),
      `escJs(${JSON.stringify(valeur)}) referme l'attribut onclick.`);
    let recu;
    new Function('f', decoder(m[1]))(v => { recu = v; });
    assert.equal(recu, valeur, `escJs(${JSON.stringify(valeur)}) ne restitue pas la valeur.`);
  }
});

test('plus aucun onclick n\'échappe sa chaîne à la main', () => {
  /* `.replace(/'/g, "\\'")` protège de l'apostrophe et de rien d'autre : un
     guillemet droit referme l'attribut. Trois boutons le faisaient. */
  const fautifs = SRC.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /onclick="[^"]*\.replace\(\/'\/g/.test(l));
  assert.deepEqual(fautifs.map(([n]) => n), [],
    'Un onclick construit sa chaîne JavaScript à la main. Utilisez escJs().');
});

/* ─── LA GARDE DE MOTIF ────────────────────────────────────────────────────
   Elle cherche la FORME du défaut : un champ de texte libre interpolé nu —
   `${x.titre}`, `${x.nom || '—'}`, `' — ' + x.ville` — sans esc() autour.

   ⚠️ CE QU'ELLE NE VOIT PAS, dit d'emblée : une valeur libre rangée d'abord
   dans une variable au nom anodin (`const t = b.titre; … ${t}`). C'est pour
   cela que les gardes de comportement ci-dessus existent aussi.

   Les lignes qui n'écrivent pas du HTML sont écartées : `textContent`,
   `confirm()`, `showNotif()` (qui échappe lui-même), la `question` de
   sfConfirmer (échappée), la console, et la composition de chaînes de
   recherche. */
const CHAMPS = 'titre|nom|prenom|societe|name|pdf_name|adresse|ville|nom_sci|message'
             + '|notes|commentaire|libelle|email|telephone|source';
const CHEMIN = '[\\w$]+(?:\\??\\.[\\w$]+)*\\??\\.';
const NU = new RegExp('\\$\\{\\s*' + CHEMIN + '(?:' + CHAMPS + ')'
                    + '\\s*(?:\\|\\|\\s*(?:\'[^\']*\'|"[^"]*"))?\\s*\\}', 'g');
const CONCAT = new RegExp('\\+\\s*' + CHEMIN + '(?:' + CHAMPS + ')\\b(?!\\s*[\\(\\[])', 'g');
const PAS_DU_HTML = /\.textContent\s*=|confirm\(|showNotif\(|question:|console\.|toLowerCase\(\)|tiNormTexte|^\s*(\/\/|\*)/;

/* ⚠️ LA LISTE DES TOLÉRANCES EST COURTE ET MOTIVÉE. Chaque entrée nomme un
   fragment de code exact et dit pourquoi il est sûr. Y ajouter une ligne doit
   coûter une justification vérifiée, pas un copier-coller pour faire passer
   la garde. */
const TOLERES = new Map([
  ['sf-alert__title">${p.titre}',
   'titres composés par sfPointsAttention à partir de compteurs et d\'années, '
   + 'jamais d\'un texte saisi.'],
  ["`Mise en gestion — ${b.titre || 'Bien'}`",
   'rendu par bdAcqRender via textContent, pas innerHTML : le texte reste du texte.'],
  ["photo${bdPhotos.length>1?'s':''} — ${b?.titre || 'Bien'}",
   'affecté à detail-titre.textContent à la ligne précédente : pas de HTML.'],
  ['const label = v.biens?.titre ?',
   'libellé de groupe composé en texte brut, échappé au rendu par ${esc(g.label)}.'],
]);

test('aucun champ de texte libre n\'est interpolé nu dans du HTML', () => {
  const fautifs = [];
  SRC.split('\n').forEach((l, i) => {
    if (PAS_DU_HTML.test(l)) return;
    if ([...TOLERES.keys()].some(k => l.includes(k))) return;
    for (const re of [NU, CONCAT]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(l))) fautifs.push(`  app.js:${i + 1}  ${m[0]}\n      ${l.trim().slice(0, 110)}`);
    }
  });
  assert.deepEqual(fautifs, [],
    'Un champ de texte libre passe brut dans du HTML :\n' + fautifs.join('\n') +
    '\n\n  Entourez-le de esc() — ou de escJs() dans un onclick. Si la valeur ne' +
    '\n  peut vraiment pas contenir de balise, ajoutez-la à TOLERES avec la raison.');
});

test('les tolérances existent encore, et le sont pour une raison écrite', () => {
  /* Une tolérance dont le code a disparu est une porte ouverte pour le
     prochain qui écrira la même ligne ailleurs. */
  for (const [fragment, motif] of TOLERES) {
    assert.ok(SRC.includes(fragment), `Tolérance périmée, le code a changé : ${fragment}`);
    assert.ok(motif.length > 40, `Tolérance sans justification sérieuse : ${fragment}`);
  }
  assert.ok(TOLERES.size <= 6,
    'La liste des tolérances grossit. Chaque ajout doit être un choix vérifié.');
});

test('LE TÉMOIN — la garde de motif sait reconnaître le défaut', () => {
  /* Un test qui ne sait pas échouer ne prouve rien. On lui montre les formes
     exactes trouvées le 02/10/2026, et il doit toutes les voir. */
  const vues = ['<div class="ech-title">${e.titre}</div>',
                "<div class=\"name\">${s.pdf_name||'Document PDF'}</div>",
                "${sfAccIcon('maison',12)+' '+s.biens.titre+' · '}"];
  for (const ligne of vues) {
    NU.lastIndex = 0; CONCAT.lastIndex = 0;
    assert.ok(NU.test(ligne) || CONCAT.test(ligne), `La garde ne voit pas : ${ligne}`);
  }
  NU.lastIndex = 0;
  assert.ok(!NU.test('<div>${esc(e.titre)}</div>'), 'La garde accuse une valeur échappée.');
});
