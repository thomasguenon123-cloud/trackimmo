# Cartographie — ce qui reste avant d'ouvrir Stonefolio à un testeur

*Écrit le 27/09/2026, sur le code de la v=88 et la base du jour. Tous les
chiffres sont mesurés, aucun n'est repris d'un document précédent — plusieurs
de ceux du backlog s'étaient révélés faux, et ils sont corrigés ici.*

---

## 0. Méthode, et ce qu'elle vaut

Cinq passes, toutes outillées plutôt qu'à l'œil :

| Passe | Comment | Ce qu'elle a trouvé |
|---|---|---|
| Écrans et charte | comptage des marqueurs d'ancienne charte par fonction de rendu | 4 écrans migrés, 8 non migrés |
| Emojis | balayage Unicode large, commentaires masqués, sauts de ligne préservés | **201** occurrences, **77** caractères |
| Reliquats TrackImmo | `grep -i` sur tout le code livré + inventaire base | 6 familles |
| Bugs | handlers morts, gardes, chemins destructeurs | 1 bloquant, 3 sérieux |
| Base | schéma, RLS, contraintes, lignes réelles | 1 écart à 8 380 €, 6 colonnes mortes |

⚠️ **Deux limites, dites d'emblée.** Je n'ai pas pu tester sur un vrai iPad :
le glisser-déposer et le comportement de Safari se vérifient sur l'appareil.
Et je n'ai que la **lecture** sur Supabase : tout ce qui touche à la base est
décrit, jamais exécuté.

**Une correction de chiffre.** Le backlog annonçait « 209 emojis dont 59
flèches ». Mon premier balayage en trouvait 187, le second 201 : ma plage
Unicode initiale ratait `⏳` (7×), `ℹ` (3×), `▼▲` (3×) et `○` (1×). **Le chiffre
à retenir est 201.** Je le signale parce qu'un inventaire faux sur un lot qu'on
veut traiter « d'un coup » se paie au moment de la reprise.

---

## 1. Les trois choses qui abîmeront le test, par ordre de gravité

### 1.1 🔴 Le testeur ne peut pas saisir ce qu'il a réellement encaissé

C'est le geste le plus fréquent de l'outil, et il est **fermé**.

> `app.js:8327` — `if(statut === 'Payé') montantEnc = loyerDu;`
> `app.js:8331` — `if(v >= loyerDu) { showNotif('Pour ce montant, utilisez "Payé intégralement"', true); return; }`

Un locataire vire **un seul montant**, loyer + provisions. Disons 700 € de
loyer et 150 € de charges, 850 € reçus. Le bailleur ouvre l'encaissement :

- il saisit 850 en « Partiel » → **refusé**, parce que 850 ≥ 700 ;
- il clique « Payé intégralement » → la base enregistre **700**.

Il n'existe aucun chemin pour enregistrer 850. L'application lui dit que sa
saisie est trop grande, puis en stocke une plus petite sans le dire.

**Ce n'est plus une hypothèse, c'est déjà dans la base :** les 28 échéances
portent toutes des `charges_dues > 0`, les 17 marquées « Payé » ont un
`montant_encaisse` égal **au centime** au `loyer_du` seul.

| Mesure sur les 17 lignes « Payé » | |
|---|---:|
| Total `loyer_du` | 24 683 € |
| Total `charges_dues` | 8 380 € |
| Total `montant_encaisse` | 24 683 € |
| **Écart non encaissé** | **8 380 €** |

La régularisation annuelle des charges et la quittance de loyer dépendent
entièrement de ce chiffre. **À trancher avant le test, pas après.**

### 1.2 🔴 Six boutons de test et de purge s'offrent au testeur dès le premier jour

Même famille que la purge base64 qu'on a retirée le 05/09 : un outil de
développement laissé dans le produit. Cette fois **rien n'est cloisonné par
rôle**.

**Administration** — le menu est ouvert à tous, et trois boutons vivent dans
l'en-tête (`app.js:11610-11612`), sans garde `isAdmin` :

| Bouton | Ce qu'il fait |
|---|---|
| 🧪 Générer tests | injecte des SCI, contacts, échéances et bilans factices |
| 🧹 Supprimer tests | supprime ce qui porte « TEST » |
| 🗑 **Tout supprimer** | efface **toutes** ses SCI, contacts, échéances, bilans |

