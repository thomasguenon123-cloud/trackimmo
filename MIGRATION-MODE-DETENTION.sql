-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Mode de détention d'un bien acquis
-- Stonefolio · règle arrêtée par Thomas le 12/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en lecture seule : toute migration DDL lui revient.
--
-- ⚠️ LA MIGRATION EST EN DEUX PARTIES, ET L'ORDRE COMPTE.
--    · PARTIE A — à exécuter MAINTENANT. Sans risque.
--    · PARTIE B — à exécuter SEULEMENT le jour où app.js est mis à jour.
--      L'exécuter maintenant CASSERAIT l'enregistrement d'une fiche bien.
--      La raison est expliquée en tête de la partie B. Ne pas l'anticiper.
--
-- ── POURQUOI CETTE MIGRATION ───────────────────────────────────────────────
-- Aujourd'hui la seule information de détention est `biens.sci_id`, nullable.
-- `sci_id IS NULL` veut donc dire DEUX CHOSES OPPOSÉES :
--   · « ce bien est détenu en nom propre »  (une réponse)
--   · « on ne sait pas encore »             (une absence de réponse)
-- C'est la même confusion que celle qui rendait la vacance invisible dans les
-- consolidés : deux cas contraires sous une seule absence de valeur. Elle
-- produisait des phrases du type « T4+ Paris 16e n'est rattaché à aucune
-- SCI », qui ne disent pas si c'est un choix ou un oubli.
--
-- ── CE QUE LA MIGRATION FAIT, ET NE FAIT PAS ───────────────────────────────
-- Elle ne reprend QUE ce qui est certain : un bien rattaché à une SCI est en
-- SCI. Un bien sans rattachement n'est PAS forcément en propre — il peut
-- appartenir à une SCI pas encore créée dans Stonefolio. On laisse NULL et
-- c'est l'écran qui demandera.
--
-- ⚠️ NE JAMAIS PRÉSUMER 'propre' PAR DÉFAUT : ce serait écrire une donnée à
-- portée fiscale en la devinant.
--
-- Toutes les instructions sont IDEMPOTENTES : les relancer ne casse rien.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 0 — PHOTO AVANT (lecture seule, ne modifie rien)
-- Noter ce résultat pour pouvoir le comparer à l'étape 2.
-- Attendu au 12/08/2026 : 7 biens, dont 2 rattachés et 5 non rattachés ;
-- 3 biens au statut « Acheté », dont 1 sans rattachement.
-- ═══════════════════════════════════════════════════════════════════════════
select count(*)                                                    as biens_total,
       count(*) filter (where sci_id is not null)                  as rattaches,
       count(*) filter (where sci_id is null)                      as non_rattaches,
       count(*) filter (where statut = 'Acheté')                   as acquis,
       count(*) filter (where statut = 'Acheté' and sci_id is null) as acquis_sans_sci
  from public.biens;


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE A — À EXÉCUTER MAINTENANT
--
-- Pourquoi c'est sans risque : aucune ligne de code d'app.js n'écrit ni ne lit
-- `mode_detention` aujourd'hui. La colonne est donc invisible pour
-- l'application, et la contrainte de valeurs ne peut être violée par personne.
-- ═══════════════════════════════════════════════════════════════════════════

-- A.1 · La colonne. Nullable : l'existant ne peut pas toujours être tranché.
alter table public.biens
  add column if not exists mode_detention text;

-- A.2 · Les deux seules valeurs admises.
alter table public.biens
  drop constraint if exists biens_mode_detention_valide;
alter table public.biens
  add constraint biens_mode_detention_valide
  check (mode_detention is null or mode_detention in ('propre', 'sci'));

