# Avant d'inviter le testeur — ce qui est fait, ce qui te reste

*27/09/2026 · v=89. Trois points étaient prévus. La relecture du parcours
d'invitation en a sorti un quatrième, et c'est le plus grave des quatre.*

---

## ⚠️ Le point qu'on n'avait pas vu : l'invitation mène au mur qu'elle devait éviter

Le backlog disait que `admin-invite-user` *« fait le travail proprement »*.
**C'est faux, et c'est moi qui l'ai écrit.** J'ai relu la fonction déployée
ligne à ligne en préparant le point 3 :

```ts
status: alreadyRegistered ? 'active' : 'pending'
```

Un compte invité naît donc `pending`. Et côté application, `ensureProfileActive()`
(`app.js:217`) **déconnecte** tout profil `pending` et affiche :

> ⏳ **Compte en attente de validation**
> Votre inscription a bien été reçue. Un administrateur va valider votre accès
> très bientôt.

Le parcours complet était donc :

1. tu invites ton ami depuis la console ;
2. il reçoit le mail, clique, choisit son mot de passe ;
3. il se connecte — **et il est déconnecté**, avec un message qui lui dit
   d'attendre ;
4. il te faut aller l'activer à la main dans Administration.

Le chemin recommandé *pour éviter* le mur d'attente menait exactement au même
mur. Rien à l'écran ne te disait qu'il fallait ensuite l'activer.

**Le correctif** est dans le dépôt : `supabase/functions/admin-invite-user/index.ts`,
`status: 'active'`. Une invitation **est** la validation — c'est toi qui as saisi
l'adresse, le prénom, le nom et le rôle. `pending` garde tout son sens pour une
inscription libre, où personne n'a vérifié qui s'inscrit.

⚠️ **Au passage : les trois Edge Functions n'existaient nulle part dans le
dépôt.** Elles ne vivaient que dans la console — aucun historique, aucune revue
possible, aucun moyen de savoir ce qui avait changé. `admin-invite-user` y est
maintenant. Les deux autres suivront.

⚠️ **Et une trouvaille en relisant les trois : `admin-create-user` est morte et
cassée.** Elle n'est appelée de nulle part — la console d'administration passe
uniquement par `admin-invite-user` — et elle écrit `temp_password: password`
dans `profiles`, **une colonne qui n'existe plus**. Le commentaire
d'`admin-invite-user` le dit lui-même : *« sans temp_password — la colonne
n'existe plus »*. Elle a été retirée d'un côté et pas de l'autre. Si tu
l'appelais, elle échouerait après avoir créé le compte auth — te laissant un
utilisateur sans profil, c'est-à-dire exactement le cas qui ouvre le trou des
gardes `admin` sur un `NULL` (cf. la cartographie). **Elle mérite d'être
supprimée de la console**, mais ce n'est pas dans les trois points et je n'y ai
pas touché.

---

## Ce qui est fait, et qui ne demande rien de ta part

### ✅ Point 1 — les six outils de test et de purge sont cloisonnés

| Avant | Après |
|---|---|
| 3 boutons dans l'en-tête d'**Administration**, vus de tous | **Retirés.** |
| « Générer des fiches tests (5) » dans **Paramètres › Données**, vu de tous | Déplacé dans **Paramètres › Maintenance** (réservé aux administrateurs) |
| « Supprimer les fiches tests », vu de tous | Idem |
| « Supprimer tout » (biens), zone de danger | **Conservé** — c'est sa donnée, il doit pouvoir l'effacer |
| — | **Ajouté** : « Supprimer vos données d'administration », au même endroit |

La règle posée : **ce qui fabrique de la donnée factice est réservé à
l'administrateur ; ce qui efface les données de l'utilisateur lui reste
accessible, mais dans une zone qui s'annonce comme dangereuse.**

Trois choses en plus, pendant que j'y étais :

- les quatre suppressions passent par la fenêtre **à la charte** (`sfConfirmer`),
  plus par `confirm()` — fini la bannière « github.io indique » ;
- chaque fenêtre **dit ce qui part et ce qui reste**. Vérifié sur les clés
  étrangères, pas supposé : supprimer un bien emporte ses **loyers, charges et
  actions** (CASCADE), mais **conserve** locataires, comptes rendus et
  simulations, qui se retrouvent simplement détachés ;
