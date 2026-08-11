-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Mode de détention d'un bien acquis
-- Stonefolio · règle arrêtée par Thomas le 12/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en lecture seule : toute migration DDL lui revient.
--
-- ── POURQUOI ───────────────────────────────────────────────────────────────
-- Aujourd'hui la seule information de détention est `biens.sci_id`, nullable.
-- `sci_id IS NULL` veut donc dire DEUX CHOSES OPPOSÉES :
--   · « ce bien est détenu en nom propre »  (une réponse)
--   · « on ne sait pas encore »             (une absence de réponse)
-- C'est la même confusion que celle qui avait rendu la vacance invisible dans
-- les consolidés : deux cas contraires sous une seule absence de valeur.
--
-- Conséquence visible avant correction : le module financier devait écrire
-- « T4+ Paris 16e n'est rattaché à aucune SCI », une phrase qui ne dit pas si
-- c'est un choix ou un oubli.
--
-- ── CE QUE LA MIGRATION FAIT, ET NE FAIT PAS ───────────────────────────────
-- Elle ajoute la colonne, pose l'invariant, et ne reprend QUE ce qui est
-- certain. Un bien rattaché à une SCI est en SCI — c'est déductible. Un bien
-- sans rattachement n'est PAS forcément en propre : il peut appartenir à une
-- SCI que vous n'avez pas encore créée dans Stonefolio. On laisse donc NULL
-- et c'est l'écran qui demande.
--
-- ⚠️ NE JAMAIS PRÉSUMER 'propre' PAR DÉFAUT : ce serait écrire une donnée à
-- portée fiscale en la devinant.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- 1 · La colonne. Nullable : l'existant ne peut pas toujours être tranché.
alter table public.biens
  add column if not exists mode_detention text;

-- 2 · Les deux seules valeurs admises.
alter table public.biens
  drop constraint if exists biens_mode_detention_valide;
alter table public.biens
  add constraint biens_mode_detention_valide
  check (mode_detention is null or mode_detention in ('propre', 'sci'));

-- 3 · L'INVARIANT : le mode et le rattachement ne peuvent plus se contredire.
--     Sans lui, on pourrait écrire mode='propre' sur un bien rattaché à une
--     SCI, et les deux sources diraient le contraire l'une de l'autre —
--     exactement ce que la règle vient supprimer.
--
--     ⚠️ Conséquence côté application, à connaître : détacher une SCI et
--     changer le mode doivent se faire DANS LE MÊME UPDATE, sinon la
--     contrainte rejette l'écriture intermédiaire.
alter table public.biens
  drop constraint if exists biens_mode_detention_coherent;
alter table public.biens
  add constraint biens_mode_detention_coherent
  check (
    mode_detention is null
    or (mode_detention = 'sci'    and sci_id is not null)
    or (mode_detention = 'propre' and sci_id is null)
  );

-- 4 · Reprise de l'existant : uniquement le cas certain.
update public.biens
   set mode_detention = 'sci'
 where sci_id is not null
   and mode_detention is null;

commit;

-- ── CONTRÔLE APRÈS EXÉCUTION ───────────────────────────────────────────────
-- Attendu au 12/08/2026 sur la base de Thomas :
--   'sci'  → 2  (Immeuble Paris 18e, T3 Lyon)
--   NULL   → 1  (T4+ Paris 16e, statut « Acheté »)   ← à renseigner dans l'app
-- Les biens en prospection restent NULL : ils n'ont pas encore de détention.
select coalesce(mode_detention, '(à renseigner)') as mode,
       count(*) filter (where statut = 'Acheté')  as biens_acquis,
       count(*)                                   as total
  from public.biens
 group by 1
 order by 1;

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
-- · ⚠️ `creation_sci` a une VALEUR PAR DÉFAUT DE 200 € en base, posée sur tous
--   les biens. T4+ Paris 16e porte donc 200 € de frais de création d'une SCI à
--   laquelle il n'appartient pas, et ce montant entre dans `emprunt` à cinq
--   endroits du code — donc dans son coût d'acquisition (952 200 € au lieu de
--   952 000 €) et dans tout ce qui en dérive. Une fois le mode explicite, ce
--   champ n'a de sens que pour mode_detention = 'sci'.
-- ═══════════════════════════════════════════════════════════════════════════
