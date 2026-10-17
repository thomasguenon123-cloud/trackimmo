/* BANC DES FONCTIONS SERVEUR (v=102) — exécuté par fonctions-serveur.test.js.
   Chaque fonction de supabase/functions/ est chargée telle quelle, Supabase et
   fetch simulés : aucun réseau, aucune clé. Validé par mutation le 17/10/2026 (6 sur 6). */
// Essai hors ligne des fonctions serveur de la v=102 : Supabase et fetch simulés.
import fs from 'node:fs';
const R = process.argv[2];
const charger = async (fichier, remplacements) => {
  let src = fs.readFileSync(R + '/supabase/functions/' + fichier, 'utf8');
  for (const [a, b] of remplacements) src = src.replace(a, b);
  let handler;
  globalThis.Deno = { serve: (h) => { handler = h; }, env: { get: (k) => ({ SUPABASE_URL: 'https://projet.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'cle-service', NEWSAPI_KEY: 'cle-news' })[k] } };
  globalThis.__serve = (h) => { handler = h; };
  await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  return handler;
};
const jwt = (sub) => 'xx.' + Buffer.from(JSON.stringify({ sub, role: 'authenticated' })).toString('base64url') + '.sig';
const ACTIF = '11111111-1111-1111-1111-111111111111', ATTENTE = '22222222-2222-2222-2222-222222222222';
const STATUTS = { [ACTIF]: 'active', [ATTENTE]: 'pending' };
let ok = 0, ko = 0;
const verifie = (cond, lib) => { if (cond) ok++; else { ko++; console.log('ÉCHEC :', lib); } };

// ── 1. news-proxy et taux-credit : compte actif seulement ──
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  if (url.includes('/rest/v1/profiles')) {
    const sub = (url.match(/user_id=eq\.([0-9a-f-]+)/) || [])[1];
    if (opt.headers?.apikey !== 'cle-service') return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, json: async () => (STATUTS[sub] ? [{ status: STATUTS[sub] }] : []) };
  }
  if (url.includes('newsapi.org')) return { ok: true, json: async () => ({ totalResults: 1, articles: [{ title: 'Poitiers', description: 'x', url: 'https://a.fr' }] }) };
  if (url.includes('data-api.ecb.europa.eu')) return { ok: true, text: async () => 'KEY,FREQ,TIME_PERIOD,OBS_VALUE\n' + Array.from({ length: 24 }, (_, i) => `X,M,${2024 + Math.floor((8 + i) / 12)}-${String((8 + i) % 12 + 1).padStart(2, '0')},3.5`).join('\n') };
  return { ok: false, status: 404 };
};
const news = await charger('news-proxy/index.ts', [["import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';", 'const serve = globalThis.__serve;']]);
const appelNews = (auth) => news(new Request('http://x/', { method: 'POST', headers: auth ? { Authorization: auth, 'content-type': 'application/json' } : {}, body: JSON.stringify({ q: 'Poitiers' }) }));
verifie((await appelNews('Bearer ' + jwt(ACTIF))).status === 200, 'news : un compte actif obtient les actualités');
verifie((await appelNews('Bearer ' + jwt(ATTENTE))).status === 403, 'news : un compte en attente est refusé');
verifie((await appelNews(null)).status === 403, 'news : sans jeton, refusé');
verifie((await appelNews('Bearer ' + jwt('33333333-3333-3333-3333-333333333333'))).status === 403, 'news : un compte sans profil est refusé');
const taux = await charger('taux-credit/index.ts', []);
const appelTaux = (sub) => taux(new Request('http://x/', { method: 'POST', headers: { Authorization: 'Bearer ' + jwt(sub) } }));
verifie((await appelTaux(ATTENTE)).status === 403, 'taux : un compte en attente est refusé (même avec un cache vide)');
const rt = await appelTaux(ACTIF); const jt = await rt.json();
verifie(rt.status === 200 && jt.taux === 3.5, 'taux : un compte actif obtient le taux');
verifie((await appelTaux(ATTENTE)).status === 403, 'taux : refusé AVANT le cache (le cache est maintenant plein)');

// ── 2. admin-delete-user ──
function faireSupabase(etat) {
  const table = (nom) => {
    let filtres = [], op = 'select';
    const q = {
      select() { return q; }, eq(c, v) { filtres.push([c, v]); return q; },
      delete() { op = 'delete'; return q; },
      single() { return q.maybeSingle(); },
      maybeSingle() { const l = etat[nom].filter(r => filtres.every(([c, v]) => r[c] === v)); return Promise.resolve({ data: l[0] || null, error: null }); },
      then(res) { if (op === 'delete') { const avant = etat[nom].length; etat[nom] = etat[nom].filter(r => !filtres.every(([c, v]) => r[c] === v)); etat.journal.push(`delete ${nom} ${avant - etat[nom].length}`); } return Promise.resolve({ data: null, error: null }).then(res); },
    };
    return q;
  };
  return {
    from: table,
    auth: {
      getUser: async (j) => { const u = etat.users.find(x => x.jeton === j); return { data: { user: u || null }, error: u ? null : { message: 'invalid' } }; },
      admin: {
        updateUserById: async (id, opt) => { etat.journal.push(`ban ${id} ${opt.ban_duration}`); return { error: null }; },
        deleteUser: async (id) => { etat.journal.push(`deleteUser ${id}`); etat.profiles = etat.profiles.filter(p => p.user_id !== id); return { error: null }; },
      },
    },
    storage: { from: (espace) => ({
      list: async (dossier) => {
        const enfants = new Map();
        for (const f of etat.fichiers.filter(f => f.espace === espace && f.chemin.startsWith(dossier + '/'))) {
          const reste = f.chemin.slice(dossier.length + 1); const nom = reste.split('/')[0];
          enfants.set(nom, reste.includes('/') ? { name: nom, id: null, metadata: null } : { name: nom, id: 'f', metadata: {} });
        }
        return { data: [...enfants.values()], error: null };
      },
      remove: async (chemins) => { etat.fichiers = etat.fichiers.filter(f => !(f.espace === espace && chemins.includes(f.chemin))); etat.journal.push(`remove ${espace} ${chemins.length}`); return { error: null }; },
    }) },
  };
}
const ADMIN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', CIBLE = 'cccccccc-cccc-cccc-cccc-cccccccccccc', AUTRE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const etatInitial = () => ({
  journal: [],
  users: [{ id: ADMIN, jeton: 'j-admin', app_metadata: { role: 'admin' } }, { id: AUTRE, jeton: 'j-user', app_metadata: {} }],
  profiles: [
    { id: 'p0000000-0000-0000-0000-000000000000'.replace('p', 'a'), user_id: ADMIN, email: 'admin@exemple.fr', role: 'admin', status: 'active' },
    { id: 'b1111111-1111-1111-1111-111111111111', user_id: CIBLE, email: 'Suspect@Exemple.fr', role: 'user', status: 'pending' },
    { id: 'b2222222-2222-2222-2222-222222222222', user_id: AUTRE, email: 'autre@exemple.fr', role: 'user', status: 'active' },
    { id: 'b3333333-3333-3333-3333-333333333333', user_id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', email: 'admin2@exemple.fr', role: 'admin', status: 'active' },
  ],
  fichiers: [
    { espace: 'biens-photos', chemin: `${CIBLE}/bien1/a.jpg` }, { espace: 'biens-photos', chemin: `${CIBLE}/bien1/b.jpg` },
    { espace: 'sci-documents', chemin: `${CIBLE}/sci1/statuts.pdf` }, { espace: 'biens-photos', chemin: `${AUTRE}/bien9/c.jpg` },
  ],
});
let etat = etatInitial();
globalThis.__supabase = () => faireSupabase(etat);
const suppr = await charger('admin-delete-user/index.ts', [["import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'", 'const createClient = (...a) => globalThis.__supabase(...a);']]);
const appelSuppr = (jeton, corps) => suppr(new Request('http://x/', { method: 'POST', headers: { Authorization: 'Bearer ' + jeton }, body: JSON.stringify(corps) }));
let r = await appelSuppr('j-user', { profileId: 'b1111111-1111-1111-1111-111111111111', confirmation: 'suspect@exemple.fr' });
verifie(r.status === 403 && etat.journal.length === 0, 'suppression : un non-admin est refusé, rien ne bouge');
r = await appelSuppr('j-admin', { profileId: 'b1111111-1111-1111-1111-111111111111', confirmation: 'mauvaise@exemple.fr' });
verifie(r.status === 400 && etat.journal.length === 0, 'suppression : une confirmation fausse ne supprime rien');
r = await appelSuppr('j-admin', { profileId: etat.profiles[0].id, confirmation: 'admin@exemple.fr' });
verifie(r.status === 403, 'suppression : on ne se supprime pas soi-même');
r = await appelSuppr('j-admin', { profileId: 'b3333333-3333-3333-3333-333333333333', confirmation: 'admin2@exemple.fr' });
verifie(r.status === 403 && etat.journal.length === 0, 'suppression : un AUTRE administrateur ne se supprime pas');
r = await appelSuppr('j-admin', { profileId: 'pas-un-uuid', confirmation: 'x' });
verifie(r.status === 400, 'suppression : identifiant illisible refusé');
r = await appelSuppr('j-admin', { profileId: 'b1111111-1111-1111-1111-111111111111', confirmation: '  suspect@exemple.FR ' });
const jr = await r.json();
verifie(r.status === 200 && jr.fichiers === 3, 'suppression : réussie, 3 fichiers effacés (casse et espaces ignorés) ' + JSON.stringify(jr));
verifie(etat.journal[0].startsWith(`ban ${CIBLE}`), 'suppression : le compte est bloqué AVANT tout effacement');
const iFichiers = etat.journal.findIndex(l => l.startsWith('remove')), iCompte = etat.journal.indexOf(`deleteUser ${CIBLE}`);
verifie(iFichiers > 0 && iCompte > iFichiers, 'suppression : fichiers avant le compte');
verifie(etat.fichiers.length === 1 && etat.fichiers[0].chemin.startsWith(AUTRE), 'suppression : les fichiers d\'un AUTRE compte restent');
verifie(!etat.profiles.some(p => p.user_id === CIBLE) && etat.profiles.length === 3, 'suppression : le profil est parti, les autres restent');

// ── 3. admin-invite-user : un compte bloqué ne se réactive pas par une invitation ──
etat = etatInitial(); etat.profiles[2].status = 'disabled';
const fauxInvite = () => ({ ...faireSupabase(etat), auth: { getUser: async () => ({ data: { user: { id: ADMIN, app_metadata: { role: 'admin' } } }, error: null }),
  admin: { listUsers: async () => ({ data: { users: [{ id: AUTRE, email: 'autre@exemple.fr' }] } }), inviteUserByEmail: async () => { throw new Error('ne doit pas inviter'); } },
  resetPasswordForEmail: async () => { etat.journal.push('reset'); return { error: null }; } } });
globalThis.__supabase = fauxInvite;
const invite = await charger('admin-invite-user/index.ts', [["import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'", 'const createClient = (...a) => globalThis.__supabase(...a);'], ['(req: Request)', '(req)'], ['let userId: string', 'let userId']]);
r = await invite(new Request('http://x/', { method: 'POST', headers: { Authorization: 'Bearer j-admin' }, body: JSON.stringify({ email: 'autre@exemple.fr', firstName: 'A', lastName: 'B' }) }));
const ji = await r.json();
verifie(r.status === 400 && /bloqué/.test(ji.error) && !etat.journal.includes('reset'), 'invitation : un compte bloqué n\'est ni réactivé ni relancé ' + JSON.stringify(ji));
console.log(`${ok} vérifications passées, ${ko} en échec`);
process.exit(ko ? 1 : 0);
