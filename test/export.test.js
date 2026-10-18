/* L'EXPORT COMPLET DES DONNÉES (v=103, Paramètres › Données).

   Ce qu'il doit tenir :
   · tout ce que le compte a saisi — et rien d'un autre compte : chaque lecture
     est filtrée sur `user_id` EN PLUS des règles de la base, car un
     administrateur lit les profils des autres ;
   · du profil, ni l'adresse e-mail, ni le rôle, ni l'invitant, ni les notes ;
   · une erreur de lecture ne remet AUCUN fichier (jamais un export partiel
     présenté comme complet) ;
   · deux appuis rapprochés ne lancent qu'un export ;
   · une table que l'application écrit et que l'export oublierait le fait
     tomber (la prochaine table ajoutée ne sortira pas en silence). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const MASQUE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

function banc({ erreurSur = null } = {}) {
  const ctx = charger({ maintenant: new Date(2026, 9, 17, 12) });
  injecter(ctx, { currentUser: { id: 'u1', email: 'proprietaire@exemple.fr' } });
  const journal = [];
  lire(ctx, 'db').from = (table) => {
    const ops = []; journal.push({ table, ops });
    const q = new Proxy({}, { get(_, p) {
      if (p === 'then') {
        const r = table === erreurSur ? { data: null, error: { message: `lecture de ${table} refusée` } }
          : table === 'profiles' ? { data: { first_name: 'Alex', last_name: 'Martin', phone: null, created_at: '2026-01-01' }, error: null }
          : { data: [{ id: table + '-1', user_id: 'u1' }], error: null };
        return res => Promise.resolve(r).then(res);
      }
      return (...args) => { ops.push([p, ...args]); return q; };
    } });
    return q;
  };
  const fichiers = [];
  ctx.Blob = class { constructor(parts, o) { this.texte = parts.join(''); this.type = o && o.type; } };
  ctx.sfTelechargerFichier = (nom, blob) => fichiers.push({ nom, blob });
  const notifs = [];
  ctx.showNotif = (m, err) => notifs.push([m, !!err]);
  return { ctx, journal, fichiers, notifs };
}

test('l’export lit chaque table du compte, filtrée sur le compte connecté', async () => {
  const { ctx, journal, fichiers } = banc();
  await ctx.sfExporterDonnees();
  const tables = Array.from(lire(ctx, 'SF_EXPORT_TABLES'));
  assert.ok(tables.length >= 15, `témoin : ${tables.length} tables exportées`);
  for (const t of tables) {
    const lecture = journal.find(j => j.table === t);
    assert.ok(lecture, `${t} n’est pas lue`);
    assert.ok(lecture.ops.some(([op, col, val]) => op === 'eq' && col === 'user_id' && val === 'u1'),
      `${t} : lecture non filtrée sur le compte — un administrateur exporterait les données des autres`);
  }
  const profil = journal.find(j => j.table === 'profiles');
  assert.ok(profil.ops.some(([op, col, val]) => op === 'eq' && col === 'user_id' && val === 'u1'), 'le profil n’est pas filtré sur le compte');
  const colonnes = profil.ops.find(([op]) => op === 'select')[1];
  assert.doesNotMatch(colonnes, /email|role|invited_by|notes|\*/, 'le profil exporté emporte l’adresse e-mail ou des données d’administration');
  assert.equal(journal.some(j => j.table === 'bank_presets'), false, 'le catalogue partagé des banques n’est pas une donnée du compte');

  assert.equal(fichiers.length, 1, 'un fichier, et un seul');
  assert.match(fichiers[0].nom, /^stonefolio-donnees-2026-10-17\.json$/);
  assert.equal(fichiers[0].blob.type, 'application/json');
  const contenu = JSON.parse(fichiers[0].blob.texte);
  assert.equal(contenu.format, 'stonefolio-export-1');
  assert.deepEqual(Object.keys(contenu.tables).sort(), [...tables].sort());
  assert.equal(contenu.comptes.biens, 1);
  assert.deepEqual(contenu.tables.loyers_mensuels, [{ id: 'loyers_mensuels-1', user_id: 'u1' }]);
  assert.doesNotMatch(fichiers[0].blob.texte, /proprietaire@exemple\.fr/, 'l’adresse e-mail du compte se retrouve dans le fichier');
});

test('une lecture refusée ne remet aucun fichier, et le dit', async () => {
  const { ctx, fichiers, notifs } = banc({ erreurSur: 'charges_reelles' });
  await ctx.sfExporterDonnees();
  assert.equal(fichiers.length, 0, 'un export partiel a été remis comme s’il était complet');
  assert.ok(notifs.some(([m, err]) => err && /n’a pas abouti/.test(m) && /Rien n’a été téléchargé/.test(m)), 'l’échec doit se dire');
});

test('deux appuis rapprochés ne lancent qu’un export', async () => {
  const { ctx, fichiers } = banc();
  await Promise.all([ctx.sfExporterDonnees(), ctx.sfExporterDonnees()]);
  assert.equal(fichiers.length, 1, 'la garde contre le double envoi doit se poser AVANT le premier await');
  await ctx.sfExporterDonnees();
  assert.equal(fichiers.length, 2, 'une fois le premier fini, un nouvel export reste possible');
});

test('toute table que l’application écrit figure dans l’export', () => {
  /* Les tables écrites par le code (insert, update, upsert). Une nouvelle
     table oubliée ici sortirait du droit à la portabilité sans un bruit. */
  const ecrites = new Set();
  for (const m of MASQUE.matchAll(/\.from\('([a-z_]+)'\)\s*\.(?:insert|update|upsert)\(/g)) ecrites.add(m[1]);
  assert.ok(ecrites.size >= 8, `témoin : ${[...ecrites].join(', ')}`);
  const exportees = new Set(Array.from(lire(charger(), 'SF_EXPORT_TABLES')));
  const HORS_EXPORT = { profiles: 'exporté à part, colonnes choisies', bank_presets: 'catalogue partagé' };
  const oubliees = [...ecrites].filter(t => !exportees.has(t) && !(t in HORS_EXPORT));
  assert.deepEqual(oubliees, [], `tables écrites mais absentes de l’export : ${oubliees.join(', ')}`);
});

test('la section Données propose l’export, derrière un vrai bouton', () => {
  const ctx = charger();
  const h = ctx.paramsDonneesHtml();
  assert.match(h, /<button class="sf-btn sf-btn--secondary" id="sf-export-btn" type="button" onclick="sfExporterDonnees\(\)">/);
  assert.match(h, /aria-live="polite"/, 'le retour (nom du fichier) se dit au lecteur d’écran');
  assert.match(h, /Zone de danger/, 'témoin : les suppressions restent, après l’export');
  assert.ok(h.indexOf('sf-export-btn') < h.indexOf('Zone de danger'), 'exporter vient avant effacer');
});
