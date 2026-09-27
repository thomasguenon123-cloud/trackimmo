/* ═══════════════════════════════════════════════════════════════════════════
   LES GARDES « admin » TOMBAIENT SUR UN NULL — correctif du 27/09/2026
   ═══════════════════════════════════════════════════════════════════════════

   CE QUE FAISAIT LE CODE. Quatre fonctions SECURITY DEFINER se protégeaient
   ainsi, sous deux formes :

     -- forme à une clause (admin_set_user_role, admin_set_user_status)
     IF v_caller_role != 'admin' THEN RAISE EXCEPTION 'Accès refusé'; END IF;

     -- forme à deux clauses (admin_disable_user, admin_enable_user)
     IF v_caller_role != 'admin'
        AND (auth.jwt() -> 'app_metadata' ->> 'role') != 'admin' THEN
       RAISE EXCEPTION 'Accès refusé';
     END IF;

   POURQUOI C'EST FAUX. En SQL, `NULL != 'admin'` ne vaut pas VRAI : il vaut
   NULL. Et plpgsql traite NULL comme faux dans un IF. La garde ne se
   déclenche donc pas, et la fonction s'exécute.

   ⚠️ LA FORME À DEUX CLAUSES EST LA PLUS GRAVE, ET ELLE N'EST PAS LATENTE.
   Pour un utilisateur ORDINAIRE, qui a bien une ligne dans `profiles` :
     · v_caller_role = 'user'            → 'user' != 'admin'  = VRAI
     · pas de rôle dans son app_metadata → NULL  != 'admin'   = NULL
     · VRAI AND NULL                     = NULL               → PAS d'exception

   Autrement dit : n'importe quel utilisateur connecté passait la garde de
   `admin_disable_user` et `admin_enable_user`, toutes deux exécutables par le
   rôle `authenticated`. Vérifié par table de vérité en base, pas déduit.

   Ce que cela ouvrait concrètement, compte tenu de la RLS de `profiles`
   (SELECT limité à sa propre ligne, donc on ne connaît que son propre id) :
     · un compte `pending` ou `disabled` pouvait s'AUTO-ACTIVER en appelant
       admin_enable_user(son_propre_id) — status='active' ET banned_until
       remis à NULL. Le mur de validation administrateur se contournait en un
       appel, par la personne même qu'il retient.
     · un compte pouvait se bannir lui-même (sans intérêt, mais possible).
   Viser le compte d'un AUTRE supposait de connaître son UUID, que la RLS ne
   donne pas. C'est une limite de fait, pas une protection : une garde
   d'autorisation ne doit jamais reposer sur le secret d'un identifiant.

   LE CORRECTIF. `IS DISTINCT FROM` est l'opérateur qui traite NULL comme une
   valeur comparable : `NULL IS DISTINCT FROM 'admin'` vaut VRAI. La garde se
   déclenche alors dans les deux cas — profil absent, et rôle non admin.

   ⚠️ UNE CINQUIÈME FONCTION N'AVAIT PAS LE DÉFAUT, et c'est instructif :
   `admin_purge_legacy_base64` écrit
     SELECT (role = 'admin') INTO v_is_admin ... ;
     IF NOT COALESCE(v_is_admin, false) THEN RAISE ...
   Le COALESCE fait le même travail qu'IS DISTINCT FROM. Elle n'est donc pas
   touchée ici — et ses droits restent révoqués pour `authenticated`.

   ⚠️ UN SIXIÈME NULL, DANS L'AUTRE SENS. `admin_set_user_status` finit par
     UPDATE ... WHERE id = p_profile_id AND role != 'admin';
   L'intention est bonne (ne pas toucher au statut d'un administrateur), mais
   une cible dont le `role` est NULL n'est PAS mise à jour, et la fonction
   renvoie quand même `success: true`. Le même opérateur corrige les deux.

   ⚠️ ET UNE DERNIÈRE MALHONNÊTETÉ, DE LA MÊME FAMILLE. `admin_disable_user`
   et `admin_enable_user` répondaient `success: true` même quand l'UPDATE ne
   touchait AUCUNE ligne. L'écran affichait alors « Utilisateur archivé » sans
   que rien ne le soit. Corriger la garde de deux fonctions sur quatre et
   laisser les deux autres mentir aurait été pire que de n'en corriger aucune :
   les quatre utilisent désormais GET DIAGNOSTICS.

   Chaque bloc est indépendant et rejouable (CREATE OR REPLACE). Les droits
   EXECUTE existants sont préservés : remplacer un corps ne les touche pas.
   ═══════════════════════════════════════════════════════════════════════════ */


