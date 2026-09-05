# Cadrage — la première ouverture de Stonefolio

*Écrit le 05/09/2026, avant le test d'un bailleur extérieur. Tous les chiffres
de ce document sont mesurés sur le code et la base du jour, jamais estimés.*

---

## 0. Ce qu'on cherche à obtenir

Que quelqu'un qui n'a pas construit l'outil comprenne, dans ses trente premières
secondes, **ce que Stonefolio va faire pour lui** — et sache quoi faire ensuite.

Le testeur n'est pas un profil abstrait : il possède **plusieurs biens déjà
loués, avec des locataires en place**. Ce détail commande tout ce qui suit.

---

## 1. Le constat — ce que vit réellement un compte neuf

Un second compte existe déjà en base (0 bien, 0 locataire) : ce n'est pas une
hypothèse, c'est mesurable.

### 1.1 La couche de calcul tient

Vérifié en exécutant les indicateurs sur un contexte vide : `sfPointsAttention`,
`sfBauxQuiSeTerminent`, `sfLoyersAttendus` et `mfLoyersNonSoldes` rendent tous
des listes vides. Aucune exception, aucune valeur aberrante, aucun `NaN`. Les
indicateurs sans donnée affichent « non disponible », comme la règle l'exige.

**Il n'y a donc rien à réparer côté calcul.** Le chantier est éditorial et
narratif.

### 1.2 Le premier écran affirme quelque chose de faux

`renderAccueil` n'a **aucune branche « première ouverture »**. Le verdict se
calcule sur `pts.length === 0`, sans distinguer « rien à signaler » de « rien du
tout ». Un compte neuf lit donc :

> **Bonjour**
> ✓ **Rien ne demande votre attention**
> *Vos loyers sont pointés et vos fiches sont complètes.*

Et, plus bas : *« Tout est à jour — vous pouvez prospecter l'esprit tranquille. »*

Deux phrases fausses, à l'endroit exact où devrait se trouver la seule utile :
par quoi commencer. Le prénom lui-même est absent si le profil ne le porte pas —
« Bonjour » tout court.

### 1.3 Les autres écrans sont corrects, mais muets sur l'ordre des choses

Les états vides existent et proposent une action :

| Écran | Ce qu'il dit à vide | Action offerte |
|---|---|---|
| Mes biens | « Aucun bien acquis » | Ajouter un bien |
| Suivi financier | « Aucun bien dans votre portefeuille » | — |
| Comptes rendus | « Aucun compte rendu » | — |
| Simulateur | « Aucune simulation » | Commencer |
| Kanban | « Aucun code postal renseigné » | — |

Chacun est juste **pris isolément**. Aucun ne dit lequel vient en premier, ni
pourquoi. Un nouveau venu arrive sur un tableau de bord vide et doit deviner que
le point d'entrée est « Ajouter un bien », dans un autre menu.

### 1.4 Il n'existe aucune aide

Un seul point d'entrée dans toute l'application : un bouton « Relancer » dans
À propos, dont le gestionnaire est `showNotif('Tutoriel : bientôt disponible')`.
Une promesse tenue par une notification.

---

## 2. Le décalage de fond — l'outil est fait pour un acheteur, le testeur est un propriétaire

C'est le point le plus important de ce cadrage, et il n'est pas cosmétique.

Le parcours principal de Stonefolio est un **pipeline d'acquisition** :
je repère une annonce → je la qualifie → je visite → j'achète → je loue. Les
écrans, les statuts et le kanban racontent cette histoire.

Le testeur, lui, n'a rien à prospecter : **il possède déjà**. Or :

> `get STATUTS_SAISISSABLES() { return this.STATUTS.filter(v => v !== 'Acheté'); }`

**« Acheté » n'est pas un statut saisissable.** Le commentaire du code est
explicite : *« Deux gestes volontaires y mènent, et deux seulement : le bouton de
la fiche et le dépôt dans la colonne Finalisé du kanban. »*

