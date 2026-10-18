# Cadrage — n8n au service de Stonefolio

*Écrit le 05/09/2026. Faits vérifiés sur le code, la base et la documentation
publique de n8n. Aucun chiffre repris de mémoire.*

---

## 0. La thèse, en une phrase

**Stonefolio calcule des obligations et n'en émet aucune.**

Mesuré : six fonctions produisent des échéances datées et chiffrées —
`sfBauxQuiSeTerminent`, `sfEcheanceDepot`, `sfLoyersAttendus`,
`mfLoyersNonSoldes`, `sfPointsAttention`, `sfResteAEncaisser`. Elles savent qui
doit combien, pour quel mois, et à quelle date une restitution de dépôt commence
à coûter 10 % du loyer par mois de retard.

En face, dans tout `app.js` : **zéro `cron`, zéro `webhook`, zéro `smtp`, aucun
envoi**. « Quittance loyer » n'est qu'une *catégorie de document à téléverser*.
« Relance » n'est qu'un *type d'action à consigner*. Le bloc `.mfx-relance`
nomme les locataires en retard et les mois concernés — et s'arrête là.

Tout cela n'existe que si quelqu'un ouvre l'application.

n8n n'apporte pas une fonctionnalité de plus : il apporte **le dos manquant**.
Le backlog le disait déjà de l'agent WhatsApp — *« il exige un backend
persistant — webhook, Edge Function, appel à un modèle — alors que Stonefolio
est aujourd'hui entièrement statique sur GitHub Pages »*. C'est exactement la
description de n8n.

---

## 1. Ce qu'est n8n, en clair

Un outil d'automatisation à base de **workflows** dessinés sur une toile. Trois
sortes de briques :

- **les déclencheurs** — un horaire (cron), une requête HTTP entrante (webhook),
  un événement d'une application tierce, ou un lancement manuel ;
- **les actions** — appeler une API, lire ou écrire dans Postgres, envoyer un
  e-mail, générer un fichier, interroger un modèle de langage ;
- **la logique** — conditions, boucles, branchements, fusion.

Il existe un nœud Supabase et un nœud Postgres, et un nœud « AI Agent » capable
d'appeler un modèle avec des outils.

### Réponse à ta question sur l'hébergement

**Oui, il existe une version gratuite, et elle n'est pas bridée.** L'édition
Community s'auto-héberge, gratuitement, avec **exécutions illimitées et toutes
les intégrations** ; seuls des extras d'entreprise (SSO, RBAC avancé, support)
sont réservés aux offres payantes.

Trois façons de commencer, par coût croissant :

| Mode | Coût | Pour quoi |
|---|---|---|
| **Sur ta machine** (Docker ou `npx n8n`) | 0 € | Écrire et essayer les workflows. Rien ne tourne quand l'ordinateur est éteint. |
| **VPS auto-hébergé** | ~5 €/mois | Les workflows tournent en continu. Tu deviens responsable des mises à jour et des sauvegardes. |
| **n8n Cloud** | 24 $/mois, 2 500 exécutions | Rien à administrer. ⚠️ **Il n'y a plus d'offre gratuite** — seulement un essai de 14 jours. |

**Pour tester : commence sur ta machine.** Un rappel quotidien sur quelques biens
consomme une trentaine d'exécutions par mois — n'importe quelle formule suffit,
la question du coût ne se pose pas encore.

### Réponse à ta question sur le canal

Ma question était mal posée. Elle voulait dire : **par quel moyen l'automatisation
te joint-elle quand elle a quelque chose à dire ?** Un workflow qui constate un
loyer en retard doit bien le dire *quelque part*.

| Canal | Ce que ça implique |
|---|---|
| **E-mail** | Le plus simple. Le seul qui accepte une pièce jointe — donc le seul qui convienne à une quittance. |
| **Telegram** | Un bot se crée en deux minutes, gratuitement. Bon pour un message court, mauvais pour un document. |
| **WhatsApp** | Ce que dit le backlog, et ce que tes locataires utilisent. Mais l'API Business exige une vérification d'entreprise Meta et un numéro dédié : des jours de démarches. |
| **Dans Stonefolio** | n8n écrit dans une table que l'app lit. Ne règle pas le problème de fond : il faut toujours ouvrir l'app. |

Recommandation : **e-mail d'abord** — il couvre tout, y compris les quittances —
et Telegram plus tard si tu veux des alertes courtes sur ton téléphone.