-- A.3 · Reprise de l'existant : uniquement le cas certain.
--       ⚠️ L'éditeur SQL Supabase s'exécute en `postgres` et IGNORE les
--       politiques RLS : cette mise à jour porte donc sur les biens de TOUS
--       les comptes, pas seulement les vôtres. C'est bien ce qu'on veut pour
--       une reprise de schéma. (Au 12/08/2026 : 2 comptes, 1 seul a des biens.)
update public.biens
   set mode_detention = 'sci'
 where sci_id is not null
   and mode_detention is null;


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 2 — CONTRÔLE APRÈS LA PARTIE A (lecture seule)
--
-- Attendu au 12/08/2026 :
--   'sci'            → 2 biens, dont 2 acquis   (Immeuble Paris 18e, T3 Lyon)
--   (à renseigner)   → 5 biens, dont 1 acquis   (T4+ Paris 16e)
-- Les biens en prospection restent NULL : ils n'ont pas encore de détention.
-- ═══════════════════════════════════════════════════════════════════════════
select coalesce(mode_detention, '(à renseigner)')  as mode,
       count(*)                                    as biens,
       count(*) filter (where statut = 'Acheté')   as dont_acquis
  from public.biens
 group by 1
 order by 1;


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE B — NE PAS EXÉCUTER MAINTENANT
--
-- ⚠️ POURQUOI ELLE ATTEND. Cette contrainte interdit au mode et au
-- rattachement de se contredire. Or DEUX chemins d'app.js écrivent AUJOURD'HUI
-- `sci_id` tout seul, sans toucher au mode :
--
--   1. `saveBien()` (app.js:3093) — le formulaire de fiche bien contient
--      « SCI associée » avec une option « — Aucune SCI — ». Choisir cette
--      option sur un bien marqué 'sci' écrit `sci_id = null` et violerait la
--      contrainte : L'ENREGISTREMENT ENTIER ÉCHOUERAIT, faisant perdre toutes
--      les autres modifications de la fiche.
--   2. `mfBilanFeedSaveBiens()` (app.js:7676) — décocher un bien dans la
--      fenêtre « Alimenter le bilan SCI » écrit aussi `sci_id = null` seul.
--
-- Tant que `mode_detention` n'est lu par personne, une incohérence passagère
-- est sans conséquence et se corrige en relançant A.3. Un enregistrement qui
-- échoue, lui, est une régression visible sur une plateforme en service.
--
-- → À exécuter le jour où ces deux chemins écrivent les DEUX champs dans le
--   MÊME `update`. C'est à ce moment-là que l'invariant devient tenable.
-- ═══════════════════════════════════════════════════════════════════════════

-- alter table public.biens
--   drop constraint if exists biens_mode_detention_coherent;
-- alter table public.biens
--   add constraint biens_mode_detention_coherent
--   check (
--     mode_detention is null
--     or (mode_detention = 'sci'    and sci_id is not null)
--     or (mode_detention = 'propre' and sci_id is null)
--   );


-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE (si besoin, annule la partie A sans perte)
-- La colonne n'est lue par rien : la supprimer est sans effet sur l'app.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.biens drop constraint if exists biens_mode_detention_valide;
-- alter table public.biens drop column if exists mode_detention;


-- ═══════════════════════════════════════════════════════════════════════════
-- SUITE, CÔTÉ APPLICATION (aucune DDL — pour mémoire)
--
-- · `bdEtapesGestion()` (app.js:4139) : l'étape « Rattacher une SCI »,
--   aujourd'hui FACULTATIVE, devient « Mode de détention », obligatoire et
--   première. Le crochet existe déjà : `bdCheckMiseEnGestion()` est appelé aux
--   deux seuls endroits où un bien passe en « Acheté » (app.js:2350 glissement
--   kanban, app.js:3304 édition en ligne).
--
-- · `sfPointsAttention()` : un sixième détecteur pour les biens acquis dont le
--   mode reste à renseigner — c'est le rattrapage de l'existant.
--
-- · Les deux chemins cités en partie B doivent écrire les deux champs
--   ensemble, puis la partie B peut être appliquée.
--
-- · ⚠️ `creation_sci` a une VALEUR PAR DÉFAUT DE 200 € en base, posée sur tous
--   les biens. T4+ Paris 16e porte donc 200 € de frais de création d'une SCI à
--   laquelle il n'appartient pas, et ce montant entre dans `emprunt` à cinq
--   endroits du code — donc dans son coût d'acquisition (952 200 € au lieu de
--   952 000 €) et dans tout ce qui en dérive. Une fois le mode explicite, ce
--   champ n'a de sens que pour mode_detention = 'sci'.
-- ═══════════════════════════════════════════════════════════════════════════
