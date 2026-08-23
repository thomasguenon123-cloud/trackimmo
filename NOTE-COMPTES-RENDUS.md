# Note d'architecture — les comptes rendus

> Question de Thomas, 22/08/2026 : *« Qui dit remise des clés dit état des lieux de sortie
> à prévoir, donc comptes rendus. »* Il a raison, et la question arrive au bon moment :
> l'étape 4 du préavis va vouloir écrire un état des lieux, et il n'y a aujourd'hui aucun
> endroit pour le mettre.
>
> État des lieux du code et de la base au 22/08/2026. **Rien n'est implémenté.**

---

## 0. Arbitrages rendus par Thomas — 22/08/2026

| Décision | Réponse |
|---|---|
| **Architecture** | **A — on élargit `visites`.** Pendant que la table pèse deux lignes. |
| **Renommage** | **Oui** — la table devient `comptes_rendus`. ⚠️ **Reporté à la migration de l'écran** (22/08, voir ci-dessous) : décidé, pas annulé. |
| **État des lieux d'entrée** | **Dans le périmètre.** Sans lui, la sortie n'a rien à comparer. |
| Questions 4 à 6 | Recommandations retenues par défaut, à confirmer au moment de les écrire. |

**Conséquence de planning** : la partie additive des comptes rendus et celle du préavis
partent **ensemble, en une seule manipulation Supabase** (`MIGRATION-PREAVIS.sql`).

⚠️ **Le renommage, lui, en est ressorti** — question de Thomas le 22/08 : faut-il migrer
le design maintenant ? Non, et le renommage doit suivre le même sort. C'est un changement
**cassant** : huit appels `db.from('visites')` vivent dans `app.js`, et la plateforme
déployée cesserait de lire ses comptes rendus entre l'exécution du SQL et le déploiement
du code. Il n'apporte par ailleurs **rien** au workflow de préavis — il est cosmétique.
Il partira donc avec la migration de l'écran à la charte, qui réécrit ces appels de toute
façon : **une seule ouverture au lieu de deux.**

⚠️ Conséquence à ne pas oublier à l'étape 4 : quand le workflow créera un état des lieux,
l'écran actuel l'affichera comme « Visite locataire » — son libellé n'a que deux branches
(`type_visite === 'achat' ? 'Achat' : 'Locataire'`). Trois lignes à corriger à ce
moment-là, pas une refonte.

---

## 0 bis. Ce qui a été fait le 23/08/2026 (v=77)

L'architecture A est en place, **sans le renommage ni la migration de l'écran** :

- `type_visite` accepte les **quatre natures** (`SF_CR_TYPES` côté code, contrainte côté base),
  et les libellés viennent d'une source unique — quatre ternaires à deux branches disparaissent ;
- **`locataire_id` sort de sa dormance** : le formulaire le demande, `saveVisite` l'écrit, et un
  état des lieux sans locataire est refusé ;
- `conforme` est saisi sur les seuls états des lieux **de sortie** ;
- ⚠️ **le constat met à jour la conclusion** : enregistrer un EDL de sortie reporte son verdict
  sur `locataires.edl_sortie_conforme`, donc sur le délai de restitution du dépôt. **Un seul
  sens** — du constat vers le bail. Sans ce report, la fenêtre de sortie promettait « le délai
  sera recalculé » alors que rien ne le recalculait (§4 de cette note : deux faits différents,
  mais pas indépendants).

Restent à faire, ensemble : le **renommage** en `comptes_rendus` et la **migration de l'écran**
à la charte Stonefolio.

---

## 1. Ce qui existe déjà — la section n'est pas à construire, elle est à reprendre

La fonctionnalité **existe et tourne**. Ce qui n'a pas été fait, c'est sa **migration à la
charte Stonefolio** (phase 5, écran par écran).

| | État au 22/08/2026 |
|---|---|
| **Table** | `visites` — 2 lignes, toutes deux `type_visite = 'achat'` |
| **Colonnes** | `bien_id` · `date_visite` · `type_visite` · `adresse` · `note_sur_5` · `notes` · `photos` (legacy base64) · `photos_paths` (Storage) · **`locataire_id`** |
| **Écran** | `renderVisites` (app.js:11440) — page `visites`, déjà intitulée **« Comptes rendus »** dans `PAGE_LABELS` |
| **Fiche bien** | Un onglet **« Visites »**, section *« Comptes rendus de visite »* (app.js:4141) |
| **Photos** | Bucket `visites-photos`, migration base64 → Storage déjà écrite et passée |
| **Contrainte** | `visites_type_visite_check` : `'achat'` ou `'locataire'`, **et rien d'autre** |

### Trois constats qui orientent tout le reste

**1. `locataire_id` existe déjà — et n'est ni écrit ni lu.** La colonne est là, avec sa
clé étrangère `ON DELETE SET NULL`. `saveVisite` ne la met pas dans son `payload`, aucun
écran ne l'affiche. Une « visite locataire » ne sait donc pas **quel** locataire : elle
porte le type, pas la personne. La moitié du chaînage dont le préavis a besoin est déjà
en base, dormante.

**2. L'écran est à l'ancienne charte.** Dégradé `accent-g`, styles en ligne, étoiles
`⭐` en emoji, hero blanc sur vert. C'est l'un des derniers écrans non migrés : le
reprendre pour le préavis, c'est le migrer.

**3. Il n'y a rien à migrer côté données.** Deux lignes, aucune rattachée à un locataire.
Le coût d'un changement de modèle est, aujourd'hui, **nul**. Dans six mois, non.

---

## 2. Le vrai problème : un compte rendu n'est pas une visite

Aujourd'hui `type_visite` vaut `'achat'` ou `'locataire'`. Or ce que Thomas décrit —
*« visites, états des lieux, etc. »* — ce sont **des natures différentes du même objet** :

