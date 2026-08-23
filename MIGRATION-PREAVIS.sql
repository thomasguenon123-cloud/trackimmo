-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Préavis du locataire, et les comptes rendus qui vont avec
-- Stonefolio · étape 2 du PLAN-PREAVIS.md · écrite le 22/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en LECTURE SEULE : toute migration DDL lui revient.
-- Je vérifie le résultat moi-même en lecture après chaque étape.
--
-- ✅ PARTIES A ET B APPLIQUÉES par Thomas le 22/08/2026, vérifiées en lecture
--    le jour même — pas sur parole :
--      · 5 colonnes de préavis, aux bons types (date · smallint · text ·
--        date · boolean), toutes nullables, 0 ligne renseignée ;
--      · colonne `conforme` présente, 0 ligne renseignée ;
--      · 3 contraintes posées et `convalidated = true` — Postgres a
--        réellement contrôlé les lignes existantes, pas seulement les futures ;
--      · index partiel `idx_visites_locataire` créé ;
--      · RLS INTACTE : 4 + 4 policies, comme avant ;
--      · données inchangées : 2 locataires (1 en préavis), 2 comptes rendus
--        de type « achat », 31 lignes de loyers.
--
-- ✅ PARTIE D APPLIQUÉE par Thomas le 23/08/2026, vérifiée en lecture le jour
--    même : 2 colonnes aux bons types (date · numeric), toutes deux nullables,
--    contrainte `locataires_depot_retenue_valide` posée, commentaires en place,
--    RLS intacte (4 policies), 0 ligne renseignée.
--
-- ⏳ RESTE LES COMMENTAIRES DE COLONNES (bloc facultatif en fin de partie A) :
--    ils n'étaient pas dans les blocs transmis le 22/08 — mon oubli. Ils ne
--    changent aucun comportement, mais ils font apparaître dans l'éditeur
--    Supabase QUELLE date est quoi, ce qui est exactement la confusion qui a
--    motivé cette migration.
--
-- ── CE QU'ELLE FAIT ────────────────────────────────────────────────────────
-- PARTIE A  cinq colonnes sur `locataires` : le congé, sa durée, son motif,
--           la remise des clés et la conformité de l'état des lieux.
-- PARTIE B  la table `visites` accueille les états des lieux : deux types de
--           plus, un verdict de conformité, et sa colonne `locataire_id`
--           — présente depuis toujours, jamais utilisée — enfin indexée.
-- PARTIE D  le suivi de la RESTITUTION du dépôt — ajoutée le 23/08/2026 avec
--           la liste « Baux qui se terminent », qui ne se viderait jamais sans
--           elle. Additive comme A et B.
-- PARTIE C  les invariants croisés. ⚠️ VOLONTAIREMENT EN COMMENTAIRE : ils
--           s'appliqueront quand le workflow de congé écrira ces colonnes,
--           pas avant. Même discipline que la migration MODE-DETENTION, dont
--           la partie B a attendu que les trois chemins d'écriture soient
--           alignés. Elle vient APRÈS D dans le fichier : ce qui s'exécute
--           d'abord se lit d'abord.
--
-- ── CE QU'ELLE NE FAIT PAS, ET C'EST UN CHOIX ──────────────────────────────
-- ⚠️ ELLE NE RENOMME PAS `visites` EN `comptes_rendus`. L'arbitrage du
-- 22/08 était de le faire ; le séquencement l'a déplacé, pas annulé.
-- Un renommage de table est un changement CASSANT : huit appels `db.from(
-- 'visites')` vivent dans app.js, et la plateforme déployée s'arrêterait de
-- lire ses comptes rendus entre l'exécution du SQL et le déploiement du code.
-- Or ce renommage n'apporte RIEN au workflow de préavis : il est cosmétique.
-- Il partira donc avec la migration de l'écran à la charte Stonefolio, qui
-- réécrit ces appels de toute façon. Une seule ouverture au lieu de deux.
--
-- Elle ne devine aucune valeur : toutes les colonnes naissent à NULL, et
-- c'est l'écran qui demandera. On n'écrit pas une date de congé en la
-- déduisant d'un statut.
--
-- Toutes les instructions sont IDEMPOTENTES : les relancer ne casse rien.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- ÉTAPE 0 — PHOTO AVANT (lecture seule, ne modifie rien)
-- Noter le résultat pour le comparer à la vérification finale.
-- Attendu au 22/08/2026 : 2 locataires (1 actif, 1 en préavis), 2 comptes
-- rendus tous deux de type « achat », 0 rattaché à un locataire.
-- ═══════════════════════════════════════════════════════════════════════════
select (select count(*) from public.locataires)                                as locataires,
       (select count(*) from public.locataires where statut = 'Préavis')       as en_preavis,
       (select count(*) from public.visites)                                   as comptes_rendus,
       (select count(*) from public.visites where locataire_id is not null)    as cr_rattaches,
       (select string_agg(distinct type_visite, ', ') from public.visites)     as types_presents;


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE A — LE CONGÉ DU LOCATAIRE
--
-- Pourquoi c'est sans risque : aucune ligne de code d'app.js ne lit ni
-- n'écrit ces cinq colonnes aujourd'hui. Elles naissent NULL sur les deux
-- locataires existants, et rien ne change à l'écran.
--
-- ⚠️ `date_sortie` N'EST PAS TOUCHÉE et reste la FIN DU PRÉAVIS : c'est elle
-- qui arrête les loyers et fait partir le délai de restitution du dépôt. Le
-- congé ajoute son POINT DE DÉPART (`date_conge_recu`), pas un doublon.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.locataires
  add column if not exists date_conge_recu     date,
  add column if not exists preavis_mois        smallint,
  add column if not exists preavis_motif       text,
  add column if not exists date_remise_cles    date,
  add column if not exists edl_sortie_conforme boolean;

