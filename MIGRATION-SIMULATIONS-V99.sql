-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION-SIMULATIONS-V99.sql — v=99, 15/10/2026
-- Le simulateur de crédit : l'assurance emprunteur, la simulation retenue
-- d'un bien, et votre taux de crédit.
--
-- STATUT : JOUÉ LE 16/10/2026 par Thomas dans l'éditeur SQL de Supabase
-- (« Success. No rows returned »). Vérifié en lecture le jour même : les trois
-- colonnes (assurance_mensuelle numeric nullable, retenue boolean not null
-- default false, taux_credit numeric nullable), les deux contraintes, l'index
-- unique partiel, RLS active sur les deux tables avec leurs 8 règles ; données
-- inchangées (2 simulations, aucune retenue ; 1 ligne de préférences, sans taux).
-- Ce fichier reprend exactement le bloc joué ; les commentaires de colonnes,
-- facultatifs, n'en faisaient pas partie (voir en fin de fichier).
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. Depuis la v=99 :
--   · une simulation porte l'ASSURANCE EMPRUNTEUR (€/mois) : la mensualité, le
--     coût du crédit et l'endettement la comptent ;
--   · une simulation peut être RETENUE pour son bien — une seule par bien. Sa
--     mensualité, assurance comprise, et sa durée passent alors sur la fiche ;
--     le dossier banque la présélectionne, l'achat la rappelle ;
--   · Préférences métier propose VOTRE TAUX de crédit ; laissé vide, Stonefolio
--     prend le taux moyen officiel (Banque de France).
--
-- TANT QUE CES COLONNES N'EXISTENT PAS, l'application ne propose ni
-- l'assurance, ni « Retenir », ni votre taux, et n'envoie rien pour eux :
-- le reste du simulateur fonctionne (sfsColonnesDispo, app.js).
--
-- CE QUE FAIT CE SCRIPT. Trois colonnes, vides sur l'existant (assurance non
-- renseignée, aucune simulation retenue, pas de taux personnel), deux
-- contraintes de bornes, et un index qui refuse deux simulations retenues pour
-- un même bien. Les droits et les règles d'accès (RLS : chacun ne lit et
-- n'écrit que ses lignes) couvrent les nouvelles colonnes sans rien changer :
-- ils portent sur les tables entières (vérifié le 15/10 : privilèges de table,
-- policies sim_own_* et user_prefs_*).
--
-- CE QU'IL NE FAIT PAS. Il ne modifie aucune donnée existante. Il se rejoue
-- sans dommage (aucun « drop »).
--
-- RETOUR EN ARRIÈRE, si besoin (⚠️ efface les assurances, les simulations
-- retenues et votre taux déjà saisis) :
--   drop index if exists public.simulations_credit_une_retenue_par_bien;
--   alter table public.simulations_credit drop column if exists assurance_mensuelle;
--   alter table public.simulations_credit drop column if exists retenue;
--   alter table public.user_preferences drop column if exists taux_credit;
--   notify pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.simulations_credit add column if not exists assurance_mensuelle numeric;
alter table public.simulations_credit add column if not exists retenue boolean not null default false;
alter table public.user_preferences  add column if not exists taux_credit numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'simulations_assurance_positive') then
    alter table public.simulations_credit
      add constraint simulations_assurance_positive
      check (assurance_mensuelle is null or assurance_mensuelle >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'user_preferences_taux_credit_borne') then
    alter table public.user_preferences
      add constraint user_preferences_taux_credit_borne
      check (taux_credit is null or (taux_credit > 0 and taux_credit <= 20));
  end if;
end $$;

-- Une seule simulation retenue par bien.
create unique index if not exists simulations_credit_une_retenue_par_bien
  on public.simulations_credit (bien_id) where retenue;

notify pgrst, 'reload schema';

-- ── Facultatif, NON JOUÉ : la documentation des colonnes en base ────────────
-- comment on column public.simulations_credit.assurance_mensuelle is
--   'Assurance emprunteur, en euros par mois (v=99). NULL : non renseignée.';
-- comment on column public.simulations_credit.retenue is
--   'Simulation retenue pour financer son bien (v=99) : une seule par bien.';
-- comment on column public.user_preferences.taux_credit is
--   'Taux de crédit personnel, en % (v=99). NULL : le taux moyen officiel est proposé.';
