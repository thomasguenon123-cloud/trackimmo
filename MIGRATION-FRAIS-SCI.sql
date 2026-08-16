-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Frais de constitution d'une SCI
-- Stonefolio · règle arrêtée par Thomas le 15/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase :
-- https://supabase.com/dashboard/project/dizkljqobgiywxsbsdkd/sql/new
-- Mon accès MCP est en lecture seule, toute écriture lui revient.
--
-- ── LA RÈGLE ───────────────────────────────────────────────────────────────
-- Les frais de constitution s'imputent AU BIEN QUI A MOTIVÉ LA CRÉATION de la
-- société, et à lui seul :
--   · bien détenu en propre        → 0 €
--   · SCI qui détient déjà un bien → 0 €   « je ne refais pas une SCI à chaque
--                                            achat »
--   · premier bien d'une SCI       → 200 €
--
-- ── CE QUE ÇA CORRIGE ──────────────────────────────────────────────────────
-- `biens.creation_sci` a une VALEUR PAR DÉFAUT DE 200 €, posée sur TOUT bien
-- créé — y compris ceux détenus en propre et ceux encore en prospection.
-- Mesuré le 15/08/2026 : 4 biens sur 7 la portaient à tort. Le montant entre
-- dans `emprunt`, donc dans le coût d'acquisition, le rendement, le cashflow et
-- tout ce qui en dérive. T4+ Paris 16e affichait 952 200 € au lieu de 952 000 €.
--
-- Côté application, `sfFraisCreationSci()` applique déjà la règle depuis v=69 :
-- ce fichier ne traite QUE le défaut de colonne et la reprise de l'existant.
--
-- Les instructions sont IDEMPOTENTES : les relancer ne casse rien.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 1 — PHOTO AVANT (lecture seule, ne modifie rien)
-- Attendu au 15/08/2026 : 5 lignes à 200 €, dont 4 à tort.
-- ═══════════════════════════════════════════════════════════════════════════
select b.titre,
       coalesce(b.mode_detention, '(a renseigner)') as mode,
       s.nom_sci,
       b.creation_sci as actuel,
       case
         when b.mode_detention is distinct from 'sci' then 0
         when b.id = (select b2.id from public.biens b2
                       where b2.sci_id = b.sci_id and b2.mode_detention = 'sci'
                       order by b2.created_at, b2.id limit 1) then 200
         else 0
       end as attendu
  from public.biens b
  left join public.sci s on s.id = b.sci_id
 order by b.creation_sci desc, b.titre;


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 2 — LE DÉFAUT DE COLONNE PASSE DE 200 € À 0 €
--
-- C'est la cause racine : sans cela, chaque nouvelle fiche naîtrait de nouveau
-- avec 200 € de frais d'une SCI qui n'existe peut-être pas.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.biens
  alter column creation_sci set default 0;


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 3 — REPRISE DE L'EXISTANT
--
-- ⚠️ L'éditeur SQL s'exécute en `postgres` et IGNORE les politiques RLS : la
-- mise à jour porte donc sur les biens de TOUS les comptes. C'est bien ce qu'on
-- veut pour une reprise. (Au 15/08/2026 : 2 comptes, 1 seul a des biens.)
--
-- ⚠️ Départage `created_at, id` et non `created_at` seul : les deux biens de la
-- SCI de test ont EXACTEMENT la même date de création, et un `limit 1` sans
-- second critère aurait désigné l'un ou l'autre au gré du plan d'exécution —
-- donc un résultat différent d'une exécution à l'autre.
-- ═══════════════════════════════════════════════════════════════════════════
update public.biens b
   set creation_sci = case
         when b.mode_detention is distinct from 'sci' then 0
         when b.id = (select b2.id from public.biens b2
                       where b2.sci_id = b.sci_id and b2.mode_detention = 'sci'
                       order by b2.created_at, b2.id limit 1) then 200
         else 0
       end
 where b.creation_sci is distinct from (case
         when b.mode_detention is distinct from 'sci' then 0
         when b.id = (select b2.id from public.biens b2
                       where b2.sci_id = b.sci_id and b2.mode_detention = 'sci'
                       order by b2.created_at, b2.id limit 1) then 200
         else 0
       end);


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 4 — CONTRÔLE APRÈS (lecture seule)
-- Attendu : `ecarts` = 0, et une seule ligne à 200 € (le premier bien de la SCI).
-- ═══════════════════════════════════════════════════════════════════════════
select count(*) filter (where b.creation_sci is distinct from (case
         when b.mode_detention is distinct from 'sci' then 0
         when b.id = (select b2.id from public.biens b2
                       where b2.sci_id = b.sci_id and b2.mode_detention = 'sci'
                       order by b2.created_at, b2.id limit 1) then 200
         else 0 end))                                        as ecarts,
       count(*) filter (where b.creation_sci > 0)             as biens_avec_frais,
       coalesce(sum(b.creation_sci), 0)                       as total_frais,
       (select column_default from information_schema.columns
         where table_schema='public' and table_name='biens'
           and column_name='creation_sci')                    as defaut_colonne
  from public.biens b;


-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE
--
-- Remet le défaut de colonne. Les montants repris, eux, ne se « dé-reprennent »
-- pas : ils étaient faux, la photo de l'étape 1 en garde la trace si besoin.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.biens alter column creation_sci set default 200;
