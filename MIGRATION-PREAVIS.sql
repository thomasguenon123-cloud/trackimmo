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
-- ✅ PARTIE C APPLIQUÉE par Thomas le 05/09/2026, vérifiée en lecture le jour
--    même : les 6 invariants posés et `convalidated = true` — Postgres a
--    réellement scanné les lignes existantes —, définitions conformes au mot
--    près, contraintes A/B/D toujours en place (4), RLS intacte (4 + 4),
--    index présent, données inchangées : 2 locataires, 3 comptes rendus dont
--    le premier état des lieux de sortie, 28 lignes de loyer.
--
-- PARTIE C  les invariants croisés — DÉCOMMENTÉE LE 05/09/2026, quand la
--           fiche locataire a cessé de pouvoir défaire ce que les workflows
--           posent (`sfInvariantsBail`, v=81). Elle est restée en commentaire
--           deux semaines : même discipline que la migration MODE-DETENTION,
--           dont la partie B a attendu que les chemins d'écriture soient
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
-- CONTRÔLE DES INVARIANTS — À JOUER AVANT LA PARTIE C, QUI SUIT (lecture seule).
-- Chaque ligne DOIT rendre 0. Une seule violation, et l'`alter` correspondant
-- échouera : corrige la donnée d'abord, ne désactive pas la contrainte.
-- ═══════════════════════════════════════════════════════════════════════════
select '1. motif => preavis 1 mois' as invariant, count(*) as violations
  from public.locataires where not (preavis_motif is null or preavis_mois = 1)
union all
select '2. conge => date de sortie', count(*)
  from public.locataires where not (date_conge_recu is null or date_sortie is not null)
union all
select '3. cles apres entree', count(*)
  from public.locataires where not (date_remise_cles is null or date_entree is null
                                    or date_remise_cles >= date_entree)
union all
select '3bis. retenue <= depot', count(*)
  from public.locataires where not (depot_retenue is null
                                    or depot_retenue <= coalesce(depot_garantie, 0))
union all
select '4a. edl => locataire', count(*)
  from public.visites where not (type_visite not in ('edl_entree','edl_sortie')
                                 or locataire_id is not null)
union all
select '4b. conforme => edl_sortie', count(*)
  from public.visites where not (conforme is null or type_visite = 'edl_sortie');


-- ═══════════════════════════════════════════════════════════════════════════
-- PARTIE C — LES INVARIANTS CROISÉS  (applicable depuis le 05/09/2026)
--
-- Ce qu'ils interdisent tient en trois phrases : un motif ne se justifie que
-- sur un préavis réduit, un congé reçu a une fin, et on ne rend pas les clés
-- avant d'être entré. Plus deux sur les comptes rendus, et la retenue bornée
-- au dépôt versé.
--
-- ── POURQUOI ILS ONT ATTENDU, ET POURQUOI C'EST FINI ──────────────────────
-- La leçon de MIGRATION-MODE-DETENTION : un invariant posé avant que le code
-- ne sache le respecter transforme chaque enregistrement en erreur. Celui-là
-- a attendu deux semaines, le temps que les workflows de congé, de sortie et
-- de dépôt existent ET que la FICHE cesse de pouvoir les défaire.
--
-- Les trois workflows tenaient déjà leurs règles chacun de son côté :
--   * `sfCongeConfirmer` écrit `date_sortie` DANS LE MÊME patch que le congé,
--     refuse une sortie antérieure à l'entrée, et `sfCongeSetMois` efface le
--     motif dès qu'on repasse à trois mois ;
--   * `sfSortieConfirmer` refuse des clés rendues avant l'entrée ;
--   * `sfDepotConfirmer` borne la retenue au dépôt par un `Math.min` ;
--   * `saveVisite` refuse un état des lieux sans locataire et n'écrit
--     `conforme` que sur une sortie.
--
-- ⚠️ LE TROU ÉTAIT LA FICHE LOCATAIRE. `saveLocataire` réécrit tout le bail
-- d'un bloc — `date_sortie`, `date_entree`, `depot_garantie` compris — sans
-- lire ce que ces workflows ont posé. Trois gestes ordinaires suffisaient à
-- casser un invariant : vider la date de sortie d'un locataire sorti, reculer
-- son entrée après la remise des clés, ramener à zéro un dépôt dont une part
-- a été retenue. `sfInvariantsBail` (app.js, v=81) ferme ce trou et refuse
-- AVANT la base, en français, en désignant le champ.
--
-- ⚠️ 3 BIS EST POSÉE, contrairement à ce qu'annonçait la partie D. Sa réserve
-- — « à poser le jour où `saveLocataire` cesse de réécrire `depot_garantie`
-- sans le lire » — visait le symptôme. Il le réécrit toujours ; ce qui a
-- changé, c'est qu'il ne peut plus le faire DESCENDRE SOUS LA RETENUE.
-- L'invariant est tenu, par un autre chemin que celui prévu.
--
-- ── VÉRIFIÉ EN LECTURE LE 05/09/2026, AVANT ÉCRITURE ──────────────────────
-- Les six invariants comptent ZÉRO violation sur les données existantes
-- (2 locataires, 2 comptes rendus). Aucun `ALTER` ci-dessous ne peut donc
-- échouer sur l'existant. Relance la requête de contrôle en fin de fichier
-- pour t'en assurer toi-même avant de jouer ce bloc.
--
-- Idempotent comme le reste : `drop ... if exists` avant chaque `add`.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Un MOTIF n'existe que sur un préavis RÉDUIT. Trois mois de préavis avec
--    « mutation professionnelle » en face est une contradiction : le motif
--    sert précisément à justifier le raccourcissement.
alter table public.locataires
  drop constraint if exists locataires_preavis_motif_coherent;
