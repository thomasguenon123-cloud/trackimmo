/* LA DÉTENTION D'UN BIEN — une saisie, deux colonnes, un invariant en base.

   `biens_mode_detention_coherent` exige que 'sci' porte une SCI et que 'propre'
   n'en porte pas. Si l'écran compose cette paire de travers, Postgres refuse
   L'ENREGISTREMENT ENTIER — et les modifications sans rapport de la même fiche
   sont perdues avec lui. Ces tests vérifient que la paire ne peut pas naître
   fausse.

   Gardes validées par mutation le 05/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-05T12:00:00') });

/* ⚠️ UN OBJET NÉ DANS LE CONTEXTE `vm` N'EST PAS UN OBJET D'ICI : son
   prototype vient de l'autre royaume, et `deepEqual` — qui est strict —
   échoue sur cette seule différence, en annonçant deux objets identiques.
   Même piège que celui déjà noté pour les tableaux dans `charger-app.js`.
   On recopie donc la paire avant de la comparer. */
const paire = v => ({ ...app.sfDetentionDepuisChamp(v) });
const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ── La fabrique de la paire ────────────────────────────────────────────────

test('« en propre » n’emporte aucune SCI', () => {
  assert.deepEqual(paire('propre'), { mode_detention: 'propre', sci_id: null });
});

test('choisir une SCI pose le mode ET la référence, ensemble', () => {
  const id = '7bd53e38-47c6-49fe-8c89-78ceb0197b03';
  assert.deepEqual(paire(id), { mode_detention: 'sci', sci_id: id });
});

test('« non renseigné » laisse les deux colonnes vides', () => {
  for (const vide of ['', null, undefined]) {
    assert.deepEqual(paire(vide), { mode_detention: null, sci_id: null },
      `valeur ${JSON.stringify(vide)}`);
  }
});

test('RÉGRESSION — aucune saisie ne produit de paire que la base refuse', () => {
  /* L'invariant tel qu'il est écrit en base, rejoué ici sur toutes les formes
     de saisie possibles. C'est la seule garantie qui compte : le reste des
     tests décrit des cas, celui-ci couvre l'espace. */
  const coherent = ({ mode_detention: m, sci_id: s }) =>
    m === null ? s === null
    : m === 'sci' ? s !== null
    : m === 'propre' ? s === null
    : false;

  const saisies = ['', null, undefined, 'propre', 'abc-123',
                   '7bd53e38-47c6-49fe-8c89-78ceb0197b03', '0', 'false'];
  for (const v of saisies) {
    const p = paire(v);
    assert.ok(coherent(p),
      `saisie ${JSON.stringify(v)} → ${JSON.stringify(p)} viole biens_mode_detention_coherent`);
  }
});

// ── Le garde-fou qui remplace celui qu'on a retiré ─────────────────────────

test('la fiche peut poser « Acheté », la saisie en masse non', () => {
  /* Le retrait d'origine visait le changement EN MASSE, qui contournait la
     mise en gestion. Cette raison tient toujours : seule la fiche, qui porte
     le champ « Détention » à côté, a le droit de proposer le statut. */
  /* ⚠️ `TI_BIENS` est déclaré en `const` : il n'apparaît pas dans le contexte
     `vm`, qui n'expose que les déclarations `function`. On lit donc les deux
     accesseurs dans la source — ce qu'ils filtrent est visible tel quel. */
  assert.match(APP_JS, /get STATUTS_FICHE\(\) \{ return this\.STATUTS; \}/,
    'la fiche ne propose plus tous les statuts : le bailleur repasse par la prospection');
  assert.match(APP_JS, /get STATUTS_SAISISSABLES\(\) \{ return this\.STATUTS\.filter\(v => v !== 'Acheté'\); \}/,
    '« Acheté » est revenu dans la saisie en masse — elle n’a nulle part où demander le mode');
  assert.match(APP_JS, /<select id="f-statut">\$\{TI_BIENS\.options\('STATUTS_FICHE'/,
    'le select de la fiche ne consomme plus STATUTS_FICHE');
});

test('RÉGRESSION — le refus vise la TRANSITION, pas chaque enregistrement', () => {
  /* `saveBien` touche au DOM et à la base : on vérifie la forme du contrôle
     dans la source, pas son exécution.
     ⚠️ LE TROISIÈME TERME EST LE PLUS IMPORTANT. Sans lui, le contrôle
     s'applique à CHAQUE enregistrement, et les biens déjà acquis dont le mode
     est nul — ceux que le tableau de bord signale pour qu'on les corrige —
     deviennent inmodifiables : plus de correction de titre, plus de photo, et
     pour seule issue un mode déclaré faux. La revue l'a trouvé ; ce test
     l'empêche de revenir. */
  const garde = /if\(data\.statut === 'Acheté' && !data\.mode_detention && !sfDetenu\([^)]*\)\)\{/
    .test(APP_JS);
  assert.ok(garde,
    'le contrôle « Acheté sans mode » a disparu, ou ne distingue plus la transition de la simple modification');
});

test('RÉGRESSION — des frais de SCI ne survivent pas à un passage « en propre »', () => {
  /* `biens.creation_sci` vaut 200 € par défaut EN BASE. Écrire la détention
     sans remettre ce montant à zéro rhabille un bien détenu en propre de frais
     de constitution de société — qui entrent dans l'emprunt, donc dans le
     rendement et le cashflow. C'est le défaut que `sfFraisCreationSci` avait
     été écrite pour supprimer, revenu par la fiche. */
  assert.match(APP_JS, /mode_detention === 'sci'\s*\n?\s*\?[\s\S]{0,200}?:\s*0,/,
    'creation_sci ne suit plus la détention : un bien en propre peut reporter 200 € de frais de SCI');
});

test('RÉGRESSION — un prospect ne détient pas encore une SCI', () => {
  /* La règle dit « le bien qui a MOTIVÉ la création ». Sans `sfDetenu`, poser
     une SCI sur une fiche de prospection suffit à la faire compter comme
     détentrice, et la première acquisition réelle enregistre 0 € au lieu de
     200. Le champ « Détention » rend ce geste naturel. */
  assert.match(APP_JS,
    /dejaDetenus = allBiens\.filter\(b =>\s*\n?\s*b\.id !== bienId[^;]*sfDetenu\(b\)\)/,
    'sfFraisCreationSci compte de nouveau les prospects comme détenteurs d’une SCI');
});

test('la barre d’actions groupées et l’édition en ligne restent fermées', () => {
  const groupees = /sfb-bulk-statut[\s\S]{0,200}?options\('(\w+)'/.exec(APP_JS);
  assert.equal(groupees?.[1], 'STATUTS_SAISISSABLES',
    'la saisie en masse ne doit pas ouvrir « Acheté »');
});