comment on column public.locataires.date_conge_recu is
  'Date de RÉCEPTION du congé — le point de départ légal du préavis. La fin du préavis reste date_sortie.';
comment on column public.locataires.preavis_mois is
  'Durée appliquée le jour du congé : 1 ou 3 mois. FIGÉE — la loi évolue, l''historique non.';
comment on column public.locataires.preavis_motif is
  'Motif du préavis réduit à un mois, choisi par le bailleur. NULL = préavis plein. Jamais déduit : la zone tendue est fixée par décret et évolue.';
comment on column public.locataires.date_remise_cles is
  'Remise des clés — c''est elle, et non la fin de bail, qui fait courir le délai de restitution du dépôt.';
comment on column public.locataires.edl_sortie_conforme is
  'État des lieux de sortie conforme à celui d''entrée : 1 mois pour restituer le dépôt, 2 mois sinon. NULL = pas encore constaté.';

-- Contraintes de VALEUR — elles ne portent que sur une colonne à la fois,
-- donc aucune ligne existante ne peut les violer (tout est NULL).
-- ⚠️ 1 ou 3 mois : le périmètre est le congé du LOCATAIRE. Le congé du
-- BAILLEUR (6 mois en bail vide, 3 en meublé) est un second workflow ; s'il
-- arrive un jour, il élargira cette contrainte.
alter table public.locataires
  drop constraint if exists locataires_preavis_mois_valide;
alter table public.locataires
  add constraint locataires_preavis_mois_valide
  check (preavis_mois is null or preavis_mois in (1, 3));

-- Les huit cas de préavis réduit de la loi du 6 juillet 1989, tels que
-- listés dans CADRAGE-PREAVIS.md. Une liste fermée en base empêche les
-- variantes d'orthographe de se glisser dans un champ qui sera lu.
alter table public.locataires
  drop constraint if exists locataires_preavis_motif_valide;
alter table public.locataires
  add constraint locataires_preavis_motif_valide
  check (preavis_motif is null or preavis_motif in (
    'Zone tendue',
    'Logement social',
    'RSA ou AAH',
    'État de santé',
    'Violences conjugales',
    'Premier emploi',
    'Mutation professionnelle',
    'Perte d''emploi'
  ));


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE B — LES COMPTES RENDUS ACCUEILLENT LES ÉTATS DES LIEUX
--
-- Pourquoi élargir plutôt que créer une table : `visites` porte déjà tout ce
-- qu'un état des lieux demande — une date, un bien, des notes, des photos sur
-- Storage — et même un `locataire_id` avec sa clé étrangère, présent depuis
-- l'origine et jamais utilisé par le code. Voir NOTE-COMPTES-RENDUS.md.
--
-- ⚠️ La contrainte de type est REMPLACÉE, pas ajoutée : Postgres n'a pas
-- d'« alter check ». Les deux lignes existantes sont de type « achat », donc
-- la nouvelle contrainte les accepte — c'est un élargissement, jamais un
-- rétrécissement. Vérifié avant écriture par l'étape 0.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.visites
  drop constraint if exists visites_type_visite_check;
