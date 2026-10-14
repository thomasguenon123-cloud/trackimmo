-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION-VISITES-GRILLE.sql — v=96, 14/10/2026
-- La grille de visite : une colonne `grille` (jsonb) sur public.visites.
--
-- STATUT : NON JOUÉ. À jouer par Thomas dans l'éditeur SQL de Supabase,
-- guidé pas à pas ; vérifié ensuite en lecture de notre côté.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- POURQUOI. Depuis la v=96, une visite d'achat se remplit avec une grille,
-- validée par Thomas le 14/10 : le bien (état général, DPE, luminosité, bruit,
-- travaux à prévoir), la copropriété (charges annuelles, parties communes,
-- procédures en cours, travaux votés ou à venir), le quartier (transports,
-- commerces, écoles, sécurité ressentie) et un verdict (suite à donner, points
-- forts, points faibles — la note reste dans note_sur_5). Ces critères vivent
-- dans UNE colonne jsonb : en ajouter un ne demandera pas de nouvelle
-- migration.
--
-- TANT QUE LA COLONNE N'EXISTE PAS, l'application ne montre pas la grille et
-- n'envoie rien pour elle : le reste du compte rendu fonctionne. Dès qu'elle
-- existe, la grille apparaît au prochain chargement de la page.
--
-- CE QUE FAIT CE SCRIPT. Il ajoute la colonne, vide (NULL) sur les comptes
-- rendus existants — « grille non remplie ». Une contrainte refuse tout ce qui
-- n'est pas un objet JSON. Les droits et les règles d'accès (RLS : chacun ne
-- lit et n'écrit que ses comptes rendus) couvrent la nouvelle colonne sans
-- rien changer : ils portent sur la table entière (vérifié le 14/10 :
-- privilèges de table, quatre policies « own »).
--
-- CE QU'IL NE FAIT PAS. Il ne modifie aucune donnée existante, ni aucune
-- autre table. Il se rejoue sans dommage.
--
-- RETOUR EN ARRIÈRE, si besoin (⚠️ efface les grilles déjà saisies) :
--   alter table public.visites drop column if exists grille;
--   notify pgrst, 'reload schema';
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.visites
  add column if not exists grille jsonb;

alter table public.visites
  drop constraint if exists visites_grille_objet;

alter table public.visites
  add constraint visites_grille_objet
  check (grille is null or jsonb_typeof(grille) = 'object');

comment on column public.visites.grille is
  'Grille de visite d''achat (v=96). Critères normalisés par sfGrilleNormaliser (app.js). NULL : grille non remplie.';

-- L'API relit le schéma : la colonne est utilisable aussitôt.
notify pgrst, 'reload schema';
