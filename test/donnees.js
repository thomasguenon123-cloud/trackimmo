/* Jeu de données de test, calqué sur la base réelle de Thomas.
   Les chiffres attendus dans les tests viennent d'un recalcul SQL sur ces
   mêmes données — pas d'une exécution du code qu'ils vérifient. */

const SCI_ID = 'sci-1';

const IMMEUBLE = {
  id: 'bien-immeuble', titre: 'Immeuble Paris 18e', ville: 'Paris 18e', code_postal: '75018',
  statut: 'Acheté', prix_affiche: 650000, frais_notaire: 45500, travaux: 0,
  frais_agence: 32500, creation_sci: 200, mensualite_credit: 2800,
  loyer_en_etat: 4200, charges_locataire_etat: 0, charge_copro: 126,
  assurance_logement: 33, taxe_fonciere: 168, sci_id: SCI_ID, mode_detention: 'sci',
};
const T3_LYON = {
  id: 'bien-lyon', titre: 'T3 Lyon', ville: 'Lyon', code_postal: '69007',
  statut: 'Acheté', prix_affiche: 220000, frais_notaire: 15400, travaux: 0,
  frais_agence: 11000, creation_sci: 200, mensualite_credit: 850,
  loyer_en_etat: 1050, charges_locataire_etat: 0, charge_copro: 32,
  assurance_logement: 33, taxe_fonciere: 42, sci_id: SCI_ID, mode_detention: 'sci',
};
const T4_PARIS = {
  id: 'bien-t4', titre: 'T4+ Paris 16e', ville: 'Paris 16e', code_postal: '75016',
  statut: 'Acheté', prix_affiche: 850000, frais_notaire: 59500, travaux: 0,
  frais_agence: 42500, creation_sci: 200, mensualite_credit: 3600,
  loyer_en_etat: 2800, charges_locataire_etat: 0, charge_copro: 84,
  assurance_logement: 33, taxe_fonciere: 112, sci_id: null, mode_detention: null,
};
const EN_PROSPECTION = {
  id: 'bien-nice', titre: 'T2 Nice', ville: 'Nice', code_postal: '06000',
  statut: 'Contre offre - Acceptée', prix_affiche: 320000, frais_notaire: 22400,
  travaux: 0, frais_agence: 16000, creation_sci: 200, mensualite_credit: 1380,
  loyer_en_etat: 1100, charges_locataire_etat: 0, charge_copro: 33,
  assurance_logement: 33, taxe_fonciere: 44, sci_id: null, mode_detention: null,
};

const LOCATAIRE = {
  id: 'loc-1', nom: 'Test V1', prenom: null, bien_id: IMMEUBLE.id,
  date_entree: '2025-06-11', date_sortie: null,
  loyer_bail_hc: 830, charges_bail: 490, jour_paiement: 5, statut: 'Actif',
};

// Exercice 2026 : payé en jan/mar/avr/mai, en attente les autres mois.
const PAYES = [1, 3, 4, 5];
const LOYERS_2026 = Array.from({ length: 12 }, (_, i) => {
  const mois = i + 1;
  const paye = PAYES.includes(mois);
  return {
    id: `loyer-2026-${mois}`, bien_id: IMMEUBLE.id, locataire_id: LOCATAIRE.id,
    annee: 2026, mois, loyer_du: 830, charges_dues: 490,
    montant_encaisse: paye ? 830 : null,
    statut: paye ? 'Payé' : 'En attente',
    date_encaissement: paye ? `2026-${String(mois).padStart(2, '0')}-05` : null,
  };
});

const CHARGES = [{
  id: 'charge-1', bien_id: IMMEUBLE.id, date_charge: '2026-04-15',
  categorie: 'Autre', libelle: 'taxe test', montant: 55,
  frequence: 'Ponctuelle', recuperable_locataire: false, lissable: false,
}];

/** Injecte le jeu complet dans le contexte, et rend les objets pour les tests. */
function poser(injecter, contexte, surcharges = {}) {
  const donnees = {
    allBiens: [T3_LYON, IMMEUBLE, T4_PARIS, EN_PROSPECTION].map(b => ({ ...b })),
    allLoyers: LOYERS_2026.map(l => ({ ...l })),
    allCharges: CHARGES.map(c => ({ ...c })),
    allLocataires: [{ ...LOCATAIRE }],
    allSCI: [{ id: SCI_ID, nom_sci: 'SCI TEST' }],
    allBilans: [],
    currentUser: { id: 'user-test' },
    userPrefs: { seuil_rentabilite: 5 },
    mfExercice: 2026,
    ...surcharges,
  };
  injecter(contexte, donnees);
  return donnees;
}

module.exports = { poser, IMMEUBLE, T3_LYON, T4_PARIS, EN_PROSPECTION, LOCATAIRE, SCI_ID };