Pour enregistrer un appartement qu'il loue depuis 2019, le testeur doit donc :

1. le créer comme **fiche de prospection** (statut « À visiter », « Offre faite »…) ;
2. le faire passer par le **workflow d'acquisition**, intitulé « Confirmer
   l'acquisition » et qui se termine sur un écran « **Félicitations** ».

Ça fonctionne. Mais on félicite quelqu'un pour un achat vieux de sept ans, après
lui avoir fait déclarer une intention d'achat qu'il n'a pas. Le détour n'est pas
long — le workflow ne demande que le mode de détention et le locataire — il est
**narrativement faux**, et c'est ce qui se remarque en premier chez un nouveau
venu.

⚠️ Un mode `reprise` existe déjà dans `bdAcq`, mais il ne fait pas ce qu'on
croit : il sert à rattraper un bien **déjà** « Acheté » dont le mode de détention
manque, et ne touche pas au statut (`if(bdAcq.mode === 'acquisition')
patchBien.statut = 'Acheté'`). Il n'ouvre pas la porte d'entrée du patrimoine
existant.

---

## 3. Le piège qui gâcherait tout — les loyers fantômes

Celui-là ne se voit pas à l'écran vide. Il se déclenche au moment précis où le
testeur saisit son **premier locataire réel**, et c'est le pire moment.

`autoGenerateLoyers` génère les échéances de **l'année en cours**, de janvier (ou
du mois d'entrée) à décembre, toutes au statut `'En attente'` :

```js
if(dEntree.getFullYear() === annee) moisDebut = dEntree.getMonth() + 1;
else if(dEntree.getFullYear() < annee) moisDebut = 1;
...
statut: 'En attente',
```

Un bail commencé en 2023 produit donc **douze lignes 2026 impayées**. Au 5
septembre, huit d'entre elles sont antérieures au mois courant, donc comptées par
`sfPointsAttention` comme « loyers échus non pointés » — voire « en retard », en
rouge, si le jour de paiement est passé.

**Trois biens à 800 € : l'application annonce environ 19 000 € d'arriérés qui
n'existent pas**, sur le premier écran, à quelqu'un qui a encaissé ces loyers.

Le pointage est heureusement d'**un clic** (`sfPointerLoyer` bascule la case),
mais il n'existe **aucune action groupée sur les loyers** — la barre `sfb-bulk`
ne porte que sur le statut des biens. Il faudrait donc ~24 clics pour effacer une
alerte qui n'aurait jamais dû s'afficher.

⚠️ Et l'historique d'avant l'année en cours n'est jamais créé : les KPI « sur 12
mois glissants » seront partiels sans que rien ne le dise.

---

## 4. La friction de saisie, mesurée

| Formulaire | Champs | Marqués obligatoires |
|---|---|---|
| Nouveau bien | **31** | 0 (validation en JS) |
| Fiche locataire | **24** | 0 |

Un portefeuille de cinq biens loués représente donc de l'ordre de **275 champs**
avant que l'outil ne dise quoi que ce soit d'utile. Aucun n'est marqué
obligatoire, donc rien ne distingue le minimum vital du confort — le nouveau venu
les traite tous comme requis, ou aucun.

---

## 5. Ce sur quoi on peut s'appuyer

Le socle est meilleur qu'il n'y paraît, et il faut le dire :

- les états vides **existent** sur tous les écrans, avec une action ;
- « non disponible » est déjà la règle quand la donnée manque ;
- les calculs tiennent le vide sans planter ;
- `sfPointsAttention` est **déjà** le bon véhicule : c'est une liste priorisée
  d'actions avec un enjeu chiffré et un bouton. Il lui manque simplement de
  savoir quoi dire quand il n'y a **rien** ;
- le workflow d'acquisition est court et bien fait — c'est son intitulé qui ne
  colle pas, pas sa mécanique.

---

## 6. Trois approches possibles

