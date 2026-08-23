-- =====================================================================
-- REPRISE DES CHARGES SUR MOIS PARTIEL  (suite au correctif v=80)
-- =====================================================================
-- Le correctif v=80 fait suivre aux charges le prorata du loyer. Il agit
-- sur les lignes CREEES A PARTIR DE MAINTENANT. Les lignes deja en base
-- gardent leurs charges pleines : ce fichier les reprend.
--
-- Regle qui n'a pas bouge depuis le debut : UNE LIGNE ENCAISSEE N'EST
-- JAMAIS RETOUCHEE. Un mois paye est un fait comptable, pas un calcul.
--
-- A executer dans l'editeur SQL Supabase, bloc par bloc, apres lecture.
-- Rien ici n'est obligatoire : c'est un constat + le SQL correspondant.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. CONSTAT — a relancer avant et apres, pour comparer
-- ---------------------------------------------------------------------
WITH occ AS (
  SELECT lm.id, lm.mois, lm.annee, lm.statut, lm.loyer_du, lm.charges_dues,
         lm.montant_encaisse, l.nom, l.prenom, l.charges_bail, l.loyer_bail_hc,
         GREATEST(make_date(lm.annee, lm.mois, 1),
                  COALESCE(l.date_entree, make_date(lm.annee, lm.mois, 1)))     AS deb,
         LEAST((make_date(lm.annee, lm.mois, 1) + interval '1 month - 1 day')::date,
               COALESCE(l.date_sortie,
                        (make_date(lm.annee, lm.mois, 1) + interval '1 month - 1 day')::date)) AS fin,
         EXTRACT(DAY FROM (make_date(lm.annee, lm.mois, 1) + interval '1 month - 1 day'))::int AS jours_mois
  FROM loyers_mensuels lm
  JOIN locataires l ON l.id = lm.locataire_id
)
SELECT nom, prenom, mois, annee, statut,
       GREATEST(fin - deb + 1, 0) AS jours_occupes, jours_mois,
       loyer_du,
       ROUND(loyer_bail_hc * GREATEST(fin - deb + 1, 0) / jours_mois::numeric) AS loyer_attendu,
       charges_dues,
       ROUND(charges_bail  * GREATEST(fin - deb + 1, 0) / jours_mois::numeric) AS charges_attendues,
       montant_encaisse, id
FROM occ
WHERE (fin - deb + 1) < jours_mois
ORDER BY annee, mois;


-- ---------------------------------------------------------------------
-- 1. TEST V1 — septembre 2026, mois de sortie (23/30 jours)
-- ---------------------------------------------------------------------
-- Loyer deja proratise (636 EUR), charges restees pleines (490 EUR).
-- 490 -> 376 EUR. Ligne « En attente », rien d'encaisse : reprise sure.
UPDATE loyers_mensuels
   SET charges_dues = 376
 WHERE id = 'a459f131-2963-41a7-9a95-b8197f4fe56a'
   AND statut <> 'Payé'          -- garde-fou : ne touche pas un mois paye
   AND montant_encaisse = 0;


-- ---------------------------------------------------------------------
-- 2. TEST V1 — juin 2025, mois d'entree (20/30 jours)  ->  NE PAS TOUCHER
-- ---------------------------------------------------------------------
-- Loyer 553 EUR (deja proratise), charges 490 EUR au lieu de 327 EUR.
-- Ligne « Payé », 553 EUR encaisses. On n'y touche pas.
--
-- A noter : les 553 EUR encaisses soldent le LOYER seul — l'application
-- ne suit pas l'encaissement des charges (chantier ouvert, cf. PLAN §5 bis).
-- Donc si 490 EUR de provisions ont reellement ete encaisses en juin 2025,
-- 163 EUR sont dus au locataire. Cela se solde a la REGULARISATION annuelle
-- des charges, pas en reecrivant une ligne payee.


-- ---------------------------------------------------------------------
-- 3. GUENON — donnees contradictoires, A ARBITRER AVANT TOUT UPDATE
-- ---------------------------------------------------------------------
-- statut = 'Actif' MAIS date_sortie = 2026-08-22 (hier).
-- Les deux ne peuvent pas etre vrais. Consequences en base :
--   * aout 2026 : loyer 3000 EUR et charges 500 EUR PLEINS sur 22/31 jours
--   * sept., oct., nov., dec. 2026 : quatre lignes de 3000 + 500 EUR
--     ENTIEREMENT posterieures au 22/08 — 0 jour occupe.
-- L'application les neutralise deja a l'affichage (sfBailCouvre), donc
-- elles ne faussent aucun indicateur. Elles restent fausses en base.
--
-- Choisis UN des deux blocs. Ne joue pas les deux.

-- --- 3.a  Il reste en place : la date de sortie est une scorie de test ---
-- UPDATE locataires
--    SET date_sortie = NULL
--  WHERE id = (SELECT id FROM locataires WHERE nom = 'Guénon' AND prenom = 'Thomas');
-- -> aout 2026 redevient un mois plein : 3000 + 500 EUR sont alors JUSTES,
--    et les lignes sept.-dec. redeviennent legitimes. Aucun autre UPDATE.

-- --- 3.b  Il est bien parti le 22/08/2026 -------------------------------
-- UPDATE locataires
--    SET statut = 'Sorti'
--  WHERE id = (SELECT id FROM locataires WHERE nom = 'Guénon' AND prenom = 'Thomas');
--
-- -- aout 2026 : mois de sortie, 22/31 jours
-- UPDATE loyers_mensuels
--    SET loyer_du = 2129, charges_dues = 355
--  WHERE id = 'a2af2f91-8341-4372-a1b3-2e5d34203cb5'
--    AND statut <> 'Payé' AND montant_encaisse = 0;
--
-- -- sept. a dec. 2026 : quatre mois hors bail, aucun encaissement
-- DELETE FROM loyers_mensuels
--  WHERE id IN ('f265ddc0-d99f-4bf4-af76-5a8f6bb1b7f9',   -- 09/2026
--               'a8ec3255-104c-4b57-b9b4-9ca4ca2684cb',   -- 10/2026
--               '8067c44d-7540-4e66-ac3a-2e842f2563d4',   -- 11/2026
--               'b09cc679-0604-49fc-a32c-500feba0bf64')   -- 12/2026
--    AND statut <> 'Payé' AND montant_encaisse = 0;
