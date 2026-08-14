# Tests du socle de calcul

```bash
npm test
```

Aucune dépendance, aucune étape de build : `node --test` suffit. Le dépôt reste
déployable tel quel sur GitHub Pages — c'est ce qui rend ces tests tenables ici.

## Ce qu'ils couvrent, et pourquoi ceux-là

Les fonctions **pures** du socle de calcul : celles qui décident des chiffres
affichés, sans DOM ni réseau. C'est là que les bugs coûtent le plus cher, parce
qu'ils écrivent en base ou faussent une décision d'investissement.

| Fichier | Couvre |
|---|---|
| `prorata.test.js` | `mfLoyerProrata`, `mfDaysOccupiedInMonth`, `mfDaysInMonth` |
| `exercice.test.js` | `mfMoisEcoules`, `mfReelExercice`, `mfRendementNet`, `mfDansLePerimetre`, `mfLoueSurExercice`, `mfConsolide` |
| `loyers.test.js` | `sfLoyerEtat`, `mfLoyersNonSoldes` |

## Les tests marqués RÉGRESSION

Ils gardent des bugs qui ont réellement existé, trouvés à la revue du
13/08/2026. Chacun a été **validé par mutation** : on réintroduit l'ancien code,
et on vérifie que le test tombe. Un test qui ne tombe pas sur son bug ne vaut
rien.

1. **Le prorata de mars, faussé par l'heure d'été.** Le comptage se faisait en
   millisecondes ; le dernier dimanche de mars ne dure que 23 h, le plancher
   perdait un jour. Un loyer de 830 € était généré à **803 €** et écrit en base.
2. **« Loué » lu sur le statut actuel du locataire.** Sur un exercice passé dont
   le locataire est parti, un bien loué toute l'année comptait comme vacant.
3. **Un loyer dû sans ligne générée, invisible des compteurs.** La grille le
   peignait en rouge, les compteurs l'ignoraient.

## Comment ça marche

`app.js` est un script de navigateur : pas de modules, pas d'exports, et il crée
un client Supabase dès sa ligne 4. `charger-app.js` l'exécute dans un contexte
`node:vm` muni de doublures minimales, puis lit ses fonctions.

Deux pièges rencontrés, à connaître avant d'écrire un test :

- ⚠️ **Le temps est injectable, et il doit l'être.** `mfMoisEcoules` et
  `sfLoyerEtat` lisent l'horloge : un test qui dépend du jour passe en août et
  échoue en janvier. `charger({ maintenant })` fige la date vue par `app.js`.
- ⚠️ **Les `let` de `app.js` ne sont pas des propriétés du contexte.** Une
  déclaration `let` au sommet d'un script crée un lien dans la portée lexicale
  globale, pas sur l'objet global ; seules les `function` y apparaissent. Pour
  lire ou écrire `allBiens`, `allLoyers`, `mfExercice`… il faut passer par
  `injecter()` et `lire()`, qui exécutent du code **dans** le contexte.
- ⚠️ **Comparer des tableaux venus du contexte échoue en `deepStrictEqual`** :
  ils portent le prototype de l'autre realm. Passer par `Array.from(...)`.

## Ce qui n'est pas couvert

Le rendu, les gestionnaires d'événements et les écritures en base. Ils se
vérifient au banc d'essai (`_banc-essai.html`, hors dépôt) : Supabase stubbé,
données réelles injectées, lecture du DOM et des styles calculés.