### A — La visite guidée
Une surcouche qui pointe les éléments d'écran l'un après l'autre.
**Contre :** elle explique l'interface, pas le métier ; elle se referme et on
n'y revient jamais ; elle vieillit à chaque changement d'écran. C'est aussi le
plus gros morceau à écrire.

### B — Le parcours de démarrage, porté par le tableau de bord
Le tableau de bord distingue « rien à signaler » de « rien du tout », et affiche
dans le second cas une **suite ordonnée de trois gestes**, chacun avec son
bouton, qui se coche à mesure. Même véhicule que les points d'attention, même
grammaire, aucun composant nouveau.
**Pour :** cohérent avec l'existant, réutilisable (il réapparaît si le compte
redevient vide), et il enseigne le métier — l'ordre des gestes *est*
l'explication.

### C — Le jeu de données de démonstration
Un bouton « remplir avec un exemple » qui crée deux biens et un locataire fictifs
pour que l'outil parle immédiatement.
**Contre :** il faudra les supprimer, et le risque de confondre données réelles
et fictives est exactement celui qu'on a passé six semaines à éliminer. La
colonne `is_test` existe mais n'est pas exploitée à l'affichage.

### Recommandation : **B**, avec deux correctifs qui ne sont pas optionnels

Le parcours de démarrage ne vaut que si les deux pièges structurels sont levés
d'abord — sinon il conduit poliment le testeur dans le mur :

1. **une porte d'entrée pour un bien déjà possédé**, qui ne passe pas par la
   prospection ni par « Félicitations » ;
2. **la question des loyers passés** au moment de saisir un bail antérieur :
   *« ce bail court depuis mars 2023 — les loyers de 2026 ont-ils été
   encaissés ? »*, une réponse, et les lignes naissent au bon statut.

---

## 7. Périmètre proposé

**Dans le périmètre**