| Nature | Quand | Ce qu'elle engage |
|---|---|---|
| Visite d'achat | prospection | une décision d'investissement |
| Visite locataire | candidature | un choix de locataire |
| **État des lieux d'entrée** | remise des clés à l'entrée | la **référence** contre laquelle la sortie sera comparée |
| **État des lieux de sortie** | remise des clés au départ | **1 ou 2 mois** pour restituer le dépôt, et les retenues éventuelles |

Les deux premières sont des **impressions**, notées sur 5. Les deux dernières sont des
**constats contradictoires**, signés, qui produisent des conséquences chiffrées. Même
support — une date, un bien, une personne, des notes, des photos — mais l'état des lieux
porte en plus **un verdict** : conforme, ou pas.

⚠️ Et c'est ce verdict, et lui seul, qui décide du délai de restitution du dépôt.

---

## 3. Trois architectures possibles

### A. Élargir `visites` — la section devient « Comptes rendus »
`type_visite` passe à quatre valeurs (`achat`, `locataire`, `edl_entree`, `edl_sortie`),
`locataire_id` sort de sa dormance, une colonne `conforme` (booléen nullable) porte le
verdict des états des lieux.

- ✅ Rien à redévelopper : photos, Storage, groupement par bien, onglet de la fiche.
- ✅ `locataire_id` et sa clé étrangère sont **déjà là**.
- ✅ Une seule migration, additive, sur une table de deux lignes.
- ⚠️ Le nom `visites` reste en base alors qu'il ne décrit plus le contenu. On peut
  renommer la table — ou assumer l'écart, comme le dépôt `trackimmo` qui héberge
  Stonefolio.
- ⚠️ `note_sur_5` n'a aucun sens sur un état des lieux : le champ devient conditionnel.

### B. Une table `etats_des_lieux` à part
- ✅ Chaque objet a son modèle, sans champ qui ne s'applique qu'à la moitié des lignes.
- ⚠️ On redéveloppe photos, Storage, écran, onglet — pour un objet qui partage 90 % de
  sa structure avec l'autre.
- ⚠️ Deux endroits où chercher « ce qui a été constaté sur ce bien ».

### C. Une table `comptes_rendus` générique, qui remplace `visites`
Le modèle juste sur le papier : un compte rendu a un type, une date, un bien, parfois une
personne, des notes, des photos, parfois un verdict.
- ✅ Le nom dit ce que c'est, et la section porte déjà ce nom à l'écran.
- ⚠️ Renommage de table + reprise de tous les appels + bucket à renommer ou à conserver.
- ⚠️ Pour un gain qui, aujourd'hui, est **uniquement de vocabulaire** : A donne le même
  résultat fonctionnel.

**Ma recommandation : A**, et **maintenant** — pendant que la table pèse deux lignes.
C'est le seul moment où ce choix ne coûte rien. Si le nom `visites` gêne, un renommage de
table est une ligne de SQL qu'on peut poser dans la même migration.

---

## 4. Où vit le verdict de conformité — le point à ne pas rater

L'échéance de restitution du dépôt se calcule dans `mfEcheancesBail(loc, bien)`, qui ne
reçoit **que** le locataire et le bien, et lit des données déjà en mémoire
(`allLocataires`, `allBiens`, `allLoyers`). Les comptes rendus, eux, sont chargés **à la
demande**, sur la fiche d'un bien — il n'existe pas d'`allVisites`.

Deux façons de s'en sortir :

1. **Charger les comptes rendus au démarrage**, comme les locataires. Une collection de
   plus dans le socle, pour une donnée qu'un seul calcul consomme.
2. **Séparer le constat de la décision** — ma recommandation :
   - le **compte rendu** porte ce qui a été *observé* : photos, notes, relevés, signature ;
   - `locataires.edl_sortie_conforme` porte ce que le bailleur en *conclut*, et c'est
     cette conclusion qui engage le délai.

Ce n'est pas une duplication : ce sont deux faits différents, et ils peuvent légitimement
diverger — un compte rendu peut lister trois réserves sans que le bailleur retienne quoi
que ce soit. Le workflow de sortie pose la question une fois, écrit la conclusion sur le
bail, et **propose d'ouvrir le compte rendu pré-rempli** (date = remise des clés, type =
état des lieux de sortie, bien et locataire déjà renseignés).

---

## 5. Ce qu'il me manque

| # | Question | Ma recommandation |
|---|---|---|
| ~~1~~ | ~~A, B ou C ?~~ | ✅ **Tranché : A** (voir §0). |
| ~~2~~ | ~~On renomme la table ?~~ | ✅ **Tranché : oui**, `comptes_rendus` (voir §0). |
| ~~3~~ | ~~L'état des lieux d'entrée est-il dans le périmètre ?~~ | ✅ **Tranché : oui** (voir §0). Il existe déjà comme *document* (`LOC_DOC_TYPES.edl_entree`), ce qui n'est pas la même chose qu'un constat daté : le document est un fichier, le compte rendu est un fait daté qui fonde le verdict. |
| 4 | **Un compte rendu doit-il pouvoir exister sans bien ?** | Aujourd'hui oui (« visites générales », `bien_id` nullable) — à conserver pour l'achat, à interdire pour un état des lieux. |
| 5 | **Migre-t-on l'écran à la charte dans le même chantier ?** | Oui : le rouvrir pour y ajouter deux types sans le migrer, c'est le rouvrir deux fois. |
| 6 | **Les retenues sur dépôt** (montant, motif) : sur le compte rendu ou sur le bail ? | Sur le **bail**, avec la restitution — c'est un mouvement d'argent, pas une observation. Et c'est l'étape 6 du préavis, pas celle-ci. |
