# Brief de reprise — maquette du Module financier (Stonefolio)

> À coller tel quel au début d'une nouvelle session.

---

## Contexte

`Projet : C:\Users\thoma\Projets\trackimmo` · dépôt GitHub **`trackimmo`** (non renommé
volontairement : le renommer changerait l'URL Pages).
`Prod : https://thomasguenon123-cloud.github.io/trackimmo/ — actuellement v=59`

**Lis d'abord ta mémoire projet** (`MEMORY.md` + fiches liées), puis `BRIEF-REPRISE.md` à la
racine du dépôt.

TrackImmo a été renommé **Stonefolio**. Refonte visuelle en 6 phases, cible investisseurs
24-30 ans. Phases 0 à 4 terminées. **Phase 5** (écran par écran) : accueil, « Mes biens » et
fiche bien **migrés**. Il reste le **Module financier**, puis les écrans secondaires.

**Les 4 mots d'ordre, à citer tels quels** : la plateforme doit être **cohérente, uniforme,
professionnelle et intuitive** pour l'utilisateur final.

---

## Où on en est

La **maquette du Module financier est à l'itération 4**, en ligne mais **NON branchée dans
l'application** :

**https://thomasguenon123-cloud.github.io/trackimmo/financier.html** → fichier `financier.html`

Elle charge les **vrais** `tokens.css` et `components.css`, donc elle ne peut pas diverger d'une
copie des styles. Ses données sont celles de la base de Thomas, **exercice 2026**, recalculées en
SQL.

**Thomas a encore des retours à donner sur cette maquette.** Ne rien implémenter dans `app.js`
tant qu'il ne l'a pas validée.

---

## Méthode de travail (à respecter)

- Maquette servie en prod → itérer avec Thomas → **puis seulement** implémenter dans `app.js`.
- **Incrémenter `?v=N` dans `index.html` AVANT de tester** — sinon le navigateur sert l'ancien
  asset avec le nouveau HTML. Piège rencontré plusieurs fois.
- Branche dédiée → commit détaillé → merge main → push → **attendre le déploiement Pages** avant
  d'annoncer que c'est en ligne.
- MCP Supabase **en lecture seule** : toute migration DDL revient à Thomas.
- **Jamais de chiffre inventé** : « non disponible » si la donnée manque.
- Ne jamais recopier une énumération en dur (registre `TI_BIENS`).
- **Un indicateur dit CE QU'IL EST, jamais comment il est calculé.** Pas d'alerte permanente
  anxiogène.
- **Montants alignés à DROITE**, en-têtes comprises (règle du 05/08/2026, appliquée partout).
- **Espace fine insécable U+202F** devant `€` et `%` — helpers `sfEur()` / `sfPct()` dans
  `app.js`. Virgule décimale : « 5,8 % », pas « 5.8% ».

---

## Structure arrêtée du module — ne pas rouvrir

**Quatre onglets, dans cet ordre :**

| Onglet | Rôle |
|---|---|
| **Performance** | Consolidé. 3 graphiques + prévu/constaté + loyers non soldés + bilan comptable. Un **sélecteur de périmètre** (« Tous les biens » ou un bien) y préserve l'analyse par bien. |
| **Portefeuille** | Bien par bien. **Cartes uniquement, aucun graphique.** Filtres + tri. |
| **Suivi mensuel** | La **saisie**. Grille 12 mois × biens, 2 lignes par bien (loyers puis charges). |
| **Locataires** | Annuaire + « À réclamer » + « Prochaines échéances ». |

Point de départ : 5 onglets (Vue d'ensemble · Mes biens · Suivi mensuel · Locataires ·
Rentabilité). « Vue d'ensemble » et « Mes biens » portaient **les 4 mêmes indicateurs** → fusion.
« Rentabilité » → renommée **« Performance »**, passée en premier, devenue consolidée.

---

## Arbitrages déjà rendus par Thomas — ne pas les rouvrir

1. **Un bien VACANT est COMPTÉ** dans les consolidés. Seul un bien **loué dont les loyers ne sont
   pas saisis** est écarté. *(Voir la règle de périmètre ci-dessous — c'est le point le plus
   important du module.)*
2. **« Rendement net » = hors crédit, sur le loyer DÛ.** L'effort mensuel n'est pas un indicateur
   séparé : c'est le **sous-titre du cashflow constaté** (c'était le même nombre à deux échelles).
