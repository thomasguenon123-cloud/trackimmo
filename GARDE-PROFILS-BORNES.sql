-- ═══════════════════════════════════════════════════════════════════════════
-- GARDE-PROFILS-BORNES.sql — v=102, 17/10/2026
-- Les textes d'un profil (prénom, nom, téléphone, notes) ont une longueur
-- maximale, quel que soit le chemin d'écriture.
--
-- STATUT : NON JOUÉ. Étape 3, à jouer par Thomas APRÈS la vérification de
-- GARDE-COMPTES-ACTIFS.sql, puis à vérifier en lecture.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. Une inscription libre peut passer par l'API au lieu de l'écran :
-- le prénom et le nom envoyés à l'inscription sont recopiés dans le profil
-- (handle_new_user_profile) SANS limite de taille. Un compte malveillant
-- pouvait y mettre un mégaoctet de texte, que la page des utilisateurs de
-- l'administrateur chargerait à chaque ouverture. Le texte est déjà échappé à
-- l'affichage (pas de script possible) : la borne protège la taille, pas
-- l'affichage.
--
-- CE QUE FAIT LE DÉCLENCHEUR. Avant chaque création ou modification d'un
-- profil, il coupe : prénom et nom à 80 caractères, téléphone à 30, notes à
-- 2 000. Il COUPE au lieu de refuser : une vraie inscription n'est jamais
-- bloquée, une valeur abusive est simplement tronquée. Aucune donnée
-- existante n'est modifiée (les deux profils actuels sont bien en dessous).
--
-- RETOUR EN ARRIÈRE, si besoin (sans rien supprimer) :
--   alter table public.profiles disable trigger trg_profiles_bornes;
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
