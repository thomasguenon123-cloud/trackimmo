# Plan d'action — workflow de préavis

> Suite de `CADRAGE-PREAVIS.md` (16/08/2026). Le cadrage disait **le droit** et ce qui
> restait à trancher ; ce document dit **comment l'implémenter** dans le code existant,
> dans quel ordre, et ce qu'il manque pour commencer.
>
> Analyse du code et de la base faite le **22/08/2026**. **Rien n'est implémenté** :
> aucune ligne de `app.js` n'est touchée par ce document.

---

## 1. Ce que le code sait déjà faire — plus que ce que le cadrage supposait

| Ce qui existe déjà | Où | Ce que ça évite |
|---|---|---|
| Le statut **`Préavis`** | `LOC_STATUTS` (app.js:6202) **et** contrainte `locataires_statut_check` en base | Aucune migration pour l'état lui-même |
| **`date_sortie`** (date) | colonne `locataires` | La colonne porteuse existe : c'est elle que le workflow doit remplir **juste, et une seule fois** |
| Le **prorata de sortie** | `mfLoyerProrata` (app.js:6171), `mfLocataireForBienMonth` (app.js:7142) | Les deux sont **calendaires**, pas statutaires |
| Le type de document **`edl_sortie`** | `LOC_DOC_TYPES` (app.js:6191) | L'état des lieux de sortie a déjà où se ranger |
| Deux échéances **`preavis`** et **`depot`** | `mfEcheancesBail` (app.js:8077) | L'échéancier a déjà ses lignes, il faut corriger leur calcul |
| Le **glisser-déposer qui ouvre un workflow** au lieu d'écrire | `kanbanDrop` (app.js:2437), colonne « Finalisé » | Le patron du 5ᵉ point à trancher du cadrage est déjà écrit et éprouvé |
| Le **brouillon d'acquisition** — rien n'est écrit avant confirmation | `bdAcq` (app.js:4456 et suivantes) | Le patron du workflow complet : collecte → confirmation → écriture d'un bloc → vue de succès |

### Réponse à la question 2 du cadrage
**« Les loyers attendus après la sortie doivent-ils cesser d'être comptés ? »**
Ils cessent **déjà**, par construction : `mfLoyerProrata` rend `0` pour un mois postérieur à
`date_sortie`, `mfLocataireForBienMonth` ne renvoie plus le locataire, et `mfLoueSurExercice`
/ `mfDansLePerimetre` en découlent. **Il n'y a rien à décider côté calcul.** Le problème est
ailleurs, et il est réel — voir §2.2.

---

## 2. Les trois défauts que le workflow doit corriger en même temps

### 2.1 « Préavis » n'existe que sur la carte — dix-sept lectures disent « Actif »

`statut === 'Actif'` s'écrit **17 fois** dans `app.js` (plus deux `!== 'Actif'`). C'est
exactement la dette n°3 de `REVUE-2026-08-13.md` (score 28), et sa conséquence est mécanique :
**un locataire en préavis occupe toujours le bien et paie toujours son loyer, mais aucune de
ces lectures ne le voit.**

| Ligne | Ce qui se passe aujourd'hui pour un locataire en préavis |
|---|---|
| `app.js:1532` | Le bien remonte en point d'attention **« acquis sans locataire »** — mensualité annoncée comme perdue alors que le loyer est dû |
| `app.js:1683` | `sfLoyersAttendus` **l'ignore** : ses loyers disparaissent de l'agenda 60 jours |
| `app.js:3727 · 4355 · 4479` | La fiche du bien n'a **plus de locataire** : bandeau, onglet Locatif, mise en gestion |
| `app.js:8997` | `mfStatutOccupation` rend **« Vacant »** sur un bien occupé |
| `app.js:6341 · 8142` | Le compte d'actifs et le **« loyer mensuel actif »** le perdent |
| `app.js:8343 · 8371` | Sa carte **cesse d'afficher ses impayés** : il peut devoir trois mois, la carte se tait |
| `app.js:9289` | Le contrôle **« un seul actif par bien »** ne le voit pas : on peut activer un second locataire sans un mot |

