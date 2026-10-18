-- ═══════════════════════════════════════════════════════════════════════════
-- GARDE-COMPTES-ACTIFS.sql — v=102, 17/10/2026
-- Seul un compte ACTIF lit ou écrit des données. Une inscription pas encore
-- validée, ou un compte bloqué, n'a plus accès à rien — en base, pas
-- seulement à l'écran.
--
-- STATUT : JOUÉ le 17/10/2026 par Thomas dans l'éditeur SQL de Supabase
-- (« Success. No rows returned »), dans la forme ci-dessous. Vérifié le jour
-- même : 17 règles `compte_actif` (16 tables + storage.objects), toutes
-- RESTRICTIVE, pour `authenticated`, FOR ALL, USING et WITH CHECK =
-- (select sf_compte_actif()) ; fonction en SECURITY INVOKER, STABLE,
-- search_path vide ; advisor de sécurité sans alerte nouvelle. Éprouvé dans
-- une transaction ANNULÉE (vérifié après coup) avec le compte administrateur :
--   actif    → 7 biens, 28 loyers, 2 locataires, 3 comptes rendus,
--              2 simulations, 1 SCI, 24 fichiers ; écriture : passe la règle ;
--   pending  → 0 partout, son profil reste lisible (1) ; écriture refusée 42501 ;
--   disabled → idem ;
--   actif de nouveau → tout revient.
-- ⚠️ Une fonction SECURITY DEFINER contourne ces règles par construction :
-- les préférences (`get_my_preferences`, `update_my_preferences`,
-- `update_my_appearance`) sont tenues par GARDE-PROFILS-BORNES.sql (étape 3).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. L'inscription libre reste ouverte (arbitrage du 17/10). Jusqu'ici,
-- la seule barrière entre un inscrit non validé et l'application était
-- l'écran (`ensureProfileActive` le déconnecte). En base, les règles de chaque
-- table vérifient seulement que la ligne lui appartient : avec sa session et la
-- clé publique, il pouvait créer des biens, déposer des fichiers, remplir la
-- base. Et un compte BLOQUÉ par l'administrateur garde son jeton de connexion
-- jusqu'à son expiration — une heure — : la documentation Supabase le précise,
-- une session révoquée laisse courir le jeton déjà délivré.
--
-- CE QUE FAIT CE BLOC.
--   1. `sf_compte_actif()` : vrai si le profil de l'appelant est « active ».
--      Elle lit la base à chaque requête : bloquer un compte coupe son accès
--      IMMÉDIATEMENT, sans attendre la fin de son jeton.
--   2. Une règle RESTRICTIVE `compte_actif` sur les 16 tables de données et
--      sur le stockage. Restrictive veut dire qu'elle S'AJOUTE aux règles
--      existantes (« la ligne est à moi ») : il faut les deux. Elle ne donne
--      aucun droit nouveau à personne.
--
-- CE QU'IL NE TOUCHE PAS. La table `profiles` (un inscrit doit pouvoir lire
-- son propre statut pour que l'écran lui dise « en attente »). Les fonctions
-- d'administration et le serveur d'authentification (ils ne passent pas par
-- ces règles). Aucune donnée existante. Les deux comptes actuels sont
-- « active » : rien ne change pour eux.
--
-- RETOUR EN ARRIÈRE, si besoin (sans rien supprimer) : neutraliser les règles.
--   do $$ declare r record; begin
--     for r in select schemaname, tablename from pg_policies where policyname = 'compte_actif' loop
--       execute format('alter policy compte_actif on %I.%I using (true) with check (true)', r.schemaname, r.tablename);
--     end loop;
--   end $$;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.sf_compte_actif()
returns boolean
language sql
stable
set search_path to ''
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and status = 'active'
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array['actions', 'bank_presets', 'biens', 'bilans_comptables', 'charges_reelles',
    'contacts', 'dossiers_bancaires', 'locataires', 'loyers_mensuels', 'sci', 'sci_contacts',
    'sci_documents', 'sci_echeances', 'simulations_credit', 'user_preferences', 'visites'] loop
    if not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename = t and policyname = 'compte_actif') then
      execute format('create policy compte_actif on public.%I as restrictive for all to authenticated '
                     'using ((select public.sf_compte_actif())) with check ((select public.sf_compte_actif()))', t);
    end if;
  end loop;
  if not exists (select 1 from pg_policies
                 where schemaname = 'storage' and tablename = 'objects' and policyname = 'compte_actif') then
    execute 'create policy compte_actif on storage.objects as restrictive for all to authenticated '
            'using ((select public.sf_compte_actif())) with check ((select public.sf_compte_actif()))';
  end if;
end $$;
