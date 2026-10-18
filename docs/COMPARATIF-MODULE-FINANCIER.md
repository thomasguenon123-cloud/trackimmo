# Module financier — écran en ligne vs maquette

**Date** : 05/08/2026 · **En ligne** : v=59 · **Maquette** : `financier.html` itération 2

Méthode : inventaire des **capacités réellement câblées** dans `app.js` — 68 fonctions du
module, 45 gestionnaires d'événements, relevés dans le code et non de mémoire. Chaque capacité
est ensuite cherchée dans la maquette.

**Une régression est une capacité PERDUE.** Un changement de présentation qui conserve la
capacité n'en est pas une, et figure en fin de document sous « simplifications assumées ».

---

## Résumé

| | |
|---|---|
| Capacités inventoriées | **52** |
| **Régressions** | **21** |
| dont une action devient **impossible** | **9** |
| dont **information perdue** | **8** |
| dont **navigation perdue** | **4** |
| Simplifications assumées (non régressives) | 7 |

---

## A. Régressions bloquantes — une action n'est plus possible

### R-01 · La fenêtre d'encaissement disparaît
**En ligne** : clic droit ou bouton `•••` sur une cellule de loyer ouvre une fenêtre offrant
**quatre statuts** — Payé intégralement · Partiel (avec saisie du montant) · En retard (toujours
dû) · Impayé définitif — plus la **date d'encaissement**, des **notes**, et le rappel du
**prorata loi 1989** quand le locataire est entré en cours de mois.
**Maquette** : la cellule est cliquable, rien de plus.
**Conséquence** : impossible d'enregistrer un paiement partiel, une date d'encaissement réelle,
ou de distinguer un retard d'un impayé définitif. `mfOpenEncaissementPopup`, `mfPopupConfirm`,
`mfPopupStatutChange` n'ont plus de point d'entrée.

### R-02 · Modifier une charge existante
**En ligne** : `mfOpenChargeModal(charge)` depuis la liste des charges.
**Maquette** : on peut ajouter une charge, pas en rouvrir une.

### R-03 · Supprimer une charge
**En ligne** : `mfDeleteCharge(id)`, bouton corbeille sur chaque ligne.
**Maquette** : absent.

### R-04 · Le détail des charges d'un mois
**En ligne** : `mfOpenChargesDetail(bien, mois, année)` — une cellule qui porte plusieurs charges
les déplie toutes.
**Maquette** : la cellule affiche un total, sans moyen de voir ce qu'il contient.

### R-05 · Le filtre des charges par catégorie
**En ligne** : `mfSetChargesFilter(catégorie)`, pastilles construites depuis les catégories
réellement présentes.
**Maquette** : la liste des charges a disparu de l'onglet, le filtre avec.

### R-06 · Les quatre filtres du portefeuille
**En ligne** : Tous · Occupés · Vacants · Impayés (`setMfBiensFilter`).
**Maquette** : la table n'a aucun filtre.

### R-07 · Le tri du portefeuille
**En ligne** : `setMfBiensSort` — cashflow croissant/décroissant, rendement.
**Maquette** : ordre figé.

### R-08 · Les filtres de locataires par statut
**En ligne** : Tous · Candidats · Actifs · Préavis · Sortis, **avec le compteur de chacun**.
**Maquette** : une seule liste, sans filtre ni compteur.

### R-09 · Le rattachement de SCI depuis la Rentabilité
**En ligne** : `mfOpenBilanFeedModal(true)` — boutons « rattacher » / « changer » à côté du
sélecteur de bien.
**Maquette** : le nom de la SCI est affiché, sans moyen de le changer.

---

## B. Régressions d'information — un chiffre ou une donnée disparaît

### R-10 · Le graphique « Entrées vs sorties »
**En ligne** : deuxième graphique de la Vue d'ensemble, loyers encaissés opposés aux charges
payées et mensualités, mois par mois. C'est ce qui montre **d'où vient** le cashflow.
**Maquette** : seul le solde par mois est tracé.

### R-11 · Les deux graphiques de la Rentabilité
**En ligne** : « réel vs prévisionnel » mensuel (barres + ligne pointillée) et « cumul sur
l'exercice » (deux trajectoires).
**Maquette** : deux barres de comparaison statiques. La **trajectoire** — le moment où l'écart
se creuse — n'est plus lisible.

### R-12 · Les mini-courbes par bien
**En ligne** : une sparkline de cashflow sur 12 mois sur chaque carte, **plus le delta contre le
mois précédent** (« ↑ 12 % vs mois -1 »).
**Maquette** : une barre de contribution statique.

### R-13 · Loyer encaissé et charges payées, par bien
**En ligne** : deux des quatre statistiques de chaque carte.
**Maquette** : la table ne donne que cashflow, rendement et effort. On ne sait plus **ce qui est
entré** ni **ce qui est sorti** pour un bien donné.