**Conséquence de plan : l'étape 1 n'est pas le workflow, c'est le socle.** Deux
prédicats posés comme source unique — `sfEstOccupant(loc)` (`'Actif' || 'Préavis'`) et
`sfLocataireEnPlace(bienId)` — le pendant de `sfEstAcquis` que la revue recommandait déjà.
Sans eux, le jour où le premier congé est enregistré, **huit écrans se mettent à mentir en
même temps.** ✅ **Livré le 22/08/2026 (v=74).**

### 2.2 Les loyers déjà générés après la sortie deviennent des impayés fantômes

`autoGenerateLoyers` (app.js:9404) génère les lignes **jusqu'à décembre** de l'année en cours,
dès l'activation du locataire. Un congé reçu en septembre laisse donc en base les lignes
d'**octobre à décembre, à plein tarif**, sur un bien vide.

Ce qu'elles deviennent, sans intervention :
- `sfLoyerEtat` les déclare **`'ko'`** dès l'échéance passée (ligne présente + non payée) ;
- `mfLoyersNonSoldes` les remonte avec **`locataire: null`** (plus personne ce mois-là) ;
- l'alerte de l'onglet Locataires annonce alors *« … loyers échus restent à encaisser »*
  au nom d'un **« Locataire inconnu »**, pour un montant qui n'est dû par personne ;
- et le consolidé compte ce `loyer_du` dans l'exercice.

✅ **Constaté en vrai le 22/08/2026**, sur le premier congé saisi par Thomas : sortie au
22/08, quatre lignes de septembre à décembre — **12 000 € de loyer et 2 000 € de charges**
promis sur un logement vide. **Sept écrans lisaient ces lignes, trois seulement savaient
les juger.** Corrigé en v=75 par `sfBailCouvre` et `sfLocataireDuLoyer` : plus aucun écran
ne réclame un loyer hors bail, et la garde vit dans `sfLoyerEtat`, source unique de l'état
d'un loyer. Restent deux choses, qui sont bien le travail du workflow :
les lignes fantômes **à supprimer**, et le **mois de sortie à repasser au prorata** (août
vaut 3 000 € en base pour 22 jours occupés).

**La confirmation du congé doit donc reprendre ces lignes** : recalculer le mois de sortie au
prorata, supprimer les mois strictement postérieurs — **et ne jamais toucher une ligne
encaissée** (`'Payé'`, `'Partiel'`, ou `montant_encaisse > 0`), qu'on signale au lieu de
l'écraser. C'est la seule écriture destructrice de tout le chantier : elle se compte et se
dit dans la vue de succès, comme `bdAcq` compte ses loyers générés.

### 2.3 Les deux dates d'après-sortie, déjà relevées au cadrage

`mfEcheancesBail` calcule `date_sortie + 1 mois` et affiche *« état des lieux conforme »*
comme si c'était établi. Deux erreurs : le délai court depuis la **remise des clés**, et il
vaut **2 mois** si l'état des lieux de sortie n'est pas conforme. À reprendre à l'étape 4.

---

## 3. Le plan — cinq étapes, livrables une par une

Chaque étape est un commit, une version `?v=N`, un déploiement vérifiable. Aucune ne laisse
la plateforme dans un état intermédiaire incohérent.

### Étape 1 — « Préavis » devient un état d'occupation ✅ **FAITE (22/08/2026, v=74)**
**Aucune colonne, aucun écran, aucun arbitrage à prendre.**
- `sfEstOccupant(loc)` et `sfLocataireEnPlace(bienId)` posés une fois, appliqués aux
  quatorze lectures listées en §2.1.
- Ce qui **ne** change **pas**, volontairement : `mfEcheancesBail` continue de ne produire
  « fin de bail » et « révision du loyer » que pour un `'Actif'` — un locataire qui part n'a
  pas besoin qu'on lui rappelle la reconduction de son bail.
