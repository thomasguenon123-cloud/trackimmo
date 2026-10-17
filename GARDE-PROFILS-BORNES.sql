-- ═══════════════════════════════════════════════════════════════════════════
-- GARDE-PROFILS-BORNES.sql — v=102, 17/10/2026
-- (1) Les textes d'un profil (prénom, nom, téléphone, notes) ont une longueur
--     maximale, quel que soit le chemin d'écriture.
-- (2) Un compte non actif n'écrit plus ses préférences, même par les trois
--     fonctions SECURITY DEFINER qui contournent la règle `compte_actif`.
--
-- STATUT : JOUÉ le 17/10/2026 par Thomas dans l'éditeur SQL de Supabase
-- (« Success. No rows returned »), dans la forme ci-dessous — étape 3, après
-- GARDE-COMPTES-ACTIFS.sql. Le bloc avait été éprouvé AVANT d'être proposé,
-- dans une transaction annulée. Vérifié après coup : deux déclencheurs actifs,
-- BEFORE INSERT OR UPDATE, FOR EACH ROW ; fonctions en SECURITY INVOKER,
-- search_path vide ; données inchangées (2 profils, textes de 6 caractères au
-- plus) ; advisor de sécurité sans alerte nouvelle. Éprouvé sur les VRAIS
-- déclencheurs dans une transaction ANNULÉE (aucune trace, vérifié) :
--   bornes → prénom 500 → 80, téléphone 100 → 30 (session) ; prénom et nom
--            300 → 80 (update_my_profile) ; notes 5 000 → 2 000 (sans session) ;
--   préférences → inchangées pour « pending » et « disabled », écrites pour
--            un compte actif (témoin).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- (1) POURQUOI. Une inscription libre peut passer par l'API au lieu de
-- l'écran : le prénom et le nom envoyés à l'inscription sont recopiés dans le
-- profil (handle_new_user_profile) SANS limite de taille. Un compte
-- malveillant pouvait y mettre un mégaoctet de texte, que la page des
-- utilisateurs de l'administrateur chargerait à chaque ouverture. Le texte est
-- déjà échappé à l'affichage (pas de script possible) : la borne protège la
-- taille, pas l'affichage.
--
-- CE QUE FAIT LE DÉCLENCHEUR. Avant chaque création ou modification d'un
-- profil, il coupe : prénom et nom à 80 caractères, téléphone à 30, notes à
-- 2 000. Il COUPE au lieu de refuser : une vraie inscription n'est jamais
-- bloquée, une valeur abusive est simplement tronquée. Aucune donnée
-- existante n'est modifiée (les deux profils actuels sont bien en dessous).
--
-- (2) POURQUOI. La règle `compte_actif` (GARDE-COMPTES-ACTIFS.sql) tient
-- toutes les lectures et écritures faites avec la session d'un utilisateur.
-- Mais `get_my_preferences`, `update_my_preferences` et `update_my_appearance`
-- sont des fonctions SECURITY DEFINER : elles s'exécutent avec les droits de
-- leur propriétaire, qui n'est pas soumis aux règles. Un compte en attente ou
-- bloqué pouvait donc encore écrire SA propre ligne de préférences (quatre
-- réglages bornés et l'apparence) — rien de plus, aucune donnée d'autrui.
--
-- CE QUE FAIT LE DÉCLENCHEUR. Un déclencheur, lui, s'applique quel que soit le
-- chemin. Avant chaque création ou modification d'une ligne de préférences
-- demandée par une session d'utilisateur, il ne laisse passer que si le compte
-- est actif ; sinon l'écriture est simplement IGNORÉE (pas d'erreur : le site
-- garde ses valeurs par défaut, comme il le fait déjà). Le serveur
-- d'authentification et les fonctions serveur (sans session d'utilisateur) ne
-- sont pas concernés. Aucune donnée existante n'est modifiée.
--
-- RETOUR EN ARRIÈRE, si besoin (sans rien supprimer) :
--   alter table public.profiles disable trigger trg_profiles_bornes;
--   alter table public.user_preferences disable trigger trg_preferences_compte_actif;
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.profiles_bornes()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.first_name := left(new.first_name, 80);
  new.last_name  := left(new.last_name, 80);
  new.phone      := left(new.phone, 30);
  new.notes      := left(new.notes, 2000);
  return new;
end;
$$;

create or replace trigger trg_profiles_bornes
  before insert or update on public.profiles
  for each row execute function public.profiles_bornes();

create or replace function public.preferences_compte_actif()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  if (select auth.uid()) is not null and not public.sf_compte_actif() then
    return null;
  end if;
  return new;
end;
$$;

create or replace trigger trg_preferences_compte_actif
  before insert or update on public.user_preferences
  for each row execute function public.preferences_compte_actif();