- les deux suppressions de biens **écrivent le compte visé**. Elles s'en
  remettaient à la seule RLS (`.delete()` sans condition, `.neq('id', '000…')`
  pour viser « tout »). La policy les rattrapait, mais c'est exactement la forme
  qui a rendu la purge base64 dangereuse.

⚠️ **Un piège évité au dernier moment.** En déplaçant « Supprimer vos données
d'administration » vers les Paramètres, la fenêtre de confirmation se serait
mise à annoncer « 0 SCI » : elle lisait le cache `allSCI`, que seul un passage
par l'écran Administration remplit. Elle compte maintenant en base. Une
confirmation qui ment sur ce qu'elle s'apprête à effacer est pire que pas de
confirmation.

**6 gardes**, validées par mutation.

### ✅ Point 2 — l'encaissement des charges est tranché

**Ce qui était cassé :** 700 € de loyer, 150 € de charges, 850 € reçus.
« Partiel » refusait 850 (car 850 ≥ 700), « Payé intégralement » enregistrait
700. Aucun chemin ne permettait de saisir 850.

**Ce qui a été décidé, et pourquoi.** Deux routes existaient :

- **(A)** faire porter à `montant_encaisse` le total reçu. Aucune migration —
  mais on perd la répartition ligne à ligne, or c'est exactement ce dont la
  **régularisation annuelle** a besoin. Cette route débloquait la saisie et
  fermait la régularisation.
- **(B)** une colonne de plus, `charges_encaissees`. `montant_encaisse` garde
  son sens — dix endroits le lisent — et la répartition reste connue.

**J'ai retenu (B).** Coût : une migration, à jouer par toi (ci-dessous).

Maintenant : « Payé intégralement — **850 €** » solde les deux lignes. « Partiel »
ouvre deux champs, *Loyer encaissé* et *Charges encaissées*, pré-remplis avec ce
qui est dû, avec le total qui s'affiche à mesure. Plus rien n'est refusé : si le
total solde le mois, on le **dit**, on ne bloque pas.

⚠️ **Le piège de cette correction, et c'est le vrai sujet.** Faire entrer les
charges dans le calcul des arriérés ferait apparaître **8 380 €** comme dus, sur
17 mois que tu tiens pour soldés depuis des semaines. D'où la règle :
`charges_encaissees IS NULL` veut dire **« non suivi »**, pas « zéro ». Une ligne
d'avant la migration garde exactement son comportement d'avant. C'est la
première des huit gardes.

⚠️ **Ta déclaration fiscale ne bouge pas d'un euro, et c'est délibéré.**
`mfBilanFeedCompute` continue de ne compter que les loyers, et continue d'exclure
les charges récupérables des déductions : **c'est un couple cohérent**. Faire
entrer les provisions en recettes obligerait à cesser d'exclure les charges
récupérables — sinon le revenu foncier déclaré est surestimé. C'est un arbitrage
**fiscal**, distinct de celui-ci, et il t'appartient. Une garde de test
l'empêche d'être fait par réflexe.

**8 gardes**, validées par mutation. **176 tests au vert.**

---

## Ce qu'il te reste à faire

### ✅ 1️⃣ La migration SQL — **JOUÉE le 27/09, vérifiée en lecture**

| Contrôle | Résultat |
|---|---|
| `charges_encaissees` | `numeric`, nullable ✓ |
| `loyers_charges_encaissees_positives` | `CHECK (IS NULL OR >= 0)` ✓ |
| Commentaire de colonne | posé ✓ |
| Lignes modifiées | **0 sur 28** ✓ |

La v=89 est en production (`e1dfe80`).

### ✅ 2️⃣ `admin-invite-user` — **REDÉPLOYÉE le 27/09, version 6**

Déployée depuis `supabase/functions/admin-invite-user/index.ts`, puis relue
depuis le serveur : le seul `status:` du profil vaut `'active'`, `verify_jwt`
reste à `true`, l'`import_map` est conservé. Le mot `pending` n'apparaît plus
que dans le commentaire qui explique le défaut.

Ton ami ne verra donc plus l'écran « en attente de validation » : il cliquera,
choisira son mot de passe, et entrera directement.

---

### 3️⃣ Renommer les gabarits d'e-mails — **il te reste ça**