- Trois défauts de plus, trouvés en revue du diff et corrigés dans la foulée : un
  locataire en préavis **ressuscité en « Actif »** par la mise en gestion ; un **préavis
  sans date de sortie** accepté en silence, qui ne déclenche jamais rien ; deux baux
  **qui se chevauchent** écrits sans un mot, alors que `loyers_mensuels` n'accepte qu'une
  ligne par bien et par mois.
- Vérification : `npm test` — 43 cas, 43 passent — dont **quatre gardes de régression
  validées PAR MUTATION** (on remet `=== 'Actif'`, le test tombe ; on retire la garde
  d'occupation de l'agenda, il tombe aussi).

### Étape 2 — les colonnes (migration guidée, comme la partie B)
📄 **Écrite : `MIGRATION-PREAVIS.sql`.** Additive, aucun invariant, aucune valeur par
défaut à rattraper — les cinq colonnes naissent NULL et rien ne change à l'écran.
⚠️ **Elle embarque aussi les comptes rendus** : `type_visite` passe à quatre valeurs
(les deux états des lieux), une colonne `conforme` porte le verdict, et `locataire_id`
sort de sa dormance. **Une seule manipulation Supabase au lieu de deux.**
⚠️ **Le renommage de la table en `comptes_rendus` n'y est PAS** : c'est un changement
cassant pour la plateforme déployée, et il n'apporte rien au préavis. Il part avec la
migration de l'écran à la charte (voir `NOTE-COMPTES-RENDUS.md`).
⚠️ Les **invariants croisés** sont écrits dans le fichier mais **en commentaire**, comme
la partie B de MODE-DETENTION : ils s'appliqueront quand le workflow saura les respecter.

| Colonne | Type | Rôle |
|---|---|---|
| `date_conge_recu` | `date` | **Le point de départ légal** — c'est la réception qui compte |
| `preavis_mois` | `smallint` (1 ou 3) | La durée **appliquée ce jour-là**, figée : la loi évolue, l'historique non |
| `preavis_motif` | `text` nullable | Le motif du préavis réduit, **choisi par toi, jamais déduit** |
| `date_remise_cles` | `date` nullable | Ce qui déclenche le délai de restitution |
| `edl_sortie_conforme` | `boolean` nullable | Trois états : oui · non · **pas encore constaté** |

`date_sortie` **reste la fin de préavis** — elle est déjà branchée sur tous les calculs.
Écrite par le workflow, modifiable à la main.

### Étape 3 — le workflow du congé (l'acte) ✅ **FAITE (22/08/2026, v=76)**
Copie du patron `bdAcq` : la fenêtre **collecte**, « Enregistrer le congé » **écrit d'un bloc**,
« Annuler » n'a rien à défaire.

1. **Vue 1 — le congé.** Date de réception · durée du préavis (3 mois par défaut en bail vide,
   1 mois en meublé) · *« Le locataire a-t-il droit au préavis réduit à un mois ? »* → si oui,
   le motif dans la liste des 8. **La zone tendue est demandée, jamais devinée** (arbitrage du
   cadrage). La date de sortie calculée s'affiche, et reste modifiable.
2. **Vue 2 — ce que ça change.** Les loyers restant dus jusqu'à la sortie, les lignes
   postérieures qui vont être reprises, celles qui ne le seront pas parce qu'elles sont
   encaissées. **Rien n'est écrit tant que cette vue n'est pas confirmée.**
3. **Vue 3 — succès.** Ce qui a été écrit, compté, pas deviné.

**Deux points d'entrée étaient prévus.** Un seul est livré : le **bouton sur la carte** du
locataire actif (« Enregistrer un congé »), et son symétrique sur une carte en préavis
(« Annuler le congé »).

