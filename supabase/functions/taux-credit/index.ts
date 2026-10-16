// taux-credit (v=99, etendue en v=100) : les taux officiels utiles a un
// emprunteur, lus sur le portail de donnees de la BCE. Aucune cle : donnees
// publiques. Reserve aux comptes connectes (verify_jwt).
//
//   - le taux moyen des nouveaux credits immobiliers en France (collecte MIR
//     de la Banque de France), et son historique sur 24 mois ;
//   - l'OAT 10 ans (taux de l'Etat francais a dix ans, statistique IRS), sur
//     laquelle les banques fixent leurs taux fixes ;
//   - le taux de la facilite de depot de la BCE, et la date de sa derniere
//     modification.
//
// Chaque partie est verifiee (bornes, periodes) et FACULTATIVE : une serie
// muette n'empeche pas les autres. Le tout est garde en memoire quelques
// heures : les series sont mensuelles, le taux BCE change quelques fois par an.
// @ts-nocheck

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Candidats, dans l'ordre : prets a l'habitat aux menages, nouveaux contrats,
// taux annuel convenu, France. Le premier qui repond une valeur plausible gagne.
const SERIES_MIR = [
  'M.FR.B.A2C.A.R.A.2250.EUR.N',
  'M.FR.B.A2C.AM.R.A.2250.EUR.N',
];
// Taux a long terme de la France (OAT 10 ans), moyenne mensuelle.
const SERIES_OAT = ['M.FR.L.L40.CI.0000.EUR.N.Z'];
// Taux de la facilite de depot de la BCE, jours ouvres.
const SERIES_BCE = ['B.U2.EUR.4F.KR.DFR.LEV'];

const DUREE_CACHE_MS = 6 * 60 * 60 * 1000;
let cache = null; // { donnees, a }

// Lecture CSV qui respecte les guillemets (un libelle peut contenir une virgule).
function lignesCsv(texte) {
  const lignes = [];
  let champ = '', ligne = [], guillemets = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guillemets) {
      if (c === '"' && texte[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
    } else if (c === '"') guillemets = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some(x => x !== '')) lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); if (ligne.some(x => x !== '')) lignes.push(ligne); }
  return lignes;
}

// Les n dernieres observations d'une serie : [{ periode, valeur }], dans l'ordre
// chronologique. `periodeOk` et `bornes` rejettent tout ce qui n'est pas un taux.
async function lireSerie(dataset, cle, n, periodeOk, min, max) {
  const url = `https://data-api.ecb.europa.eu/service/data/${dataset}/${cle}?lastNObservations=${n}&detail=dataonly&format=csvdata`;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 8000);
  try {
    const rep = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'text/csv', 'User-Agent': 'Stonefolio/1.0 (Edge Function)' } });
    if (!rep.ok) { console.log(`serie ${dataset}.${cle} : HTTP ${rep.status}`); return null; }
    const lignes = lignesCsv(await rep.text());
    if (lignes.length < 2) { console.log(`serie ${dataset}.${cle} : vide`); return null; }
    const entete = lignes[0];
    const iPeriode = entete.indexOf('TIME_PERIOD'), iValeur = entete.indexOf('OBS_VALUE');
    if (iPeriode < 0 || iValeur < 0) { console.log(`serie ${dataset}.${cle} : colonnes absentes`); return null; }
    const points = [];
    for (const l of lignes.slice(1)) {
      const periode = String(l[iPeriode] || '').trim();
      const brut = String(l[iValeur] || '').trim();
      const valeur = Number(brut);
      // Une valeur hors bornes ou une periode illisible n'est pas un taux.
      if (!periodeOk.test(periode) || brut === '' || !Number.isFinite(valeur) || valeur < min || valeur > max) continue;
      points.push({ periode, valeur: Math.round(valeur * 100) / 100 });
    }
    points.sort((a, b) => a.periode < b.periode ? -1 : a.periode > b.periode ? 1 : 0);
    if (!points.length) { console.log(`serie ${dataset}.${cle} : aucune valeur retenue`); return null; }
    return points;
  } catch (e) {
    console.log(`serie ${dataset}.${cle} : ${e && e.name === 'AbortError' ? 'delai depasse' : 'erreur reseau'}`);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
}

const MOIS = /^\d{4}-(0[1-9]|1[0-2])$/;
const JOUR = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function premiere(dataset, cles, n, periodeOk, min, max) {
  for (const cle of cles) {
    const p = await lireSerie(dataset, cle, n, periodeOk, min, max);
    if (p) return { points: p, serie: `${dataset}.${cle}` };
  }
  return null;
}

async function lireTout() {
  const [mir, oat, bce] = await Promise.all([
    premiere('MIR', SERIES_MIR, 24, MOIS, 0.1, 15),
    premiere('IRS', SERIES_OAT, 24, MOIS, -2, 15),
    // ~2 ans de jours ouvres : de quoi trouver la derniere modification.
    premiere('FM', SERIES_BCE, 520, JOUR, -2, 10),
  ]);
  if (!mir) return null;
  const dernier = mir.points[mir.points.length - 1];
  const donnees = {
    taux: dernier.valeur,
    periode: dernier.periode,
    serie: mir.serie,
    libelle: 'Taux moyen des nouveaux credits immobiliers en France',
    source: 'Banque de France, statistiques publiees par la BCE',
    historique: mir.points.map(p => ({ periode: p.periode, taux: p.valeur })),
    oat10: null,
    bce: null,
  };
  if (oat) {
    const d = oat.points[oat.points.length - 1];
    donnees.oat10 = { valeur: d.valeur, periode: d.periode, historique: oat.points.map(p => ({ periode: p.periode, taux: p.valeur })) };
  }
  if (bce) {
    const pts = bce.points;
    const actuel = pts[pts.length - 1].valeur;
    // La derniere modification : le premier jour de la serie au taux actuel,
    // en remontant tant que le taux ne change pas.
    let i = pts.length - 1;
    while (i > 0 && pts[i - 1].valeur === actuel) i--;
    donnees.bce = { taux: actuel, depuis: i > 0 ? pts[i].periode : null };
  }
  console.log(`taux ${donnees.taux} pour ${donnees.periode} (${mir.serie}) · ${donnees.historique.length} mois`
    + ` · OAT ${donnees.oat10 ? donnees.oat10.valeur + ' (' + donnees.oat10.periode + ')' : 'absente'}`
    + ` · BCE ${donnees.bce ? donnees.bce.taux + ' depuis ' + donnees.bce.depuis : 'absente'}`);
  return donnees;
}

function reponse(corps, statut = 200, extra = {}) {
  return new Response(JSON.stringify(corps), {
    status: statut,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extra },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'GET' && req.method !== 'POST') return reponse({ error: 'Methode non autorisee' }, 405);

  if (cache && Date.now() - cache.a < DUREE_CACHE_MS) {
    return reponse({ ...cache.donnees, cache: true }, 200, { 'Cache-Control': 'private, max-age=21600' });
  }
  const donnees = await lireTout();
  if (donnees) {
    cache = { donnees, a: Date.now() };
    return reponse({ ...donnees, cache: false }, 200, { 'Cache-Control': 'private, max-age=21600' });
  }
  // Plutot un ancien taux verifie que rien du tout ; sinon, on le dit.
  if (cache) return reponse({ ...cache.donnees, cache: true, perime: true }, 200);
  return reponse({ error: 'Source indisponible' }, 502);
});