alter table public.visites
  add constraint visites_type_visite_check
  check (type_visite in ('achat', 'locataire', 'edl_entree', 'edl_sortie'));

alter table public.visites
  add column if not exists conforme boolean;

comment on column public.visites.conforme is
  'États des lieux de SORTIE uniquement : le constat est-il conforme à celui d''entrée ? NULL sur les autres types, et tant que rien n''est constaté.';
comment on column public.visites.locataire_id is
  'Le locataire concerné. Obligatoire pour un état des lieux, facultatif ailleurs.';

-- Postgres n'indexe PAS les clés étrangères de lui-même. Tant que la table
-- pèse deux lignes cela ne change rien ; le jour où l'on cherchera « les
-- constats de ce locataire », l'index sera déjà là.
create index if not exists idx_visites_locataire
  on public.visites (locataire_id)
  where locataire_id is not null;


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE D — LA RESTITUTION DU DÉPÔT (ajoutée le 23/08/2026, étape 5)
--
-- Pourquoi elle n'était pas dans les parties A et B : tant qu'aucun écran ne
-- listait « ce qui reste à faire », suivre la restitution n'apportait rien —
-- l'arbitrage du 22/08 était explicite, « v1 : l'échéance seulement ».
--
-- La box « Baux qui se terminent » change la donne : sans marqueur de
-- restitution, un dépôt déjà rendu y resterait « à rendre » POUR TOUJOURS, et
-- une liste qui ne se vide jamais cesse d'être lue. C'est tout ce que
-- `depot_restitue_le` sert à dire.
--
-- `depot_retenue` accompagne : le bailleur garde parfois une part du dépôt
-- pour des dégradations. Sans elle, on saurait que le dépôt est rendu, mais
-- pas combien — et le montant réellement restitué serait perdu.
--
-- ⚠️ SANS CETTE PARTIE, le bouton « Dépôt restitué » de la box se refuse et le
-- dit : le code détecte l'absence de la colonne au lieu de laisser Postgres
-- répondre « column does not exist ». Rien d'autre ne dépend d'elle.
-- ═══════════════════════════════════════════════════════════════════════════
alter table public.locataires
  add column if not exists depot_restitue_le date,
  add column if not exists depot_retenue     numeric(10,2);

comment on column public.locataires.depot_restitue_le is
  'Date à laquelle le dépôt de garantie a été rendu. NULL = pas encore restitué — c''est ce qui maintient le bail dans « Baux qui se terminent ».';
comment on column public.locataires.depot_retenue is
  'Part du dépôt conservée pour dégradations. Une retenue se justifie par l''état des lieux de sortie : sans constat contradictoire, elle n''est pas opposable.';

-- Une retenue ne peut pas être négative.
-- ⚠️ ET PAS « ni supérieure au dépôt versé », alors que ce serait vrai : une
-- contrainte CROISÉE est revérifiée à CHAQUE mise à jour de la ligne. Or
-- `saveLocataire` réécrit `depot_garantie` à chaque enregistrement de la fiche
-- — vider ce champ après une retenue ferait échouer une modification sans
-- rapport, avec un message Postgres brut. La règle est tenue par l'écran, qui
-- borne la retenue au dépôt ; elle rejoint les invariants croisés de la
-- partie C, à poser quand tous les chemins d'écriture s'y conforment.
alter table public.locataires
  drop constraint if exists locataires_depot_retenue_valide;
