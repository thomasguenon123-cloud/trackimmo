-- ═══════════════════════════════════════════════════════════════════════════
-- RÉVOCATION DE admin_purge_legacy_base64()  ·  05/09/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en LECTURE SEULE. Je vérifie le résultat en lecture après.
--
-- ── POURQUOI ──────────────────────────────────────────────────────────────
-- Le bouton qui appelait cette fonction est retiré de l'écran (app.js, v=82).
-- Cela suffit à empêcher le clic, PAS l'appel : une fonction Postgres exposée
-- reste joignable sur /rest/v1/rpc/admin_purge_legacy_base64 par n'importe quel
-- administrateur muni de son jeton. Retirer l'interface sans révoquer le droit,
-- c'est ranger le couteau dans un tiroir non fermé.
--
-- ── CE QUE LA FONCTION FAISAIT DE FAUX ────────────────────────────────────
-- L'écran promettait, au-dessus du bouton : « seules les lignes ayant déjà un
-- équivalent Storage sont purgées. Aucune donnée non migrée n'est perdue. »
--
-- Quatre de ses cinq écritures tenaient cette promesse. La cinquième, non :
--     update public.locataires set documents = '[]'::jsonb
--      where jsonb_typeof(documents)='array' and jsonb_array_length(documents)>0;
-- Aucune condition sur Storage. Les documents rangés sur Storage devenaient des
-- orphelins invisibles, et ceux dont l'envoi avait échoué — conservés en base64
-- dans la fiche, exactement le cas que la phrase promettait de protéger —
-- disparaissaient pour de bon.
--
-- ⚠️ ET AUCUNE des cinq écritures n'était filtrée par compte. C'est le fond du
-- problème : `SECURITY DEFINER` CONTOURNE LA RLS. Les suppressions lancées
-- depuis le client (« Supprimer tout », « Supprimer les fiches tests ») sont
-- bornées par la policy `auth.uid() = user_id` et ne touchent que leur auteur ;
-- celle-ci, non. Un clic aurait vidé les documents de tous les locataires de
-- tous les comptes.
--
-- ── POURQUOI RÉVOQUER PLUTÔT QUE CORRIGER ─────────────────────────────────
-- La migration vers Storage est faite : cette purge n'a plus d'objet. Réparer
-- une fonction destructrice qu'on ne relancera jamais, c'est garder le risque
-- pour un bénéfice nul. On révoque le droit et on garde le corps de la fonction
-- comme trace ; `DROP` reste possible plus tard si tu veux effacer jusqu'au
-- souvenir.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── AVANT (lecture seule) : qui peut l'exécuter aujourd'hui ? ─────────────
select p.proname, p.proacl::text as droits
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'admin_purge_legacy_base64';


-- ── LA RÉVOCATION ─────────────────────────────────────────────────────────
-- `public` couvre l'héritage implicite : sans lui, `authenticated` peut encore
-- hériter du droit d'exécution accordé à tous par défaut.
revoke execute on function public.admin_purge_legacy_base64() from authenticated;
revoke execute on function public.admin_purge_legacy_base64() from anon;
revoke execute on function public.admin_purge_legacy_base64() from public;

comment on function public.admin_purge_legacy_base64() is
  'RETIRÉE LE 05/09/2026 — droit d''exécution révoqué. Vidait locataires.documents sans vérifier Storage et sans filtre par compte : SECURITY DEFINER contourne la RLS. La migration vers Storage étant faite, cette purge n''a plus d''objet. Ne pas ré-accorder sans corriger les deux défauts.';


-- ── APRÈS (lecture seule) : attendu, plus aucun droit pour authenticated ──
select p.proname, p.proacl::text as droits,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_peut_executer,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_peut_executer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'admin_purge_legacy_base64';
-- Attendu : les deux colonnes à `false`.
