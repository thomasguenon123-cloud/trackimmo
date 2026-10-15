// taux-credit (v=99) : le taux moyen des nouveaux credits immobiliers en France,
// statistique officielle de la Banque de France (collecte MIR de l'Eurosysteme),
// lue sur le portail de donnees de la BCE. Aucune cle : donnees publiques.
// Reserve aux comptes connectes (verify_jwt). Le resultat est verifie (bornes,
// periode) puis garde en memoire quelques heures : la serie est mensuelle.
// @ts-nocheck

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Candidats, dans l'ordre : prets a l'habitat aux menages, nouveaux contrats,
// taux annuel convenu, France. Le premier qui repond une valeur plausible gagne.
const SERIES = [
  'M.FR.B.A2C.A.R.A.2250.EUR.N',
  'M.FR.B.A2C.AM.R.A.2250.EUR.N',
];
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

async function lireSerie(cle) {
  const url = `https://data-api.ecb.europa.eu/service/data/MIR/${cle}?lastNObservations=1&detail=dataonly&format=csvdata`;
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), 8000);
  try {
    const rep = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'text/csv', 'User-Agent': 'Stonefolio/1.0 (Edge Function)' } });
    if (!rep.ok) { console.log(`serie ${cle} : HTTP ${rep.status}`); return null; }
    const lignes = lignesCsv(await rep.text());
    if (lignes.length < 2) { console.log(`serie ${cle} : vide`); return null; }
    const entete = lignes[0];
    const iPeriode = entete.indexOf('TIME_PERIOD'), iValeur = entete.indexOf('OBS_VALUE');
    if (iPeriode < 0 || iValeur < 0) { console.log(`serie ${cle} : colonnes absentes`); return null; }
    const derniere = lignes[lignes.length - 1];
    const periode = String(derniere[iPeriode] || '').trim();
    const taux = Number(String(derniere[iValeur] || '').trim());
    // Une valeur hors bornes ou une periode illisible n'est pas un taux.
    if (!/^\d{4}-\d{2}$/.test(periode) || !Number.isFinite(taux) || taux < 0.1 || taux > 15) {
      console.log(`serie ${cle} : valeur rejetee (${periode} ${taux})`);
      return null;
    }
    return { taux: Math.round(taux * 100) / 100, periode, serie: 'MIR.' + cle };
  } catch (e) {
    console.log(`serie ${cle} : ${e && e.name === 'AbortError' ? 'delai depasse' : 'erreur reseau'}`);
    return null;
  } finally {
    clearTimeout(minuteur);
  }
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
  for (const cle of SERIES) {
    const lu = await lireSerie(cle);
    if (lu) {
      const donnees = {
        ...lu,
        libelle: 'Taux moyen des nouveaux credits immobiliers en France',
        source: 'Banque de France, statistiques publiees par la BCE',
      };
      cache = { donnees, a: Date.now() };
      console.log(`taux ${lu.taux} pour ${lu.periode} (${lu.serie})`);
      return reponse({ ...donnees, cache: false }, 200, { 'Cache-Control': 'private, max-age=21600' });
    }
  }
  // Plutot un ancien taux verifie que rien du tout ; sinon, on le dit.
  if (cache) return reponse({ ...cache.donnees, cache: true, perime: true }, 200);
  return reponse({ error: 'Source indisponible' }, 502);
});
