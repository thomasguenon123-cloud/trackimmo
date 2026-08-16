# Cadrage — workflow de préavis

> Document de travail, **rien n'est implémenté**. Décision de Thomas le 16/08/2026 :
> le préavis est un chantier à part, qui demande un cadrage juridique, technique et
> fonctionnel avant d'écrire la moindre ligne.
>
> ⚠️ **Je ne suis pas juriste.** Ce qui suit est la synthèse de sources officielles
> consultées le 16/08/2026, à vérifier auprès d'un professionnel avant de fonder
> un calcul dessus. Les sources sont citées en fin de document.

---

## Le point qui structure tout : deux mécaniques opposées

| | Préavis | Point de départ | Contrainte de date |
|---|---|---|---|
| **Locataire** — bail vide | 3 mois, **réduit à 1 mois** dans 8 cas | **réception** du congé | à tout moment |
| **Locataire** — bail meublé | 1 mois, sans condition | réception | à tout moment |
| **Bailleur** — bail vide | 6 mois | réception | **uniquement à l'échéance du bail** |
| **Bailleur** — bail meublé | 3 mois | réception | **uniquement à l'échéance du bail** |

Côté locataire : `date de réception + N mois`.
Côté bailleur : `N mois AVANT la date anniversaire du bail` — un congé donné plus tôt
reste valable mais **ne fait pas partir le locataire plus tôt**.

**Ce ne sont pas deux variantes d'un même calcul, ce sont deux calculs.**

⚠️ **Rappel de vocabulaire, source d'un malentendu le 16/08** : le **bailleur**, c'est
Thomas. Détenir le bien via une SCI n'y change rien — la SCI est bailleresse, donc lui
à travers elle. Le mot n'introduit aucun tiers.

**Périmètre retenu : le congé du LOCATAIRE uniquement.** C'est le cas courant. Le congé
du bailleur exige en outre un motif parmi trois (vente, reprise, motif légitime et
sérieux) et une notice d'information annexée : c'est un second workflow, pas une option.

---

## Les huit cas de préavis réduit à un mois (bail vide)

1. Logement en **zone tendue**
2. Obtention d'un **logement social**
3. Bénéficiaire du **RSA ou de l'AAH**
4. **État de santé** justifiant un déménagement
5. **Violences conjugales** (ordonnance de protection ou condamnation)
6. **Premier emploi**
7. **Mutation professionnelle**
8. **Perte d'emploi**

Tous exigent un justificatif, sauf la zone tendue qui dépend de la commune.

⚠️ **La zone tendue est fixée par décret et évolue.** L'embarquer dans la base
vieillirait sans que rien ne le signale. → À demander au moment du congé plutôt qu'à
déduire. C'est aussi l'arbitrage le plus honnête : la plateforme ne devine pas un droit.

---

## Après la sortie : deux dates que Stonefolio calcule mal aujourd'hui

**Restitution du dépôt de garantie**
- **1 mois** si l'état des lieux de sortie est conforme à celui d'entrée
- **2 mois** sinon
- ⚠️ Le délai court à partir de la **remise des clés**, pas de la date de fin de bail
- Retard : pénalité de **10 % du loyer mensuel hors charges par mois commencé**

⚠️ **`mfEcheancesBail()` calcule aujourd'hui `date_sortie + 1 mois`** — une approximation
optimiste sur deux points : elle suppose l'état des lieux conforme, et confond date de
sortie et remise des clés. À reprendre avec ce chantier.

**Loyer pendant le préavis** : dû en totalité, **sauf** si un nouveau locataire entre
avant la fin du préavis.

---

## Ce qui reste à trancher

1. **Que produit le workflow ?** Piste de Thomas : *« une nouvelle box dans la section
   Locataires pour faire apparaître toutes les informations utiles »*. À cadrer — le
   garde-fou qu'il pose est clair : **apporter une vraie valeur sans tomber dans la
   surenchère de KPI qui ne ferait que perdre l'utilisateur.**
2. **Les loyers attendus après la sortie** doivent-ils cesser d'être comptés ? Le bien
   redevient vacant : cela touche le cashflow prévisionnel, l'occupation et la règle de
   périmètre du module.
3. **La remise des clés** doit-elle devenir une date distincte de la date de sortie ?
   C'est elle qui déclenche le délai de restitution.
4. **L'état des lieux de sortie** conditionne 1 ou 2 mois : le suivre, ou demander au
   moment de la restitution ?
5. **Le glisser-déposer du kanban** vers la colonne « Préavis » : second point d'entrée
   du workflow, sur le modèle de la colonne « Finalisé » qui déclenche l'acquisition.
   ⚠️ Tant que le workflow n'existe pas, le glisser-déposer est **volontairement absent** :
   il créerait un locataire en préavis sans date de sortie, donc une donnée incomplète
   et silencieuse.

---

## Sources consultées le 16/08/2026

- [Préavis et formalités du congé donné par le locataire — service-public.gouv.fr, F1168](https://www.service-public.gouv.fr/particuliers/vosdroits/F1168)
- [Préavis et formalités du congé donné par le propriétaire — service-public.gouv.fr, F929](https://www.service-public.gouv.fr/particuliers/vosdroits/F929)
- [Restitution du dépôt de garantie — service-public.gouv.fr, F31269](https://www.service-public.gouv.fr/particuliers/vosdroits/F31269)
- [Article 15 de la loi n° 89-462 du 6 juillet 1989 — Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042193498/)