**Paramètres › Données** — la famille « Données & gestion » n'est pas
`adminOnly` (`app.js:5933`), donc visible de tous (`app.js:6250-6271`) :

| Bouton | Ce qu'il fait |
|---|---|
| Générer des fiches tests (5) | crée 5 biens factices, dont 3 « Acheté » |
| Supprimer les fiches tests | |
| **Supprimer tout** | efface **tous** ses biens |

✅ **Bonne nouvelle, vérifiée dans le code :** les six sont correctement filtrés
par `.eq('user_id', currentUser.id)`. **Aucune fuite entre comptes** — ce n'est
pas le défaut de la purge base64, qui, lui, traversait les comptes.

⚠️ **Mais deux pièges restent.** « Générer des fiches tests » n'annonce rien :
un testeur curieux clique, se retrouve avec 5 biens factices, et **tous les
indicateurs sont faussés** — `is_test` ne sert qu'à afficher un ruban « TEST »
(`app.js:2728`, `2944`) et n'exclut ces biens d'**aucun** calcul, sauf d'une
liste de rattachement (`app.js:13949`). Et « Tout supprimer » de
l'Administration **détache au passage les biens de leurs SCI**
(`purgeAllAdminData` → `sciDetacherBiens`), ce qui remet leur mode de détention
à « à renseigner » sur des biens « Acheté » — sans que la base s'y oppose, la
contrainte `biens_mode_detention_coherent` acceptant `NULL`.

### 1.3 🟠 L'avatar du bandeau affiche « T » sur ta capture, alors que le code dit « TG »

Vérifié en base : ton profil porte `first_name = Thomas` **et**
`last_name = Guenon`, et `get_my_profile()` les rend tous les deux. Le code
(`app.js:874-882`, `914-919`) en tire bien `TG`.