-- ── BLOC 1 ─ admin_disable_user ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_disable_user(p_profile_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_role text;
  v_user_id uuid;
  v_touchees int;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid();
  -- ⚠️ IS DISTINCT FROM, pas != : voir l'en-tête de MIGRATION-GARDES-ADMIN.sql.
  --    Avec !=, un utilisateur ordinaire passait cette garde (VRAI AND NULL = NULL).
  IF v_caller_role IS DISTINCT FROM 'admin'
     AND (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  SELECT user_id INTO v_user_id FROM public.profiles WHERE id = p_profile_id;
  -- Bannir le user (invalide toutes ses sessions)
  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = 'infinity' WHERE id = v_user_id;
  END IF;
  UPDATE public.profiles SET status = 'disabled', updated_at = now() WHERE id = p_profile_id;
  -- ⚠️ Même faute d'honnêteté que dans admin_set_user_status : sans ce contrôle,
  --    la fonction répondait `success: true` pour un profil introuvable, et
  --    l'écran affichait « Utilisateur archivé » sans que rien ne le soit.
  GET DIAGNOSTICS v_touchees = ROW_COUNT;
  IF v_touchees = 0 THEN RAISE EXCEPTION 'Profil introuvable'; END IF;
  RETURN json_build_object('success', true);
END;
$function$;


-- ── BLOC 2 ─ admin_enable_user ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_enable_user(p_profile_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_role text;
  v_user_id uuid;
  v_touchees int;
BEGIN
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid();
  -- ⚠️ C'ÉTAIT LA PLUS EXPOSÉE DES QUATRE : avec !=, un compte `pending` ou
  --    `disabled` s'auto-activait en s'appelant sur son propre id.
  IF v_caller_role IS DISTINCT FROM 'admin'
     AND (auth.jwt() -> 'app_metadata' ->> 'role') IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;
  SELECT user_id INTO v_user_id FROM public.profiles WHERE id = p_profile_id;
  IF v_user_id IS NOT NULL THEN
    UPDATE auth.users SET banned_until = NULL WHERE id = v_user_id;
  END IF;
  UPDATE public.profiles SET status = 'active', updated_at = now() WHERE id = p_profile_id;
  GET DIAGNOSTICS v_touchees = ROW_COUNT;
  IF v_touchees = 0 THEN RAISE EXCEPTION 'Profil introuvable'; END IF;
  RETURN json_build_object('success', true);
END;
$function$;


-- ── BLOC 3 ─ admin_set_user_role ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_role(p_profile_id uuid, p_role text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_caller_role text;
  v_target_user_id uuid;
BEGIN
  -- 1. Check appelant = admin
  SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid();
  -- ⚠️ IS DISTINCT FROM : un appelant SANS ligne dans `profiles` passait la garde
  --    à une clause, et cette fonction accorde le rôle admin. Élévation.
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Accès refusé : rôle admin requis';
  END IF;

  -- 2. Validation entrée
  IF p_role NOT IN ('admin', 'user') THEN
    RAISE EXCEPTION 'Rôle invalide : doit être "admin" ou "user"';
  END IF;

  -- 3. UPDATE profiles + récupération du user_id cible
  UPDATE public.profiles
  SET role = p_role,
      updated_at = now()
  WHERE id = p_profile_id
  RETURNING user_id INTO v_target_user_id;

  IF v_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable, ou pas encore associé à un compte auth';
  END IF;

  -- 4. Sync app_metadata du JWT (la nouveauté FND-004)
  IF p_role = 'admin' THEN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb,
        updated_at = now()
    WHERE id = v_target_user_id;
  ELSE
    -- Retirer la clé "role" (préserve provider/providers/autres)
    UPDATE auth.users
    SET raw_app_meta_data = (COALESCE(raw_app_meta_data, '{}'::jsonb) - 'role'),
        updated_at = now()
    WHERE id = v_target_user_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'profile_id', p_profile_id,
    'user_id', v_target_user_id,
    'new_role', p_role,
    'note', 'Le user doit se déconnecter/reconnecter pour que son JWT reflète le nouveau rôle.'
  );
END;
$function$;


-- ── BLOC 4 ─ admin_set_user_status ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_status(p_profile_id uuid, p_status text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_touchees int;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE user_id = auth.uid();
  -- ⚠️ IS DISTINCT FROM : sans profil, l'appelant passait.
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Accès refusé'; END IF;

  -- ⚠️ LE MÊME NULL, DANS L'AUTRE SENS. `role != 'admin'` écartait aussi les
  --    cibles dont le rôle est NULL — la fonction ne faisait alors RIEN tout
  --    en répondant `success: true`. On distingue désormais les deux cas.
  UPDATE public.profiles SET status = p_status
  WHERE id = p_profile_id AND role IS DISTINCT FROM 'admin';
  GET DIAGNOSTICS v_touchees = ROW_COUNT;

  IF v_touchees = 0 THEN
    RAISE EXCEPTION 'Statut non modifié : profil introuvable, ou cible administrateur';
  END IF;
  RETURN json_build_object('success', true);
END;
$function$;


/* ── BLOC 5 ─ VALIDATION PAR MUTATION ──────────────────────────────────────
   ⚠️ UN TEST QUI NE SAIT PAS ÉCHOUER NE PROUVE RIEN. Ce bloc se fait passer
   pour les DEUX comptes réels et compare : le compte `user` doit être REFUSÉ
   par la garde, le compte `admin` doit la FRANCHIR (et n'échouer qu'ensuite,
   pour une raison métier, puisqu'on vise un uuid inexistant). Sans ce témoin
   positif, un « tout refuse » pourrait venir d'une erreur sans rapport.

   Aucune donnée ne peut bouger : la cible est l'uuid nul, qui n'existe pas.
   Exécuté le 27/09/2026 — résultat obtenu, les quatre lignes :
     disable  user REFUSE (garde)  ·  admin REFUSE (métier) : Profil introuvable
     enable   user REFUSE (garde)  ·  admin REFUSE (métier) : Profil introuvable
     status   user REFUSE (garde)  ·  admin REFUSE (métier) : Statut non modifié…
     role     user REFUSE (garde)  ·  admin REFUSE (métier) : Profil introuvable…
   Avant le correctif, la colonne `user` répondait PASSE → {"success": true}.
   ────────────────────────────────────────────────────────────────────────── */
CREATE OR REPLACE FUNCTION pg_temp.essai(p_appelant uuid, p_fn text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE r json;
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', p_appelant, 'role', 'authenticated',
      'app_metadata', json_build_object('provider', 'email'))::text, true);
  BEGIN
    CASE p_fn
      WHEN 'disable' THEN SELECT public.admin_disable_user('00000000-0000-0000-0000-000000000000') INTO r;
      WHEN 'enable'  THEN SELECT public.admin_enable_user('00000000-0000-0000-0000-000000000000') INTO r;
      WHEN 'status'  THEN SELECT public.admin_set_user_status('00000000-0000-0000-0000-000000000000','active') INTO r;
      WHEN 'role'    THEN SELECT public.admin_set_user_role('00000000-0000-0000-0000-000000000000','admin') INTO r;
    END CASE;
    RETURN 'PASSE → ' || coalesce(r::text, 'null');
  EXCEPTION WHEN others THEN
    RETURN CASE WHEN sqlerrm LIKE '%Accès refusé%'
                THEN 'REFUSE (garde)' ELSE 'REFUSE (métier) : ' || sqlerrm END;
  END;
END $$;

-- Remplacer les deux uuid par ceux de `profiles` : un compte role='user',
-- un compte role='admin'.
SELECT fn,
       pg_temp.essai('0ee51b1a-79cc-49a5-b0df-67db89affbad', fn) AS compte_user,
       pg_temp.essai('3abcb928-2f54-4863-9dc4-beda1b204edb', fn) AS compte_admin
FROM (VALUES ('disable'),('enable'),('status'),('role')) t(fn);

-- Et le contrôle statique : plus aucun `!= 'admin'` vivant dans les gardes.
WITH d AS (
  SELECT p.proname, regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') AS code
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname LIKE 'admin\_%'
)
SELECT proname,
       (code ~ '!=\s*''admin''')         AS inegal_vivant,   -- doit être false partout
       (code ILIKE '%IS DISTINCT FROM%')  AS garde_corrigee   -- true sauf admin_purge_legacy_base64
FROM d ORDER BY proname;
