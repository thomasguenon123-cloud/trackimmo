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
- **Front 100 % statique**, sans framework. Depuis le 18/10 (v=104), publié
  par GitHub Actions : tests, puis version minifiée (voir Publication).
  `app.js` est un script unique (~17 500 lignes) ; CSS en couches :
  `tokens.css` → `components.css` → `styles.css` → `financier.css` → `tactile.css`.
- **Dépôt rangé** (v=103) : le site à la racine ; `docs/` (audits, cadrages,
  notes) ; `supabase/sql/` (scripts joués à la main) ; `supabase/functions/` ;
  `maquettes/` (HTML de référence, non chargés par le site) ; `scripts/`.
- **Publication** (activée le 18/10, v=104) : Settings › Pages › Source est
  sur « GitHub Actions ». Chaque push sur `main` lance
  `.github/workflows/publication.yml` : `npm test` (rouge = rien ne part, le
  site reste celui d'avant), puis `scripts/construire.mjs`, qui copie dans
  `_site/` ce que le site charge, minifie app.js et les feuilles SANS renommer
  (les `onclick` appellent les fonctions par leur nom), revérifie les
  empreintes, et seul `_site/` part en ligne. Gain mesuré : 507 → 332 Ko à
  l'ouverture, Lighthouse 95 → 98 ; la construction affiche les tailles (app.js
  979 → 604 Ko au 18/10). Un fichier ajouté au site doit l'être au script
  (garde `publication.test.js`). Revenir en arrière : remettre la source sur
  « Deploy from a branch ». esbuild signale les erreurs CSS : les lire.
- **Bibliothèques hébergées dans `vendor/`** depuis la v=102 (supabase-js,
  Chart.js, pdf.js et son travailleur, html2canvas, jsPDF, pdf-lib, police
  Montserrat), versions exactes prises sur npm, licences jointes, empreintes
  dans `vendor/empreintes.json` et dans les `integrity` d'`index.html`.
  **Aucun CDN, aucune police Google.** Une politique de sécurité (CSP, balise
  meta d'`index.html`) refuse tout script venu d'ailleurs et liste les seuls
  services appelés. Monter de version : `npm pack`, remplacer le fichier, ses
  deux empreintes, passer au banc (garde `dependances.test.js`).
  **Depuis la v=103, seuls supabase-js et app.js se chargent au démarrage**
  (`defer`) : Chart.js, pdf.js, html2canvas, jsPDF et pdf-lib (1,2 Mo) se
  chargent à la première utilisation, une fois, AVEC leur empreinte
  (`SF_BIBLIOS`, `sfChargerBiblio()`). Leur seconde empreinte vit donc dans
  `SF_BIBLIOS`, plus dans `index.html`.
- **Supabase** (projet `immo-pipeline`, eu-west-1) : Postgres + RLS sur toutes
  les tables, Storage, Auth (mot de passe + Google restreint aux comptes
  connus), Edge Functions (`admin-invite-user`, `admin-delete-user`,
  `news-proxy`, `taux-credit`) — sources dans `supabase/functions/`, seule
  source de vérité, testées hors ligne par `test/fonctions-serveur.mjs`.
- Le premier testeur extérieur est sur **iPad** : pas de survol, `title=`
  invisible, glisser-déposer au doigt.

## Méthode de travail — à respecter

1. **Incrémenter `?v=N` dans `index.html` AVANT de tester** toute modification
   de CSS ou de JS — sinon le navigateur mêle nouvel HTML et anciens assets.
2. Branche de travail → commit détaillé → fusion dans `main` → push →
   **attendre la fin du workflow « Publication »** (ses deux jobs, construire
   et publier) avant d'annoncer que c'est en ligne. En session cloud,
   `github.io` et le stockage des artefacts sont bloqués par le proxy : suivre
   par l'API GitHub Actions, et lire le journal de la construction (tailles,
   avertissements).
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
  **Milliers séparés par l'espace insécable ordinaire U+00A0** (« 12 600 »,
  arbitrage du 17/10, v=103) : tout nombre passe par `sfNombre()` ; jamais
  `toLocaleString('fr-FR')` en direct, qui pose U+202F entre les milliers.
  Virgule décimale. `tabular-nums`. Garde : `typographie.test.js`.
- **Un montant se saisit comme il s'affiche** (v=103) : champ texte,
  `inputmode="decimal"`, classe `sf-montant` (aligné à droite), lu par
  `sfLireNombre()`, valeur initiale par `sfValeurChamp()` (0 reste 0). Vide :
  la valeur par défaut annoncée ; illisible : refusé, en le disant. Seuls trois
  entiers courts restent en `type="number"` (jour du mois, jours de rappel,
  année). Garde : `saisie-montants.test.js`.
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
  vides complets (icône, titre, explication, action), jamais une ligne seule —
  l'explication derrière le « ? » du titre depuis la v=100.
- **Iconographie** : un seul jeu, `SF_ACC_ICONS` via `sfAccIcon(cle, taille)`.
  Plus aucun emoji dans ce qui part en production (garde `emojis.test.js`).
- **Biens de test** (v=94) : ils restent dans la LISTE des biens, marqués
  « Test », et sortent de tout ce qui agrège, gère ou déclare — avec leurs
  loyers, charges et locataires, filtrés au chargement. Seul un administrateur
  les réintègre (« Inclure les biens de test », Maintenance) ; un rappel reste
  alors dans le bandeau. Seul un administrateur en fabrique (écran, code, et
  déclencheur `biens_garde_is_test` en base). Une écriture (frais de SCI) ne
  dépend jamais de l'interrupteur. Garde : `biens-test.test.js`.
- **Formulaire d'un bien** (v=95) : l'essentiel d'abord (titre, ville, type,
  surface, prix, loyer, statut, détention), le reste en sections repliables
  qui résument leur contenu. Il ne calcule rien lui-même : sa synthèse passe
  par les fonctions de la fiche. Montants en champ texte au clavier numérique,
  alignés à droite, unité dans le champ. Une seule action principale, en barre
  collante ; quitter une saisie se confirme. Garde : `nouvelle-fiche.test.js`.
