-- ════════════════════════════════════════════════════════════════════════════
--  ENCAISSEMENT DES CHARGES — une colonne, et le geste le plus fréquent
--  de la plateforme cesse d'être impossible.
--
--  À jouer dans Supabase > SQL Editor, bloc par bloc, dans l'ordre.
--  27/09/2026
-- ════════════════════════════════════════════════════════════════════════════
--
--  LE DÉFAUT QU'ELLE CORRIGE
--  ─────────────────────────
--  Un locataire vire UN SEUL montant : loyer + provisions pour charges.
--  700 € de loyer, 150 € de charges, 850 € reçus. Aujourd'hui :
--    · saisir 850 en « Partiel »     → REFUSÉ, parce que 850 >= 700
--    · cliquer « Payé intégralement » → la base enregistre 700
--  Aucun chemin ne permet d'enregistrer 850.
--
--  Mesuré le 27/09 : les 17 lignes « Payé » de la base ont un
--  `montant_encaisse` égal AU CENTIME au `loyer_du` seul. 8 380 € de charges
--  n'ont jamais été soldés nulle part.
--
--  CE QUI A ÉTÉ TRANCHÉ, ET POURQUOI
--  ─────────────────────────────────
--  Deux chemins étaient possibles :
--
--   (A) faire porter à `montant_encaisse` le TOTAL reçu (loyer + charges).
--       Aucune migration, mais on perd la répartition ligne à ligne — or
--       c'est exactement ce dont la RÉGULARISATION ANNUELLE a besoin :
--       comparer les provisions encaissées aux charges réellement payées.
--       Le chemin (A) débloquait la saisie et fermait la régularisation.
--
--   (B) une colonne de plus, `charges_encaissees`. C'est le chemin retenu.
--       `montant_encaisse` garde son sens — dix endroits le lisent — et la
--       répartition reste connue. Coût : cette migration.
--
--  ⚠️ LA DÉCLARATION FISCALE N'EST PAS TOUCHÉE, ET C'EST DÉLIBÉRÉ.
--  `mfBilanFeedCompute` somme `montant_encaisse` pour alimenter la 2044.
--  Elle continue de ne compter que les loyers, et continue d'exclure les
--  charges récupérables des déductions : c'est un COUPLE COHÉRENT. Faire
--  entrer les provisions en recettes obligerait à cesser d'exclure les
--  charges récupérables — sinon la déclaration surestime le revenu. C'est un
--  arbitrage FISCAL, distinct de celui-ci, et il t'appartient. Tant qu'il
--  n'est pas tranché, tes chiffres de déclaration ne bougent pas d'un euro.
--
--  ⚠️ AUCUNE LIGNE EXISTANTE N'EST MODIFIÉE. La colonne naît NULL partout.
--  NULL ne veut pas dire « zéro charge encaissée », il veut dire « on ne
--  suivait pas ». La différence compte : le code ne réclamera pas les
--  8 380 € sur des mois que tu as déjà marqués « Payé ».
--
-- ════════════════════════════════════════════════════════════════════════════


-- ── BLOC 1 — ÉTAT DES LIEUX (lecture seule, rien n'est écrit) ───────────────
-- À jouer d'abord. Il doit rendre : colonne_existe = false.

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'loyers_mensuels'
            AND column_name  = 'charges_encaissees')            AS colonne_existe,
  count(*)                                                       AS lignes_total,
  count(*) FILTER (WHERE statut = 'Payé')                        AS lignes_payees,
  sum(coalesce(charges_dues, 0)) FILTER (WHERE statut = 'Payé')  AS charges_non_soldees
FROM public.loyers_mensuels;


-- ── BLOC 2 — LA COLONNE ────────────────────────────────────────────────────
-- Additive et réversible. Le code déployé aujourd'hui ignore cette colonne :
-- tu peux jouer ce bloc AVANT la mise en production, sans rien casser.

ALTER TABLE public.loyers_mensuels
  ADD COLUMN IF NOT EXISTS charges_encaissees numeric;

COMMENT ON COLUMN public.loyers_mensuels.charges_encaissees IS
  'Provisions pour charges effectivement encaissées sur ce mois. '
  'NULL = non suivi (lignes antérieures au 27/09/2026), ce qui n''est PAS '
  'la même chose que 0. Le pendant de montant_encaisse, qui ne solde que '
  'loyer_du. La régularisation annuelle compare cette colonne aux charges '
  'réellement payées (charges_reelles.recuperable_locataire).';


-- ── BLOC 3 — L'INVARIANT ───────────────────────────────────────────────────
-- Une provision encaissée n'est jamais négative. On NE contraint PAS
-- charges_encaissees <= charges_dues : un locataire peut régler un rattrapage
-- de charges sur un mois, et la base n'a pas à le lui interdire.

ALTER TABLE public.loyers_mensuels
  DROP CONSTRAINT IF EXISTS loyers_charges_encaissees_positives;

ALTER TABLE public.loyers_mensuels
  ADD CONSTRAINT loyers_charges_encaissees_positives
  CHECK (charges_encaissees IS NULL OR charges_encaissees >= 0);


-- ── BLOC 4 — CONTRÔLE (lecture seule) ──────────────────────────────────────
-- Doit rendre : colonne_existe = true, contrainte_posee = true,
-- lignes_renseignees = 0 (rien n'a été écrit, c'est voulu).

SELECT
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'loyers_mensuels'
            AND column_name  = 'charges_encaissees')             AS colonne_existe,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conname = 'loyers_charges_encaissees_positives') AS contrainte_posee,
  count(*) FILTER (WHERE charges_encaissees IS NOT NULL)         AS lignes_renseignees,
  count(*)                                                       AS lignes_total
FROM public.loyers_mensuels;


-- ════════════════════════════════════════════════════════════════════════════
--  ET LES 17 LIGNES DÉJÀ EN BASE ?
--
--  Elles restent à NULL, et il n'y a rien à jouer ici. Deux raisons :
--
--   1. On ne sait pas. Tu as marqué ces mois « Payé » à une époque où
--      l'application ne demandait que le loyer. Écrire « charges encaissées =
--      charges dues » supposerait que ton locataire a tout réglé — c'est
--      probable, ce n'est pas su. « Jamais de chiffre inventé » vaut ici.
--
--   2. Ça ne gêne rien. `sfLoyerEtat` lit le STATUT, pas les montants : ces
--      mois restent « encaissés », aucune alerte ne se déclenche, aucun
--      arriéré fantôme n'apparaît. La régularisation annuelle, elle, ne
--      portera que sur les mois saisis après cette migration — et c'est la
--      seule réponse honnête.
--
--  Si tu VEUX quand même les solder, le bloc ci-dessous le fait. Il est
--  commenté à dessein : c'est une décision, pas une étape.
--
--  UPDATE public.loyers_mensuels
--     SET charges_encaissees = charges_dues
--   WHERE statut = 'Payé'
--     AND charges_encaissees IS NULL
--     AND coalesce(charges_dues, 0) > 0;
--
-- ════════════════════════════════════════════════════════════════════════════
--  RETOUR ARRIÈRE
--    ALTER TABLE public.loyers_mensuels
--      DROP CONSTRAINT IF EXISTS loyers_charges_encaissees_positives;
--    ALTER TABLE public.loyers_mensuels
--      DROP COLUMN IF EXISTS charges_encaissees;
--  Aucune donnée existante n'est perdue : la colonne n'en portait aucune.
-- ════════════════════════════════════════════════════════════════════════════
