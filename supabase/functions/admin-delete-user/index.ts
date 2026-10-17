// admin-delete-user (v=102) — Supprime DÉFINITIVEMENT un compte, sur demande
// d'un administrateur. Arbitrage de Thomas du 17/10/2026 : l'inscription libre
// reste ouverte, il faut donc pouvoir écarter vite et pour de bon un compte
// suspect.
//
// Sécurité :
//  1. L'appelant est authentifié (verify_jwt + getUser sur son jeton) ET
//     administrateur des DEUX côtés : rôle du profil et rôle du jeton
//     (app_metadata, que l'utilisateur ne peut pas modifier lui-même).
//  2. Jamais un administrateur, jamais soi-même.
//  3. Saisie de contrôle : l'adresse du compte visé, retapée à l'écran, est
//     revérifiée ici. Un appel forgé sans elle ne supprime rien.
//  4. service_role uniquement côté serveur, jamais exposé au site.
//
// Ce qui part, dans cet ordre :
//  a. le compte est BLOQUÉ (plus de nouvelle session pendant l'effacement) ;
//  b. ses FICHIERS, dans chaque espace de stockage privé (tout ce qui est
//     rangé sous son dossier) — le stockage ne suit pas les clés étrangères ;
//  c. le compte d'authentification : ses biens, loyers, locataires, comptes
//     rendus, simulations, SCI, préférences et son profil partent en cascade
//     (toutes les tables portent user_id → auth.users ON DELETE CASCADE).
// Si (c) échoue, le compte reste bloqué et sans fichiers : on peut relancer.
//
// Entrée : { profileId, confirmation }   Retour : { success, fichiers } ou { error }
// Journal : identifiants seulement, jamais d'adresse.
// @ts-nocheck

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Les espaces de stockage privés : chacun range les fichiers d'un compte sous
// son identifiant (storage_owns_path : premier dossier = auth.uid()).
const ESPACES = ['biens-photos', 'biens-documents', 'locataires-documents', 'sci-documents',
  'simulations-pdf', 'visites-photos', 'bilans-pdf']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function reponse(corps, statut = 200) {
  return new Response(JSON.stringify(corps), {
    status: statut, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// Tous les fichiers sous un dossier, sous-dossiers compris.
async function lister(admin, espace, dossier) {
  const chemins = []
  for (let decalage = 0; ; decalage += 1000) {
    const { data, error } = await admin.storage.from(espace).list(dossier, { limit: 1000, offset: decalage })
    if (error) throw new Error(`stockage ${espace} : ${error.message}`)
    if (!data || !data.length) break
    for (const e of data) {
      const chemin = `${dossier}/${e.name}`
      // Un dossier n'a ni identifiant ni métadonnées.
      if (e.id === null || e.metadata == null) chemins.push(...await lister(admin, espace, chemin))
      else chemins.push(chemin)
    }
    if (data.length < 1000) break
  }
  return chemins
}

async function viderDossier(admin, espace, uid) {
  const chemins = await lister(admin, espace, uid)
  for (let i = 0; i < chemins.length; i += 100) {
    const { error } = await admin.storage.from(espace).remove(chemins.slice(i, i + 100))
    if (error) throw new Error(`stockage ${espace} : ${error.message}`)
  }
  return chemins.length
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return reponse({ error: 'Méthode non autorisée' }, 405)

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. L'appelant
    const jeton = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jeton) return reponse({ error: 'Non authentifié' }, 401)
    const { data: { user: appelant }, error: errAuth } = await admin.auth.getUser(jeton)
    if (errAuth || !appelant) return reponse({ error: 'Session invalide' }, 401)
    const { data: profilAppelant } = await admin.from('profiles')
      .select('role, status').eq('user_id', appelant.id).maybeSingle()
    const estAdmin = profilAppelant?.role === 'admin' && profilAppelant?.status === 'active'
      && appelant.app_metadata?.role === 'admin'
    if (!estAdmin) return reponse({ error: 'Accès refusé : rôle administrateur requis' }, 403)

    // 2. La cible
    const { profileId, confirmation } = await req.json().catch(() => ({}))
    if (!profileId || !UUID.test(String(profileId))) return reponse({ error: 'Compte non précisé' }, 400)
    const { data: cible, error: errCible } = await admin.from('profiles')
      .select('id, user_id, email, role').eq('id', profileId).maybeSingle()
    if (errCible) throw errCible
    if (!cible) return reponse({ error: 'Compte introuvable' }, 404)
    if (cible.role === 'admin') return reponse({ error: 'Un compte administrateur ne se supprime pas ici.' }, 403)
    if (cible.user_id && cible.user_id === appelant.id) return reponse({ error: 'Vous ne pouvez pas supprimer votre propre compte ici.' }, 403)
    const norme = (t) => String(t ?? '').trim().toLowerCase()
    if (!cible.email || norme(confirmation) !== norme(cible.email)) {
      return reponse({ error: 'La confirmation ne correspond pas à l’adresse du compte.' }, 400)
    }

    let fichiers = 0
    if (cible.user_id) {
      const uid = cible.user_id
      // a. Bloqué d'abord : aucune nouvelle session pendant l'effacement.
      const { error: errBan } = await admin.auth.admin.updateUserById(uid, { ban_duration: '876000h' })
      if (errBan && !/not found/i.test(errBan.message)) throw new Error('Blocage impossible : ' + errBan.message)
      // b. Les fichiers.
      for (const espace of ESPACES) fichiers += await viderDossier(admin, espace, uid)
      // c. Le compte — tout le reste suit en cascade.
      const { error: errSuppr } = await admin.auth.admin.deleteUser(uid)
      if (errSuppr && !/not found/i.test(errSuppr.message)) throw new Error('Suppression du compte impossible : ' + errSuppr.message)
    }
    // Un profil sans compte (ou resté) : on le retire aussi.
    const { error: errProfil } = await admin.from('profiles').delete().eq('id', cible.id)
    if (errProfil) throw errProfil

    console.log(`compte ${cible.id} supprime par ${appelant.id} : ${fichiers} fichier(s)`)
    return reponse({ success: true, fichiers })
  } catch (err) {
    console.log('admin-delete-user : ' + (err?.message || String(err)))
    return reponse({ error: err?.message || 'Erreur interne' }, 400)
  }
})