- **Comptes rendus de visite** (v=96) : liste, lecture et saisie en PAGES
  (route `compte-rendu`), plus dans `modal-detail`. Une visite d'achat se
  remplit avec la grille validée le 14/10 (le bien, la copropriété, le
  quartier, le verdict), rangée dans `visites.grille` (jsonb) et vidée hors
  visite d'achat. Tant que la colonne n'existe pas (`sfcGrilleDispo`), la
  grille ne s'affiche pas et rien n'est envoyé pour elle. Les comptes rendus
  des biens de test sortent des chiffres ; la note moyenne ne porte que sur les
  visites notées. Un enregistrement ouvre la lecture, « ← » ramène d'où l'on
  venait (fiche sur l'onglet Comptes rendus, Suivi financier, liste).
  **Un seul point d'entrée** (v=98) : la Négociation ne propose plus
  « Visite » (`ACTION_TYPES`) ; une visite tapée dans « Autre… » mène à son
  compte rendu, date et commentaire repris (`sfEstUneVisite`) — refuser laisse
  la fenêtre telle quelle ; son rappel « Rédiger un compte rendu » reprend la
  même saisie (`actVersCompteRendu`). L'onglet de la fiche s'appelle « Comptes rendus »,
  comme le menu. **Revenir sur un onglet, c'est le voir** : après un compte
  rendu ou un échange, la fiche descend jusqu'à sa barre d'onglets quand elle
  est hors de l'écran (`bdVersOnglets`), et l'onglet ouvert est ramené dans la
  barre qui défile. Garde : `comptes-rendus.test.js`.
- **Sur téléphone, ce qu'on choisit s'affiche** (v=98) : ce qui s'ouvre sous
  ce qui l'a fait choisir (onglets de la fiche, section des Paramètres sous
  leur sommaire) est amené à l'écran par `sfAmenerDansLeChamp()` ; une barre
  d'onglets qui défile en largeur garde l'onglet ouvert visible
  (`sfOngletDansLeChamp()`). Sur grand écran, rien ne bouge.
