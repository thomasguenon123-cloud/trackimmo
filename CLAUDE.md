# Stonefolio — consignes pour Claude Code

> Extrait durable de la mémoire locale de Thomas (`MEMORY.md` et ses fiches,
> sur son poste). Ce fichier vit au dépôt pour qu'une session cloud en dispose
> aussi. ⚠️ **Il est public** — le dépôt l'est, et GitHub Pages sert tout le
> dépôt : jamais de secret, d'adresse e-mail ni d'identité de testeur ici.
> Répondre à Thomas **en français**.

## Le projet

- **Stonefolio**, anciennement TrackImmo : suivi de patrimoine immobilier
  locatif (prospection, gestion, rentabilité). Cible : investisseurs de 24 à
  30 ans, premiers biens. Thomas développe seul.
- Le dépôt garde le nom **`trackimmo`** : le renommer changerait l'URL Pages
  (et le `REDIRECT_URL` du lien d'invitation). À faire d'un seul tenant, plus tard.
- **Production** : https://thomasguenon123-cloud.github.io/trackimmo/
- **Front 100 % statique**, sans build, déployé tel quel sur GitHub Pages.
  `app.js` est un script unique (~15 000 lignes) ; CSS en couches :
  `tokens.css` → `components.css` → `styles.css` → `financier.css` → `tactile.css`.
- **Supabase** (projet `immo-pipeline`, eu-west-1) : Postgres + RLS sur toutes
  les tables, Storage, Auth (mot de passe + Google restreint aux comptes
  connus), Edge Functions (`admin-invite-user`, `news-proxy`).
- Le premier testeur extérieur est sur **iPad** : pas de survol, `title=`
  invisible, glisser-déposer au doigt.

## Méthode de travail — à respecter

1. **Incrémenter `?v=N` dans `index.html` AVANT de tester** toute modification
   de CSS ou de JS — sinon le navigateur mêle nouvel HTML et anciens assets.
2. Branche de travail → commit détaillé → fusion dans `main` → push →
   **attendre la fin de « pages build and deployment »** avant d'annoncer que
   c'est en ligne. En session cloud, `github.io` est bloqué par le proxy :
   suivre le déploiement par l'API GitHub Actions.
3. **`npm test` avant tout commit** (`node --test`, aucune dépendance).
4. ⚠️ **Toute garde de régression se valide PAR MUTATION** : réintroduire
   l'ancien code et vérifier que le test TOMBE. Vérifier d'abord que la
   mutation s'est bien appliquée. Une garde qui lit une donnée doit aussi
   exiger un **témoin positif** — sinon un rendu vide la fait passer.
5. **Base de données** : Thomas n'est pas à l'aise avec Supabase. Toute
   écriture DDL se fait **par lui**, guidée pas à pas (URL de l'éditeur SQL,
   bloc prêt à coller, ce qu'il doit voir, quoi faire en cas d'erreur, comment
   revenir en arrière), une étape à la fois — puis **vérifiée en lecture** de
   notre côté, sans le croire sur parole. Lecture SQL libre pour vérifier.
6. **Jamais de chiffre recopié** d'une note précédente : on le re-mesure sur le
   code ou la base du jour, et on livre la méthode qui le produit. Plusieurs
   chiffres du backlog se sont révélés faux exactement de cette façon.
7. **Vérifier un « finding » contre le code avant de le ressortir** — une fiche
   a gardé « ouvert » un défaut corrigé depuis deux semaines.
8. L'authentification est fermée à l'assistant : on vérifie par le code, le
   DOM et les styles calculés (banc d'essai : Supabase stubbé **avant**
   `app.js`, données injectées). En cloud, Chromium + Playwright sont
   disponibles (`/opt/pw-browsers`). **C'est Thomas qui juge le rendu final.**
9. Messages de commit en français, sans accents dans le texte, détaillés :
   ce qui était cassé, pourquoi, ce qui a été décidé, comment c'est vérifié.
   Suffixe `(v=N)` quand la version change.
10. ⚠️ Ne pas utiliser perl/sed pour un remplacement contenant `${...}` (perl
    l'interprète). Sur le poste de Thomas les fichiers sont en **CRLF** : une
    recherche multi-ligne écrite avec `\n` y échoue en silence.

## Règles produit — arbitrages de Thomas, ne pas rouvrir

- **Les quatre mots d'ordre** : la plateforme doit être **cohérente, uniforme,
  professionnelle et intuitive**.
- **Un indicateur dit CE QU'IL EST, jamais comment il est calculé.** Pas de
  glose de méthode (« réel quand il existe, estimé sinon »), pas de `≥`, phrase
  courte en français plein. Pas d'alerte permanente anxiogène.
- **Montants alignés à DROITE**, en-têtes comprises ; le texte reste à gauche.
  Espace fine insécable U+202F devant `€` et `%` → `sfEur()`, `sfPctNum()`.
  Virgule décimale. `tabular-nums`.
- **Une donnée absente → « non disponible »**, jamais un 0 ou un chiffre inventé.
- **Un bien VACANT se compte** (son cashflow est connu) ; seul un bien loué
  sans loyers saisis est écarté.
- **Un loyer dû le 5 n'est en retard que le 6** (seuil sur `jour_paiement`) —
  toute lecture d'un retard passe par `sfLoyerEtat()`, jamais par le libellé.
- **« Turnover »** est maintenu par Thomas malgré l'objection de vocabulaire.
- **Règle de détention** : tout bien passé en « Acheté » déclare **en propre**
  ou **via une SCI**. Ne jamais présumer `'propre'`. « Acheté » n'est plus
  saisissable (`STATUTS_SAISISSABLES`) : on y entre par
  `bdDemarrerAcquisition()`, et rien n'est écrit avant la confirmation.
- **Frais de constitution de SCI** : seul le premier bien d'une SCI les porte
  (`sfFraisCreationSci`).
- **Charte** : sombre par défaut ; marque verte mais **bouton principal sans
  teinte** ; un seul vert lumineux (`--gain`), réservé aux valeurs positives ;
  la couleur ne porte jamais seule. Pas de plafond de largeur de page. États
  vides complets (icône, titre, explication, action), jamais une ligne seule.
- **Iconographie** : un seul jeu, `SF_ACC_ICONS` via `sfAccIcon(cle, taille)`.
  Plus aucun emoji dans ce qui part en production (garde `emojis.test.js`).
- **Confirmation** : `sfConfirmer({...})`, jamais `confirm()` natif (garde
  `impasses.test.js`). Elle a sa propre fenêtre, au-dessus de tout
  (`--sf-z-confirm`). ⚠️ son `question` est échappé, son `detail` ne l'est PAS.
  Sur un acte destructeur (`danger: true`), le focus va à « Annuler ».
- **Écran tactile** : un `title` ne s'affiche jamais au doigt. Toucher un
  élément NON interactif titré l'affiche dans une bulle (`sfBulleCible`) ; une
  information indispensable doit rester visible, pas seulement titrée.
- **Mots de passe** : vérifiés contre Have I Been Pwned (5 caractères de
  l'empreinte, jamais le mot de passe) ; un service muet ne bloque personne.
  Les erreurs disent la vraie raison du refus (`authErrorToFr`).
- **Pas d'entrée « Bientôt »** : une section non construite n'est pas affichée
  (`sfParamPropose`) ; elle réapparaît quand son statut passe à `'ready'`.
- **Ne jamais recopier une énumération en dur** : tout passe par `TI_BIENS`
  (statuts dérivés de `PHASE_MAP`).

## Sources uniques — appeler la fonction, ne jamais réécrire la règle

Une règle métier écrite deux fois finit par diverger : c'est la cause des trois
findings hauts de l'audit du 05/08 et des deux générateurs de loyers.

| Règle | Source unique |
|---|---|
| Affichage d'un cashflow (réel / attente / estimé) | `cfDisplayData()` — jamais `computeCF()` seul pour agréger |
| État d'un loyer, retard, impayé | `sfLoyerEtat()` |
| Dû et encaissé (`charges_encaissees IS NULL` = « non suivi », pas zéro) | `sfDuEtEncaisse()` |
| Prorata d'un loyer | `mfLoyerProrata()` |
| Génération des loyers | `autoGenerateLoyers()` |
| Détacher les biens d'une SCI avant de la supprimer | `sciDetacherBiens()` |
| Nom d'affichage du compte | `sfProfilNom()` |
| Échappement HTML | `esc()` · URL : `safeUrl()` · argument JS dans un `onclick` : `escJs()` |
| Montant d'un champ éditable | `ieEur()` (jamais la valeur *affichée* dans un `<input>`) |
| Couleur pour Chart.js | `sfToken()` (un canvas ne lit pas `var()`) |

## Pièges connus — chacun a coûté au moins une fois

- **Ne jamais compter des jours en millisecondes** (heure d'été : 830 € écrits
  803 €). Une borne de fin de mois va jusqu'à 23:59:59.999 (`finDeJournee`).
  Une date n'est pas un instant.
- **Une action référentielle est un chemin d'écriture** : lire les
  `ON DELETE` / `ON UPDATE` des clés étrangères, pas seulement les `update`.
- **Tout texte lu dans l'URL est hostile** (`error_description`, paramètres,
  hash) : un lien piégé suffit. `showAuthAlert` écrit du HTML — tout ce qui
  y entre passe par `esc()` (garde `authentification.test.js`).
- **Échappement** : un `<textarea>` EST du HTML généré ; un filtre
  `replace(/<[^>]+>/g,'')` ne protège pas (balise non fermée) ; une donnée
  tierce (NewsAPI, API publiques) est la plus exposée. Garde : `echappement.test.js`.
- **`.sf-pick`** déplace le `<select>` 30 ms après son insertion → focus perdu
  sans `blur`. Créer un select pour interagir ⇒ `sfSelectHabillerMaintenant()`.
  Son panneau est téléporté dans `<body>` : tout garde global teste
  `.sf-pick, .sf-pick__panel`. Tester sur une liste qui **défile**.
- Migration emoji → SVG : `textContent` affiche le SVG en toutes lettres ; une
  `<option>` n'accepte que du texte ; certaines chaînes ne sont pas des gabarits.
- `roleColors` reste en hexadécimal 6 chiffres (`${couleur}22`).
- `.sff-line` fait **5 colonnes** dans `styles.css` : surcharger, jamais
  réutiliser tel quel. Toujours `minmax(0,1fr)`, jamais `1fr` seul.
- **Contraste** : `--sf-text-3` retombe sous AA dès qu'il quitte `--sf-bg` →
  `--sf-text-2`. Les `--sf-*-wash` sont en `rgba()` : compositer la pile de fonds.
- **Ordre de chargement CSS** : `components.css` est chargé AVANT `styles.css`.
  À spécificité égale, `styles.css` gagne — une règle `.sf-x` de components.css
  peut perdre contre `.modal-overlay` de styles.css. Vérifier dans un vrai
  navigateur, pas seulement que la règle existe.
- **Plans de superposition** : les fenêtres d'ancienne charte sont à 2000-2001,
  les popups jusqu'à 9999, `modal-detail` à 200. Rien d'interactif ne doit
  s'ouvrir depuis l'une d'elles dans une couche plus basse.
- **Vérifier qu'une classe n'existe pas avant de la créer.** Mesurer la MISE EN
  PAGE (ordonnées, pistes à 0 px), pas seulement le contenu du DOM.
- Jamais de commentaire HTML `<!-- -->` contenant un accent grave dans un gabarit.
- `node --check` ne voit pas une variable hors portée.
- Une couleur qui « ne prend pas » : chercher qui l'écrit en JS (style en ligne).
- Quand un affichage diffère selon l'écran : chercher un second mapping.

## Tests

`npm test` → `test/*.test.js`, chargés par `test/charger-app.js` dans un
contexte `node:vm`. Trois pièges (détail dans `test/LISEZMOI.md`) :
- le temps doit être figé : `charger({ maintenant })` ;
- les `let` d'`app.js` ne sont pas des propriétés du contexte → `injecter()` / `lire()` ;
- un tableau venu du contexte échoue en `deepStrictEqual` → `Array.from()`.

Les commentaires du dépôt citent volontiers le défaut qu'ils corrigent : une
garde qui lit le texte brut s'accuse elle-même. Masquer les commentaires — et
garder le canari qui vérifie que le masquage n'efface pas de code.

## Faux positifs documentés — ne pas re-signaler

- `bank_presets_read` en `USING(true)` : catalogue partagé, voulu.
- L'advisor « SECURITY DEFINER exécutable par authenticated » sur les
  fonctions `admin_*` et `*_my_*` : la garde de rôle est à l'intérieur (en
  `IS DISTINCT FROM` depuis le 27/09) ; les `*_my_*` sont scopées par `auth.uid()`.
- Les « index inutilisés » de l'advisor : normal à ce volume. Ne rien supprimer.
- L'id `bf-resultat` dupliqué : branches IR/IS exclusives.
- Les couleurs TrackImmo trouvées dans des **commentaires** qui documentent leur suppression.

## Où trouver l'état du projet

- **Le backlog** est tenu dans un artefact claude.ai de Thomas (« Backlog
  Stonefolio ») — demander le lien. Ses chiffres se re-mesurent avant d'être cités.
- Au dépôt : `CARTOGRAPHIE-AVANT-TEST.md` (état détaillé avant ouverture au
  testeur), `AVANT-INVITATION.md`, `REVUE-2026-08-13.md` (dont les trois
  options sur le découpage d'`app.js`), `AUDIT-2026-08-0{3,5}.md`, et les
  `MIGRATION-*.sql` (chacun dit s'il a été joué). `BRIEF-REPRISE.md` est
  **périmé** (v=61) : historique seulement.

### Décisions encore ouvertes, à poser à Thomas plutôt qu'à trancher

- Découper `app.js` suppose d'accepter une étape de build — non tranché.
- L'arbitrage fiscal des provisions de charges dans la déclaration (une garde
  de test empêche de le faire par réflexe).
- Les biens `is_test` : `is_test` n'exclut ces biens d'aucun calcul.
- Vocabulaire Cerfa : `CERFA_MAPPING` suit la 2044 (personne physique), alors
  qu'une SCI à l'IR dépose une 2072 — à voir avec un comptable.
