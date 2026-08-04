# Reprise Stonefolio — brief de session

`Projet : C:\Users\thoma\Projets\trackimmo` · dépôt GitHub **`trackimmo`** (non renommé,
volontairement : le renommer changerait l'URL Pages).
`Prod : https://thomasguenon123-cloud.github.io/trackimmo/ — actuellement v=51`

**Lis d'abord ta mémoire projet** (`MEMORY.md` + fiches liées) : elle est à jour et contient
les pièges qui te feraient perdre le plus de temps.

---

## Contexte

TrackImmo a été renommé **Stonefolio**. Refonte visuelle en 6 phases, cible investisseurs
24-30 ans, style épuré et professionnel. **Les phases 0 à 4 sont terminées.** La phase 5
(migration écran par écran) est bien avancée.

**Les 4 mots d'ordre, à citer tels quels** : la plateforme doit être **cohérente, uniforme,
professionnelle et intuitive** pour l'utilisateur final.

---

## Fait dans la session précédente (03/08/2026)

### Socle
- **Bascule complète en sombre.** Le `:root` hérité de `styles.css` est devenu un simple
  **alias de `tokens.css`** : les ~1300 `var(--c-*)` suivent la charte sans réécriture.
- **Plus aucune couleur en dur hors charte dans `app.js`.** Le nuancier `THEMES` (5 thèmes,
  15 couleurs TrackImmo) était du **code mort** — supprimé avec `applyTheme()`.
- ⚠️ **Cause racine du fond blanc, à retenir** : `applyAccentVars()` écrivait `--accent` en
  **style en ligne sur `<html>`**, ce qui bat toute règle de feuille. Neutralisée.

### Écran « Mes biens » — refondu
- **Vue Tableau par défaut**, deux onglets (**Ma prospection** d'abord, puis Mon patrimoine),
  kanban retiré du patrimoine (une seule colonne « Acheté » = aucune information).
- **Correction majeure** : la synthèse calculait en prévisionnel pur pendant que les cartes
  affichaient le réel. « Meilleur cashflow +1 073 € » désignait un bien qui perd
  **2 251 €/mois** au réel. Tout passe désormais par `cfDisplayData()`.
- **`SF_ESSENTIELS`** (prix, loyer, statut, ville) fait autorité pour TOUTE la plateforme :
  une fiche incomplète est écartée des indicateurs, affiche « À compléter » en nommant le
  champ manquant, et remonte dans « À traiter » sur l'accueil.
- Sélection multiple + actions groupées, densité Confort/Compact, recherche, colonne Charges.

### Accueil
- **Pointage d'un loyer depuis l'agenda** (case à cocher qui **crée** la ligne si besoin).
- Un loyer non pointé au **lendemain de son échéance** passe « en retard » — seuil sur
  `jour_paiement + 1`, pas figé au 6 du mois.

### Audit complet (rapport versionné : `AUDIT-2026-08-03.md`)
- 12 findings, 0 critique, **2 hauts corrigés**.
- Le plus grave n'était pas de la sécurité mais **une perte de données** : 70 champs de
  formulaire n'échappaient pas leur valeur ; un titre contenant `"` était tronqué à la
  réouverture et perdu à l'enregistrement.
- **Socle Supabase validé sain** : RLS sur les 17 tables, 68 policies toutes scopées.
- **FND-005 et FND-006 clos.** FND-004 abandonné (abonnement Supabase requis).

### Iconographie et listes déroulantes
- **Un seul jeu d'icônes** (`SF_ACC_ICONS`), lu par `sfAccIcon()` et `sfIcon()`. Il y en
  avait trois.
- **Composant de liste déroulante maison** (`.sf-pick`) : le `<select>` natif reste dans le
  DOM comme source de vérité, une couche est dessinée par-dessus. **Natif conservé sous
  720 px.** Un `MutationObserver` habille tout select qui apparaît.
- Emojis migrés : états vides, titres de sections, boutons, onglets de la fiche bien,
  Paramètres, section Marché, écran Utilisateurs, Paramètres → Données.

---

## Ce qu'il reste à faire

### Phase 5 — écrans
1. **Fiche bien (7 onglets)** — chantier DA à part entière. Seuls ses **onglets** sont faits.
2. **Module financier (5 onglets)**.
3. Écrans secondaires : Simulateur, Comptes rendus, Administration, écran de connexion.

### Dette mesurée au 03/08/2026
| | |
|---|---|
| Emojis rendus restants | **303** (hints, messages d'auth, matrice de suivi) |
| Flèches Unicode `→` | **50** — tombent en police système, à passer en SVG |
| Styles en ligne | **476** |
| Tailles de police en dur | **212** |
| `app.js` | 11 421 lignes |

### Backlog hors refonte
- Valider l'écriture du **bilan SCI** (jamais testée en conditions réelles).
- **Lot Marché** : carte de France + ouvrir le filtre NewsAPI.
- Tuto de première connexion · sections Paramètres « Bientôt ».
- Agent WhatsApp (dépend de l'écran Intégrations).
- Retouche mineure : l'icône de « Envoyer l'invitation » est une flèche montante
  (téléversement) ; une enveloppe conviendrait mieux.

### À la charge de Thomas (hors code)
- Gabarits d'e-mails Supabase (disent encore TrackImmo).
- User-Agent `TrackImmo/1.0` de l'Edge Function `news-proxy`.
- Achat du domaine **stonefolio.fr** (vérifié libre : AFNIC + INPI, 0 résultat).

---

## Règles de travail

- **Incrémenter `?v=N` dans `index.html` AVANT de tester** — sinon le navigateur sert
  l'ancien asset avec le nouveau HTML.
- Branche dédiée → commit détaillé → merge main → push → **attendre le déploiement Pages
  avant d'annoncer que c'est en ligne**.
- MCP Supabase **en lecture seule** : toute migration DDL revient à Thomas.
- **Jamais de chiffre inventé** : « non disponible » si la donnée manque.
- Ne jamais recopier une énumération en dur (registre `TI_BIENS`).
- **Sens de lecture gauche → droite** : valeurs de tableau alignées à gauche, en-têtes
  comprises. `tabular-nums` conservé.
- **Un indicateur dit CE QU'IL EST, jamais comment il est calculé.** Pas de glose de méthode
  en sous-titre. Pas d'alerte permanente anxiogène.

---

## Pièges qui coûtent du temps — à lire avant de coder

1. **Chercher les noms fragmentés par du balisage.** Un `grep` sur « TrackImmo » avait
   manqué l'écran de connexion et la page 404 : le nom y était coupé (`Track<em>Immo</em>`).
2. **Une couleur qui « ne prend pas » vient souvent d'un style écrit en ligne par JS** — il
   bat toute règle de feuille.
3. **Chercher le code mort avant de conclure qu'une couleur est utilisée** (cf. `THEMES`).
4. **`textContent` ne rend pas le SVG**, il l'affiche en toutes lettres. Vérifier avant de
   migrer un libellé de bouton.
5. **Tout n'est pas un gabarit.** Les boutons de la table admin et les lignes
   `btn.innerHTML = '…'` sont des **chaînes simples** : `${…}` y est du texte littéral et
   les quotes imbriquées cassent la chaîne. *Ce piège s'est présenté trois fois.*
6. **Une `<option>` n'accepte que du texte** — aucun SVG possible.
7. **Les noms de phase viennent de `PHASE_MAP`**, jamais d'une liste réécrite à la main.
   Le CSS en décrivait six alors que le code en produit cinq → pastille illisible.
8. **Vérifier les doublons de sélecteur** avant de déboguer une couleur (`.statut-pill`
   était défini deux fois).
9. **Espace fine insécable `U+202F` devant `€` et `%`**, sinon le symbole passe seul à la
   ligne.
10. **Fichiers en CRLF** : une recherche multi-ligne écrite avec `\n` échoue silencieusement.

---

## Comment vérifier sans pouvoir se connecter

L'authentification demande des identifiants que l'assistant ne saisit pas. **Tout se vérifie
au niveau du code, du DOM et des styles calculés — jamais au-dessus des vraies données.**
C'est Thomas qui juge le rendu final, et il faut le lui demander après chaque déploiement.

Deux outils qui ont bien marché et qu'il faut réutiliser :
- **Auditeur de contraste** : rendre chaque règle CSS sur un élément témoin, lire les
  couleurs *réellement calculées* (`var()` résolues), appliquer la formule WCAG. Il a trouvé
  ce que la relecture avait manqué.
  ⚠️ Deux pièges : `CSSRuleList` n'est **pas itérable** en `for...of`, et en Chrome moderne
  **tout `CSSStyleRule` a un `cssRules` vide mais truthy** — une garde `if (r.cssRules)`
  fait donc récurser sur toutes les règles et n'en collecte aucune.
- **Rendu avec données injectées** : stubber `allBiens`, `allLoyers`, `userPrefs`, masquer
  `.auth-overlay`, puis appeler les fonctions de rendu et lire le DOM. Pour les fonctions
  qui interrogent Supabase, simuler `db.from`.