3. **Année civile partout**, sélecteur d'exercice unique en haut du module. (Avant : la Vue
   d'ensemble raisonnait sur 12 mois glissants, la Rentabilité sur l'année civile.)
4. **Écart réel − prévisionnel** : consolidé dans le bandeau. L'écart par bien reste le cœur de
   Performance. Le troisième emplacement (ancien « Mes biens ») disparaît.
5. **Cartes** pour le Portefeuille, pas de table.
6. **Trois graphiques** : cashflow consolidé par mois · entrées et sorties (aires) · cumul sur
   l'exercice. Tous dans **Performance**.
7. **Listes déroulantes en `.sf-pick`** (composant maison, `components.css`).
8. **Graphiques** : CSS/SVG pour les barres simples, **Chart.js** pour les vraies courbes à
   l'implémentation (déjà chargé dans l'app).

---

## ⚠️ LA RÈGLE DE PÉRIMÈTRE — elle gouverne tous les chiffres du module

Ma première règle (« écarter les biens sans donnée ») **confondait deux cas opposés** :

- Un bien **VACANT** n'est PAS une donnée manquante : on **sait** qu'il ne rapporte rien et que
  son crédit court. Son cashflow est **calculable et vrai** → **il est COMPTÉ**.
- Seul un bien **LOUÉ dont les loyers ne sont pas saisis** est **écarté** — là on ignore vraiment
  ce qui s'est passé.

Conséquence mesurée sur la base : le cashflow consolidé passe de −19 135 € à **−54 735 €**, dont
**35 600 €** de crédit sur les deux biens vides, soit **65 %** du total. La vacance cesse d'être
invisible. Cohérent avec `sfPointsAttention()` qui signale déjà « biens acquis sans locataire ».

---

## ⚠️ Deux défauts de calcul de l'écran EN LIGNE, à corriger à l'implémentation

1. **`mfCashflowReel12M` impute 12 mois de mensualités quoi qu'il arrive.** Un bien avec 8 mois
   de loyers encaissés est confronté à 12 mois de crédit. `renderMfRenta` borne déjà correctement
   aux mois écoulés : **deux définitions du « réel » cohabitent dans le même module.**
2. **Le « Rendement net » n'en est pas un** : `(loyers − charges − mensualités) / coût total`. Il
   retranche le remboursement du crédit — dont la part de capital est de l'épargne, pas une perte
   — et divise par le coût total au lieu de l'apport. D'où les « −4,14 % » affichés en prod.

---

## Chiffres de référence (base réelle, exercice 2026, 8 mois écoulés)

**Trois biens acquis · patrimoine 1 927 000 €**

| Bien | Coût | Mensualité | Encaissé | Dû | Charges | Cashflow | Prévu |
|---|---|---|---|---|---|---|---|
| Immeuble Paris 18e (loué) | 728 200 € | 2 800 € | 3 320 € | 6 640 € | 55 € | **−19 135 €** | +8 584 € |
| T3 Lyon (vacant) | 246 600 € | 850 € | 0 € | 0 € | 0 € | **−6 800 €** | +744 € |
| T4+ Paris 16e (vacant) | 952 200 € | 3 600 € | 0 € | 0 € | 0 € | **−28 800 €** | −8 232 € |

**Consolidé** : cashflow **−54 735 €** (soit **−6 842 €/mois**) · rendement net **0,51 %** ·
écart réel−prévi **−55 831 €** · occupation **33 %** · mensualités des vacants **35 600 €**
(65 % du cashflow négatif) · mensualités totales **58 000 €**.

**Loyers** : 4 mois payés (jan, mar, avr, mai), **4 échus non soldés** (fév, jun, jul, aoû),
4 à venir. Taux d'impayés **50 %**. 1 locataire actif « Test V1 », 830 €/mois, paiement le 5.
1 SCI « SCI TEST Guénon ».

⚠️ En base, les seuls statuts de loyer écrits sont **`'Payé'` et `'En attente'`** — jamais
`'Impayé'` ni `'En retard'`, que seule la fenêtre d'encaissement peut poser à la main.

---

## Non-régression : la méthode à refaire avant d'implémenter