*(Le détail est plus bas. C'est la dernière chose avant l'invitation.)*

---

<details>
<summary>Les étapes détaillées, pour référence</summary>

### 1️⃣ Jouer la migration SQL *(3 minutes)*

Supabase → **SQL Editor** → ouvrir `MIGRATION-ENCAISSEMENT-CHARGES.sql` du
dépôt, et jouer les **blocs 1 à 4 dans l'ordre**.

- le **bloc 1** ne fait que lire : il doit rendre `colonne_existe = false` ;
- le **bloc 4** contrôle : `colonne_existe = true`, `contrainte_posee = true`,
  `lignes_renseignees = 0`.

⚠️ **Cette migration passe AVANT la mise en production**, et c'est important.
Le code de la v=89 écrit `charges_encaissees` à chaque encaissement : tant que
la colonne n'existe pas, **tout pointage de loyer échoue**. C'est pourquoi je
n'ai **pas** poussé sur `main` — la v=89 n'est que sur la branche de
développement. Dis-moi quand c'est joué et je pousse.

*(La lecture, elle, est sans risque : une colonne absente se lit `undefined`,
donc « non suivi », donc le comportement d'avant.)*

### 2️⃣ Redéployer `admin-invite-user` *(5 minutes)*

Supabase → **Edge Functions** → `admin-invite-user` → coller le contenu de
`supabase/functions/admin-invite-user/index.ts` → **Deploy**.

Pour vérifier : le fichier ne doit plus contenir le mot `pending` ailleurs que
dans les commentaires, et la ligne du profil doit être `status: 'active',`.

*Si tu préfères, je peux le déployer moi-même — dis-le-moi, je ne le fais pas
sans ton accord.*

### 3️⃣ Renommer les gabarits d'e-mails *(10 minutes)* ← **à faire**

Supabase → **Authentication** → **Emails** (ou *Email Templates*).

Celui qui compte vraiment est **`Invite user`** : c'est exactement celui
qu'`admin-invite-user` déclenche via `inviteUserByEmail`. C'est le **tout
premier contact** de ton ami avec la plateforme.

| Gabarit | Priorité | Pourquoi |
|---|---|---|
| **Invite user** | 🔴 | Le mail que ton testeur va recevoir |
| **Reset password** | 🟠 | Le second mail le plus probable |
| **Confirm signup** | 🟡 | Seulement en inscription libre |
| Magic Link · Change Email · Reauthentication | ⚪ | Non utilisés aujourd'hui |

Dans chacun, remplacer **TrackImmo** par **Stonefolio**. Pense aussi à
**Authentication → Emails → SMTP Settings**, où le *sender name* peut encore
porter l'ancien nom.

### 4️⃣ Pendant que tu y es, deux interrupteurs *(2 minutes)*

- **Authentication → Policies** : activer la protection contre les mots de passe
  compromis (elle est désactivée, l'advisor Supabase la signale).
- Rien d'autre : les 17 tables ont leur RLS, les sept buckets de données
  personnelles sont privés.

</details>

---

## Ce qui reste, et que je n'ai PAS fait

Dit franchement, pour que tu saches ce que ton ami verra encore :

| Point | Où en est-ce |
|---|---|
| **L'URL dit encore `trackimmo`** | `…github.io/trackimmo/`. Elle est dans le lien d'invitation lui-même, via le `REDIRECT_URL` codé en dur dans `admin-invite-user`. Renommer le dépôt casse cette redirection — à faire d'un seul tenant, pas avant le test. |
| **Les 201 emojis** | Le lot « reliquats », non commencé. ~16 icônes restent à dessiner. |
| **Le `User-Agent` `TrackImmo/1.0`** de `news-proxy` | Ne part que vers newsapi.org. Invisible du testeur. |
| **Les gardes `admin` sur un `NULL`** | Correctif à trois mots (`IS DISTINCT FROM`), non exploitable aujourd'hui. |
| **Les 4 écrans « Bientôt »** | Sécurité, Notifications, Intégrations, Carte de France. |
| **22 boîtes de dialogue natives** | Il en restait 27, j'en ai converti 5 en passant. |

---

## Résumé en une ligne

**Trois blocs SQL, un redéploiement, trois gabarits d'e-mails — et je pousse la
v=89 sur `main` dès que tu me dis que la migration est jouée.**
