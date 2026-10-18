# Briefing — démarrer une session dédiée à n8n

*Écrit le 05/09/2026, à la fin d'une session de travail sur Stonefolio.
Destiné à être lu EN PREMIER par une session qui ne sait rien de ce qui précède.
Tous les chiffres ont été mesurés sur le code et la base, aucun n'est estimé.*

---

## 0. Comment se servir de ce document

Ce n'est pas un plan d'exécution : c'est **le contexte qu'il faut avoir en tête
avant d'écrire le premier workflow**. Il tient en trois parties — ce qu'est
Stonefolio et comment on y travaille (§1-§3), pourquoi n8n a sa place ici et
sous quelle architecture (§4-§6), et ce qu'il reste à décider (§7-§9).

Le cadrage détaillé des cas d'usage vit à côté, dans **`CADRAGE-N8N.md`**. Ce
briefing le résume et lui ajoute ce qu'une session neuve ne peut pas deviner.

---

## 1. Ce qu'est Stonefolio

Une application de suivi de patrimoine immobilier locatif : prospection,
acquisition, gestion des baux, suivi financier, déclaration fiscale.

| | |
|---|---|
| **Dépôt** | `thomasguenon123-cloud/trackimmo` (le nom d'origine ; l'app s'appelle Stonefolio) |
| **Frontend** | JavaScript pur, `app.js` ≈ 14 700 lignes, **aucune étape de build** |
| **Déploiement** | GitHub Pages, le dépôt est servi tel quel |
| **Base** | Supabase (Postgres) avec RLS sur toutes les tables |
| **Backend** | ⚠️ **Il n'y en a pas**, hors 3 Edge Functions : `admin-create-user`, `admin-invite-user`, `news-proxy` |
| **Tables** | `biens`, `locataires`, `loyers_mensuels`, `charges_reelles`, `sci`, `visites`, `profiles`, `simulations_credit`, `bilans_comptables` |

**C'est cette absence de backend qui rend n8n pertinent.** Le backlog le dit
déjà à propos de l'agent WhatsApp : *« il exige un backend persistant — webhook,
Edge Function, appel à un modèle — alors que Stonefolio est aujourd'hui
entièrement statique sur GitHub Pages. »*

---

## 2. Les règles du dépôt — non négociables

⚠️ **Il n'existe pas de `CLAUDE.md`.** Ces règles ne vivent que dans les
commentaires du code et dans les échanges. Les voici, parce qu'une session qui
les ignore produira du travail qui sera rejeté.

**Source unique.** Chaque règle métier est calculée à UN endroit. Le dépôt a
payé deux fois pour l'avoir oublié : deux générateurs de loyers qui
n'appliquaient pas le même prorata, et cinq chemins d'écriture dont trois
oubliaient les charges. C'est la règle la plus importante de ce document.

**Jamais de chiffre inventé.** Si la donnée manque, l'écran affiche « non
disponible ». Ne jamais deviner, ne jamais extrapoler, ne jamais arrondir un
trou.

**MCP Supabase en LECTURE SEULE.** Toute écriture DDL passe par Thomas, dans
l'interface Supabase. On écrit le SQL, il l'exécute, **et on vérifie soi-même le
résultat en lecture ensuite** — jamais sur parole.

**`npm test` avant tout commit** touchant le socle de calcul. 116 tests
aujourd'hui, `node --test` via `npm test` (le glob `test/*.test.js` ; `node
--test test/` échoue sur la version de Node du conteneur).

**Les gardes se valident par mutation.** On casse volontairement le code pour
vérifier que le test tombe. *Un test qui ne tombe pas sur son bug ne vaut rien.*

**Incrémenter `?v=N` dans `index.html` avant de tester.** 9 références
aujourd'hui (5 feuilles de style, `app.js`, 3 icônes). Version actuelle : **84**.

**Pas de `perl`/`sed` pour un remplacement contenant `${...}`.** Utiliser Python.

---

## 3. L'état au 05/09/2026

- Branche de travail : `claude/workflow-preavis-cadrage-0b6kvj`, alignée sur `main`
- Production : **v=84**, 116 tests au vert, arbre propre
- Base : 7 biens, 2 locataires, 28 lignes de loyer, 2 comptes (1 admin, 1 vide)
- 6 invariants croisés posés en base et `convalidated`
- Un testeur extérieur — un bailleur possédant plusieurs biens loués — doit
  essayer la plateforme prochainement, **sur iPad Pro en Safari, au doigt**

Le backlog vivant est un artefact Claude, tenu à jour à chaque chantier :
<https://claude.ai/code/artifact/2b330343-9fb3-45cb-bd22-ff3cb14dce74>

---

## 4. Le constat qui justifie n8n

**Stonefolio calcule des obligations et n'en émet aucune.**

Six fonctions produisent des échéances datées et chiffrées :
`sfBauxQuiSeTerminent`, `sfEcheanceDepot`, `sfLoyersAttendus`,
`mfLoyersNonSoldes`, `sfPointsAttention`, `sfResteAEncaisser`. Elles savent qui
doit combien, pour quel mois, et à partir de quand une restitution de dépôt
coûte 10 % du loyer par mois commencé.

En face, mesuré dans tout `app.js` :

| Ce qu'on a cherché | Trouvé |
|---|---|
| `cron` | **0** |
| `webhook` | **0** |
| `smtp` / envoi d'e-mail | **0** |

Et les deux mots qui semblaient prometteurs ne tiennent pas :

- **« Quittance loyer »** n'est qu'une *catégorie de document à téléverser*. Le
  bailleur produit la quittance ailleurs et la dépose.
- **« Relance »** n'est qu'un *type d'action à consigner* dans un historique de
  prospection. Rien n'est envoyé.
- Le bloc `.mfx-relance` nomme les locataires en retard et les mois dus — et
  s'arrête là.

Tout cela n'existe que si quelqu'un ouvre l'application.

**n8n n'ajoute pas une fonctionnalité : il apporte le dos manquant.**

---

## 5. L'architecture retenue — segmentation des données

C'est la contrainte posée par Thomas : *« il faut prévoir de segmenter les
workflows n8n pour ne pas mélanger les data des users. »* C'est le vrai sujet.

### Pourquoi c'est difficile

La sécurité de Stonefolio repose **entièrement** sur la RLS : chaque politique
compare `auth.uid()` au `user_id` de la ligne. Ça marche parce que le navigateur
présente le jeton de l'utilisateur connecté.

**n8n n'a pas de jeton d'utilisateur.** Il tourne hors session. La seule clé qui
lui permet de lire, `service_role`, **contourne la RLS intégralement**.

⚠️ **Le dépôt vient d'en vivre la démonstration.** La fonction
`admin_purge_legacy_base64` était dangereuse pour exactement cette raison :
`SECURITY DEFINER` contourne la RLS, et elle n'avait aucun filtre par compte —
un clic aurait vidé les documents de tous les locataires de **tous les comptes**.
Elle a été retirée et son droit d'exécution révoqué le 05/09/2026
(`REVOQUER-PURGE-BASE64.sql`). La leçon vaut ici en plus grand.

### Ce qui ne marche pas

❌ **Un workflow par utilisateur.** Ça semble répondre à la question, mais non :
ça ne passe pas l'échelle, et surtout **ça ne protège de rien** — chaque
workflow détiendrait quand même la clé qui voit tout.

### Ce qui marche

✅ **Segmenter à la source, pas dans n8n.**

> n8n ne lit jamais une table. Il appelle une fonction qui ne rend que ce qu'un
> rappel a besoin de savoir : un identifiant, un prénom, un montant, une date,
> une adresse de contact. **Jamais de documents, jamais de notes, jamais une
> table entière.**

Si n8n est compromis, ce qui fuit n'est pas la base — c'est « qui doit un loyer
ce mois-ci ».

⚠️ Cette fonction devra être écrite avec la même méfiance que la partie C des
invariants : **filtre par compte explicite**, contrôle du rôle appelant, et une
revue qui cherche précisément le défaut corrigé ci-dessus.

### Trois voies d'accès, par sécurité croissante

| Approche | n8n détient | Rayon d'explosion |
|---|---|---|
| Clé `service_role` en direct | La clé maîtresse | **Toute la base.** À éviter |
| `service_role` + discipline d'appel | La clé maîtresse | Toute la base — la discipline protège des accidents, pas d'une compromission |
| **Edge Function + secret étroit** ⭐ | Un secret limité | **Ce que la fonction rend, et rien d'autre** |

La troisième est recommandée, et **le dépôt en porte déjà le patron** :
`news-proxy` existe précisément pour que la clé NewsAPI ne vive pas dans le
navigateur. Le même geste, appliqué à n8n.

### La frontière, à ne pas franchir

⚠️ **n8n ne calcule AUCUNE règle métier.** Pas de prorata, pas de durée de
préavis, pas de délai de restitution. Ces règles ont une source unique dans
`app.js`. Un workflow qui les réimplémente en SQL crée le défaut le plus cher de
ce dépôt — **et en pire**, parce que la divergence serait invisible : personne
ne regarde n8n tous les jours.

**n8n lit ce que Stonefolio a conclu, et l'achemine. Rien de plus.**

---

## 6. n8n en pratique

Un orchestrateur de workflows dessinés sur une toile : des **déclencheurs**
(cron, webhook, événement d'app), des **actions** (API, Postgres, e-mail, PDF,
modèle de langage), de la **logique** (conditions, boucles). Nœuds Supabase et
Postgres natifs, nœud « AI Agent » capable d'appeler un modèle avec des outils.

**Hébergement — l'édition Community est gratuite et non bridée** (exécutions
illimitées, toutes les intégrations ; seuls SSO et RBAC avancé sont payants).

| Mode | Coût | Pour quoi |
|---|---|---|
| **Sur la machine de Thomas** (Docker ou `npx n8n`) | 0 € | Écrire et essayer. Rien ne tourne quand l'ordinateur est éteint |
| VPS auto-hébergé | ~5 €/mois | Exécution continue ; mises à jour et sauvegardes à sa charge |
| n8n Cloud | 24 $/mois | ⚠️ **Plus d'offre gratuite**, essai de 14 jours seulement |

**Pour démarrer : sa propre machine.** Un rappel quotidien sur quelques biens
consomme ~30 exécutions/mois — la question du coût ne se pose pas encore.

**Canal** — par quel moyen l'automatisation joint son destinataire. E-mail
recommandé pour commencer : c'est le seul qui accepte une pièce jointe, donc le
seul qui convienne à une quittance. Telegram est la voie courte vers l'agent
(un bot en deux minutes) ; WhatsApp exige une vérification d'entreprise Meta et
un numéro dédié.

---

## 7. Les neuf cas d'usage

Séparés comme Thomas l'a demandé : ce qui relève de lui **administrateur**, et
ce qui serait une **fonction du produit** pour ses utilisateurs.

### Pour l'administrateur — ne touchent que ses propres données

| # | Cas | Pourquoi |
|---|---|---|
| **A1** | **Sauvegarde hebdomadaire** | Il n'y a **rien** aujourd'hui. Une suppression en cascade est irréversible |
| **A2** | **Veille sur les invariants** | Les 6 contrôles croisés et le balayage du prorata existent — personne ne les exécute |
| **A3** | **Alerte d'inscription** | Un compte passe en `pending` et attend validation ; il faut ouvrir Administration pour le savoir |
| **A4** | **Actualités régionales** | NewsAPI donne 4 articles/mois sur Poitiers et son offre gratuite interdit la production. Des flux RSS agrégés font mieux |

### Pour le bailleur — fonctions du produit, exigent la segmentation du §5

| # | Cas | Réserve |
|---|---|---|
| **U1** ⭐ | **Rappel d'échéances** | Le cas fondateur. Toute la matière existe |
| **U2** | **Relance d'impayé** | ⚠️ Message vers un **tiers** : validation humaine obligatoire |
| **U3** | **Quittance de loyer** | ⚠️ **Bloqué** — voir §8 |
| **U4** | **Récapitulatif mensuel** | Découle de U1 presque gratuitement |
| **U5** | **Agent conversationnel** | ⚠️ Un modèle qui ÉCRIT en base à partir d'une phrase ambiguë. En dernier |

**Ordre proposé** : A1 → A3 → A2 → **U1** → A4 → U4 → U2 → U3 → U5.

Les trois premiers ne touchent que les données de Thomas : ils permettent
d'apprendre n8n sans risquer celles d'un autre.

---

## 8. Ce qui est tranché, ce qui ne l'est pas

### Déjà décidé

- Cadrage écrit **avant** d'écrire le moindre workflow — c'est ce document
- Segmentation **à la source**, pas un workflow par utilisateur
- n8n **n'implémente aucune règle métier**
- Commencer par les cas administrateur

### Ouvert — à poser à Thomas au début de la session

1. **La voie d'accès** — Edge Function à secret étroit (recommandé) ou
   `service_role` en direct pour aller plus vite ?
2. **Le canal** — e-mail seul, ou e-mail + Telegram ?
3. **Le rythme** — un récapitulatif quotidien, ou un message par événement ?
4. **La promesse de service** — assume-t-il que les rappels des utilisateurs
   soient un engagement, avec ce que ça implique quand ils tombent ?
5. **U2 et U3** — un message part-il vers un locataire sans qu'il l'ait relu ?

### ⚠️ La dépendance à connaître avant de promettre U3

**L'encaissement des charges n'est suivi nulle part** : `montant_encaisse` ne
solde que `loyer_du`. Une quittance de loyer distingue le loyer des charges —
l'émettre aujourd'hui, c'est produire **un document légal avec un montant
incomplet**.

C'est un arbitrage ouvert de longue date, listé au backlog et au
`PLAN-PREAVIS.md` (§5 bis). **U3 en dépend entièrement.**

---

## 9. Le premier pas concret

1. Lire `CADRAGE-N8N.md` pour le détail des cas d'usage.
2. Poser à Thomas les cinq questions du §8.
3. Faire tourner n8n **sur sa machine** — rien à acheter, rien à héberger.
4. Écrire **A1, la sauvegarde** : un cron, un export, un dépôt daté. Aucune
   décision produit requise, et ça protège d'une perte réelle. C'est le bon
   banc d'essai de la mécanique.
5. Ne passer à **U1** qu'une fois la voie d'accès du §5 tranchée et posée.

---

## 10. Les pièges connus

| Piège | Pourquoi il coûte cher |
|---|---|
| Réimplémenter une règle métier dans n8n | Deux sources qui divergent, et la divergence est invisible |
| Donner `service_role` à n8n | Un serveur qui exécute des scripts détient toute la base, RLS comprise |
| Un workflow par utilisateur | Illusion de segmentation : chacun détient quand même la clé |
| Écrire en base depuis un modèle de langage | « Le loyer de septembre » un 2 octobre désigne quel mois ? |
| Envoyer à un locataire sans relecture | Une relance injustifiée coûte plus qu'un loyer |
| Promettre un rappel sans surveiller n8n | Un rappel qui n'arrive pas est pire que pas de rappel |

---

## 11. Où lire quoi

| Document | Contenu |
|---|---|
| **`CADRAGE-N8N.md`** | Le détail des 9 cas d'usage, l'architecture, les arbitrages |
| `CADRAGE-PREMIER-LANCEMENT.md` | La première ouverture pour un nouveau venu — chantier en cours, points 3-5 restants |
| `PLAN-PREAVIS.md` | Le workflow préavis, livré. §5 bis liste les chantiers connexes ouverts |
| `CADRAGE-PREAVIS.md` | La recherche juridique : préavis, dépôt, congés |
| `NOTE-COMPTES-RENDUS.md` | L'architecture des comptes rendus et le modèle d'état des lieux |
| `MIGRATION-PREAVIS.sql` | Les 4 parties appliquées, dont les 6 invariants croisés |
| `REVOQUER-PURGE-BASE64.sql` | Le défaut destructeur trouvé et fermé le 05/09 — à lire pour la leçon |
| L'artefact du backlog | L'état vivant, tenu à jour à chaque chantier |
