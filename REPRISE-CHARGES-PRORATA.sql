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
-- 3. GUENON — ARBITRE LE 30/08/2026 : RIEN A FAIRE
-- ---------------------------------------------------------------------
-- Le bloc 3.b qui figurait ici (passage en « Sorti », prorata d'aout,
-- suppression de quatre lignes) A ETE SUPPRIME SANS ETRE JOUE : Thomas a
-- repousse la sortie au 22/10/2028 pour garder un locataire actif en
-- reserve de test, ce qui inverse exactement ses trois effets.
--
-- Verifie en lecture apres son changement :
--   * statut « Actif », date_sortie 2028-10-22, aucun conge -> coherent
--   * aout 2026 est redevenu un mois PLEIN : 3000 + 500 EUR sont justes
--   * sept. a dec. 2026 sont dans le bail : les quatre lignes sont dues
--   * plus aucune ligne partielle sur ce bail
--
-- ⚠️ Une date de sortie a 2028 n'est PAS neutre, elle est seulement
-- lointaine. `mfDaysOccupiedInMonth` la lit comme une fin d'occupation :
-- en octobre 2028 le mois sera proratise a 22/31, et a partir de novembre
-- 2028 `sfBailCouvre` ecartera tout loyer. Sans conge, c'est faux — voir
-- le chantier « tacite reconduction » au PLAN §5 bis. Rien a corriger
-- aujourd'hui : l'echeance est a plus de deux ans.