✅ **Le glisser-déposer est arrivé avec l'étape 4**, comme annoncé — trois transitions ont un
acte derrière elles (Actif → Préavis, Préavis → Sorti, Préavis → Actif) ; les autres rendent la
carte et disent par où passer. Ce qui suit est l'arbitrage qui l'avait différé :

⚠️ **Le glisser-déposer était reporté à l'étape 4, et c'était un arbitrage assumé.** Un kanban
dont une seule colonne accepte le dépôt se lit plus mal qu'un kanban qui n'en accepte aucun :
« Sorti » n'aura son acte — remise des clés, état des lieux — qu'à l'étape suivante, et y
déposer une carte d'ici là recréerait exactement la donnée incomplète que le cadrage refusait.
Les deux actes arriveront donc ensemble, et le tableau deviendra cohérent d'un coup.

**Trois choses de plus, imposées par le workflow** :
- **« Préavis » quitte les boutons radio de la fiche locataire** — même arbitrage que « Acheté »,
  retiré de la picklist des biens le jour où l'acquisition est devenue un acte. L'option reste
  visible mais inerte, et cochée pour qui y est déjà.
- **Revenir à « Actif » efface le congé** (réception, durée, motif) : un statut et les colonnes
  qui le justifient ne peuvent pas se contredire. « Sorti » les conserve — c'est son histoire.
- **`mfEcheancesBail` cesse de déborder** : la restitution du dépôt se calculait à
  `setMonth(+1)`, qui rendait le 3 mars pour une sortie au 31 janvier. Elle passe par
  `sfFinPreavis`, la même arithmétique clampée — une seule dans le fichier, pas une juste et
  une fausse.

**Retour en arrière** : « Annuler le congé » remet `'Actif'`, efface les cinq colonnes et
`date_sortie`, et régénère les loyers effacés. Sans lui, une erreur de saisie est définitive.

### Étape 4 — la sortie, les clés, le dépôt (le second acte) ✅ **FAITE (23/08/2026, v=77)**
⚠️ **Qui dit remise des clés dit état des lieux de sortie, donc COMPTE RENDU.** L'analyse
de cette section — table `visites`, colonne `locataire_id` déjà présente et jamais
utilisée, trois architectures possibles — est dans **`NOTE-COMPTES-RENDUS.md`**.

Depuis une carte en préavis : **« Le locataire est parti »** → date de remise des clés ·
*« L'état des lieux de sortie est-il conforme à celui d'entrée ? »* → écrit `'Sorti'`.
C'est **à ce moment** qu'on sait, et pas avant.
Puis `mfEcheancesBail` est repris : délai ancré sur la **remise des clés**, **1 mois** si
conforme, **2 mois** sinon, et tant que rien n'est constaté on garde le plus court en le
disant (*« au plus tôt »*) — un rappel trop tôt est utile, l'inverse non.

### Étape 5 — « Baux qui se terminent » (onglet Locataires) ✅ **FAITE (23/08/2026, v=79)**

⚠️ **Le périmètre a changé, et c'est le test du 23/08 qui l'a imposé.** Un état des lieux
non conforme repousse la restitution du dépôt de 1 600 € du 20 octobre au 20 novembre — et
l'échéance **sort alors de l'échéancier**, qui ne montre que trois mois. Une obligation
chiffrée, dont le retard coûte 10 % du loyer par mois commencé, n'était plus visible nulle
part. Plus le constat est défavorable, plus l'échéance s'éloigne, et moins on la voit.

La box ne liste donc pas « les préavis en cours » mais **ce qui reste ouvert sur un bail qui
se termine** — trois natures, une seule question :
- un **préavis qui court** : il part quand, et que reste-t-il à encaisser d'ici là ;
- un **dépôt à rendre** : combien, avant quand, en retard ou non ;
- un **état des lieux non constaté** : il fige le délai au plus court.

**Une ligne par bail, pas une par obligation** — un même locataire cumule souvent le constat
manquant et le dépôt à rendre. Aucun total, aucun pourcentage, aucune carte d'indicateur :
des faits datés et l'action qui suit.