`COMPARATIF-MODULE-FINANCIER.md` à la racine. J'ai inventorié **52 capacités** de l'écran en
ligne — non pas de mémoire, mais en **lisant les handlers réellement câblés** dans `app.js`
(68 fonctions `mf*`, 45 gestionnaires d'événements). **21 régressions** relevées, toutes rendues
depuis, **vérifiées par sonde DOM** et non par ma parole.

**Une régression** (capacité présente en ligne, absente de la maquette) est différente d'une
**simplification assumée**. Sept simplifications sont listées à part avec leur justification.

Leçon : *le module financier est un **poste de travail**, pas un écran de lecture. Sa densité est
sa fonction.* L'itération 1 avait remplacé la grille de saisie par une liste de lecture — on ne
pouvait plus enregistrer une charge sur le mois où elle est tombée.

---

## ⚠️ Pièges qui coûtent du temps

- **`--sf-brand-vivid` sur `--sf-brand-wash-2` ne tient que 4,16:1** — sous le seuil AA. C'est la
  combinaison des **états actifs partout** (pastilles de filtre, badges d'onglet). Jamais testée
  sur la fiche bien car l'onglet sélectionné n'y portait pas de badge. **À reporter sur la fiche
  bien et `components.css`.** Correctif : fond teinté conservé, texte en `--sf-text`.
- **`minmax(370px,1fr)` impose sa piste** même dans un conteneur plus étroit → débordement mobile.
  Toujours **`minmax(min(370px,100%),1fr)`**. Et **`minmax(0,1fr)`**, jamais `1fr`, dès qu'un
  enfant est en `nowrap`.
- **Un contrôle d'alignement doit mesurer le TEXTE** (une `Range` sur le nœud texte) et
  **plusieurs colonnes** : la largeur d'une cellule est identique quelle que soit la mise en forme
  de son contenu, et une colonne peut rester alignée précisément parce que la mise en page est
  uniformément cassée.
- **`--sf-text-3` retombe sous AA sur les surfaces plus claires** (`--sf-brand-wash`,
  `--sf-loss-wash`) : passer à `--sf-text-2`.
- **`ie()` exige `ieEur()` pour tout montant** — sinon perte de données (le champ s'ouvre vide et
  un clic à côté écrit `null`).
- **`sfLoyerEtat()`** est la source unique de l'état d'un loyer (ok/part/ko/avenir/none). Un
  impayé se déduit de l'**échéance**, jamais du libellé du statut.
- **Toute agrégation de cashflow passe par `cfDisplayData()`**, jamais `computeCF()` seul.

---

## Comment vérifier sans pouvoir se connecter

L'authentification demande des identifiants que l'assistant ne saisit pas. **Tout se vérifie au
niveau du code, du DOM et des styles calculés.** C'est Thomas qui juge le rendu final — le lui
demander après chaque déploiement.

Trois outils qui marchent, à réutiliser :

1. **Auditeur de contraste** : rendre chaque élément, lire les couleurs **réellement calculées**
   (`var()` résolues), appliquer la formule WCAG. ⚠️ Partir de **l'élément lui-même**, pas de son
   parent — sinon tout bouton portant son propre fond est déclaré en échec.
2. **Sondes DOM de capacité** : pour chaque fonctionnalité attendue, une fonction booléenne qui la
   cherche dans le DOM. C'est ce qui a permis d'affirmer « 21/21 rendues » sans me croire sur
   parole.
3. **Recalcul SQL puis comparaison au DOM** : chaque chiffre affiché est recalculé depuis la base,
   puis cherché dans le texte rendu. Normaliser les espaces (U+202F vs U+00A0) avant de comparer.

---

## Ce qui reste, hors maquette

- **À la charge de Thomas** : renommer `TRACKIMMO_SSO_RESTREINT` côté Supabase (dernier TrackImmo
  vivant, migration DDL — le client devra accepter les deux chaînes pendant la bascule) ·
  vérifier le contenu du bucket **public** `bank-assets` · gabarits d'e-mails Supabase ·
  User-Agent `TrackImmo/1.0` de l'Edge Function `news-proxy` · achat de `stonefolio.fr`.
- **Dette mesurée au 05/08/2026** : 482 caractères hors police (422 emojis + 60 flèches) ·
  449 styles en ligne · 680 tailles de police en dur · 15 écrans encore à l'ancienne charte.
- Rapports versionnés : `AUDIT-2026-08-05.md`, `AUDIT-2026-08-03.md`,
  `COMPARATIF-MODULE-FINANCIER.md`.