1. Le tableau de bord distingue le compte vide et propose trois gestes ordonnés.
2. Une entrée « j'ai déjà ce bien » qui crée directement un bien acquis.
3. La question des loyers passés à la création d'un bail antérieur à l'année.
4. Le prénom demandé (ou l'accueil reformulé sans lui).
5. Le bouton « Relancer » d'À propos : soit il fait quelque chose, soit il part.

**Hors périmètre**

- La visite guidée pas-à-pas (approche A).
- Les données de démonstration (approche C).
- L'aide contextuelle sur chaque champ.
- L'import CSV d'un portefeuille : utile un jour, hors sujet pour un test.
- Le glossaire des notions métier — *sauf arbitrage contraire, cf. §8.*

---

## 8. Les arbitrages — tranchés le 05/09/2026

| Question | Décision |
|---|---|
| Porte d'entrée d'un bien possédé | **Rendre « Acheté » saisissable** dans le formulaire |
| Loyers passés d'un bail antérieur | **Poser la question une fois**, puis créer au bon statut |
| Vocabulaire métier | **Infobulles au point d'usage**, pas de page à part |
| Périmètre | **Les deux pièges + le parcours de démarrage** |

Les trois gestes retenus : **ajouter un bien → déclarer son locataire → pointer
un loyer**.

⚠️ **« Acheté » saisissable retire un garde-fou**, et il faut le dire. Le
commentaire du code était explicite : *« Deux gestes volontaires y mènent, et
deux seulement. »* Passer un bien en patrimoine engageait donc un acte réfléchi.
En ouvrant le statut au formulaire, on rend possible de le poser par
inadvertance dans une liste déroulante. Ce qui le remplace :

- le formulaire **demande le mode de détention** sur place quand « Acheté » est
  choisi — c'est déjà une règle obligatoire, elle devient le nouveau seuil ;
- le workflow d'acquisition **reste** le chemin depuis la prospection, avec sa
  confirmation ; on n'ouvre pas une porte, on en ajoute une deuxième.

---

## 9. Le terrain de test — iPad Pro, Safari, au doigt

Contrainte transmise le 05/09 : le testeur travaillera sur **iPad Pro avec
clavier**, donc en Safari, et surtout **au doigt**. Ça ne change pas le
périmètre, ça ajoute une dimension à chaque élément. Mesuré, pas supposé.

### 9.1 Le zoom automatique — le plus gênant, et le moins visible

> `.form-group input, .form-group select, .form-group textarea { font-size:13px }`

**Safari sur iOS et iPadOS zoome la page dès qu'un champ sous 16 px reçoit le
focus.** Tous les champs de l'application sont entre 11 et 14 px. Sur les
**31 champs** du formulaire d'un bien, chaque passage au champ suivant
déclenche un zoom que l'utilisateur doit défaire à la main.

C'est le défaut qui rendra la saisie pénible sans que personne ne sache le
nommer — on croira l'application « mal fichue sur tablette ». Correctif : porter
les contrôles de saisie à `16px` sur pointeur grossier, via
`@media (pointer: coarse)`, sans toucher au reste de la typographie.

### 9.2 Les actions révélées au survol

Cinq règles ne montrent une action qu'au `:hover`, dont deux sur des écrans du
quotidien :

- `.mfx-cell:hover .mfx-cell__more` — l'action d'une **cellule de loyer** du
  Suivi mensuel ;
- `.mfx-charge:hover .mfx-charge__a` — les actions d'une **charge**.

**Il n'y a pas de survol au doigt.** Safari émule un premier survol au premier
tap, ce qui transforme l'action en double-tap — quand ça marche. Correctif :
sous `@media (hover: none)`, ces actions deviennent visibles en permanence.

Le dépôt l'avait déjà compris ailleurs — la barre d'actions groupées porte le
commentaire *« des actions qui ne se révèlent qu'au survol sont invisibles au
clavier et au doigt »*. La règle existe, elle n'a simplement pas été appliquée
partout.

### 9.3 Les cibles tactiles

`--sf-control-h-sm: 30px`, et les boutons d'action de documents font **26×26 px**.
La recommandation d'Apple est de **44×44 pt**. On est 40 % en dessous sur les
petits boutons — atteignables, mais avec des erreurs de visée.

⚠️ Élargir toutes les cibles casserait la densité des écrans financiers, qui est
un choix assumé. Correctif proportionné : agrandir **la zone tactile** sans
changer la taille visuelle, par un pseudo-élément, et seulement sur
`pointer: coarse`.

### 9.4 Le glisser-déposer — à vérifier sur l'appareil, mais pas bloquant

Six occurrences : kanban des biens et kanban des locataires. Le glisser HTML5 au
doigt est capricieux sur iPadOS et **je ne peux pas le tester d'ici** — ça se
vérifie sur l'iPad, pas dans un document.

**Bonne nouvelle : ce n'est jamais le seul chemin.** Les cartes de locataire
portent des boutons qui appellent directement `sfCongeDemarrer` et
`sfSortieDemarrer`. Si le glisser ne répond pas au doigt, aucun workflow n'est
inaccessible — on perd un raccourci, pas une fonction. À confirmer au test.

### 9.5 Ce qui ne pose pas de problème

- Les **`confirm()` natifs** s'affichent correctement sur iPad — ils restent
  laids, c'est un autre sujet ;
- les champs `type="date"` ouvrent le sélecteur iOS, plus confortable qu'au
  clavier ;
- `100vh` est utilisé cinq fois, mais sur des éléments (barre latérale, tiroir,
  modale) où la barre d'adresse d'iPadOS ne provoque pas le décalage connu sur
  iPhone. À regarder au test, pas à corriger à l'aveugle.

### 9.6 Ce que l'iPad ajoute au périmètre

Trois correctifs CSS, tous sous requête média, aucun effet sur le bureau :

1. les contrôles de saisie à 16 px sous `pointer: coarse` ;
2. les actions au survol rendues permanentes sous `hover: none` ;
3. les cibles tactiles élargies sans changer l'apparence.

C'est peu de code et ça conditionne tout le reste : un parcours de démarrage
parfaitement écrit ne sauve pas une saisie qui zoome à chaque champ.