- **Saisie assistée** (v=97) : l'assistance ne remplace JAMAIS une saisie —
  elle remplit un champ vide ou propose. Le code postal donne la ville et
  inversement (geo.api.gouv.fr ; un service muet ne bloque personne) ; le titre
  se propose d'après type, ville et surface tant qu'on ne l'a pas écrit ; la
  source se déduit du domaine du lien ; charges de copropriété et taxe foncière
  se saisissent À L'ANNÉE (`annuel: true` dans `SFN_SECTIONS`) et se comptent
  par mois. « Coller l'annonce » lit le texte sur l'appareil (rien n'est envoyé)
  et ne remplit que les champs vides. Garde : `saisie-assistee.test.js`.
- **Simulations de crédit** (v=99) : liste, lecture et saisie en PAGES
  (routes `simulateur` et `simulation`), à la charte. Une mensualité compte
  l'ASSURANCE EMPRUNTEUR quand elle est saisie, et le dit. L'endettement se juge
  à **35 %** (`SF_ENDETTEMENT_MAX`, HCSF), assurance comprise, sur les revenus +
  70 % du loyer : dans la limite = neutre, au-dessus = alerte (jamais de vert) ;
  sans revenus = « non disponible ». Une simulation peut être **retenue** pour
  son bien — une seule (index unique en base) : sa mensualité et sa durée
  passent sur la fiche, sur accord ; le dossier banque la présélectionne ;
  l'achat la rappelle. ⚠️ Le Suivi financier lit la mensualité de la FICHE, pas
  la simulation : quand elles diffèrent, l'écran le dit et propose « Mettre la
  fiche à jour ». **Le taux proposé** : le vôtre (Préférences métier), sinon le
  taux moyen officiel (fonction `taux-credit` : BCE, série Banque de France,
  mention en italique `.sf-source`), sinon celui de la dernière simulation,
  sinon rien. Le formulaire d'un bien PROPOSE une mensualité estimée
  (« Utiliser cette estimation »), il ne la pose jamais seul. Le PDF de la
  banque : voir « Import du PDF de la banque » (v=105).
  Tant que les colonnes de la v=99 n'existent pas (`sfsColonnesDispo`), ni
  assurance, ni « Retenir », ni taux personnel, et rien n'est envoyé pour eux.
  Garde : `simulateur.test.js`.
- **Import du PDF de la banque** (v=105, demande du 18/10 : « ces données sont
  sensibles… protégées et sécurisées avec une attention toute particulière »).
  Deux portes partout où l'on crée une simulation (page, état vide, fiche) :
  « Importer un PDF de la banque » (principal) et « Saisir une simulation »
  (`sfsBoutonsCreer`). L'import ouvre une fenêtre (`sfsImporter`) : déposer
  sur ordinateur, choisir dans Fichiers au doigt (iPhone, iPad), un PDF lâché
  n'importe où sur la fenêtre est lu. Le PDF est lu SUR L'APPAREIL, par motifs
  (aucune IA) : lignes reconstruites d'après la position des mots
  (`sfPdfLignes`), tableau des prêts puis libellés (`sfsLireOffre`) — jamais un
  TAEG pour le taux, ni une durée de validité ou de carence pour la durée ; la
  mensualité annoncée contrôle le calcul (±2 %). Le formulaire s'ouvre
  prérempli : un champ vide ou une valeur PROPOSÉE (`data-propose` : taux
  moyen, durée par défaut, coût du bien, revenus de la dernière simulation) se
  remplit, une SAISIE se garde et le PDF la propose (« Prendre les valeurs du
  PDF ») ; une valeur lue dans un premier PDF, pas retouchée, reste une
  proposition (un second PDF la remplace, nom et notes compris) ; un champ
  repris se dit « PDF » jusqu'à la première frappe ; un
  récapitulatif dit repris / non trouvés / gardés / plusieurs prêts / durée
  arrondie / mensualité discordante ; TAEG, mensualité annoncée et autres prêts
  vont dans des notes vides. **Sécurité** : signature `%PDF-`, 20 Mo
  (`SF_PDF_MAX` = limite du stockage), 40 pages, `isEvalSupported: false`,
  `disableFontFace`, travailleur libéré ; le TEXTE ne sort jamais de
  `sfsLirePdf` (ni journal — le nom d'une erreur seulement —, ni base, ni
  réseau : seuls des chiffres) ; rien n'est envoyé avant « Enregistrer », et
  seulement si « Garder ce PDF dans mon espace privé » (coché par défaut) ;
  envoi APRÈS la ligne, nom neutre (`SF_PDF_NOM`, jamais le nom du fichier de
  l'appareil), `cacheControl: '0'`, type imposé ; ouverture par un lien de 60 s
  sans cache (`TI_STORAGE.lienCourt`), fenêtre sans `opener` ; « Retirer le
  PDF » sur la lecture ; un PDF ne se duplique pas avec sa simulation. Bucket
  `simulations-pdf` privé, règle `storage_owns_path` + `compte_actif`, aucune
  règle administrateur (vérifié en base le 18/10). Garde : `import-pdf.test.js`.
- **Chiffres clés sur téléphone** (v=99) : deux colonnes sous 560 px
  (`.sff-kpis`, `.sfb-kpis`, `.mfx-kpis`, `.acc-kpis`), le dernier impair sur
  toute la largeur. Garde : `mise-en-page.test.js`.
- **Les aides « ? »** (v=100, arbitrage du 16/10) : l'interface reste épurée.
  Derrière un « ? » (`sfAide(html, sujet, id)`), les EXPLICATIONS : pourquoi un
  chiffre manque, ce qu'il couvre, à quoi sert une page, un champ, une section,
  l'explication d'un état vide. Restent VISIBLES : les chiffres, leur unité ou
  leur période quand elle en change le sens (« par mois », « assurance
  comprise », « frais et travaux compris »), les données (ville, surface,
  dates, « sur 6 200 € dus »), les jugements qui doublent une couleur (« en
  dessous de votre seuil »), les sources citées (mention en italique), les
  messages d'erreur et les retours d'action. Le sous-titre descriptif d'une
  page passe derrière un « ? » accolé au titre ; les actions rapides de
  l'accueil n'ont plus de sous-ligne. ⚠️ Un « ? » ne vit JAMAIS dans un
  `<button>`, un lien, un `<label>` ou un `<summary>` : à côté du libellé, dans
  `.sf-tete`. Dans un chiffre clé, il se tient en haut à droite de la carte.
  Une aide de champ garde son id (`aria-describedby`). Échap referme la bulle.
  Une information qui évite une erreur de saisie va dans le LIBELLÉ lui-même
  (« Date de sortie · dernier jour du bail »). Garde : `aides.test.js`.
- **Tendance des taux** (v=100, Simulations) : le taux moyen (Banque de
  France), sa courbe sur 24 mois et UNE phrase factuelle (« En baisse depuis
  5 mois · 4,02 % il y a un an »), l'OAT 10 ans et le taux de dépôt de la BCE.
  Elle dit d'où l'on vient, JAMAIS où l'on va : aucun conseil (« c'est le
  moment »…), aucune couleur de gain ou de perte. Chaque partie de la réponse
  serveur est facultative et vérifiée (`sfSerieValide`) ; une partie absente se
  tait. Garde : `simulateur.test.js`.
- **Choix segmenté** : `.sf-choix` (components.css) — des boutons
  `aria-pressed` pour quelques valeurs visibles ; toucher le choix retenu le
  retire. Le choix retenu se dit par la bordure, le fond ET une pastille.
- **Confirmation** : `sfConfirmer({...})`, jamais `confirm()` natif (garde
  `impasses.test.js`). Elle a sa propre fenêtre, au-dessus de tout
  (`--sf-z-confirm`). ⚠️ son `question` est échappé, son `detail` ne l'est PAS.
  Sur un acte destructeur (`danger: true`), le focus va à « Annuler ». Un acte
  IRRÉVERSIBLE ajoute `saisie: { attendu, libelle }` : le bouton reste fermé
  tant que le texte attendu n'est pas tapé (v=102).
- **Ligne à pastille** (numéro ou icône + titre, `.acc-pas`, `.sf-alert`) :
  centrée (`align-items: center`). Depuis que l'explication passe derrière le
  « ? », un titre est souvent seul : aligné en haut, il restait 4 à 8 px
  au-dessus du centre de sa pastille (capture du 17/10). Mesuré sur 56 écrans
  par la sonde d'alignement du banc ; garde `mise-en-page.test.js`.
- **Écran tactile** : un `title` ne s'affiche jamais au doigt. Toucher un
  élément NON interactif titré l'affiche dans une bulle (`sfBulleCible`) ; une
  information indispensable doit rester visible, pas seulement titrée.
- **Mots de passe** : vérifiés contre Have I Been Pwned (5 caractères de
  l'empreinte, jamais le mot de passe) ; un service muet ne bloque personne.
  Les erreurs disent la vraie raison du refus d'un MOT DE PASSE
  (`authErrorToFr`). **12 caractères au moins** pour tout mot de passe choisi
  (`SF_MDP_MIN`, v=102 ; NIST SP 800-63B-4 en demande 15 sans second facteur).
- **Inscription libre** (arbitrage du 17/10, v=102) : elle reste ouverte.
  Donc : aucun message ne dit si une adresse a déjà un compte ; un compte non
  validé ou bloqué n'accède à AUCUNE donnée, en base (`sf_compte_actif()`,
  règle restrictive `compte_actif` sur 16 tables et le stockage,
  `GARDE-COMPTES-ACTIFS.sql`, jouée et éprouvée le 17/10) et aux
  fonctions serveur (`compteActif`) ; l'administrateur voit le nombre de
  comptes en attente sur l'icône « Utilisateurs » (`sfMajAttente`) et peut
  Valider / Refuser (en attente), Bloquer (actif), Réactiver / Supprimer
  (bloqué). Supprimer = fonction `admin-delete-user` : saisie de contrôle de
  l'adresse (`sfConfirmer({ saisie })`), jamais un administrateur ni soi-même,
  compte bloqué → fichiers effacés → compte supprimé (cascade). Garde :
  `comptes.test.js`, `fonctions-serveur.test.js`.
- **L'adresse personnelle du propriétaire n'est JAMAIS publique** (consigne du
  17/10) : ni dans le code, ni dans le dépôt, ni dans ce qu'un utilisateur
  reçoit. Le rôle admin se lit dans le profil ou le jeton (`app_metadata`),
  jamais par une adresse. Les exemples s'écrivent en `@exemple.fr`. Garde :
  `vie-privee.test.js` (aucune adresse d'un fournisseur personnel dans le dépôt).
- **Pas d'entrée « Bientôt »** : une section non construite n'est pas affichée
  (`sfParamPropose`) ; elle réapparaît quand son statut passe à `'ready'`.
- **Navigation** (v=103, arbitrage du 17/10) : un bandeau À PLAT — Accueil ·
  Mes biens · Suivi financier · Locataires · Administration — et un menu
  **Outils** (Simulations de crédit, Comptes rendus, Marché immobilier,
  Portails immobiliers). Le libellé d'une entrée est le TITRE de la page
  qu'elle ouvre. La page courante se dit (`active` + `aria-current="page"`),
  sous-pages comprises (`SF_NAV_PARENT` dans `navigate`). Les **Locataires**
  ont leur page (route `locataires`, `renderLocatairesPage`) ; l'ancien onglet
  du Suivi financier retombe sur Performance. Garde : `navigation.test.js`.
- **Une action mène là où elle se fait** (v=103) : « Pointer » ouvre le Suivi
  mensuel de l'exercice, « Saisir une charge » la fenêtre de saisie, « Ajouter
  un locataire » la fenêtre sur le bien concerné, « Compléter » la fiche sur
  l'onglet du champ manquant (plusieurs biens : la liste filtrée). Chaque
  destination est écrite une fois (`sfAller*`, `sfOuvrirFiche`,
  `sfOuvrirBiens`) ; un onglet demandé est une clé de `TAB_DEFS`.
- **Accueil** (v=103, v=104) : plus de bandeau « verdict ». Ordre : « Votre
  patrimoine » (SEULEMENT avec un bien acquis — avant, ses cartes disaient
  trois fois « non disponible » : le parcours dit ce qui les fera naître),
  « À traiter » (l'argent passe avant le démarrage), « Pour démarrer »,
  « Actions rapides », puis « Prochaines échéances » et « En prospection ».
  « Tout est à jour » ne se dit jamais pendant le démarrage ; le point « À
  traiter » qui promet le prochain geste du parcours s'efface devant lui.
  **Prochaines échéances** (v=104, ex-Agenda) : loyers attendus ET échéances
  administratives (`sci_echeances`, lues dans la vague du démarrage) des
  60 jours, de la plus proche à la plus lointaine, l'horizon dit en date
  (« d'ici le 17 décembre ») ; une échéance faite sort, dépassée elle reste
  « En retard » ; celle du générateur de test suit l'interrupteur des biens de
  test ; une échéance mène à Administration › Échéances (`sfAllerEcheances`),
  « Programmer une échéance » y ouvre la saisie ; « aucune » ne se dit que si
  elles ont été lues (`sfEcheancesLues`). **En prospection** : deux lignes par
  fiche (titre, puis statut et ville), un vrai bouton, « Tout voir dans Mes
  biens ». Le cashflow s'appelle « Cashflow réel » comme sur la fiche (plus
  « Ce que ça rapporte »). Gardes : `parcours.test.js`, `accueil.test.js`.
- **Laisser de l'air** (v=104, demande du 18/10) : cinq distances dans
  `tokens.css`, qui grandissent avec l'écran — `--sf-rythme-section` (entre
  sections titrées, 36-56 px), `--sf-rythme-bloc` (entre cartes, empilées ou
  voisines, 20-28 px), `--sf-rythme-titre` (titre → contenu), `--sf-pad-carte`
  (intérieur d'une carte, d'un chiffre clé), `--sf-pad-ligne-y/x` (une ligne
  de liste). Un bloc qui structure une page les emploie, jamais une distance
  brute. Mesuré au banc (sonde d'espacement, 55 écrans) : lignes 12 → 15,5 px,
  cartes voisines 12 → 23 px, hauteur des pages + 4 à 7 %. Garde :
  `mise-en-page.test.js`.
- **Une valeur absente se dit, calmement** (v=104) : dans un chiffre clé, une
  PASTILLE « Non disponible » (dessin des pastilles de statut, 12 px, centrée
  sur la ligne qu'occuperait le chiffre grâce à `--sf-v-taille`), par UNE règle
  commune en fin de styles.css, à double classe, APRÈS les tailles qu'elle doit
  battre ; dans une ligne de détail, `sfAbsent()` (texte calme, police de
  l'interface). « Non disponible » toujours avec sa majuscule en valeur.
  Garde : `mise-en-page.test.js`, `aides.test.js`.
- **Chasse fixe et milliers** (v=104) : toute règle en `--sf-font-num` pose
  `word-spacing:var(--sf-num-espace)` (-0,3 em) — l'espace U+00A0 y valait la
  largeur d'un chiffre (« 168  000 € ») — et seulement elle : ailleurs, il
  écrase les espaces. Un sous-titre en texte (« 5 fiches sur 5 », « d'ici
  le… ») est en police d'interface, sans `sf-num`. Garde : `typographie.test.js`.
- **L'action principale vit dans l'en-tête de la page** (Mes biens « Ajouter
  un bien », v=104, comme Simulations et Comptes rendus) : en fin de barre
  d'outils, elle tombait seule sur une seconde ligne.
- **Chiffres clés sans case vide** (v=103) : `.acc-kpis`, `.sfb-kpis`,
  `.sff-kpis`, `.mfx-kpis` se règlent sur leur NOMBRE (`:has`) : 4 → deux par
  deux puis une ligne dès 900 px ; 5 → « 3 + 2 » puis une ligne dès 1 180 px.
  Vérifié par la sonde des grilles du banc (58 écrans, 15 largeurs).
- **Mes biens sur tablette** (v=103) : sous 1 000 px, la liste s'ouvre en
  grille (le tableau demande 970 px) ; une vue CHOISIE est retenue sur
  l'appareil (`sf_vue_biens`, `sfVueParDefaut`).
- **Administration à la charte** (v=103) : titre + « ? » et onglets soulignés
  (`.mfx-top`, `.mfx-tabs`) ; les compteurs vivent dans les onglets, l'urgence
  des échéances en pastille d'alerte avec son libellé lu.
- **Paramètres** (v=103) : « Apparence » (une phrase) et « Mes SCI » (doublon
  d'Administration) sont retirées ; un ancien lien `#parametres/sci` mène à
  Administration. L'outil de migration base64 est retiré (plus rien à migrer,
  vérifié en base le 17/10). **Données propose l'export complet** : un JSON
  préparé sur l'appareil (`sfExporterDonnees`, `SF_EXPORT_TABLES`), chaque
  lecture filtrée sur le compte, le profil sans e-mail ni données
  d'administration, aucun fichier partiel sur une erreur. Toute table que
  l'application écrit doit y figurer (garde `export.test.js`).
- **Photos** (v=103) : réduites sur l'appareil avant l'envoi (1 600 px, JPEG,
  HEIC converti ; l'original part si la lecture échoue — `sfReduirePhoto`),
  liens signés en une requête (`TI_STORAGE.signedUrls`), images en
  `loading="lazy"`.
- **Démarrage** (v=103) : profil, préférences et données partent en UNE
  vague (`sfEntrer`) ; rien n'est gardé avant que le profil ait dit « actif ».
  L'écran se dessine avant le script (squelette, `sf-session` posé par un
  script en tête d'`index.html`). Garde : `demarrage.test.js`.
- **Ne jamais recopier une énumération en dur** : tout passe par `TI_BIENS`
  (statuts dérivés de `PHASE_MAP`).

## Sources uniques — appeler la fonction, ne jamais réécrire la règle

Une règle métier écrite deux fois finit par diverger : c'est la cause des trois
findings hauts de l'audit du 05/08 et des deux générateurs de loyers.

| Règle | Source unique |
|---|---|
| Affichage d'un cashflow (réel / attente / estimé) | `cfDisplayData()` — jamais `computeCF()` seul pour agréger |
| État d'un loyer, retard, impayé | `sfLoyerEtat()` |
| Jour d'échéance d'un loyer pour un mois donné (un « 30 » tombe le 28 en février) | `sfJourEcheance()` — jamais un plafond fixe à 28 |
| Dû et encaissé (`charges_encaissees IS NULL` = « non suivi », pas zéro) | `sfDuEtEncaisse()` |
| Prorata d'un loyer | `mfLoyerProrata()` |
| Génération des loyers | `autoGenerateLoyers()` |
| Détacher les biens d'une SCI avant de la supprimer | `sciDetacherBiens()` |
| Nom d'affichage du compte | `sfProfilNom()` |
| Échappement HTML | `esc()` · URL : `safeUrl()` · argument JS dans un `onclick` : `escJs()` |
| Montant d'un champ éditable | `ieEur()` (jamais la valeur *affichée* dans un `<input>`) |
| Couleur pour Chart.js | `sfToken()` (un canvas ne lit pas `var()`) |
| Un bien compte-t-il dans les chiffres ? | `sfBienCompte()` / `sfBiensComptes()` — seules `sfBienDeTest()` et elles lisent `is_test` |
| Rôle administrateur (côté client) | `sfEstAdmin()` |
| Montant saisi dans un champ (« 168 000 », « 1 200,50 ») | `sfLireNombre()` — jamais `parseFloat` sur une saisie |
| Rédaction d'un cashflow (libellé, valeur, sous-titre) | `sfResumeCashflow()` — fiche et formulaire |
| Champs de la fiche bien (ordre, sections) | `SFN_SECTIONS` ; libellés et types : `TI_BIENS.CHAMPS` |
| Critères de la grille de visite | `SF_GRILLE` ; ce qui entre en base : `sfGrilleNormaliser()` |
| Ligne d'un compte rendu (liste et onglet Comptes rendus de la fiche) | `sfcLigneHtml()` |
| Amener à l'écran ce qu'on vient d'ouvrir (téléphone) | `sfAmenerDansLeChamp()` · onglet ouvert dans sa barre : `sfOngletDansLeChamp()` |
| Lire le texte d'une annonce collée | `sfAnnonceLire()` |
| Source d'une annonce d'après son lien | `sfSourceDepuisLien()` (`SF_SOURCES_DOMAINES` ⊂ `TI_BIENS.SOURCES`) |
| Montant saisi à l'année, compté par mois | `sfnChampAnnuel()`, appliqué dans `getFormData()` |
| Calcul d'un crédit (mensualité assurance comprise, coût, endettement) | `sfSimCalcul()` · depuis une ligne en base : `sfSimDepuisLigne()` · jugement : `sfSimEndettement()` |
| Taux de crédit proposé | `sfTauxParDefaut()` · taux officiel : `sfTauxReference()` · sa mention : `sfTauxMention()` |
| Ligne d'une simulation (liste et Plan de financement de la fiche) | `sfsLigneHtml()` · simulation retenue d'un bien : `sfsCreditRetenu()` |
| Boutons pour créer une simulation (page, état vide, fiche) | `sfsBoutonsCreer(bienId)` |
| Lire le PDF de la banque (fichier → chiffres) · lignes d'une page · chiffres d'un texte | `sfsLirePdf()` · `sfPdfLignes()` · `sfsLireOffre()` — vérifier un fichier : `sfsVerifierPdf()` |
| Ce que le PDF change dans la saisie (vide ou proposé : rempli ; saisi : gardé) | `sfsPlanLecture()` · appliqué par `sfsAppliquerLecture()` |
| Envoyer le PDF gardé · l'ouvrir · le retirer | `sfsEnvoyerPdf()` · `openPdfSim()` · `sfsRetirerPdf()` |
| Lien d'un document sensible (60 s, sans cache) | `TI_STORAGE.lienCourt()` |
| Date du jour, date d'un objet `Date` (YYYY-MM-DD, heure locale) | `sfAujourdhuiIso()` · `sfDateIso()` |
| Une explication derrière un « ? » | `sfAide()` — jamais un `title=`, jamais une ligne grise sous la valeur |
| Un chiffre clé des pages à la charte (libellé, « ? », valeur, sous-ligne) | `sfKpi()` |
| Tendance d'une série de taux · série venue du réseau · « août 2026 » | `sfTendance()` · `sfSerieValide()` · `sfMoisLong()` |
| Lire une table qui grandit (loyers, charges) au-delà de 1 000 lignes | `sfLireTout()` — ordre total, l'id départage |
| Fichiers d'une SCI à effacer avec elle (ses documents ET tout son dossier `uid/<sci>/` ; lus AVANT, effacés APRÈS la ligne) | `sciFichiers()` |
| Erreur d'un lot d'écritures Supabase (qui ne lèvent pas) | `sfPremiereErreur()` |
| Ce que le générateur de données d'administration de test écrit, et la seule chose que sa purge reconnaît | `SF_TEST_ADMIN` |
| Un compte est-il actif ? (base · fonctions serveur) | `sf_compte_actif()` · `compteActif(req)` |
| Nombre de comptes en attente sur l'icône du bandeau | `sfMajAttente()` |
| Bouton de suppression définitive d'un compte | `btnSupprimer()` → `adminDeleteUser()` → fonction `admin-delete-user` |
| Longueur minimale d'un mot de passe choisi | `SF_MDP_MIN` |
| Bibliothèques et leurs empreintes | `vendor/` · `vendor/empreintes.json` · chargement à la demande : `SF_BIBLIOS`, `sfChargerBiblio()` |
| Mettre en forme un nombre (milliers U+00A0) | `sfNombre()` — `fmt()`, `sfEur()`, `sfPctNum()` passent par elle |
| Valeur initiale d'un champ de montant (0 reste 0) | `sfValeurChamp()` |
| Où mène une action (accueil et ailleurs) | `sfAllerPointer()`, `sfAllerSaisirCharge()`, `sfAllerAjouterLocataire()`, `sfAllerCompleter()`, `sfAllerMensualite()`, `sfAllerEcheances({ nouvelle })` · `sfOuvrirFiche(id, onglet)` · `sfOuvrirBiens({ onglet, etat })` |
| Prochaines échéances de l'accueil · échéances administratives proches | `sfAgenda60j()` · `sfEcheancesProches()` (`SF_AGENDA_JOURS`, `SF_MOIS_COURTS`) |
| Lire les échéances administratives (démarrage et Administration) | `sfLireEcheances()` / `sfPrendreEcheances()` · lues ? `sfEcheancesLues` |
| Distances de mise en page | `--sf-rythme-section`, `--sf-rythme-bloc`, `--sf-rythme-titre`, `--sf-pad-carte`, `--sf-pad-ligne-y/x` (tokens.css) |
| Valeur absente : chiffre clé · ligne de détail | règle « UNE VALEUR ABSENTE » (fin de styles.css, classes `--none`) · `sfAbsent()` |
| Espace des milliers en chasse fixe | `--sf-num-espace` (tokens.css), posé avec chaque `--sf-font-num` |
| Entrer dans l'application (une vague) | `sfEntrer()` · `sfChargerDonnees()` / `sfAppliquerDonnees()` |
| Liens signés de plusieurs fichiers · vignettes | `TI_STORAGE.signedUrls()` · `sfUrlsVignettes()` |
| Réduire une photo avant l'envoi | `sfReduirePhoto()` · `sfDimensionsReduites()` |
| Jours de calendrier jusqu'à une date | `sfJoursJusqua()` — jamais `(date - maintenant) / 86 400 000` |
| Vue de Mes biens à l'ouverture | `sfVueParDefaut()` |
| Export complet des données · remettre un fichier | `sfExporterDonnees()`, `SF_EXPORT_TABLES` · `sfTelechargerFichier()` |

## Pièges connus — chacun a coûté au moins une fois

- **Ne jamais compter des jours en millisecondes** (heure d'été : 830 € écrits
  803 €). Une borne de fin de mois va jusqu'à 23:59:59.999 (`finDeJournee`).
  Une date n'est pas un instant : la date du jour se lit en heure locale
  (`sfAujourdhuiIso`) — `toISOString().slice(0,10)` donne la veille entre
  minuit et 2 h l'été. Les treize lectures fautives sont corrigées depuis la
  v=99 (garde `dates.test.js`, qui se place à Paris à 0 h 30 l'été).
- **Une réponse réseau ne s'affiche jamais telle quelle** : du taux officiel,
  on ne garde qu'un nombre borné et une période au format vérifié ; le libellé
  est écrit côté client (`sfTauxReference`).
- **Une écriture Supabase ne LÈVE pas** : elle rend `{ error }`. Un
  `Promise.all` de suppressions passe donc toujours, et l'écran disait
  « supprimé » sur un refus (v=101). Lire chaque `error`, ou `sfPremiereErreur()`.
- **Une requête rend au plus 1 000 lignes, sans erreur** (plafond PostgREST) :
  au-delà, les plus anciennes sortent EN SILENCE des chiffres. Une table qui
  grandit se lit par `sfLireTout()`, dans un ordre total (v=101).
- **Une purge par motif emporte ce qu'elle ne vise pas** : `ilike('%test%')`
  attrape « attestation », `'%TEST%'` une SCI « Testard ». Une purge ne
  reconnaît que l'égalité exacte avec ce que son générateur écrit (v=101).
- **Le stockage ne suit pas les clés étrangères** : une cascade supprime les
  lignes, pas les fichiers qu'elles désignent (un PDF de SCI orphelin trouvé
  à l'audit du 16/10). Lire les chemins avant, effacer les fichiers après la
  ligne — jamais avant, ou un refus laisse des documents sans fichier.
  **Exception assumée, le PDF de la banque** (v=105) : supprimer la simulation
  ou « Retirer le PDF » efface le FICHIER d'abord, et son échec arrête tout. Un
  document qui porte revenus et adresse, orphelin, ne se voit plus ni ne
  s'efface ; l'inverse laisse au pire une simulation sans PDF, qu'on supprime
  de nouveau. `TI_STORAGE.remove()` rend son erreur depuis la v=105 (elle
  était seulement journalisée : l'échec passait pour un succès).
- **pdf.js transfère le tampon qu'on lui donne à son travailleur, et le
  laisse VIDE** : une copie du fichier à envoyer se prend AVANT
  `getDocument` (`sfsLirePdf`), sinon on enverrait un PDF de zéro octet.
- **Le texte d'un PDF n'est pas dans l'ordre de lecture** : pdf.js rend ses
  morceaux dans l'ordre du flux (souvent colonne par colonne). Les coller
  bout à bout rendait un tableau illisible — c'est pourquoi l'import « ne
  marchait plus ». Reconstruire les lignes par la position (`sfPdfLignes`).
- **`auth.admin.generateLink()` n'envoie RIEN** : il fabrique un lien pour qui
  expédie ses propres e-mails. Pour envoyer : `resetPasswordForEmail()`,
  `inviteUserByEmail()` (v=101, l'écran annonçait un mail jamais parti).
- **Une dépendance de CDN en version flottante (`@2`) est une mise en
  production sans test** : le 15/10, la production a pris une version de la
  veille. Toute bibliothèque est épinglée à une version exacte (garde
  `audit-101.test.js`) ; monter de version = un geste testé au banc.
- **ESLint `no-undef` voit ce que `node --check` ne voit pas** : « Grouper par
  type » levait une ReferenceError (`TYPES` disparu) depuis le passage au
  registre `TI_BIENS`. Lancer, sur une copie d'app.js :
  `/opt/node-tools/node_modules/.bin/eslint` avec `no-undef` et les globales
  du navigateur (méthode dans le rapport d'audit du 16/10).
- **Un jeton de connexion reste valable jusqu'à son expiration** (1 h), même
  après un blocage ou une révocation de session (documentation Supabase) : seul
  un contrôle du statut à CHAQUE requête coupe l'accès sur-le-champ —
  `sf_compte_actif()` en base, `compteActif()` dans les fonctions serveur.
- **Une fonction SECURITY DEFINER contourne TOUTES les règles RLS**, y compris
  `compte_actif` : elle s'exécute avec les droits de son propriétaire. Les
  `*_my_*` des préférences sont tenues par un DÉCLENCHEUR
  (`trg_preferences_compte_actif`, `GARDE-PROFILS-BORNES.sql`, joué et éprouvé
  le 17/10), qui s'applique quel que soit le chemin. Toute nouvelle fonction SECURITY DEFINER qui écrit : la même question.
- **La CSP liste chaque service appelé** (`connect-src`) : un nouveau `fetch`
  vers un nouvel hôte casse EN SILENCE tant qu'il n'y est pas ajouté (garde
  `dependances.test.js`, qui relit les hôtes des `fetch` d'app.js).
- **Le banc substitue un faux Supabase** : son serveur retire les `integrity`
  d'`index.html`, sinon le navigateur refuse — à juste titre — le fichier
  substitué. Le démarrage avec les VRAIS fichiers se vérifie à part
  (`sbjs-essai.js` du 17/10 : empreintes acceptées, un octet modifié refusé).
  Depuis la v=103, les bibliothèques chargées à la demande portent leur
  empreinte dans app.js : le banc doit servir les VRAIS fichiers de
  `vendor/` (ne plus substituer chart.js ni pdf.js), sinon elles sont refusées.
- **Un écran qu'aucun test ne REND casse en silence** (v=100) : deux
  ReferenceError — « Mes biens » et la lecture d'une simulation — n'ont été
  vues qu'au banc, aucun test ne rendant ces écrans. Une garde d'écran appelle
  la fonction de rendu, elle ne lit pas seulement le source.
- **app.js écrit U+202F (espace fine) devant `€` et `%`, et U+00A0 entre les
  milliers** (v=103) : une recherche avec une espace ordinaire échoue en
  silence. 55 lignes écrivaient `${fmt(x)} €` avec une espace ORDINAIRE (le
  « € » partait seul à la ligne) : corrigées, garde `typographie.test.js`. Et un script Python qui écrit
  du JS : `${...}` dans une chaîne non formatée part tel quel dans le code
  (« ${N} » a cassé une page en v=100) — garde `aides.test.js`.
- **Retirer une ligne d'une liste de sélecteurs CSS peut emporter sa
  déclaration** (v=103) : la liste restante se recolle EN SILENCE à la règle
  suivante — le « ? » des états vides a pris la taille d'un titre de page. Et
  un bloc sans sélecteur (`{display:flex…}`) traînait depuis des mois. Garde :
  `mise-en-page.test.js` (liste interrompue, bloc sans sélecteur).
- **Un astérisque collé à une barre oblique FERME un commentaire** (CSS comme
  JS) : un commentaire de styles.css énumérait des classes à joker
  (`.bd-step` + astérisque + barre + `.bd-link`) ; la suite, lue comme du CSS,
  s'est collée au sélecteur de `.bd-link{…}`, qui a disparu en entier — depuis
  des mois, jusqu'à ce qu'esbuild le signale à la première publication
  construite (v=104). Le même piège a fermé deux commentaires en l'écrivant.
  Garde : `mise-en-page.test.js` (tout « fin de commentaire » ferme un
  commentaire ouvert).
- **Une règle de taille plus loin dans la feuille écrase un modificateur**
  (v=104) : les règles `--none` (16 px) de chaque famille perdaient contre les
  tailles de la v=100, posées plus bas à précision égale — « non disponible »
  s'affichait à 30-42 px. Un modificateur qui doit gagner se place APRÈS, ou
  porte une classe de plus ; le vérifier dans un vrai navigateur.
- **`word-spacing` négatif hors chasse fixe efface les espaces** (« 5fichessur5 »,
  v=104, une classe `sf-num` restée sur un texte passé en police d'interface).
- **Une sonde suppose des distances** : celle des grilles tolérait des écarts
  de 24 px au plus et a vu des « cases vides » quand le rythme les a portés à
  28 px. Lire l'écart calculé (`columnGap`), pas une constante.
- **`auto-fit` ne regarde pas combien d'éléments porte la grille** : 4 chiffres
  tombent en « 3 + 1 » et la case vide laisse voir le fond des séparateurs.
  Régler par le nombre (`:has(> :nth-child(4):last-child)`) ; une annulation
  doit avoir la même précision que ce qu'elle annule (`> :nth-child(n)`, pas
  `> *`).
- **Un pixel de texte qui dépasse sa cellule fait défiler un tableau** : sous
  Windows, une barre de défilement apparaît pour un pixel. `overflow-x:clip`
  sur la cellule (pas `hidden`, qui en ferait un conteneur de défilement).
- **`parseFloat(x) || défaut` remplace un 0 saisi par le défaut** : une
  assurance à 0 € devenait 33 €. Lire par `sfLireNombre()` et distinguer
  vide (`null`), illisible (`NaN`) et zéro.
- **Une garde contre le double envoi se pose AVANT le premier `await`** :
  posée après, deux appuis rapprochés passent tous les deux (v=96, trouvé au
  banc d'essai).
- **Une action référentielle est un chemin d'écriture** : lire les
  `ON DELETE` / `ON UPDATE` des clés étrangères, pas seulement les `update`.
- **Tout texte lu dans l'URL est hostile** (`error_description`, paramètres,
  hash) : un lien piégé suffit. `showAuthAlert` écrit du HTML — tout ce qui
  y entre passe par `esc()` (garde `authentification.test.js`).
- **Échappement** : un `<textarea>` EST du HTML généré ; un filtre
  `replace(/<[^>]+>/g,'')` ne protège pas (balise non fermée) ; une donnée
  tierce (NewsAPI, API publiques) est la plus exposée. Garde : `echappement.test.js`.
  Le 16/10, un balayage au banc avec TOUS les champs de texte libre piégés
  (`"><img onerror=…>`) et chaque élément cliquable de 56 écrans a trouvé la
  seule fuite qu'aucune lecture n'avait vue : la ville sur les cartes du kanban.
  Le rejouer après tout nouvel écran (méthode dans le rapport d'audit).
- **`.sf-pick`** déplace le `<select>` 30 ms après son insertion → focus perdu
  sans `blur`. Créer un select pour interagir ⇒ `sfSelectHabillerMaintenant()`.
  Son panneau est téléporté dans `<body>` : tout garde global teste
  `.sf-pick, .sf-pick__panel`. Tester sur une liste qui **défile**.
- Migration emoji → SVG : `textContent` affiche le SVG en toutes lettres ; une
  `<option>` n'accepte que du texte ; certaines chaînes ne sont pas des gabarits.
- `roleColors` reste en hexadécimal 6 chiffres (`${couleur}22`).
- `.sff-line` fait **5 colonnes** dans `styles.css` : surcharger, jamais
  réutiliser tel quel. Toujours `minmax(0,1fr)`, jamais `1fr` seul.
- **Safari sur iPhone cadre la page sur ce qui DÉPASSE** (v=98) : un seul
  élément plus large que l'écran et toute l'application s'affiche dézoomée,
  serrée à gauche. Trois causes trouvées : une grille en `1fr` nu (un titre
  long élargit sa colonne), des onglets `nowrap` en ligne, et un élément
  `fixed` caché par `opacity:0` + `transform` (sa boîte reste dans la page).
  Donc : `minmax(0,1fr)` partout (garde `mise-en-page.test.js`) ; un élément
  caché se cache par `display:none` ; `html, body{overflow-x:clip}` n'est
  qu'un filet — jamais `hidden`, qui casse le `position:sticky`.
- **Une clé d'onglet inconnue retombe EN SILENCE sur « Le bien »**
  (`if(!TAB_DEFS[bienDetailTab])`) : `saveAction` demandait encore `'actions'`,
  renommé `'nego'` au passage à six onglets, et chaque échange renvoyait loin
  de la Négociation — depuis au moins le 14/08, plus ancien état du dépôt.
  Toute demande d'onglet est vérifiée contre `TAB_DEFS` (garde
  `comptes-rendus.test.js`).
- **Au doigt, AUCUN `<select>` n'est habillé** (`sfAmeliorerSelects` s'arrête
  sous `SF_SEUIL_MOBILE`) : un select sans classe garde le dessin du système,
  clair sur la charte sombre. Toujours une classe (`sf-input sf-select` à
  défaut). Les contrôles natifs suivent le thème par `color-scheme` (tokens.css).
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
- **`type="number"`** refuse « 168 000 » tel qu'une annonce l'écrit et fait
  dépendre la virgule du navigateur ; `parseFloat('168 000')` vaut 168. Champ
  texte + `inputmode="decimal"` + `sfLireNombre()`.
- **`<summary>`** : Safari a longtemps ignoré `display:flex` dessus, et il
  n'admet que du contenu phrasé. Le flex va sur un `<span>` intérieur.
- **`hidden` perd contre une classe qui pose `display`** (`.sff-block`,
  `.form-group`, `.sfn-f`…) : ajouter la règle `[hidden]{display:none}`.
- **`toLocaleString('fr-FR')` sépare les milliers par U+202F** : « 150 000 »
  affiché n'est pas « 150 000 » tapé. Comparer des montants par
  `sfLireNombre()`, jamais par chaîne (deux contrôles s'y sont trompés en v=97).
- **Un domaine se reconnaît par égalité ou par le suffixe `'.' + domaine`**,
  jamais par `endsWith(domaine)` : « faux-pap.fr » finit par « pap.fr ».
- **Banc Playwright** : une capture `fullPage` coupe l'émulation tactile ;
  mesurer les cibles AVANT toute capture, une page neuve par vue. L'émulation
  iPhone (`isMobile: true`) reproduit le dézoom de Safari : mesurer
  `scrollWidth` en NEUTRALISANT le filet `overflow-x:clip`, sinon il masque
  le débordement qu'on cherche. Données longues (titre de 76 caractères).
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
- Les colonnes `is_test` de `locataires`, `loyers_mensuels`, `charges_reelles`
  divergent de celles de leur bien (28 loyers au 16/10) : elles ne sont lues
  NULLE PART, un loyer suit son bien (`sfLignesComptees`, `GARDE-BIENS-TEST.sql`).
- `update_my_appearance` n'est pas tout à fait morte : `persistAppearance()`
  l'appelle encore à la première connexion d'un compte dont `accent_color` est
  vide (vérifié au 16/10). Retirer cet appel AVANT de supprimer la fonction.
- Les 401 sur `/auth/v1/health` des journaux : ils ne viennent pas d'app.js
  (aucun appel à cette route).

## Où trouver l'état du projet

- **Le backlog** est tenu dans un artefact claude.ai de Thomas (« Backlog
  Stonefolio ») — demander le lien. Ses chiffres se re-mesurent avant d'être cités.
- Au dépôt, dans `docs/` : `CARTOGRAPHIE-AVANT-TEST.md` (état détaillé avant
  ouverture au testeur), `AVANT-INVITATION.md`, `REVUE-2026-08-13.md` (dont
  les trois options sur le découpage d'`app.js`), `AUDIT-2026-08-0{3,5}.md` ;
  dans `supabase/sql/`, les `MIGRATION-*.sql` et `GARDE-*.sql` (chacun dit
  s'il a été joué). L'audit complet du 16/10/2026 et le rapport « vitesse et
  parcours » du 17/10 sont publiés en artefacts (liens dans le backlog).
  `docs/BRIEF-REPRISE.md` est **périmé** (v=61) : historique seulement.

### Décisions encore ouvertes, à poser à Thomas plutôt qu'à trancher

- Découper `app.js` : une étape de construction existe désormais (la
  publication minifiée, v=103) ; le découpage lui-même reste à décider.
- L'arbitrage fiscal des provisions de charges dans la déclaration (une garde
  de test empêche de le faire par réflexe).
- Les données d'ADMINISTRATION de test (SCI, contacts, échéances) n'ont pas
  de drapeau en base : elles restent visibles dans Administration.
- Vocabulaire Cerfa : `CERFA_MAPPING` suit la 2044 (personne physique), alors
  qu'une SCI à l'IR dépose une 2072 — à voir avec un comptable.
- Réécrire l'historique git pour en effacer l'adresse personnelle (force-push
  sur `main`, irréversible) et/ou passer le dépôt en privé (GitHub Pro pour
  garder Pages) — à décider par Thomas, guidé.
- CAPTCHA Cloudflare Turnstile sur inscription, connexion et mot de passe
  oublié : il faut d'abord le compte Cloudflare de Thomas (clé de site).
- Second facteur (TOTP) pour le compte administrateur — le compte qui peut
  tout ; à construire.