alter table public.locataires
  add constraint locataires_preavis_motif_coherent
  check (preavis_motif is null or preavis_mois = 1);

-- 2. Un CONGÉ REÇU implique une FIN DE PRÉAVIS. C'est la donnée incomplète et
--    silencieuse que le cadrage refusait : un congé sans date de sortie ne
--    déclenche rien, ni échéance de départ, ni prorata du dernier mois.
alter table public.locataires
  drop constraint if exists locataires_conge_a_une_fin;
alter table public.locataires
  add constraint locataires_conge_a_une_fin
  check (date_conge_recu is null or date_sortie is not null);

-- 3. On ne rend pas les clés avant d'être entré. Une remise ANTÉRIEURE À LA
--    FIN DU BAIL est licite — c'est même le cas courant d'un départ anticipé ;
--    antérieure à l'ENTRÉE, non.
alter table public.locataires
  drop constraint if exists locataires_remise_cles_apres_entree;
alter table public.locataires
  add constraint locataires_remise_cles_apres_entree
  check (date_remise_cles is null or date_entree is null
         or date_remise_cles >= date_entree);

-- 3 bis. Une retenue ne peut pas dépasser le dépôt versé.
alter table public.locataires
  drop constraint if exists locataires_retenue_sous_le_depot;
alter table public.locataires
  add constraint locataires_retenue_sous_le_depot
  check (depot_retenue is null or depot_retenue <= coalesce(depot_garantie, 0));

-- 4. Un état des lieux porte sur QUELQU'UN, et le verdict de conformité n'a
--    de sens que sur une SORTIE.
alter table public.visites
  drop constraint if exists visites_edl_a_un_locataire;
alter table public.visites
  add constraint visites_edl_a_un_locataire
  check (type_visite not in ('edl_entree','edl_sortie') or locataire_id is not null);

alter table public.visites
  drop constraint if exists visites_conforme_sur_sortie;
alter table public.visites
  add constraint visites_conforme_sur_sortie
  check (conforme is null or type_visite = 'edl_sortie');


-- ═══════════════════════════════════════════════════════════════════════════
-- VÉRIFICATION — à exécuter APRÈS les parties A, B, D et C (lecture seule)
-- Attendu : 5 colonnes de préavis + 1 colonne `conforme`, les contraintes
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
  from pg_constraint where conname = 'locataires_depot_retenue_valide'
union all
select 'invariants croises (C)', count(*), 6
  from pg_constraint
 where conname in ('locataires_preavis_motif_coherent',
                   'locataires_conge_a_une_fin',
                   'locataires_remise_cles_apres_entree',
                   'locataires_retenue_sous_le_depot',
                   'visites_edl_a_un_locataire',
                   'visites_conforme_sur_sortie')
   and convalidated;
-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE — si quelque chose se passe mal
--
-- ⚠️ CE RETOUR DÉTRUIT DES DONNÉES, ET CE N'EST PLUS THÉORIQUE. La phrase qui
-- figurait ici — « aucune donnée n'est détruite, les colonnes sont vides » —
-- était vraie le 22/08/2026 et ne l'est plus : au 05/09, un bail porte sa date
-- de congé, sa durée de préavis, sa remise des clés et son verdict d'état des
-- lieux. `drop column` emporte tout cela sans retour. Sauvegarde d'abord.
--
-- ⚠️ La contrainte de type doit être REMISE dans son état d'origine, sinon
-- `visites` accepterait des types que l'écran ne sait pas afficher.
--
-- ⚠️ Les invariants de la partie C sont retirés EN PREMIER et explicitement.
-- Cinq d'entre eux disparaîtraient d'eux-mêmes avec leur colonne, mais pas
-- `visites_edl_a_un_locataire` : il ne porte que sur `type_visite` et
-- `locataire_id`, qui survivent tous deux au retour. Il resterait en place,
-- orphelin, à refuser des lignes pour une règle que plus rien n'explique.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.locataires
--   drop constraint if exists locataires_preavis_motif_coherent,
--   drop constraint if exists locataires_conge_a_une_fin,
--   drop constraint if exists locataires_remise_cles_apres_entree,
--   drop constraint if exists locataires_retenue_sous_le_depot;
-- alter table public.visites
--   drop constraint if exists visites_edl_a_un_locataire,
--   drop constraint if exists visites_conforme_sur_sortie;
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
