-- ═══════════════════════════════════════════════════════════════════════════
-- GARDE-PROFILS.sql — v=101, 16/10/2026 (audit complet de la v=100)
-- Un utilisateur ne peut plus changer lui-même son statut, son rôle, son
-- e-mail ou les notes de l'administrateur sur son profil.
--
-- STATUT : JOUÉ le 17/10/2026 par Thomas dans l'éditeur SQL de Supabase
-- (« Success. No rows returned »), dans la forme ci-dessous. Vérifié le jour
-- même : déclencheur actif (BEFORE UPDATE), fonction en SECURITY INVOKER avec
-- search_path vide, 2 profils actifs inchangés. Éprouvé dans des transactions
-- ANNULÉES (rien d'enregistré, vérifié après coup) : passer son statut à
-- « pending » sans rôle admin dans le jeton → refusé (42501) ; changer prénom
-- et téléphone sans rôle admin → accepté ; changer les notes avec le rôle
-- admin → accepté ; sans jeton (serveur Auth, service_role) → accepté.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. Une inscription libre crée un profil « pending » : l'écran
-- déconnecte ce compte tant qu'un administrateur ne l'a pas validé
-- (`ensureProfileActive`). Mais cette barrière est côté site. En base, le rôle
-- `authenticated` a le droit UPDATE sur TOUTES les colonnes de `profiles`, et
-- la policy `update_own_or_admin` laisse chacun modifier sa propre ligne tant
-- qu'il ne se donne pas le rôle admin. Un inscrit non validé pouvait donc,
-- avec sa propre session et la clé publique, écrire `status = 'active'` sur
-- son profil et entrer sans validation. Il pouvait aussi réécrire les notes
-- que l'administrateur garde sur lui, ou son adresse e-mail de profil.
-- (Il ne voyait les données de PERSONNE d'autre : le cloisonnement par
-- user_id tient sur toutes les tables. Le défaut contourne la validation, pas
-- le cloisonnement.)
--
-- CE QUE FAIT LE DÉCLENCHEUR. Avant chaque modification d'un profil, si
-- l'appel vient du site (rôle « authenticated ») sans le rôle admin dans le
-- jeton, il refuse tout changement de status, role, notes, email, invited_by
-- ou user_id. Le rôle admin vit dans app_metadata, que l'utilisateur ne peut
-- pas modifier lui-même : la même source que les policies de `profiles` et
-- que la garde des biens de test.
--
-- CE QU'IL NE BLOQUE PAS. Prénom, nom, téléphone (Paramètres › Compte, par
-- `update_my_profile`) restent modifiables par chacun. Les fonctions des
-- administrateurs (valider, archiver, réactiver) passent : l'appelant porte
-- le rôle admin. L'inscription et l'invitation passent : elles écrivent
-- depuis le serveur d'authentification ou le service_role, sans jeton
-- « authenticated ». Aucune donnée existante n'est modifiée.
--
-- RETOUR EN ARRIÈRE, si besoin (sans rien supprimer) :
--   alter table public.profiles disable trigger trg_profiles_garde_colonnes;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.profiles_garde_colonnes()
returns trigger
language plpgsql
set search_path to ''
as $$
declare
  jeton jsonb := (select auth.jwt());
begin
  if coalesce(jeton ->> 'role', '') in ('authenticated', 'anon')
     and coalesce(jeton -> 'app_metadata' ->> 'role', '') <> 'admin'
     and (new.status     is distinct from old.status
       or new.role       is distinct from old.role
       or new.notes      is distinct from old.notes
       or new.email      is distinct from old.email
       or new.invited_by is distinct from old.invited_by
       or new.user_id    is distinct from old.user_id)
  then
    raise exception 'Seul un administrateur peut modifier le statut, le rôle, l''adresse ou les notes d''un profil.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace trigger trg_profiles_garde_colonnes
  before update on public.profiles
  for each row execute function public.profiles_garde_colonnes();
