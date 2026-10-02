-- ═══════════════════════════════════════════════════════════════════════════
-- GARDE-BIENS-TEST.sql — v=94, 02/10/2026
-- Seul un administrateur peut marquer un bien comme « bien de test ».
--
-- STATUT : NON JOUÉ. À jouer par Thomas dans l'éditeur SQL de Supabase,
-- guidé pas à pas ; vérifié ensuite en lecture de notre côté.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. Depuis la v=94, un bien de test sort de tous les chiffres. La
-- création de biens de test est réservée aux administrateurs à l'écran
-- (Paramètres › Maintenance) et dans le code (genTestData). Mais l'écran se
-- contourne : tout compte peut appeler l'API Supabase avec la clé publique et
-- écrire is_test = true sur ses propres biens. La base est la seule barrière
-- que l'on ne contourne pas.
--
-- CE QUE FAIT LE DÉCLENCHEUR. À l'insertion d'un bien marqué de test, ou à la
-- modification qui fait passer is_test à true, il refuse l'écriture si
-- l'appelant passe par l'API (rôle « authenticated » ou « anon ») sans porter
-- le rôle admin dans son jeton. Ce rôle vit dans app_metadata, que
-- l'utilisateur ne peut pas modifier lui-même : c'est la même source que les
-- policies de la table profiles.
--
-- CE QU'IL NE FAIT PAS. Il ne touche à aucune donnée existante. Il ne bloque
-- ni la modification d'un bien de test déjà marqué, ni sa suppression. Il ne
-- concerne pas l'éditeur SQL ni le service_role.
--
-- (Les colonnes is_test de locataires, loyers_mensuels et charges_reelles ne
-- sont lues nulle part : un loyer suit son bien. Elles n'ont pas besoin de
-- garde.)
--
-- RETOUR EN ARRIÈRE, si besoin :
--   drop trigger if exists trg_biens_garde_is_test on public.biens;
--   drop function if exists public.biens_garde_is_test();
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.biens_garde_is_test()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  jeton jsonb := (select auth.jwt());
begin
  if new.is_test is true
     and (tg_op = 'INSERT' or old.is_test is distinct from true)
     and coalesce(jeton ->> 'role', '') in ('authenticated', 'anon')
     and coalesce(jeton -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Seul un administrateur peut créer un bien de test.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_biens_garde_is_test on public.biens;

create trigger trg_biens_garde_is_test
  before insert or update of is_test on public.biens
  for each row execute function public.biens_garde_is_test();