---

## 2. LA question d'architecture : ne pas mélanger les données

C'est ta contrainte, et c'est le vrai sujet de ce cadrage.

### Pourquoi c'est difficile

La sécurité de Stonefolio repose entièrement sur la **RLS** : chaque politique
compare `auth.uid()` au `user_id` de la ligne. Ça marche parce que le navigateur
présente le jeton de l'utilisateur connecté.

**n8n n'a pas de jeton d'utilisateur.** Il tourne sur un serveur, hors session.
Pour lire la base, il lui faut une clé — et la clé qui marche, `service_role`,
**contourne la RLS intégralement**.

⚠️ **Nous venons d'en vivre la démonstration.** `admin_purge_legacy_base64` était
dangereuse pour exactement cette raison : `SECURITY DEFINER` contourne la RLS, et
la fonction n'avait aucun filtre par compte — un clic aurait vidé les documents
de tous les locataires de tous les comptes. La leçon vaut ici, en plus grand :
**mettre `service_role` dans n8n, c'est confier toute la base à un serveur qui
exécute des scripts.**

### La segmentation qui marche, et celle qui ne marche pas

❌ **Un workflow par utilisateur.** Ça semble répondre à la question, mais non :
ça ne passe pas l'échelle (dix utilisateurs = dix workflows à maintenir), et ça
ne protège de rien — chaque workflow détient quand même la clé qui voit tout.

✅ **Segmenter à la source, pas dans n8n.** La règle : *n8n ne lit jamais une
table, il appelle une fonction qui ne rend que ce qu'un rappel a besoin de
savoir.*

Concrètement, une fonction Postgres dédiée — appelons-la
`echeances_a_notifier()` — qui rend des lignes déjà groupées par utilisateur et
réduites au strict nécessaire : un identifiant, un prénom, un montant, une date,
une adresse de contact. **Jamais de documents, jamais de notes, jamais de pièce
jointe, jamais une table entière.**

L'intérêt est mesurable : si n8n est compromis, ce qui fuit n'est pas la base,
c'est « qui doit un loyer ce mois-ci ». C'est le principe du moindre privilège
appliqué là où il compte.

⚠️ **Et cette fonction devra être écrite avec la même méfiance que la partie C
des invariants** : filtre par compte explicite, contrôle du rôle appelant, et une
revue qui cherche précisément le défaut qu'on vient de corriger ailleurs.

### Trois façons de donner l'accès, par sécurité croissante

| Approche | Ce que n8n détient | Rayon d'explosion |
|---|---|---|
| Clé `service_role` en direct | La clé maîtresse | **Toute la base.** À éviter. |
| `service_role` + n'appeler que les RPC dédiées | La clé maîtresse | Toute la base — la discipline ne protège que des accidents, pas d'une compromission. |
| **Edge Function + secret partagé** | Un secret étroit | **Ce que la fonction rend, et rien d'autre.** |

La troisième est la bonne, et le dépôt en porte déjà le patron : `news-proxy`
existe précisément pour que la clé NewsAPI ne vive pas dans le navigateur. Le
même geste, appliqué à n8n.

### Où passe la frontière

⚠️ **n8n ne calcule aucune règle métier.** Pas de prorata, pas de durée de
préavis, pas de délai de restitution. Ces règles ont une source unique dans
`app.js`, et le dépôt a déjà payé deux fois le prix de deux calculs divergents —
les deux générateurs de loyers qui ne s'accordaient pas, et les cinq chemins
d'écriture qui oubliaient les charges.

**n8n lit ce que Stonefolio a conclu, et l'achemine.** Rien de plus.

---

## 3. Les cas d'usage — pour l'administrateur

Ceux-là te concernent seul. Ils ne touchent aucune donnée d'un autre compte, et
c'est par eux qu'il faut commencer.

### A1 · La sauvegarde hebdomadaire
Un cron, un export des tables, un dépôt daté sur un stockage externe.
**Aujourd'hui il n'y a rien.** Une fausse manœuvre ou une suppression en cascade
est irréversible. C'est le workflow le moins spectaculaire et le plus utile — et
le bon banc d'essai, parce qu'il ne dépend d'aucune décision produit.

### A2 · La veille sur les invariants
Les six contrôles croisés et le balayage du prorata existent, écrits et vérifiés.
**Personne ne les exécute.** Un cron hebdomadaire qui les rejoue et n'écrit que
si un compteur n'est pas à zéro : le silence devient une information.