Elle a exigé une **partie D de migration** : sans `depot_restitue_le`, un dépôt déjà rendu y
resterait « à rendre » pour toujours, et une liste qui ne se vide jamais cesse d'être lue.

Ce qui suit était la maquette d'origine :

### ~~Étape 5 — la box « Préavis en cours »~~ (maquette initiale)
Elle n'apparaît **que s'il y a au moins un préavis** — comme l'alerte des impayés. Une ligne
par départ, quatre faits, **aucun KPI** :

> **Marie Dupont** · T2 Lyon 7e
> Congé reçu le 12/09 · préavis d'**un mois** (mutation professionnelle) · **sortie le 12/10**
> Il reste **21 jours** · **830 €** de loyer encore dus d'ici là
> `[ Le locataire est parti ]`

Après la sortie, la même ligne devient : *« Dépôt de 850 € à restituer avant le 15/11 —
état des lieux conforme »*, et se signale en retard quand la date est passée.
C'est le garde-fou que tu as posé : **de la valeur, pas une surenchère d'indicateurs.**

---

## 4. Deux calculs à écrire noir sur blanc (et à tester)

**`sfFinPreavis(dateConge, mois)` — réception + N mois.**
⚠️ `setMonth(m + 3)` **déborde** : un congé reçu le **30 novembre** donne « 30 février »,
que JavaScript reporte au **2 mars**. Il faut ramener au dernier jour du mois cible (28/29
février). Même famille que le prorata de mars faussé par l'heure d'été et que la borne à
minuit trouvée le 16/08 : **une date n'est pas un instant.** Fonction pure → test unitaire,
avec les cas 30/11, 31/12, 29/02 d'une année bissextile.

**`sfEcheanceDepot(remiseCles, edlConforme)`** — `+1 mois` si conforme, `+2` sinon, ancré sur
la remise des clés. Même clampage, même test.

---

## 5. Ce qu'il me manque — décisions à prendre

**Aucune ne bloque l'étape 1.** Pour chacune je donne ma recommandation : sans réponse de ta
part, c'est elle que j'applique, et je te la signale au moment de l'écrire.

**Arbitrages rendus par Thomas le 22/08/2026** : questions 1, 3 et 6 → recommandation
retenue. Question 7 (le contenu de la box) → **on la construit et on la teste en vrai**,
les retours viendront de l'écran, pas du document. Les autres restent sur ma
recommandation, à confirmer au moment de les écrire.

