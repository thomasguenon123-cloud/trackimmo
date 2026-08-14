# Brief de reprise — Stonefolio

> À coller tel quel au début d'une nouvelle session Claude Code.

---

## Contexte

`Projet : C:\Users\thoma\Projets\trackimmo` · dépôt GitHub **`trackimmo`** (non renommé
volontairement : le renommer changerait l'URL Pages).
`Prod : https://thomasguenon123-cloud.github.io/trackimmo/ — actuellement v=61`

**Lis d'abord ta mémoire projet** (`MEMORY.md` + les fiches liées), puis ce fichier.

TrackImmo a été renommé **Stonefolio**. Refonte visuelle en 6 phases, cible investisseurs
24-30 ans. **Phases 0 à 4 terminées.** Phase 5 (migration écran par écran) : accueil,
« Mes biens », fiche bien et **Suivi financier** sont migrés.

**Les 4 mots d'ordre, à citer tels quels** : la plateforme doit être **cohérente, uniforme,
professionnelle et intuitive** pour l'utilisateur final.

---

## ⚠️ LA PREMIÈRE CHOSE À FAIRE — guide-moi pour la migration SQL

**Je ne suis pas à l'aise avec Supabase et je ne veux pas faire la manip seul.**

Il reste **la partie B** de `MIGRATION-MODE-DETENTION.sql` à exécuter. Elle est écrite,
commentée et **actuellement en commentaire** dans le fichier — c'est volontaire, elle
attendait que le code soit prêt. Il l'est.

**Ce que j'attends de toi, en premier :**
1. Vérifie toi-même l'état de la base avant de me faire toucher quoi que ce soit.
2. Donne-moi un **guide étape par étape**, en français simple, avec :
   - où cliquer dans Supabase (URL directe de l'éditeur SQL) ;
   - le bloc SQL exact à coller, **prêt à copier**, une étape à la fois ;
   - **ce que je dois voir** après chaque étape pour savoir que ça a marché ;
   - quoi faire si un message d'erreur apparaît ;
   - comment revenir en arrière.
3. Attends que je te confirme chaque étape avant de passer à la suivante.
4. **Vérifie le résultat toi-même en lecture** quand j'ai fini — ne me crois pas sur parole.

**Contexte technique dont tu auras besoin :**
- La **partie A est déjà posée** (colonne `biens.mode_detention` + contrainte
  `biens_mode_detention_valide`). Vérifié : elle existe bien.
- La partie B ajoute l'**invariant** `biens_mode_detention_coherent`, qui interdit au mode
  et au rattachement SCI de se contredire.
- **Le verrou qui la bloquait est levé, et c'est prouvé** : exactement 3 chemins écrivent
  `biens.sci_id` (`saveBien`, `bdSaveDetention`, `mfBilanFeedSaveBiens`) et **tous les trois
  écrivent aussi `mode_detention` dans le même `update`**. Côté base : 0 fonction, 0
  déclencheur ne touche ces colonnes. Aucune ligne actuelle ne violerait l'invariant.
- État en base au 13/08/2026 : 2 biens `'sci'`, 0 `'propre'`, 5 à renseigner (dont aucun
  bien acquis — voir le cas de test ci-dessous).

**MCP Supabase : lecture seule.** Toute écriture DDL passe par moi, dans l'interface.

---

## Ce qui a été fait dans la session précédente (13/08/2026)

### 1. Migration du Suivi financier (v=60, merge `72468c4`)

Le « Module financier » est devenu **« Suivi financier »** et passe de cinq onglets à
**quatre** : **Performance · Portefeuille · Suivi mensuel · Locataires**.
Neuf commits séquencés, chacun vérifié sur données réelles avant le suivant, le module
restant fonctionnel à chaque étape.

- **Nouveau fichier `financier.css`**, chargé **après** `styles.css`.
- **653 lignes de code mort supprimées** (`renderMfOverview`, `renderMfBiens`,
  `renderMfRenta` et leurs satellites).
- Nouvelle section **« Déclaration fiscale »** (ex-« Bilan comptable ») : calculée à la
  lecture pour un brouillon, figée à la validation, avec deux exports CSV.
- **Règle de détention** câblée dans `bdEtapesGestion` : tout bien passé en « Acheté »
  déclare s'il est détenu **en propre** ou **via une SCI**.

### 2. Revue de code — 5 défauts corrigés (v=61, rapport `REVUE-2026-08-13.md`)

**Deux étaient antérieurs à la migration et touchaient tous les utilisateurs :**

| # | Défaut | Effet |
|---|---|---|
| 1 | **Prorata de mars faussé par l'heure d'été** | 830 € générés à **803 €**, **écrits en base**, tous les ans |
| 2 | **Deux générateurs de loyers, deux règles** | Même bouton, résultat différent selon l'écran |
| 3 | Loyer dû **sans ligne générée** invisible des compteurs | Grille : 5 mois échus ; compteurs : 4 |
| 4 | Occupation d'un exercice passé lue sur le **statut actuel** du locataire | Occupation 0 % sur une année pourtant louée |
| 5 | Biens **disparaissant de la déclaration** sans un mot | SCI supprimée → 2 biens invisibles |

Vérifié **sans défaut** : 0 interpolation d'un champ libre sans `esc()` sur tout `app.js`.
Retiré au passage : le chargement de **Google Fonts**, inutilisé (les 3 polices sont
auto-hébergées) et qui transmettait l'IP de chaque visiteur à un tiers.

### 3. Socle de tests (commit `6aaca6e`)

```bash
npm test
```

**32 cas, 32 passent. Aucune dépendance, aucune étape de build** — `node --test` suffit,
le dépôt reste déployable tel quel sur Pages.

| Fichier | Couvre |
|---|---|
| `test/prorata.test.js` | `mfLoyerProrata`, `mfDaysOccupiedInMonth`, `mfDaysInMonth` |
| `test/exercice.test.js` | `mfMoisEcoules`, `mfReelExercice`, `mfRendementNet`, `mfDansLePerimetre`, `mfLoueSurExercice`, `mfConsolide` |
| `test/loyers.test.js` | `sfLoyerEtat`, `mfLoyersNonSoldes` |

⚠️ **Les trois gardes de régression sont validées PAR MUTATION** : on réintroduit l'ancien
code et on vérifie que le test **tombe**. Un test qui ne tombe pas sur son bug ne vaut rien
— et l'un des miens ne tombait pas au premier essai (piège CRLF : la mutation ne s'était
pas appliquée). **Refaire cette validation pour toute nouvelle garde.**

Pièges du chargeur `node:vm`, tous documentés dans `test/LISEZMOI.md` : le temps doit être
injectable · les `let` d'`app.js` ne sont **pas** des propriétés du contexte · comparer un
tableau venu du contexte échoue en `deepStrictEqual`.

---

## Ce qu'il reste à faire, par ordre d'utilité

1. **La partie B de la migration** — voir en haut, c'est la priorité et j'ai besoin d'être guidé.
2. **Mon cas de test de la règle de détention.** J'ai volontairement sorti **T4+ Paris 16e**
   du statut « Acheté » (il est en « Vendeur contacté (3ème) ») pour pouvoir **repasser ce
   bien en « Acheté »** et déclencher le nouveau workflow. Ma réponse sera **« en propre »**.
   ⚠️ **Ne pas remplir `mode_detention` à ma place sur ce bien** : cela neutraliserait le test.
3. **Itérer sur l'onglet Locataires** en direct sur la plateforme — c'était convenu, il est
   fonctionnel mais je n'ai pas encore donné mes retours dessus.
4. **Les règles métier dupliquées** (dette n°2 du rapport, score 28) : `statut === 'Acheté'`
   s'écrit **13 fois**, `'Payé' || 'Partiel'` **5 fois**. C'est exactement le motif qui a
   produit les deux générateurs divergents. Deux helpers suppriment la classe de risque.
5. **Épingler `supabase-js@2`** sur une version exacte (score 25) : le CDN prend
   silencieusement toute mise à jour mineure.
6. **Le CSS mort** : 105 classes `.mf*` sur 122 ne sont plus générées. Vérifiées **inertes**
   (aucune ne peut atteindre le nouveau balisage). Hygiène, sans urgence.

### Question d'architecture, non tranchée — à me poser

`app.js` fait **12 225 lignes et 375 fonctions**. C'est la racine de la moitié de la dette.
Le découper suppose de décider si **j'accepte une étape de build**. Aujourd'hui le dépôt se
déploie tel quel sur Pages, sans outillage, et c'est une vraie qualité pour un développeur
solo. Trois options sont posées dans `REVUE-2026-08-13.md`. **La note d'architecture n'a
volontairement pas été écrite** tant que je n'ai pas tranché.

---

## Méthode de travail (à respecter)

- **Incrémenter `?v=N` dans `index.html` AVANT de tester** — sinon le navigateur sert
  l'ancien asset avec le nouveau HTML. Piège rencontré plusieurs fois.
- Branche dédiée → commit détaillé → merge main → push → **attendre le déploiement Pages
  avant d'annoncer que c'est en ligne**.
- **`npm test` avant tout commit** touchant le socle de calcul.
- **Jamais de chiffre inventé** : « non disponible » si la donnée manque.
- Ne jamais recopier une énumération en dur (registre `TI_BIENS`).
- **Un indicateur dit CE QU'IL EST, jamais comment il est calculé.**
- **Montants alignés à DROITE**, en-têtes comprises. Espace fine insécable **U+202F** devant
  `€` et `%` (`sfEur()` / `sfPctNum()`). Virgule décimale.
- **Ne pas utiliser perl/sed pour un remplacement contenant `${...}`** — perl l'interprète
  comme du code et meurt en cours d'écriture. Passer par l'outil d'édition.
- ⚠️ **Fichiers en CRLF** : une recherche multi-ligne écrite avec `\n` échoue silencieusement.

## Comment vérifier sans pouvoir se connecter

L'authentification demande des identifiants que l'assistant ne saisit pas. **Tout se vérifie
au niveau du code, du DOM et des styles calculés.** C'est moi qui juge le rendu final.

- **Banc d'essai** (hors dépôt, dans `.gitignore`) : `_banc-essai.html` + `_serveur.js` +
  `.claude/launch.json`. Il stubbe Supabase **avant** `app.js` — `createClient` est appelé
  dès la ligne 4 et ferait tomber tout le fichier — puis injecte des données réelles.
  ⚠️ Le volet d'aperçu convertit un `file://` en `data:` : il **faut** le serveur local.
  ⚠️ Il refuse de descendre sous 980 px : pour tester le 375 px, charger la page dans un
  **`iframe` de 375 px** (`_banc-mobile.html`), qui a son propre viewport.
- **Auditeur de contraste** : lire les couleurs réellement calculées, formule WCAG.
  ⚠️ Partir de **l'élément lui-même**, pas de son parent. ⚠️ Les jetons `--sf-*-wash` sont
  en `rgba()` : il faut **compositer** la pile de fonds, sinon un texte est comparé à
  lui-même et sort à 1,00:1.
- **Sondes DOM de capacité** : une fonction booléenne par fonctionnalité attendue.
- **Recalcul SQL puis comparaison au DOM**, en normalisant les espaces (U+202F vs U+00A0).

## Ce qui reste à ma charge, hors code

Renommer `TRACKIMMO_SSO_RESTREINT` côté Supabase · vérifier le bucket public `bank-assets` ·
gabarits d'e-mails Supabase · User-Agent `TrackImmo/1.0` de l'Edge Function `news-proxy` ·
achat de `stonefolio.fr`.

**Rapports versionnés** : `REVUE-2026-08-13.md`, `AUDIT-2026-08-05.md`, `AUDIT-2026-08-03.md`,
`COMPARATIF-MODULE-FINANCIER.md`, `MIGRATION-MODE-DETENTION.sql`.