### R-14 · Le prévisionnel par bien
**En ligne** : sous-titre de la carte, « prévi : +12 876 € ».
**Maquette** : le prévisionnel n'existe plus que dans l'onglet Rentabilité, un bien à la fois.

### R-15 · L'écart réel − prévisionnel consolidé
**En ligne** : KPI du portefeuille entier.
**Maquette** : supprimé du bandeau, disponible seulement bien par bien.

### R-16 · Les quatre indicateurs de l'onglet Locataires
**En ligne** : Locataires · Actifs · Candidats · **Loyer mensuel actif** (somme des loyers +
charges des baux actifs).
**Maquette** : aucun.

### R-17 · Le détail des fiches locataires
**En ligne**, sur chaque carte : e-mail ou téléphone · bien rattaché **cliquable** · loyer HC
**et dépôt de garantie** · date d'entrée **et date de sortie** · nombre de documents joints.
**Maquette** : nom, bien, jour de paiement, date d'entrée, loyer. **Perdus** : dépôt de garantie,
date de sortie, nombre de documents, e-mail/téléphone.

---

## C. Régressions de navigation — un chemin disparaît

### R-18 · Le bandeau de filtre par bien
**En ligne** : arriver depuis la fiche d'un bien filtre le suivi sur ce bien et affiche un
bandeau « Suivi filtré sur X » avec deux sorties : « Voir tous les biens » et « ← Retour à Mes
biens ». C'est le pont `bdGoToSuivi` de la fiche bien.
**Maquette** : aucun état filtré, donc aucune sortie. Le pont arrive sur un écran non filtré.

### R-19 · Le clic sur un loyer non soldé
**En ligne** : chaque ligne d'impayé de la Rentabilité ouvre le suivi mensuel **sur la bonne
année et le bon bien**.
**Maquette** : liste non cliquable.

### R-20 · Le lien vers la fiche du locataire depuis un bien
**En ligne** : « Voir fiche → » sur la carte du bien.
**Maquette** : la colonne Occupation ne porte qu'une pastille.

### R-21 · Le clic sur la contribution d'un bien
**En ligne** : chaque barre de contribution ouvre le suivi mensuel de ce bien.
**Maquette** : la ligne du tableau est cliquable, mais rien ne dit où elle mène ni qu'elle l'est.

---

## D. Simplifications assumées — non régressives

Ces changements modifient la présentation sans retirer de capacité. Ils sont issus de tes
arbitrages ou d'une règle déjà validée ailleurs.

| Changement | Justification |
|---|---|
| Vue d'ensemble + Mes biens → **Portefeuille** | Ton arbitrage. Les deux portaient les quatre mêmes indicateurs. |
| Navigateur d'année dans chaque onglet → **un sélecteur d'exercice global** | Ton arbitrage. La capacité de changer d'année est conservée, elle est simplement posée une fois. |
| Cartes de bien → **lignes de tableau** | Même parti que « Mes biens », validé le 03/08 : on compare des attributs, la table s'impose. |
| Biens sans donnée **écartés** des consolidés | Ton arbitrage. Aucune donnée n'est cachée : leur nombre et l'effet de leur inclusion sont annoncés. |
| « Rendement net » **redéfini** hors crédit, sur le loyer dû | Ton arbitrage. L'ancien chiffre était faux, pas seulement mal présenté. |
| Mensualités bornées aux **mois écoulés** | Correction d'un défaut : 12 mois étaient imputés quoi qu'il arrive. |
| Deux exports CSV → **un bouton « Exporter »** | À trancher : voir la question 2 ci-dessous. |

---

## Ce que je propose

Les 21 régressions ne se valent pas. Mon avis, à valider :

**À rétablir sans discussion (9)** — R-01 à R-05 (la saisie des loyers et des charges est la
raison d'être de cet onglet ; sans la fenêtre d'encaissement et l'édition des charges, le module
n'est plus utilisable), R-18 et R-19 (les ponts depuis la fiche bien et depuis les impayés sont
des chemins que l'utilisateur emprunte réellement), R-13 et R-17 (des chiffres et des données
qu'on vient chercher).

**À rétablir sous une autre forme (7)** — R-06 à R-08 : les filtres et le tri ont leur place,
mais la table du portefeuille peut les porter comme celle de « Mes biens », avec des en-têtes
triables plutôt que des pastilles. R-10 et R-11 : les graphiques reviennent, en Chart.js.
R-16 : les indicateurs de Locataires, dont « Loyer mensuel actif » qui est une vraie
information. R-20 et R-21 : rendre les liens explicites.

**À arbitrer (5)** — R-09, R-12, R-14, R-15 : voir les questions ci-dessous.
