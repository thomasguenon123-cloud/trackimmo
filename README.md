# Stonefolio

Suivi de patrimoine immobilier locatif : prospection, gestion locative,
rentabilité et administration (SCI, échéances, bilans).

> Anciennement TrackImmo. Le dépôt garde le nom `trackimmo` : le renommer
> changerait l'adresse du site (GitHub Pages).

**Production** : https://thomasguenon123-cloud.github.io/trackimmo/

## Comment c'est fait

- **Site statique**, sans étape de construction : `index.html`, `app.js`
  (script unique) et cinq feuilles de style chargées dans cet ordre —
  `tokens.css` → `components.css` → `styles.css` → `financier.css` →
  `tactile.css`.
- **Bibliothèques hébergées dans `vendor/`**, versions exactes, licences
  jointes, empreintes dans `vendor/empreintes.json`. Aucun CDN. Seuls
  supabase-js et `app.js` se chargent au démarrage ; les autres à la demande.
- **Supabase** : base Postgres (règles d'accès sur toutes les tables),
  stockage des fichiers, authentification, fonctions serveur
  (`supabase/functions/`, seule source de vérité).

## Travailler sur le projet

```bash
npm test          # node --test, aucune dépendance à installer
```

1. Incrémenter `?v=N` dans `index.html` avant de tester une modification de
   CSS ou de JS.
2. Branche de travail → commit → fusion dans `main` → GitHub Pages publie.
3. Toute garde de régression se valide par mutation (réintroduire l'ancien
   code, vérifier que le test tombe).

Les consignes détaillées (règles produit, sources uniques, pièges connus)
sont dans [`CLAUDE.md`](CLAUDE.md).

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| racine | le site : `index.html`, `app.js`, feuilles de style, icônes, `404.html` |
| `vendor/` | bibliothèques tierces et polices, avec leurs empreintes |
| `fonts/` | polices de l'interface |
| `supabase/functions/` | fonctions serveur (Edge Functions) |
| `supabase/sql/` | scripts SQL joués à la main (chacun dit s'il l'a été) |
| `test/` | tests (`node --test`) |
| `docs/` | audits, cadrages, notes et historique |
| `maquettes/` | maquettes HTML de référence (non utilisées par le site) |