### A3 · L'alerte d'inscription
Un nouveau compte passe en `pending` et attend ta validation. Aujourd'hui, tu
ne le sais qu'en ouvrant Administration. Un message suffit — et ça devient
pressant dès qu'un testeur extérieur s'inscrit.

### A4 · Les actualités régionales
Le backlog note que NewsAPI est **très pauvre en presse régionale** — quatre
articles en un mois pour Poitiers — et que son offre gratuite interdit la
production. n8n agrège N flux RSS locaux, filtre, et alimente la base. Le
problème n'est pas technique : c'est un problème de sources, et n8n en avale
autant qu'on veut.

---

## 4. Les cas d'usage — pour le bailleur

Ceux-là sont des **fonctions du produit**. Ils exigent la segmentation du §2, et
ils supposent que tu assumes une promesse de service : un rappel qui n'arrive
pas est pire que pas de rappel du tout.

### U1 · Le rappel d'échéances ⭐
Le cas fondateur. Chaque matin, pour chaque bailleur : les loyers attendus, les
préavis qui courent, les dépôts à restituer — **avec leur date butoir et ce que
le retard coûte**. Toute la matière existe déjà.

C'est celui qui transforme une plateforme muette en outil qui te joint. Et c'est
le banc d'essai de tout le reste : connexion, segmentation, canal, format.

### U2 · La relance d'impayé
`.mfx-relance` nomme déjà les locataires et les mois dus. Le passage à un e-mail
courtois est court. ⚠️ Mais c'est un message **envoyé à un tiers** : il faut une
validation humaine avant l'envoi, pas un automatisme aveugle. Une relance
injustifiée coûte plus qu'un loyer.

### U3 · La quittance de loyer
Obligation légale sur demande du locataire, tous les mois, pour chaque bail.
Aujourd'hui : **une case dans une liste de documents à téléverser**. Le bailleur
la fabrique ailleurs.

L'e-mail du locataire est en base (`loc-email`), le montant aussi. Un PDF
mensuel, envoyé, archivé.

⚠️ **Bloqué par un arbitrage.** Une quittance distingue le loyer des charges —
or l'application ne solde que le loyer. Émettre une quittance aujourd'hui, c'est
émettre un document légal avec un montant incomplet. **L'encaissement des charges
doit être tranché avant.**

### U4 · Le récapitulatif mensuel
Ce qui est rentré, ce qui manque, ce qui arrive. Moins urgent que U1, et il en
découle presque gratuitement.

### U5 · L'agent conversationnel
L'item du backlog, débloqué. *« Le loyer de Dupont est arrivé »* → n8n comprend,
appelle l'API, pointe l'encaissement.

⚠️ **À garder pour la fin, et pas seulement par difficulté.** C'est le seul cas
où un modèle de langage ÉCRIT dans la base à partir d'une phrase ambiguë. « Le
loyer de septembre » un 2 octobre désigne quel mois ? Il faudra une confirmation
avant écriture, ce qui retire une bonne part de la magie — mais une écriture
comptable devinée est pire qu'un formulaire.

---

## 5. Ordre proposé

1. **A1 sauvegarde** — aucune décision requise, protège d'une perte réelle.
2. **A3 alerte d'inscription** — utile dès le test extérieur, dix minutes.
3. **A2 veille des invariants** — rejoue ce qui est déjà écrit.
4. **U1 rappel d'échéances** — le premier vrai cas produit, et le banc d'essai
   de la segmentation.
5. **A4 actualités**, **U4 récapitulatif**, puis **U2 relance**.
6. **U3 quittance** — après l'arbitrage des charges.
7. **U5 agent** — en dernier.

Les trois premiers ne touchent que tes données : ils permettent d'apprendre n8n
sans risquer celles d'un autre.

---

## 6. Ce qu'il reste à trancher

1. **La voie d'accès** — Edge Function + secret étroit (ma recommandation), ou
   `service_role` en direct pour aller plus vite ?
2. **Le canal** — e-mail seul pour commencer, ou e-mail + Telegram ?
3. **Le rythme** — un récapitulatif quotidien, ou un message par événement ?
4. **La promesse** — assumes-tu que les rappels des utilisateurs soient un
   service, avec ce que ça implique quand ils tombent ?
5. **U2 et U3** — un message part-il vers un locataire sans que tu l'aies relu ?
