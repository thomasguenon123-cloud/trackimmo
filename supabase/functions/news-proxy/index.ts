// FND-001 : news-proxy — cache la cle NewsAPI cote serveur
// @ts-nocheck
//
// v=101 (audit du 16/10/2026) : ce source est recopie de la version 7
// deployee, a l'identique hormis ce bloc de commentaire. Il ne vivait que
// dans la console Supabase, contrairement a admin-invite-user et taux-credit.
// Toute modification se fait ici, puis se deploie. La cle NEWSAPI_KEY reste
// dans les secrets du projet, jamais ici.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};


// v=102 : réservé aux comptes ACTIFS. verify_jwt prouve seulement que
// l'appelant est connecté — une inscription pas encore validée, ou un compte
// bloqué dont le jeton court encore (jusqu'à une heure), l'est aussi. Le
// statut se lit en base à chaque appel. La signature du jeton est déjà
// vérifiée par la passerelle (verify_jwt) : on n'en lit que l'identifiant.
async function compteActif(req) {
  const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL'), cle = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!jeton || !url || !cle) return false;
  try {
    const charge = jeton.split('.')[1] || '';
    const sub = JSON.parse(atob(charge.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(charge.length / 4) * 4, '=')))?.sub;
    if (!/^[0-9a-f-]{36}$/i.test(String(sub || ''))) return false;
    const r = await fetch(`${url}/rest/v1/profiles?select=status&user_id=eq.${sub}`, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
    });
    if (!r.ok) return false;
    const lignes = await r.json();
    return Array.isArray(lignes) && lignes.length === 1 && lignes[0]?.status === 'active';
  } catch {
    return false;
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Le quota NewsAPI (100 requêtes par jour) ne se partage qu'entre comptes validés.
  if (!(await compteActif(req))) {
    return new Response(JSON.stringify({ error: 'Compte non actif' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const NEWSAPI_KEY = Deno.env.get('NEWSAPI_KEY');
    if (!NEWSAPI_KEY) {
      console.error('NEWSAPI_KEY non configuree');
      return new Response(
        JSON.stringify({ error: 'Configuration serveur manquante' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'JSON invalide' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const q = String(body?.q || '').trim();
    if (!q || q.length < 2 || q.length > 200) {
      return new Response(
        JSON.stringify({ error: 'Parametre q invalide (2-200 chars requis)' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    // CHANGEMENT 01/08/2026 : les parentheses sont desormais autorisees, pour
    // permettre les requetes booleennes groupees du type
    //   Poitiers AND (economie OR emploi OR entreprise)
    // Sans injection possible : q passe par encodeURIComponent avant l'appel
    // reseau, les parentheses deviennent %28/%29.
    if (!/^[\p{L}\p{N}\s'\-()]+$/u.test(q)) {
      return new Response(
        JSON.stringify({ error: 'Caracteres non autorises dans q' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let pageSize = parseInt(body?.pageSize ?? '8', 10);
    if (isNaN(pageSize) || pageSize < 1) pageSize = 8;
    if (pageSize > 20) pageSize = 20;

    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=fr&sortBy=publishedAt&pageSize=${pageSize}`;

    const newsRes = await fetch(url, {
      headers: {
        'X-Api-Key': NEWSAPI_KEY,
        'User-Agent': 'TrackImmo/1.0 (Edge Function)',
      },
    });

    if (!newsRes.ok) {
      console.error(`NewsAPI error ${newsRes.status}`);
      return new Response(
        JSON.stringify({ error: 'Service NewsAPI indisponible', status: newsRes.status }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await newsRes.json();

    const articles = (data.articles || []).map((a) => ({
      title: a.title,
      description: a.description,
      url: a.url,
      urlToImage: a.urlToImage,
      publishedAt: a.publishedAt,
      source: a.source?.name || null,
    }));

    // AJOUT 01/08/2026 : sans cette trace, un 200 avec zero article est
    // indistinguable d'un 200 avec resultats dans les logs Supabase — on en
    // etait reduit a compter le nombre de POST pour deviner. Aucune donnee
    // sensible : q ne contient qu'une commune et des mots-cles publics.
    console.log(`q="${q}" -> ${data.totalResults || 0} trouves, ${articles.length} renvoyes`);

    return new Response(
      JSON.stringify({ status: 'ok', totalResults: data.totalResults || 0, articles }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (e) {
    console.error('news-proxy error:', e);
    return new Response(JSON.stringify({ error: 'Erreur interne' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
