// admin-invite-user — Envoie un mail d'invitation Supabase à un nouvel utilisateur.
// Aucun mot de passe stocké en clair. Le user clique sur le lien dans le mail
// puis définit lui-même son mot de passe.
//
// Sécurité :
//  1. Vérifie que l'appelant est authentifié (JWT)
//  2. Vérifie que l'appelant a le rôle admin (en DB ou par email superadmin)
//  3. Utilise service_role uniquement côté serveur, jamais exposé au client
//
// Param entrée : { email, firstName, lastName, role: 'admin'|'user', notes? }
// Retour : { success: true, profileId, userId? } ou { error }
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ 27/09/2026 — UNE INVITATION VAUT VALIDATION. Voir le bloc « 5. » plus bas.
// ⚠️ CE FICHIER EST LA SOURCE DE VÉRITÉ depuis le 27/09/2026. Les trois Edge
//    Functions du projet vivaient uniquement dans la console Supabase : rien
//    dans le dépôt, aucun historique, aucune revue possible. Toute
//    modification se fait ici, puis se déploie.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPERADMIN_EMAIL = 'thomasguenon123@gmail.com'
const REDIRECT_URL = 'https://thomasguenon123-cloud.github.io/trackimmo/'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    )

    // 1. Vérifier authentification de l'appelant
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('Non authentifié')
    const token = authHeader.replace('Bearer ', '')
    const { data: { user: caller }, error: authErr } = await supabaseAdmin.auth.getUser(token)
    if (authErr || !caller) throw new Error('Token invalide')

    // 2. Vérifier rôle admin
    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('user_id', caller.id)
      .single()
    const isAdmin = callerProfile?.role === 'admin'
      || caller.app_metadata?.role === 'admin'
      || caller.email === SUPERADMIN_EMAIL
    if (!isAdmin) throw new Error('Accès refusé : rôle admin requis')

    // 3. Validation des paramètres
    const { email, firstName, lastName, role, notes } = await req.json()
    if (!email || !firstName || !lastName) {
      throw new Error('Paramètres manquants : email, firstName, lastName requis')
    }
    const targetRole = (role === 'admin' ? 'admin' : 'user')
    const cleanEmail = String(email).trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new Error('Email invalide')
    }

    // 4. Vérifier si l'utilisateur existe déjà
    const { data: existingList } = await supabaseAdmin.auth.admin.listUsers()
    const existingUser = existingList?.users?.find(u => u.email?.toLowerCase() === cleanEmail)

    let userId: string
    let alreadyRegistered = false

    if (existingUser) {
      // Cas 1 : l'utilisateur existe déjà → renvoyer un mail de récupération
      alreadyRegistered = true
      userId = existingUser.id
      const { error: resetErr } = await supabaseAdmin.auth.admin.generateLink({
        type: 'recovery',
        email: cleanEmail,
        options: { redirectTo: REDIRECT_URL }
      })
      if (resetErr) throw new Error('Erreur génération du lien : ' + resetErr.message)
    } else {
      // Cas 2 : nouveau user → mail d'invitation
      const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(cleanEmail, {
        data: { first_name: firstName, last_name: lastName },
        redirectTo: REDIRECT_URL
      })
      if (inviteErr) throw new Error('Invitation impossible : ' + inviteErr.message)
      userId = invited.user.id

      // Définir le rôle dans app_metadata si admin
      if (targetRole === 'admin') {
        await supabaseAdmin.auth.admin.updateUserById(userId, {
          app_metadata: { role: 'admin' }
        })
      }
    }

    /* 5. Créer/MAJ le profil.
       ═══════════════════════════════════════════════════════════════════════
       ⚠️ CORRECTIF DU 27/09/2026 — UN INVITÉ NAÎT « active », PLUS « pending ».

       Le défaut, trouvé en relisant le parcours d'invitation de bout en bout :
       cette fonction écrivait `status: 'pending'` pour un nouveau compte. Or
       `ensureProfileActive()`, côté client, DÉCONNECTE tout profil `pending`
       et affiche « Un administrateur va valider votre accès très bientôt ».

       Le parcours complet était donc :
         l'admin invite → l'invité reçoit le mail → il clique, choisit son mot
         de passe → il se connecte → IL EST DÉCONNECTÉ et lit qu'il doit
         attendre une validation.

       Autrement dit : le chemin recommandé POUR ÉVITER le mur d'attente menait
       exactement au même mur. Il fallait ensuite que l'admin aille l'activer à
       la main dans la console — un geste que personne n'avait documenté, et
       que rien à l'écran ne réclamait.

       `pending` garde tout son sens pour une INSCRIPTION LIBRE : là, personne
       n'a vérifié qui s'inscrit. Mais une invitation EST la vérification —
       un administrateur a saisi cette adresse, ce prénom, ce nom et ce rôle.
       Exiger une seconde validation du même administrateur ne protège de rien.

       ⚠️ Le cas « déjà inscrit » reste à 'active' comme avant : il l'était
       déjà, et un mail de récupération ne remet pas son accès en cause.
       ═══════════════════════════════════════════════════════════════════════ */
    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .upsert({
        user_id: userId,
        email: cleanEmail,
        first_name: firstName,
        last_name: lastName,
        role: targetRole,
        status: 'active',
        invited_by: caller.id,
        notes: notes || null
      }, { onConflict: 'email' })
      .select()
      .single()
    if (profileErr) throw profileErr

    return new Response(
      JSON.stringify({
        success: true,
        profileId: profile.id,
        userId,
        alreadyRegistered,
        message: alreadyRegistered
          ? `Mail de réinitialisation envoyé à ${cleanEmail}`
          : `Mail d'invitation envoyé à ${cleanEmail}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || String(err) }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