| # | Question | Ma recommandation |
|---|---|---|
| 1 | **Quelle date saisis-tu ?** La réception du congé (l'app calcule la sortie) ou la sortie directement ? | **La réception.** C'est la date légale, et c'est la seule que tu as sous les yeux quand la lettre arrive. La sortie calculée reste modifiable. |
| 2 | **Le motif du préavis réduit** : liste fermée des 8 cas, ou champ libre ? | **Liste fermée**, stockée pour mémoire, **sans contrôle de justificatif** : la plateforme enregistre ta décision, elle ne l'arbitre pas. |
| 3 | **La remise des clés** devient-elle une date distincte ? | **Oui**, demandée au second acte — au moment du congé, personne ne la connaît. |
| 4 | **L'état des lieux de sortie** : suivi ou demandé ? | **Demandé à la remise des clés**, en trois états (oui · non · pas encore constaté). |
| 5 | **La restitution effective du dépôt** (date + retenues) : on la suit, ou on se contente de rappeler l'échéance ? | **v1 : l'échéance seulement.** Suivre la restitution est une 6ᵉ étape légitime, pas un préalable. |
| 6 | **La pénalité de 10 % par mois de retard** : on l'affiche ? | **Non, pas en v1** — sans suivi de la restitution (question 5), ce serait un montant qui grandit tout seul sans jamais être vrai. On signale l'échéance dépassée, ce qui suffit à agir. |
| 7 | **Le contenu exact de la box** — la maquette du §Étape 5 te convient-elle ? | C'est **ta** question du cadrage : je propose quatre faits et un bouton. Dis-moi ce qui manque, ou ce qui est de trop. |
| 8 | **Un congé annulé** (le locataire se rétracte) : on prévoit le retour en arrière ? | **Oui.** Une erreur de saisie sur `date_sortie` efface des loyers ; sans retour, elle est définitive. |
| 9 | **Bail mobilité et saisonnier** : que fait le workflow ? | **Il accepte le congé mais ne propose aucune durée par défaut** — comme `mfEcheancesBail`, qui n'invente pas de date sur ces baux. |
| 10 | **La vérification juridique** du cadrage a-t-elle été faite ? | Le workflow **demande** au lieu de déduire : les seules affirmations de la plateforme sont *« réception + N mois »* et *« 1 ou 2 mois après la remise des clés »*. Le risque est faible, mais ces deux règles-là, il faut les avoir validées. |

---

## 5 bis. Chantiers connexes, révélés par ce plan

Le préavis n'a pas créé ces défauts — il les a rendus visibles, parce qu'un mois de sortie
est un mois partiel qu'on regarde de près.

| Chantier | État |
|---|---|
| **Le prorata des charges** — cinq chemins proratisaient le loyer et recopiaient les charges pleines | ✅ **Fait le 23/08/2026 (v=80)**, `sfProrataBail` |
| **La reprise de l'existant** — des lignes portaient des charges pleines sur un mois partiel | ✅ **Fait le 05/09/2026.** Test V1 09/2026 repris (490 → 376 €). Balayage complet des 28 lignes : ne subsiste que juin 2025, **payée**, délibérément jamais retouchée — les 163 € se soldent à la régularisation. |
| **La tacite reconduction n'est pas modélisée** — `date_sortie` sert d'échéance de bail *et* de départ effectif, alors qu'un bail arrivé à terme se **renouvelle** si personne n'a donné congé | ⏳ Ouvert. Conséquence : une date de sortie posée « pour plus tard » proratise son mois et coupe les loyers au-delà, sans qu'aucun congé n'existe. Il manque une échéance de bail distincte, renouvelable. |
| **L'encaissement des charges n'est suivi nulle part** — `montant_encaisse` ne solde que `loyer_du` | ⏳ Ouvert. Ce n'est pas un bug : c'est un choix jamais explicité, à trancher. |
| **Le modèle d'état des lieux** — grille pièce par pièce, inventaire obligatoire en meublé | ⏳ Ouvert, voir `NOTE-COMPTES-RENDUS.md` |
| **Les invariants croisés** (partie C de la migration) | 🔵 **Code livré le 05/09/2026 (v=81)** — `sfInvariantsBail` + `sfEffacementDepart`. Le SQL est décommenté et attend d'être joué par Thomas. |
| **Renommage `comptes_rendus` + migration de l'écran** | ⏳ Ouvert, à faire d'un seul tenant |

---

## 6. Ce qui reste hors périmètre, et pourquoi

- **Le congé du bailleur** — décision du cadrage : motif obligatoire, notice annexée,
  contrainte d'échéance de bail. C'est un second workflow, pas une option de celui-ci.
- **Le relet chevauchant** — *« loyer dû en totalité sauf si un nouveau locataire entre avant
  la fin du préavis »*. ⚠️ Obstacle **structurel**, pas fonctionnel : `loyers_mensuels` porte
  une contrainte **`UNIQUE (user_id, bien_id, mois, annee)`**. Un mois partagé entre deux
  locataires **ne peut pas** s'écrire aujourd'hui — il faudrait lever cette contrainte, donc
  retoucher toute la grille du suivi mensuel. À traiter seul, si le cas se présente.
- **La zone tendue** — jamais embarquée : décret évolutif, arbitrage déjà pris au cadrage.