Donc **soit ta capture est antérieure au déploiement de v=88, soit ton
navigateur sert encore l'ancien `app.js`**. Le `?v=88` ne casse le cache que
des fichiers listés dans `index.html` ; une page déjà ouverte garde son JS.
**À confirmer par un rechargement forcé** (⌘⇧R, ou Réglages → Safari → Effacer
historique sur l'iPad). Si « T » persiste après ça, c'est un vrai défaut et je
le reprends — mais je ne le classe pas comme tel tant que ce n'est pas vérifié.

---

## 2. Bugs

| # | Défaut | Où | Gravité |
|---|---|---|---|
| B1 | L'encaissement ignore les charges, et refuse le vrai montant | `app.js:8327`, `8331` | 🔴 bloquant |
| B2 | Six outils de test/purge ouverts à tous | `app.js:11610-11612`, `6250-6271` | 🔴 bloquant |
| B3 | Les gardes `admin` des RPC tombent si l'appelant n'a pas de profil | base, 4 fonctions | 🟠 latent |
| B4 | `is_test` n'exclut d'aucun calcul | `app.js` (1 seul filtre sur 40+ lectures) | 🟠 |
| B5 | 27 boîtes de dialogue natives « github.io indique » | 29 `confirm()` − 2 en commentaire | 🟡 |
| B6 | 47 `title="…"` invisibles au doigt | 21 fonctions, dont 8 sur la fiche bien | 🟡 iPad |

### B3 — le détail, parce qu'il est subtil et que le correctif tient en trois mots

Les quatre fonctions `admin_*` se gardent ainsi :

```sql
SELECT role INTO v_caller_role FROM public.profiles WHERE user_id = auth.uid();
IF v_caller_role != 'admin' THEN RAISE EXCEPTION 'Accès refusé'; END IF;
```

Si l'appelant **n'a pas de ligne dans `profiles`**, `v_caller_role` vaut `NULL`.
Or en SQL, `NULL != 'admin'` ne vaut pas `TRUE` : **il vaut `NULL`**, et plpgsql
traite `NULL` comme faux. **L'exception ne se déclenche pas, et la fonction
s'exécute.** Vérifié en base :

| expression | résultat |
|---|---|
| `null <> 'admin'` | `NULL` |
| ce que plpgsql en fait | `false` → **pas d'exception** |
| `null is distinct from 'admin'` | `true` → exception ✅ |

**Exploitable aujourd'hui ? Non.** Les 2 comptes `auth.users` ont tous deux
leur profil (0 compte orphelin), et aucun chemin du client ne supprime une
ligne de `profiles` — la seule requête est un `select` (`app.js:1051`). Le trou
s'ouvre si le trigger `handle_new_user_profile` échoue une fois, ou si une
ligne est supprimée à la main.

**Ce qui le rend quand même prioritaire :** la conséquence est une élévation en
admin, et le correctif est de remplacer `!=` par `IS DISTINCT FROM` dans quatre
fonctions. Rapport coût/risque imbattable.

*(L'avertissement Supabase « Signed-In Users Can Execute SECURITY DEFINER
Function » sur ces 9 fonctions est, lui, un faux positif : la garde est à
l'intérieur. C'est la logique ternaire qui pose problème, pas le droit
d'exécution.)*

---

## 3. Features incomplètes

| # | Ce qui est promis | Ce qui existe |
|---|---|---|
| F1 | **Carte de France** (menu + écran) | écran d'attente complet, « Bientôt disponible » ×2 |
| F2 | **Paramètres › Sécurité** | `status:'soon'` |
| F3 | **Paramètres › Notifications** | `status:'soon'` |
| F4 | **Paramètres › Intégrations** | `status:'soon'`, admin seulement |
| F5 | **Régime IS des bilans** | `is_actif` et `is_passif` ne sont lus nulle part — le bilan IS est à moitié construit ; 0 bilan IS en base, 1 bilan IR |
| F6 | **Tacite reconduction** | `date_sortie` porte deux sens : échéance du bail **et** départ effectif |
| F7 | **Modèle d'état des lieux** | grille pièce par pièce, obligatoire en meublé |
| F8 | **Quittance de loyer** | dépend de B1 |

F1 à F4 sont les « impasses Bientôt » : un testeur clique tout. Les masquer
coûte moins qu'un écran.

---

## 4. Incohérences de données

| # | Constat | Mesure |
|---|---|---|
| D1 | 17 lignes « Payé » sous-soldées de leurs charges | **8 380 €** |
| D2 | `is_test` porte 5 des 7 biens, dont **3 « Acheté »** avec 28 loyers — toute la donnée financière de la base est de la donnée de test | 5 / 7 |
| D3 | Deux orthographes de la même ville : « Châtellerault » et « Chatellerault » — tout regroupement par ville les sépare | 2 biens |
| D4 | 6 colonnes n'apparaissent nulle part dans `app.js` | `bilans_comptables.is_actif`, `.is_passif`, `.source_simulation_ids`, `profiles.invited_by`, `sci_documents.date_doc`, `simulations_credit.pdf_extracted` |
| D5 | 2 vues jamais interrogées | `v_biens_affichage_fr`, `v_kpi_pipeline` |
| D6 | La table s'appelle encore `visites`, l'écran « Comptes rendus » | renommage cassant |

✅ **Ce qui est sain, et c'est beaucoup :** RLS active sur les **17** tables,
4 policies chacune, `user_id` partout sauf `bank_presets` (table de référence
partagée, sans donnée personnelle). **Zéro orphelin** sur les six contrôles
référentiels. **Zéro violation** des invariants posés en v=81. Et le compte du
testeur (`sylasmartin87`) est **vide** : il verra bien le parcours de démarrage
livré en v=86, pas un tableau de bord pollué.

---

## 5. Reliquats TrackImmo

*Classés ici, pas en « Évolution » : à traiter d'un bloc avant d'ouvrir
davantage la plateforme.*

### 5.1 Les 201 emojis → icônes Stonefolio

**201 occurrences, 77 caractères distincts, 169 lignes, 12 écrans.**

| Écran | Occurrences | Lignes | Distincts |
|---|---:|---:|---:|
| Administration | 60 | 42 | 33 |
| Marché | 34 | 34 | 23 |
| Suivi financier / dossier banque | 26 | 24 | 18 |
| Simulateur | 24 | 21 | 11 |
| Comptes rendus | 21 | 18 | 13 |
| Connexion / inscription | 11 | 9 | 8 |
| Nouvelle fiche / Mes biens | 7 | 6 | 5 |
| Divers / transverse | 5 | 4 | 4 |
| Paramètres | 5 | 4 | 5 |
| Mes biens | 3 | 2 | 3 |
| Portails | 3 | 3 | 3 |
| Locataires / préavis | 2 | 2 | 2 |
| **Total** | **201** | **169** | **77** |

**Le socle existe déjà.** `SF_ACC_ICONS` porte **50 icônes**, et `sfIcon(nom,
taille)` / `sfAccIcon(nom, taille)` les rendent en SVG 24×24, `stroke:
currentColor` — exactement les icônes de ta capture. La doctrine est même déjà
écrite dans le code (`app.js:4774`, `12906` : *« une CLÉ de SF_ACC_ICONS,
jamais un emoji »*). Le travail est d'appliquer partout une règle déjà posée.

**Cinq familles, et elles ne se traitent pas pareil :**

| Famille | Ex. | Traitement |
|---|---|---|
| **Pictogrammes** (~130) | 🏛 📄 📊 👤 🔑 | `sfIcon('clé')` — remplacement direct |
| **Marqueurs de notification** (~40) | `showNotif('✓ Bien ajouté')`, `⚠️`, `✅`, `🔴` | le composant doit porter l'état, pas la chaîne |
| **Flèches** (10) | `↑ ↓` tri de colonne, `←` retour, `↪` | `chevron` / `retour` — sauf la typographie légitime (`2010 → 2022`, `base64 → Storage`), à **garder** |
| **Attente** (7) | `⏳ Enregistrement…` | un vrai indicateur CSS, pas un emoji |
| **Notes en étoiles** (4) | `⭐` ×5, opacité 0,2 pour l'éteinte | demande une variante **pleine** de `etoile`, qui est aujourd'hui en trait seul |

⚠️ **Il manquera des dessins.** Environ **16 icônes à créer**, sans équivalent
dans les 50 : actualités 📰, dossier 📁, énergie ⚡, carte 🗺, déconnexion 🚪,
enregistrer 💾, étiquette 🏷, éprouvette 🧪, balai 🧹, bouclier 🛡, commerce 🛒,
santé 🏥, école 🏫, sport ⚽, transport 🚌, tourisme 🧳, thermomètre 🌡.
La moitié vient des **équipements de proximité** de l'écran Marché, qui est
une grille de 7 catégories : c'est un mini-jeu d'icônes à lui seul.

⚠️ **Trois emojis sont des données, pas du décor** : `roleIcons`
(`app.js:11750-11751`), `typeIcons` (`11817-11818`) et `LOC_DOC_TYPES[].icon`
(`10886`) associent une clé métier à un emoji. Ils doivent devenir des **clés**
de `SF_ACC_ICONS` — sinon on remplace l'affichage et on laisse la table
derrière.

⚠️ **Attention aux tailles.** Plusieurs emojis servent d'illustration de vide
en `font-size:40px` voire `64px` (`11828`, `11777`, `11684`, `11921`, `13197`).
Le remplacement doit passer la taille : `sfIcon('agenda', 40)`.

### 5.2 Les reliquats hors emojis

| # | Reliquat | Où | Visible du testeur |
|---|---|---|---|
| R1 | `TRACKIMMO_SSO_RESTREINT` — le trigger côté serveur | base + `app.js:301` | oui, en cas d'échec d'inscription |
| R2 | L'URL publique est `…github.io/trackimmo/` | `404.html:228-232` | **oui, dans la barre d'adresse** |
| R3 | Table `visites` au lieu de `comptes_rendus` | base | non |
| R4 | 13 fonctions `tiXxx` (`tiCsv`, `tiDateFr`, `tiMigrateToStorage`…) | `app.js` | non |
| R5 | `ADMIN_EMAIL` en dur dans le JS public | `app.js:845` | non, mais l'e-mail est lisible |
| R6 | Gabarits d'e-mails Supabase + `User-Agent` de `news-proxy` | console Supabase | **oui, dans les e-mails d'invitation** |
| R7 | `admin_purge_legacy_base64()` existe encore (droits révoqués) | base | non |

**R2 et R6 sont les seuls que le testeur verra.** R6 est le plus gênant : son
e-mail d'invitation dira « TrackImmo ». C'est à faire **avant** de l'inviter, et
c'est côté console Supabase, donc à ta main.

---

## 6. Évolution — les écrans à l'ancienne charte

*Classés « Évolution » comme demandé : ils doivent rester **utilisables**, pas
forcément beaux. J'ai vérifié qu'ils le sont — aucun handler mort sur les **402
attributs de handler inline** du dépôt (342 dans `app.js`, 60 dans
`index.html`), qui appellent 209 fonctions distinctes.*

| Écran | Boutons ancienne charte | Emojis | Utilisable ? |
|---|---:|---:|---|
| Administration (SCI, annuaire, échéances, bilans) | 8 | 60 | ✅ sauf B2 |
| Simulateur de crédit | 9 | 24 | ✅ |
| Comptes rendus | 5 | 21 | ✅ |
| Paramètres | 4 | 5 | ✅ |
| Nouvelle fiche | 2 | 7 | ✅ |
| Utilisateurs | 1 | 0 | ✅ admin seulement |
| Marché · recherche | 0 | ~24 | ⚠️ dépend de 4 API publiques |
| Marché · carte | 0 | 10 | ❌ écran d'attente (F1) |
| Portails | 0 | 3 | ✅ liens sortants |

**Déjà à la charte Stonefolio, et rien à y faire :** Tableau de bord, Mes biens,
Fiche bien, Suivi financier. Zéro bouton d'ancienne charte, zéro emoji de
décor.

⚠️ **Le Marché est le seul dont l'usage dépend de l'extérieur** :
`api.insee.fr`, `data.ademe.fr`, `dataviz.cerema.fr`, `geo.api.gouv.fr`. Si
l'une ne répond pas, « 🔍 Analyser » reste en `⏳` sans que rien ne l'explique.
Sur un réseau d'iPad, c'est le genre de chose qu'on prend pour une panne de
l'application.

---

## 7. Ce que j'ai cherché et pas trouvé

Dit parce qu'une cartographie qui ne liste que des problèmes ne se relit pas.

- **Aucun handler mort** — les 402 attributs `on…="…"` du dépôt appellent 209
  fonctions distinctes, **toutes définies**.
- **Aucune fuite entre comptes** — les six chemins destructeurs sont filtrés
  par `user_id`, RLS active sur les 17 tables.
- **Aucun orphelin** en base sur six contrôles référentiels.
- **Aucune violation** des invariants posés en v=81.
- **Aucune clé d'API** dans le code livré — la clé NewsAPI vit dans un secret
  Supabase, et l'ancienne est purgée du `localStorage` (`app.js:14477-14479`).
- **162 tests au vert.**

---

## 8. L'ordre que je propose

| Rang | Lot | Pourquoi maintenant |
|---|---|---|
| 1 | **B2** — cloisonner les six boutons de test et de purge | Un clic, et le testeur perd ses données ou les pollue. Le moins cher des six. |
| 2 | **B1 / D1** — trancher l'encaissement des charges | Geste le plus fréquent, aujourd'hui impossible à faire juste. 8 380 € déjà faux. |
| 3 | **R6** — les gabarits d'e-mails Supabase | Le premier contact du testeur avec la plateforme dira « TrackImmo ». À ta main. |
| 4 | **Les 201 emojis**, d'un bloc | Demandé. Une fois les 16 icônes dessinées, le reste est mécanique. |
| 5 | **B3** — `IS DISTINCT FROM` | Trois mots, quatre fonctions, une élévation en admin évitée. |
| 6 | **F1-F4** — masquer les impasses « Bientôt » | Retire quatre déceptions du parcours. |
| 7 | **B5 / B6** — `sfConfirmer()` et les 47 `title=` | Confort iPad, pas bloquant. |
| 8 | **Évolution** — les 8 écrans à migrer | Utilisables en l'état. Après le test. |

**Les rangs 1 à 3 sont ceux que je ferais avant d'envoyer l'invitation.** Le
rang 4 est le lot que tu veux traiter d'un coup, et il est plus gros qu'annoncé :
201 et non 209, mais avec 16 dessins à produire.
