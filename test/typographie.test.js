/* LES NOMBRES S'ÉCRIVENT D'UNE SEULE FAÇON (v=103).

   ⚠️ CE QUI ÉTAIT FAUX.
   · Le séparateur de milliers était l'espace fine U+202F que pose
     `toLocaleString('fr-FR')` : juste en typographie, mais si étroite dans la
     police du texte courant que « 1 250 000 » se lisait d'un bloc. Arbitrage
     de Thomas : l'espace insécable ordinaire U+00A0, celle des relevés
     bancaires — en gardant l'espace fine devant € et %.
   · Cette espace fine n'était posée que par sfEur et sfPct. Ailleurs, 55
     lignes écrivaient `${fmt(x)} €` avec une espace ORDINAIRE : à la ligne,
     le « € » pouvait partir seul, loin de son nombre, et deux écrans voisins
     n'espaçaient pas la même somme de la même façon.

   LA RÈGLE. Un nombre passe par sfNombre() (fmt, sfEur, sfPctNum, les champs
   de saisie, le Marché). Devant € et %, l'espace fine insécable U+202F. Et ce
   que l'on affiche se relit : sfLireNombre() reprend tout ce que sfNombre
   écrit. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const NBSP = ' ', FINE = ' ';

// Commentaires blanchis : ceux du dépôt citent le défaut qu'ils corrigent.
const LEURRES = ['image/*', 'audio/*', 'video/*', '*/*'];
function sansCommentaires(src) {
  const brut = LEURRES.reduce((t, l) => t.split(l).join(l.replace('*', 'x')), src);
  const c = brut.split('');
  const blanchir = (d, f) => { for (let k = d; k < f; k++) if (c[k] !== '\n') c[k] = ' '; };
  for (const m of brut.matchAll(/\/\*[\s\S]*?\*\//g)) blanchir(m.index, m.index + m[0].length);
  const t = c.join('');
  for (const m of t.matchAll(/(?<=^|[\s;{}(),])\/\/[^\n]*/g)) blanchir(m.index, m.index + m[0].length);
  return c.join('');
}
const CODE = sansCommentaires(SRC);

test('les milliers se séparent par l’espace insécable, l’unité par l’espace fine', () => {
  const ctx = charger();
  assert.equal(ctx.fmt(1250000), `1${NBSP}250${NBSP}000`);
  assert.equal(ctx.fmt(-54735.4), `-54${NBSP}735`);
  assert.equal(ctx.sfEur(12600), `12${NBSP}600${FINE}€`);
  assert.equal(ctx.sfPctNum(1234.5, 1), `1${NBSP}234,5${FINE}%`);
  assert.equal(ctx.sfPctNum(5.126), `5,13${FINE}%`, 'virgule décimale, deux décimales au plus');
  assert.equal(ctx.sfnFormaterNombre(168000.5), `168${NBSP}000,5`, 'un champ de saisie montre le même séparateur');
  assert.ok(!ctx.fmt(1e9).includes(FINE), 'l’espace fine est revenue entre les milliers');
});

test('ce qui s’affiche se relit : sfLireNombre reprend tout ce que sfNombre écrit', () => {
  const ctx = charger();
  for (const n of [0.5, 12600, 168000.5, 1250000]) {
    assert.equal(ctx.sfLireNombre(ctx.sfnFormaterNombre(n)), n, `${n} affiché ne se relit plus`);
    assert.equal(ctx.sfLireNombre(ctx.sfEur(n)), Math.round(n), `${n} € affiché ne se relit plus`);
  }
  // Et ce qu'un utilisateur tape, ou qu'un ancien écran affichait encore.
  assert.equal(ctx.sfLireNombre(`168${FINE}000`), 168000);
  assert.equal(ctx.sfLireNombre('168 000'), 168000);
});

test('aucune ligne n’écrit une espace ordinaire entre un nombre et son unité', () => {
  /* Un `${fmt(x)} €` laisse le « € » passer seul à la ligne quand la colonne
     se resserre. Le motif : une interpolation ou une chaîne qui se ferme, puis
     une espace ORDINAIRE, puis € ou %. */
  const fautes = [];
  CODE.split('\n').forEach((l, i) => {
    // (`(i % n)` et `x.length) %` sont des modulos : le motif ne les voit pas.)
    if (/(?:\}|'|>\d+) (€|%)/.test(l)) fautes.push(`  app.js:${i + 1}  ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(fautes, [],
    'Espace ordinaire devant € ou % (le signe peut partir seul à la ligne) :\n' + fautes.join('\n') +
    '\n  Écrire l’espace fine insécable U+202F, ou passer par sfEur() / sfPctNum().');
  // Témoin : le motif sait trouver l'espace fine là où elle est.
  const fines = (CODE.match(/\} (€|%)/g) || []).length;
  assert.ok(fines >= 30, `témoin : ${fines} interpolations suivies de l’espace fine`);
});

test('toute mise en forme d’un nombre passe par sfNombre', () => {
  const appels = [...CODE.matchAll(/\.toLocaleString\(\s*'fr-FR'(?!\s*,\s*\{\s*(?:weekday|day|month|year|hour))/g)]
    .map(m => CODE.slice(0, m.index).split('\n').length);
  const dansSfNombre = CODE.indexOf('function sfNombre');
  const fautifs = appels.filter(ligne => {
    const debut = CODE.split('\n').slice(0, ligne - 1).join('\n').length;
    return !(debut > dansSfNombre && debut < dansSfNombre + 200);
  });
  assert.ok(dansSfNombre > 0 && appels.length >= 1, 'témoin : sfNombre existe et le balayage voit son appel');
  assert.deepEqual(fautifs, [],
    `toLocaleString('fr-FR') appelé hors de sfNombre (lignes ${fautifs.join(', ')}) : ` +
    'ce nombre reprend l’espace fine entre les milliers.');
});

test('aucun nombre affiché par toFixed : la décimale s’écrit avec une virgule', () => {
  /* « 5.6 % » sur les cartes de Mes biens, « 7.5 % » de frais de notaire,
     « 2.5 MB » pour un document, « 2.3 » personnes par ménage (v=103) :
     `toFixed` pose un point. Un affichage passe par sfPctNum() ou sfNombre() ;
     `toFixed` reste pour les coordonnées d'un dessin SVG et les longueurs CSS
     (`height:${x.toFixed(1)}%`, sans espace : ce n'est pas un affichage). */
  const fautes = [];
  CODE.split('\n').forEach((l, i) => {
    if (/toFixed\(\d\)\s*(?:\+\s*'[\s\u202f]*(?:%|€|MB|KB|Mo|Ko)|\}[\s\u202f]+(?:%|€))/.test(l)) fautes.push(`  app.js:${i + 1}  ${l.trim().slice(0, 100)}`);
  });
  assert.deepEqual(fautes, [], 'Nombre affiché avec un point décimal :\n' + fautes.join('\n'));
  const ctx = charger();
  assert.equal(ctx.mfFmtSize(2.5 * 1024 * 1024), '2,5\u202fMo', 'taille d’un document en unités françaises');
  assert.equal(ctx.mfFmtSize(1536), '2\u202fKo');
});

test('en chasse fixe, l’espace des milliers est resserré — et seulement là', () => {
  /* v=104. L'espace insécable U+00A0 (milliers, v=103) est aussi large qu'un
     chiffre dans une police à chasse fixe : « 168 000 € » s'y lisait
     « 168  000 € », sur chaque montant de la plateforme. Toute règle qui pose
     --sf-font-num pose donc le resserrement --sf-num-espace. Et lui ne vit
     QU'AVEC elle : dans la police de l'interface, il écrase les espaces
     (« 5fichessur5 », vu au banc en déplaçant une classe). */
  const fs2 = require('node:fs'), path2 = require('node:path');
  const FEUILLES = ['components.css', 'styles.css', 'financier.css', 'tactile.css'];
  const sansCom = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
  const oublis = [], intrus = [];
  let mono = 0;
  for (const f of FEUILLES) {
    const css = sansCom(fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8'));
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim().split('\n').pop().trim(), corps = m[2];
      const estMono = /font-family\s*:\s*var\(--sf-font-num\)/.test(corps);
      const serre = /word-spacing\s*:\s*var\(--sf-num-espace\)/.test(corps);
      if (estMono) mono++;
      if (estMono && !serre) oublis.push(`${f} ${sel}`);
      if (serre && !estMono) intrus.push(`${f} ${sel}`);
    }
  }
  assert.ok(mono >= 30, `témoin : ${mono} règles en chasse fixe relevées`);
  assert.deepEqual(oublis, [], 'Montant en chasse fixe sans resserrement (« 168  000 ») : ajouter word-spacing:var(--sf-num-espace)');
  assert.deepEqual(intrus, [], 'Resserrement hors chasse fixe : les espaces y disparaissent');
  const jeton = fs2.readFileSync(path2.join(__dirname, '..', 'tokens.css'), 'utf8').match(/--sf-num-espace\s*:\s*(-?[\d.]+)em/);
  assert.ok(jeton && Number(jeton[1]) < 0 && Number(jeton[1]) >= -0.35,
    'le resserrement ramène l’espace de chasse fixe (0,6 em) vers une demi-chasse, sans l’annuler');
});