alter table public.locataires
  add constraint locataires_depot_retenue_valide
  check (depot_retenue is null or depot_retenue >= 0);


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE C — LES INVARIANTS CROISÉS
--
-- ⚠️ NE PAS EXÉCUTER MAINTENANT. Ils sont écrits ici pour ne pas être
-- oubliés, et resteront en commentaire tant que le workflow de congé
-- (étape 3) et l'acte de sortie (étape 4) n'écrivent pas ces colonnes.
--
-- La leçon de MIGRATION-MODE-DETENTION : un invariant posé avant que le code
-- ne sache le respecter transforme chaque enregistrement en erreur. Celui-là
-- a attendu deux jours et c'était la bonne décision.
--
-- 1. Un MOTIF n'existe que sur un préavis RÉDUIT. Trois mois de préavis avec
--    « mutation professionnelle » en face est une contradiction : le motif
--    sert précisément à justifier le raccourcissement.
--
-- alter table public.locataires
--   add constraint locataires_preavis_motif_coherent
--   check (preavis_motif is null or preavis_mois = 1);
--
-- 2. Un CONGÉ REÇU implique une FIN DE PRÉAVIS. C'est la donnée incomplète et
--    silencieuse que le cadrage refusait : un congé sans date de sortie ne
--    déclenche rien, ni échéance de départ, ni prorata du dernier mois.
--
-- alter table public.locataires
--   add constraint locataires_conge_a_une_fin
--   check (date_conge_recu is null or date_sortie is not null);
--
-- 3. On ne rend pas les clés avant d'être parti. Une remise antérieure à la
--    fin du bail est possible en droit, mais pas ANTÉRIEURE À L'ENTRÉE.
--
-- alter table public.locataires
--   add constraint locataires_remise_cles_apres_entree
--   check (date_remise_cles is null or date_entree is null
--          or date_remise_cles >= date_entree);
--
-- 3 bis. Une retenue ne peut pas dépasser le dépôt versé. Croisée, donc
--    revérifiée à chaque mise à jour de la ligne : à ne poser que le jour où
--    `saveLocataire` cesse de réécrire `depot_garantie` sans le lire.
--
-- alter table public.locataires
--   add constraint locataires_retenue_sous_le_depot
--   check (depot_retenue is null or depot_retenue <= coalesce(depot_garantie, 0));
--
-- 4. Un état des lieux porte sur QUELQU'UN, et le verdict de conformité n'a
--    de sens que sur une SORTIE.
--
-- alter table public.visites
--   add constraint visites_edl_a_un_locataire
--   check (type_visite not in ('edl_entree','edl_sortie') or locataire_id is not null);
-- alter table public.visites
--   add constraint visites_conforme_sur_sortie
--   check (conforme is null or type_visite = 'edl_sortie');


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — à exécuter APRÈS les parties A et B (lecture seule)
-- Attendu : 5 colonnes de préavis + 1 colonne `conforme`, 4 contraintes
-- nommées, l'index, et les 4 + 4 policies RLS INTACTES.
-- ═══════════════════════════════════════════════════════════════════════════
select 'colonnes preavis' as controle, count(*) as trouve, 5 as attendu
  from information_schema.columns
 where table_schema = 'public' and table_name = 'locataires'
   and column_name in ('date_conge_recu','preavis_mois','preavis_motif',
                       'date_remise_cles','edl_sortie_conforme')
union all
select 'colonne conforme', count(*), 1
  from information_schema.columns
 where table_schema = 'public' and table_name = 'visites' and column_name = 'conforme'
union all
select 'contraintes posees', count(*), 3
  from pg_constraint
 where conname in ('locataires_preavis_mois_valide','locataires_preavis_motif_valide',
                   'visites_type_visite_check')
union all
select 'index locataire_id', count(*), 1
  from pg_indexes
 where schemaname = 'public' and indexname = 'idx_visites_locataire'
union all
select 'policies RLS locataires', count(*), 4
  from pg_policies where schemaname = 'public' and tablename = 'locataires'
union all
select 'policies RLS visites', count(*), 4
  from pg_policies where schemaname = 'public' and tablename = 'visites'
union all
select 'colonnes restitution', count(*), 2
  from information_schema.columns
 where table_schema = 'public' and table_name = 'locataires'
   and column_name in ('depot_restitue_le','depot_retenue')
union all
select 'contrainte retenue', count(*), 1
  from pg_constraint where conname = 'locataires_depot_retenue_valide';


-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE — si quelque chose se passe mal
-- Aucune donnée n'est détruite par ce retour : les colonnes ajoutées sont
-- vides, personne ne les écrit encore.
-- ⚠️ La contrainte de type doit être REMISE dans son état d'origine, sinon
-- `visites` accepterait des types que l'écran ne sait pas afficher.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.locataires
--   drop constraint if exists locataires_preavis_mois_valide,
--   drop constraint if exists locataires_preavis_motif_valide,
--   drop constraint if exists locataires_depot_retenue_valide;
-- alter table public.locataires
--   drop column if exists depot_restitue_le,
--   drop column if exists depot_retenue;
-- alter table public.locataires
--   drop column if exists date_conge_recu,
--   drop column if exists preavis_mois,
--   drop column if exists preavis_motif,
--   drop column if exists date_remise_cles,
--   drop column if exists edl_sortie_conforme;
-- drop index if exists public.idx_visites_locataire;
-- alter table public.visites drop column if exists conforme;
-- alter table public.visites drop constraint if exists visites_type_visite_check;
-- alter table public.visites add constraint visites_type_visite_check
--   check (type_visite in ('achat', 'locataire'));
