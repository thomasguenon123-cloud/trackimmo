-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION — Préavis du locataire, et les comptes rendus qui vont avec
-- Stonefolio · étape 2 du PLAN-PREAVIS.md · écrite le 22/08/2026
--
-- À EXÉCUTER PAR THOMAS dans l'éditeur SQL Supabase.
-- Mon accès MCP est en LECTURE SEULE : toute migration DDL lui revient.
-- Je vérifie le résultat moi-même en lecture après chaque étape.
--
-- ── CE QU'ELLE FAIT ────────────────────────────────────────────────────────
-- PARTIE A  cinq colonnes sur `locataires` : le congé, sa durée, son motif,
--           la remise des clés et la conformité de l'état des lieux.
-- PARTIE B  la table `visites` accueille les états des lieux : deux types de
--           plus, un verdict de conformité, et sa colonne `locataire_id`
--           — présente depuis toujours, jamais utilisée — enfin indexée.
-- PARTIE C  les invariants croisés. ⚠️ VOLONTAIREMENT EN COMMENTAIRE : ils
--           s'appliqueront quand le workflow de congé écrira ces colonnes,
--           pas avant. Même discipline que la migration MODE-DETENTION, dont
--           la partie B a attendu que les trois chemins d'écriture soient
--           alignés.
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
  from pg_policies where schemaname = 'public' and tablename = 'visites';


-- ═══════════════════════════════════════════════════════════════════════════
-- RETOUR EN ARRIÈRE — si quelque chose se passe mal
-- Aucune donnée n'est détruite par ce retour : les colonnes ajoutées sont
-- vides, personne ne les écrit encore.
-- ⚠️ La contrainte de type doit être REMISE dans son état d'origine, sinon
-- `visites` accepterait des types que l'écran ne sait pas afficher.
-- ═══════════════════════════════════════════════════════════════════════════
-- alter table public.locataires
--   drop constraint if exists locataires_preavis_mois_valide,
--   drop constraint if exists locataires_preavis_motif_valide;
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
