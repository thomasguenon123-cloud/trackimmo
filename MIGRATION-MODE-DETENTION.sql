-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Mode de détention d'un bien acquis
-- Stonefolio · règle arrêtée par Thomas le 12/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en lecture seule : toute migration DDL lui revient.
--
-- ✅ MIGRATION TERMINÉE. Les deux parties sont appliquées.
--    · PARTIE A — appliquée par Thomas le 12/08/2026.
--    · PARTIE B — appliquée par Thomas le 14/08/2026, une fois les TROIS
--      chemins d'app.js écrivant `mode_detention` dans le même `update` que
--      `sci_id`. Vérifiée en lecture le jour même : contrainte présente,
--      `convalidated = true` (les 7 lignes existantes ont été contrôlées par
--      Postgres, pas seulement les futures), RLS intacte (4 + 4 policies).
--
-- ⚠️ IL RESTE UN QUATRIÈME CHEMIN D'ÉCRITURE DE `sci_id`, ET IL EST EN BASE :
--    la clé étrangère `biens_sci_id_fkey` est en ON DELETE SET NULL. Voir la
--    note en fin de partie B. Ce fichier ne le corrige pas — c'est du code.
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
-- PARTIE B — ✅ APPLIQUÉE LE 14/08/2026
--
-- L'invariant : le mode et le rattachement ne peuvent plus se contredire.
-- Le cas NULL reste permis — c'est lui qui laisse vivre les biens en
-- prospection, qui n'ont pas encore de détention à déclarer.
--
-- ── POURQUOI ELLE A ATTENDU DEUX JOURS ─────────────────────────────────────
-- Au 12/08, DEUX chemins d'app.js écrivaient `sci_id` tout seul :
--   1. `saveBien()` — le formulaire porte « SCI associée » avec une option
--      « — Aucune SCI — ». La choisir sur un bien marqué 'sci' écrivait
--      `sci_id = null` en laissant le mode : L'ENREGISTREMENT ENTIER AURAIT
--      ÉCHOUÉ, faisant perdre toutes les autres modifications de la fiche.
--   2. `mfBilanFeedSaveBiens()` — décocher un bien dans « Alimenter le bilan
--      SCI » écrivait aussi `sci_id = null` seul.
-- Arbitrage retenu : mieux vaut une donnée temporairement incohérente qu'une
-- écriture qui échoue sur une plateforme en service.
--
-- Au 14/08, les TROIS chemins écrivent les deux champs dans le même `update` —
-- `saveBien()`, `bdSaveDetention()`, `mfBilanFeedSaveBiens()` — vérifié en
-- relisant chaque appel. L'invariant est devenu tenable.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.biens
  drop constraint if exists biens_mode_detention_coherent;
alter table public.biens
  add constraint biens_mode_detention_coherent
  check (
    mode_detention is null
    or (mode_detention = 'sci'    and sci_id is not null)
    or (mode_detention = 'propre' and sci_id is null)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠️ CE QUE LA PARTIE B N'A PAS RÉGLÉ — UN QUATRIÈME CHEMIN, EN BASE
--
-- `biens_sci_id_fkey` est déclarée ON DELETE SET NULL. Supprimer une SCI fait
-- donc écrire `biens.sci_id = null` PAR LA BASE, sans toucher au mode. Sur un
-- bien marqué 'sci', cela produit (mode='sci', sci_id=null) : l'invariant est
-- violé et LA SUPPRESSION DE LA SCI ÉCHOUE, avec un message Postgres brut.
--
-- Trois chemins d'app.js suppriment une SCI, aucun n'a de garde-fou :
--   · `deleteSCI()`          — bouton « Supprimer » de la fiche SCI
--   · `purgeAdminTestData()` — supprime les SCI dont le nom contient « TEST »
--   · `purgeAllAdminData()`  — purge totale de l'administration
--
-- Ce n'est PAS une régression introduite ici : avant la partie B, la même
-- suppression réussissait en silence et rendait les biens invisibles de la
-- déclaration (défaut n°5 de REVUE-2026-08-13.md). On remplace une corruption
-- silencieuse par un échec bruyant — c'est mieux, ce n'est pas l'arrivée.
--
-- → Correction attendue CÔTÉ CODE, pas ici : la suppression d'une SCI doit
--   décider explicitement du sort de ses biens avant de partir.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE
--
-- Annuler la PARTIE B seule : sans aucune perte, instantané. Une contrainte
-- CHECK ne stocke rien, elle vérifie. À utiliser si l'invariant bloque une
-- écriture légitime qu'on n'avait pas anticipée.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.biens drop constraint if exists biens_mode_detention_coherent;

-- ⚠️ Annuler la PARTIE A n'est PLUS anodin depuis le 13/08/2026 (v=60) :
-- `mode_detention` est désormais LUE ET ÉCRITE par app.js. Supprimer la
-- colonne casserait `bdEtapesGestion`, `bdSaveDetention`, `getFormData` et la
-- section Déclaration fiscale, et PERDRAIT la donnée saisie. Ne le faire que
-- pour un retour en arrière complet, code compris.
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
