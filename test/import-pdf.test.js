/* LE PDF DE LA BANQUE — la v=105.

   ⚠️ CE QUI ÉTAIT CASSÉ (capture de Thomas, 18/10 : « je ne peux plus
   importer de document PDF »). Le lecteur existait, caché dans le formulaire,
   et ne remplissait presque rien : le texte de chaque page était collé en une
   seule ligne, quand le document d'une banque est un TABLEAU (une ligne par
   prêt) ; seuls les champs vides se remplissaient, or le taux proposé, la
   durée par défaut et les revenus de la dernière simulation occupaient les
   leurs ; l'assurance d'un tableau n'avait pas de libellé.

   CE QUE CES GARDES EMPÊCHENT DE REVENIR :
   · un tableau de prêts lu sans la position des mots ;
   · un TAEG pris pour le taux nominal, une durée de validité pour la durée
     du prêt, un taux d'assurance pour une cotisation ;
   · une valeur SAISIE écrasée par le PDF — ou une valeur PROPOSÉE qui le bloque ;
   · un fichier qui n'est pas un PDF, trop gros ou protégé, lu quand même ou
     refusé sans le dire ;
   · le texte du document dans un journal, en base, ou dans ce qui en sort ;
   · le PDF envoyé avant l'enregistrement, ou gardé sans l'accord de l'utilisateur ;
   · le nom du fichier de l'appareil (souvent celui de l'emprunteur) dans le stockage ;
   · un lien d'une heure, en cache, pour ouvrir un document sensible ;
   · un PDF dont l'effacement échoue en silence, la ligne supprimée quand même ;
   · un second appui, après un envoi refusé, qui crée une seconde simulation.

   ⚠️ Tous les documents ci-dessous sont FICTIFS : aucun chiffre, aucun nom
   n'est tiré d'un vrai document. Le vrai PDF de Thomas a servi à régler le
   lecteur sur le poste de travail ; il n'entre jamais dans le dépôt. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger, injecter, lire } = require('./charger-app');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const MASQUE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
const nu = x => JSON.parse(JSON.stringify(x));

function corps(nom) {
  const debut = MASQUE.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = MASQUE.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(|^(?:const|let) /m);
  return suite === -1 ? MASQUE.slice(debut) : MASQUE.slice(debut, debut + 1 + suite);
}

function app() {
  const ctx = charger({ maintenant: new Date(2026, 9, 18, 12) });
  ctx.crypto = { randomUUID: () => require('node:crypto').randomUUID() };
  ctx.notifs = [];
  ctx.showNotif = (m, err) => ctx.notifs.push({ m, err: !!err });
  ctx.pages = [];
  ctx.navigate = p => ctx.pages.push(p);
  injecter(ctx, { currentUser: { id: 'u1' }, currentProfile: { role: 'user' }, allBiens: [], sfBiensCharges: true, currentPage: 'simulation' });
  return ctx;
}

// ─── Documents fictifs ─────────────────────────────────────────────────────

// Un tableau de prêts, comme le présentent les simulations d'agence.
const TABLEAU = [
  'Crédit Mutuel',
  'Valable à compter du 05/09/2026 pendant 30 jours.',
  'Votre simulation de financement',
  'Nature du prêt Montant Taux Durée (mois) Mensualité hors assurance Mensualité avec assurance Coût total TAEG',
  'Prêt habitat 182 500,00 3,25% 300 889,35 922,15 94 148,00 3,61%',
  'Total des prêts 182 500,00',
  'Revenus nets mensuels : 3 900 €',
  'Loyer',
  'Montant mensuel : 950 €',
];
// Une fiche d'information standardisée européenne : des libellés, pas de tableau.
const FISE = `BNP PARIBAS
FICHE D'INFORMATION STANDARDISÉE EUROPÉENNE
Éditée le 03/09/2026
Montant et monnaie du prêt à accorder : 187 500,00 €
Durée du prêt : 300 mois
Taux annuel effectif global (TAEG) : 4,05 %
Taux débiteur fixe annuel : 3,62 %
Échéance mensuelle hors assurance : 950,78 €
Cotisation mensuelle d'assurance emprunteur : 35,50 €
Revenus nets mensuels du foyer : 4 200,00 €`;

/* Les morceaux d'une page tels que pdf.js les rend : une cellule par
   morceau, positionnée, et DANS LE DÉSORDRE — l'ordre du flux d'un PDF n'est
   pas celui de la lecture (ici, colonne par colonne). */
function morceaux(lignes) {
  const items = [];
  lignes.forEach((l, i) => {
    const y = 780 - i * 14;
    // Les cellules d'une même ligne n'ont pas toujours la même ordonnée (à un point près).
    l.split(/(?<=\d%|\d,\d\d) (?=\d)|(?<=[a-zé)]) (?=\d)/).forEach((cellule, j) => items.push({ s: cellule, x: 20 + j * 70, y: y + (j % 2 ? 0.8 : 0) }));
  });
  items.push({ s: '   ', x: 5, y: 500 });               // les morceaux vides ne font pas de ligne
  return items.sort((a, b) => a.x - b.x || a.y - b.y);   // colonne par colonne
}
const enItems = items => items.map(i => ({ str: i.s, transform: [1, 0, 0, 1, i.x, i.y] }));

// ─── Le lecteur ────────────────────────────────────────────────────────────

test('les lignes se reconstruisent d’après la position des mots', () => {
  const ctx = app();
  const items = morceaux(TABLEAU);
  const lignes = ctx.sfPdfLignes(items).split('\n');
  assert.equal(lignes.length, TABLEAU.length, 'un morceau vide fait une ligne, ou une ligne se coupe en deux');
  assert.equal(lignes[4], TABLEAU[4], 'la ligne du prêt, remise dans l’ordre de lecture');
  // L'ancienne lecture : les morceaux collés dans l'ordre du flux.
  const colle = items.map(i => i.s).join(' ');
  assert.equal(ctx.sfsLireOffre(colle).montant ?? null, null, 'témoin : sans les positions, le tableau ne se lit pas');
});

test('un tableau de prêts : montant, taux, durée, mensualités, assurance, TAEG, revenus, loyer, date, banque', () => {
  const ctx = app();
  const r = nu(ctx.sfsLireOffre(ctx.sfPdfLignes(morceaux(TABLEAU))));
  assert.deepEqual(
    { montant: r.montant, taux: r.taux, mois: r.mois, duree: r.duree, hors: r.mensualiteHors, avec: r.mensualite, assurance: r.assurance, taeg: r.taeg },
    { montant: 182500, taux: 3.25, mois: 300, duree: 25, hors: 889.35, avec: 922.15, assurance: 32.8, taeg: 3.61 });
  assert.equal(r.revenus, 3900);
  assert.equal(r.loyer, 950, 'le bloc « Loyer » suivi de « Montant mensuel »');
  assert.equal(r.date, '2026-09-05');
  assert.equal(r.banque, 'Crédit Mutuel');
  assert.equal(r.prets, 1);
  assert.equal(r.coherent, true, 'la mensualité annoncée et le calcul concordent');
  assert.equal(r.dureeArrondie, false);
});

test('une fiche standardisée : le taux débiteur, jamais le TAEG qui le précède', () => {
  const ctx = app();
  const r = nu(ctx.sfsLireOffre(FISE));
  assert.equal(r.taux, 3.62, 'Le TAEG (4,05 %) est pris pour le taux nominal.');
  assert.equal(r.taeg, 4.05);
  assert.equal(r.montant, 187500);
  assert.equal(r.mois, 300);
  assert.equal(r.mensualiteHors, 950.78);
  assert.equal(r.assurance, 35.5);
  assert.equal(r.revenus, 4200);
  assert.equal(r.date, '2026-09-03');
  assert.equal(r.banque, 'BNP Paribas');
  assert.equal(r.coherent, true);
});

test('deux prêts : le principal est repris, l’autre est noté', () => {
  const ctx = app();
  const deux = [...TABLEAU.slice(0, 4), 'Prêt complémentaire 30 000,00 1,00% 180 179,55 185,05 3 309,00 1,25%', ...TABLEAU.slice(4)];
  const r = nu(ctx.sfsLireOffre(deux.join('\n')));
  assert.equal(r.prets, 2);
  assert.equal(r.montant, 182500, 'le plus gros prêt est le principal');
  assert.deepEqual(r.autres, [{ montant: 30000, taux: 1, mois: 180, mensualite: 185.05 }]);
  const notes = ctx.sfsNotesDepuisLecture(r);
  assert.match(notes, /Autre prêt du document : 30 000 € à 1 % sur 180 mois, 185,05 € par mois\./);
  assert.match(notes, /TAEG indiqué par la banque : 3,61 %\./, 'le TAEG, qui compare deux offres, est gardé dans les notes');
});

test('les pièges : TAEG seul, taux d’assurance, durées de validité, capitaux d’une notice', () => {
  const ctx = app();
  const taeg = nu(ctx.sfsLireOffre('Société Générale\nMontant emprunté : 150 000 €\nDurée : 20 ans\nTAEG : 3,90 %\n'
    + 'Taux du crédit, assurance comprise (TAEG) : 3,90 %\nTaux annuel effectif de l’assurance : 0,30 %'));
  assert.equal(taeg.taux ?? null, null, 'Le TAEG devient le taux nominal.');
  assert.equal(taeg.assurance ?? null, null, 'Le taux de l’assurance (TAEA) devient une cotisation.');
  assert.equal(taeg.montant, 150000, 'témoin : le montant est lu');
  assert.equal(taeg.duree, 20, 'témoin : la durée en années est lue');
  const notice = nu(ctx.sfsLireOffre([
    'La durée de validité du questionnaire de santé est fixée à 6 mois.',
    'Encours global de 2 000 000 €, limite d’âge 75 ans.',
    'Délai de franchise : 90 jours. Période de carence — durée : 12 mois.',
    'Taux de couverture : 100,00 %',
  ].join('\n')));
  assert.equal(ctx.sfsLectureUtile(notice), false, 'Une notice d’assurance fournit des chiffres de prêt : ' + JSON.stringify(notice));
  assert.equal(ctx.sfsLectureUtile(taeg), true, 'témoin');
});

test('une durée en mois s’arrondit en années, et une mensualité discordante se signale', () => {
  const ctx = app();
  const r = nu(ctx.sfsLireOffre('LCL\nPrêt amortissable 140 000,00 3,40% 243 700,00 730,00'));
  assert.equal(r.mois, 243);
  assert.equal(r.duree, 20);
  assert.equal(r.dureeArrondie, true);
  assert.equal(r.coherent, false, 'Une mensualité annoncée à 700 € quand le calcul en donne 798 passe sans alerte.');
  assert.equal(r.mensualiteCalculee, 797.83);
  // Des revenus annoncés à l'année se comptent par mois.
  assert.equal(ctx.sfsLireOffre('Revenus annuels nets : 54 000 €').revenus, 4500);
});

// ─── Le fichier ────────────────────────────────────────────────────────────

const enOctets = s => Uint8Array.from(Buffer.from(s, 'latin1'));

test('seul un PDF passe : signature, taille, fichier vide', () => {
  const ctx = app();
  assert.equal(ctx.sfsVerifierPdf(enOctets('%PDF-1.7\n…')), null);
  assert.equal(ctx.sfsVerifierPdf(enOctets(' '.repeat(500) + '%PDF-1.4')), null, 'la norme admet des octets avant la signature');
  assert.match(ctx.sfsVerifierPdf(enOctets(' '.repeat(1100) + '%PDF-1.4')), /n’est pas un PDF/, 'au-delà de 1 024 octets, ce n’est plus un PDF');
  assert.match(ctx.sfsVerifierPdf(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), /n’est pas un PDF/, 'une image PNG');
  assert.match(ctx.sfsVerifierPdf(new Uint8Array(0)), /vide/);
  assert.match(ctx.sfsVerifierPdf({ length: 21 * 1024 * 1024 }), /20 Mo/);
  // La limite du stockage simulations-pdf (file_size_limit = 20 971 520, lu en base le 18/10).
  assert.equal(lire(ctx, 'SF_PDF_MAX'), 20971520);
});

/* Un faux pdf.js : il enregistre les options, VIDE le tampon reçu (le vrai le
   transfère à son travailleur) et rend des pages fictives. */
function fauxPdfjs(ctx, { pages = {}, numPages = 3, erreur = null } = {}) {
  const suivi = { options: null, lues: [], detruit: 0, charge: 0 };
  ctx.sfChargerBiblio = async () => { suivi.charge++; };
  ctx.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument(options) {
      suivi.options = { ...options, data: undefined };
      options.data.fill(0);
      return {
        promise: erreur ? Promise.reject(erreur) : Promise.resolve({
          numPages,
          getPage: async i => { suivi.lues.push(i); return { getTextContent: async () => ({ items: enItems(pages[i] || []) }), cleanup() {} }; },
        }),
        destroy() { suivi.detruit++; return Promise.resolve(); },
      };
    },
  };
  // Un Blob qui COPIE à la construction, comme le vrai.
  ctx.Blob = function (parts, o) { this.octets = Buffer.concat(parts.map(p => Buffer.from(p))); this.type = o?.type; };
  return suivi;
}
const fichier = (texte = '%PDF-1.7\n', taille) => {
  const o = enOctets(texte);
  return { size: taille ?? o.length, name: 'Simulation_DUPONT_Jean.pdf', lu: 0, async arrayBuffer() { this.lu++; return o.buffer.slice(0); } };
};

test('lire un PDF : sans exécution de code, au plus 40 pages, travailleur libéré, copie prise avant pdf.js', async () => {
  const ctx = app();
  const suivi = fauxPdfjs(ctx, { pages: { 1: morceaux(TABLEAU) }, numPages: 55 });
  const progres = [];
  const r = await ctx.sfsLirePdf(fichier(), (i, n) => progres.push([i, n]));
  assert.equal(suivi.options.isEvalSupported, false, 'CVE-2024-4367 : pdf.js compile des polices en code exécutable');
  assert.equal(suivi.options.disableFontFace, true);
  assert.equal(suivi.lues.length, 40, 'Toutes les pages d’un PDF de 55 pages sont lues.');
  assert.deepEqual(progres.at(-1), [40, 40]);
  assert.equal(suivi.detruit, 1, 'le document et son travailleur ne sont pas libérés');
  assert.equal(r.pages, 55);
  assert.equal(r.lu.montant, 182500, 'témoin : la première page est lue');
  assert.equal(r.fichier.type, 'application/pdf', 'le stockage n’accepte que application/pdf : le type est imposé');
  assert.equal(r.fichier.octets.subarray(0, 5).toString('latin1'), '%PDF-',
    'La copie gardée pour l’envoi est prise APRÈS pdf.js, qui a vidé le tampon : le fichier envoyé serait vide.');
});

test('le texte du document ne sort jamais : ni journal, ni résultat', async () => {
  const ctx = app();
  const SECRET = ['M. Camille FICTIF', '12 rue Imaginaire 35000 Rennes', 'IBAN FR00 0000 0000 0000 0000 0000 FICTIF'];
  fauxPdfjs(ctx, { pages: { 1: morceaux([...SECRET, ...TABLEAU]) } });
  const journal = [];
  const espion = (...a) => journal.push(a.map(String).join(' '));
  ctx.console = { log: espion, warn: espion, error: espion, info: espion, debug: espion };
  const r = await ctx.sfsLirePdf(fichier());
  const sortie = JSON.stringify({ lu: r.lu, pages: r.pages });
  for (const s of SECRET) {
    assert.ok(!sortie.includes(s.split(' ').at(-1)), `Le résultat de la lecture contient du texte du document (« ${s} »).`);
  }
  assert.deepEqual(journal, [], 'La lecture écrit dans le journal du navigateur.');
  assert.equal(r.lu.montant, 182500, 'témoin : la lecture a eu lieu');
  // Une erreur ne journalise que son NOM.
  const ctx2 = app();
  fauxPdfjs(ctx2, { erreur: Object.assign(new Error('Contenu : ' + SECRET[2]), { name: 'UnknownErrorException' }) });
  const j2 = [];
  ctx2.console = { log() {}, error() {}, warn: (...a) => j2.push(a.join(' ')) };
  await assert.rejects(ctx2.sfsLirePdf(fichier()), /n’a pas pu être lu/);
  assert.ok(!j2.join().includes('IBAN'), 'Le message d’une erreur de pdf.js part dans le journal.');
  assert.equal(j2.length, 1, 'témoin : l’erreur est journalisée par son nom');
});

test('un PDF refusé le dit : protégé, pas un PDF, trop gros — et rien n’est lu ni chargé pour rien', async () => {
  const ctx = app();
  let suivi = fauxPdfjs(ctx, { erreur: Object.assign(new Error('x'), { name: 'PasswordException' }) });
  await assert.rejects(ctx.sfsLirePdf(fichier()), /protégé par un mot de passe/);
  assert.equal(suivi.detruit, 1, 'même refusé, le document est libéré');
  suivi = fauxPdfjs(ctx);
  await assert.rejects(ctx.sfsLirePdf(fichier('\x89PNG\r\n\x1a\n')), /n’est pas un PDF/);
  assert.equal(suivi.charge, 0, 'pdf.js (1 Mo) se charge pour un fichier qui n’est pas un PDF');
  // Le lecteur (pdf.js) ne se charge pas : une phrase, pas un chemin de fichier.
  fauxPdfjs(ctx);
  ctx.sfChargerBiblio = async () => { throw new Error('Échec de chargement : vendor/pdfjs-3.11.174/pdf.min.js'); };
  await assert.rejects(ctx.sfsLirePdf(fichier()), /^Error: Le lecteur de PDF n’a pas pu être chargé : vérifiez la connexion, puis réessayez\.$/);
  const gros = fichier('%PDF-1.7', 25 * 1024 * 1024);
  await assert.rejects(ctx.sfsLirePdf(gros), /20 Mo/);
  assert.equal(gros.lu, 0, 'Un fichier de 25 Mo est lu en mémoire avant d’être refusé.');
});

// ─── La saisie ─────────────────────────────────────────────────────────────

test('le plan : un champ vide ou une valeur proposée se remplit, une saisie se garde — sauf à la demande', () => {
  const ctx = app();
  const lu = { montant: 182500, taux: 3.25, duree: 25, assurance: 32.8, revenus: 3900, loyer: 950 };
  const champs = {
    's-montant': { valeur: '160 000', propose: false },   // saisi
    's-taux': { valeur: '3,32', propose: true },          // taux moyen proposé
    's-duree': { valeur: '25', propose: false },          // saisi, et identique
    's-assurance': { valeur: '', propose: false },        // vide
    's-revenus': { valeur: '3 200', propose: true },      // revenus de la dernière simulation
    's-loyer-banque': { valeur: 'abc', propose: false },  // illisible : une saisie quand même
  };
  const plan = nu(ctx.sfsPlanLecture(lu, champs));
  assert.deepEqual(plan.remplir, { 's-taux': 3.25, 's-duree': 25, 's-assurance': 32.8, 's-revenus': 3900 });
  assert.deepEqual(plan.gardes.map(g => g.id), ['s-montant', 's-loyer-banque'], 'Le PDF écrase une saisie.');
  assert.deepEqual(nu(ctx.sfsPlanLecture(lu, champs, true)).gardes, [], '« Prendre les valeurs du PDF » ne prend rien');
});

/* Un faux écran de saisie : les champs, leurs aides, le récapitulatif. */
function ecranSaisie(ctx, valeurs, proposes = []) {
  const els = {};
  const aide = { retire: 0, remove() { this.retire++; } };
  for (const [id, value] of Object.entries(valeurs)) {
    els[id] = { id, value, dataset: proposes.includes(id) ? { propose: '1' } : {}, textContent: '', innerHTML: '', className: '', hidden: false };
  }
  els['s-taux-aide'] = { innerHTML: '<em class="sf-source">Taux moyen des nouveaux crédits immobiliers</em> · <a>Voir les taux</a>' };
  els['s-montant-aide'] = { closest: sel => (sel === '.sf-aide' ? aide : null) };
  els['sfs-lecture'] = { innerHTML: '', hidden: true };
  ctx.document.getElementById = id => els[id] || null;
  return { els, aide };
}

test('appliquer la lecture : champs remplis et marqués, mentions qui ne valent plus retirées, récapitulatif', () => {
  const ctx = app();
  const lu = nu(ctx.sfsLireOffre(TABLEAU.join('\n')));
  const { els, aide } = ecranSaisie(ctx, { 's-nom': 'Crédit — T2 Rennes', 's-date-doc': '', 's-montant': '170 000', 's-taux': '3,32',
    's-duree': '20', 's-assurance': '', 's-revenus': '', 's-loyer-banque': '900', 's-notes': '' }, ['s-nom', 's-montant', 's-taux', 's-duree', 's-loyer-banque']);
  ctx.sfsAppliquerLecture(lu);
  assert.equal(els['s-montant'].value, '182 500', 'le coût du bien proposé est remplacé par le montant de l’offre');
  assert.equal(els['s-taux'].value, '3,25');
  assert.equal(els['s-duree'].value, '25', 'la durée par défaut (20 ans) bloquait la durée de l’offre');
  assert.equal(els['s-assurance'].value, '32,8');
  assert.equal(els['s-revenus'].value, '3 900');
  assert.equal(els['s-loyer-banque'].value, '950');
  assert.equal(els['s-date-doc'].value, '2026-09-05');
  assert.equal(els['s-taux'].dataset.lu, '1', 'un champ rempli par le PDF est marqué');
  assert.equal(els['s-taux'].dataset.propose, undefined);
  assert.equal(els['s-nom'].value, 'Crédit Mutuel · 182 500 € · 25 ans', 'le nom proposé devient celui de l’offre');
  assert.match(els['s-notes'].value, /^TAEG indiqué par la banque : 3,61 %\.\nMensualité indiquée par la banque : 922,15 €, assurance comprise\.$/);
  assert.doesNotMatch(els['s-taux-aide'].innerHTML, /sf-source/, 'Le taux de l’offre garde la mention du taux moyen officiel.');
  assert.equal(aide.retire, 1, 'L’aide « coût de l’opération, ôtez votre apport » reste sur le montant de l’offre.');
  const recap = els['sfs-lecture'];
  assert.equal(recap.hidden, false);
  assert.match(recap.innerHTML, /Repris : montant, taux, durée, assurance, revenus, loyer, date\. Vérifiez-les avant d’enregistrer\./);
  assert.doesNotMatch(recap.innerHTML, /Gardés|Non trouvés/);
});

test('une saisie gardée se dit, avec la valeur du PDF et le moyen de la prendre ; ce qui manque se dit aussi', () => {
  const ctx = app();
  const { els } = ecranSaisie(ctx, { 's-nom': 'Ma négociation', 's-date-doc': '2026-08-01', 's-montant': '175 000', 's-taux': '', 's-duree': '',
    's-assurance': '', 's-revenus': '', 's-loyer-banque': '', 's-notes': 'Mes notes' });
  ctx.sfsAppliquerLecture({ montant: 182500, taux: 3.25, mois: 300, duree: 25, prets: 1, autres: [] });
  assert.equal(els['s-montant'].value, '175 000', 'Le PDF écrase un montant saisi.');
  assert.equal(els['s-nom'].value, 'Ma négociation', 'Le PDF écrase un nom saisi.');
  assert.equal(els['s-notes'].value, 'Mes notes', 'Le PDF écrase des notes.');
  assert.equal(els['s-date-doc'].value, '2026-08-01');
  const recap = els['sfs-lecture'].innerHTML;
  assert.match(recap, /Gardés, car déjà saisis : montant \(le PDF indique 182 500 €\)\./);
  assert.match(recap, /onclick="sfsAppliquerLecture\(sfsLu, \{ forcer: true \}\)">Prendre les valeurs du PDF</);
  assert.match(recap, /Non trouvés dans le PDF : revenus\./);
  // « Prendre les valeurs du PDF » : la saisie cède, le nom et les notes restent.
  ctx.sfsAppliquerLecture(lire(ctx, 'sfsLu'), { forcer: true });
  assert.equal(els['s-montant'].value, '182 500');
  assert.equal(els['s-nom'].value, 'Ma négociation');
});

test('un second PDF remplace ce que le premier avait rempli — pas ce qu’on a tapé depuis', () => {
  const ctx = app();
  const { els } = ecranSaisie(ctx, { 's-nom': '', 's-date-doc': '', 's-montant': '', 's-taux': '', 's-duree': '',
    's-assurance': '', 's-revenus': '', 's-loyer-banque': '', 's-notes': '' });
  ctx.sfsAppliquerLecture(nu(ctx.sfsLireOffre(TABLEAU.join('\n'))));
  // Après le premier PDF, on retouche les revenus à la main (sfsSaisie retire la marque).
  els['s-revenus'].value = '4 100'; delete els['s-revenus'].dataset.lu;
  ctx.sfsAppliquerLecture(nu(ctx.sfsLireOffre(FISE)));
  assert.equal(els['s-montant'].value, '187\u00a0500', 'Le montant du premier PDF passe pour une saisie : le second ne le remplace pas.');
  assert.equal(els['s-taux'].value, '3,62');
  assert.equal(els['s-date-doc'].value, '2026-09-03');
  assert.equal(els['s-revenus'].value, '4 100', 'Une valeur tapée après le premier PDF est écrasée par le second.');
  assert.match(els['s-nom'].value, /^BNP Paribas · 187\u00a0500\u202f€ · 25 ans$/, 'le nom venu du premier PDF suit le second');
  assert.match(els['s-notes'].value, /^TAEG indiqué par la banque : 4,05\u202f%\./, 'les notes venues du premier PDF suivent le second');
  assert.match(els['sfs-lecture'].innerHTML, /Gardés, car déjà saisis : revenus/);
});

test('le récapitulatif signale plusieurs prêts, une durée arrondie et une mensualité discordante — sans couleur seule', () => {
  const ctx = app();
  const { els } = ecranSaisie(ctx, { 's-montant': '', 's-taux': '', 's-duree': '', 's-revenus': '' });
  ctx.sfsAppliquerLecture({ montant: 140000, taux: 3.4, mois: 243, duree: 20, dureeArrondie: true, prets: 2, autres: [],
    mensualiteHors: 700, coherent: false, mensualiteCalculee: 797.83, revenus: 3000 });
  const recap = els['sfs-lecture'].innerHTML;
  assert.match(recap, /Le document compte 2 prêts : seul le principal est repris \(140 000 €\)\. Les autres sont dans les notes\./);
  assert.match(recap, /Durée de 243 mois, arrondie à 20 ans\./);
  assert.match(recap, /<svg[^>]*>.*?<\/svg> <span>La mensualité de la banque \(700,00 € hors assurance\) ne correspond pas au calcul \(797,83 €\) : vérifiez le taux et la durée\./s,
    'une discordance se dit par une icône ET une phrase');
});

test('le formulaire : valeurs proposées marquées, unité à sa place, le PDF importé et le choix de le garder', async () => {
  const ctx = app();
  injecter(ctx, { sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
  const el = { innerHTML: '', querySelector: () => ({ addEventListener() {} }) };
  ctx.document.getElementById = () => null;
  const s = { nom_simulation: 'Crédit — T2', montant_emprunte: 170000, taux_interet: 3.32, duree_ans: 20, revenus_mensuels: 3200, loyer_exige_banque: 800 };
  ctx.sfsRenderSaisie(el, s, true, { taux: 3.32, mention: 'Taux moyen' });
  const h = el.innerHTML;
  for (const id of ['s-nom', 's-montant', 's-taux', 's-duree', 's-revenus', 's-loyer-banque']) {
    assert.match(h, new RegExp(`id="${id}"[^>]*data-propose="1"`), `${id} : une valeur proposée n’est pas marquée — le PDF ne pourra pas la remplacer`);
  }
  assert.doesNotMatch(h, /id="s-assurance"[^>]*data-propose/, 'un champ vide n’a rien de proposé');
  assert.match(h, /sfn-saisie sfs-saisie sfn-saisie--euro_mois">\s*<input[^>]*id="s-revenus"/, '« 2 501 » passe sous « €/mois »');
  assert.doesNotMatch(h, /type="file"/, 'le choix du fichier vit dans la fenêtre d’import, pas caché dans le formulaire');
  assert.match(h, /onclick="sfsImporterDansLaSaisie\(\)">[\s\S]*?Importer un PDF de la banque/);
  assert.match(h, /Date du document/);
  // Modifier une simulation : ses valeurs sont des saisies.
  ctx.sfsRenderSaisie(el, { ...s, id: 's1' }, true, null);
  assert.doesNotMatch(el.innerHTML, /data-propose/, 'Les valeurs d’une simulation enregistrée passent pour des propositions.');
  // Après l'import : le PDF lu, et la case « Garder » cochée — à côté de son aide, pas dedans.
  injecter(ctx, { sfsPdf: { fichier: {}, pages: 33, garder: true } });
  const doc = ctx.sfsDocHtml({});
  assert.match(doc, /PDF lu · 33 pages/);
  assert.match(doc, /<input type="checkbox" id="s-garder-pdf" checked>/, 'garder le PDF est proposé par défaut');
  assert.match(doc, /<label for="s-garder-pdf">Garder ce PDF dans mon espace privé<\/label><span class="sf-lex sf-aide">/);
  assert.match(ctx.sfsDocHtml({ pdf_path: 'u1/s1/x.pdf' }), /à la place du PDF joint/, 'remplacer un PDF joint se dit avant l’enregistrement');
});

test('une frappe fait de la valeur une saisie : ni proposée, ni « lue dans le PDF »', () => {
  const ctx = app();
  ctx.sfsMaj = () => {};
  const champ = { id: 's-taux', type: 'text', dataset: { propose: '1', lu: '1' } };
  ctx.sfsSaisie({ type: 'change', target: champ });
  assert.deepEqual({ ...champ.dataset }, { propose: '1', lu: '1' }, 'un simple changement (sortie du champ, mise en forme) n’est pas une frappe');
  ctx.sfsSaisie({ type: 'input', target: champ });
  assert.deepEqual({ ...champ.dataset }, {}, 'Après une frappe, le champ se dit encore « PDF » — ou le PDF pourra l’écraser.');
  assert.equal(lire(ctx, 'sfsModifie'), true);
  // Décocher « Garder ce PDF » : une décision sur le fichier.
  injecter(ctx, { sfsPdf: { fichier: {}, pages: 1, garder: true } });
  ctx.sfsSaisie({ type: 'change', target: { id: 's-garder-pdf', type: 'checkbox', checked: false, dataset: {} } });
  assert.equal(lire(ctx, 'sfsPdf.garder'), false, 'Décocher « Garder ce PDF » ne retient pas le choix : il partirait quand même.');
});

// ─── L'enregistrement et le stockage ───────────────────────────────────────

function dbStockage(ctx, { echecEnvoi = false, echecEffacement = false } = {}) {
  const journal = [];
  const db = lire(ctx, 'db');
  db.from = table => {
    const ops = [];
    journal.push({ table, ops });
    const q = new Proxy({}, { get(_, prop) {
      if (prop === 'then') {
        const ins = ops.some(o => o[0] === 'insert');
        const sel = ops.find(o => o[0] === 'select');
        const data = ins ? { id: 'sim-n1' } : sel && ops.some(o => o[0] === 'maybeSingle') ? { pdf_path: 'u1/sim-1/ancien.pdf' } : [];
        return (res, rej) => Promise.resolve({ data, error: null }).then(res, rej);
      }
      return (...a) => { ops.push([prop, ...a]); return q; };
    } });
    return q;
  };
  db.storage = { from: bucket => ({
    upload: async (chemin, corpsF, options) => { journal.push({ stockage: 'upload', bucket, chemin, corps: corpsF, options }); return { error: echecEnvoi ? { message: 'refus' } : null }; },
    remove: async chemins => { journal.push({ stockage: 'remove', bucket, chemins }); return { error: echecEffacement ? { message: 'refus' } : null }; },
    createSignedUrl: async (chemin, duree) => { journal.push({ stockage: 'signer', chemin, duree }); return { data: { signedUrl: 'https://stockage.exemple.fr/' + chemin + '?jeton' }, error: null }; },
  }) };
  return journal;
}
const SAISIE = { 's-nom': 'Offre', 's-bien': '', 's-date-doc': '', 's-montant': '170 000', 's-taux': '3,45', 's-duree': '25',
  's-assurance': '30', 's-revenus': '3 200', 's-loyer-banque': '', 's-notes': '' };
function ecranEnregistrer(ctx) {
  const els = {};
  for (const [id, value] of Object.entries(SAISIE)) els[id] = { id, value, dataset: {}, classList: { toggle() {} }, setAttribute() {}, focus() {} };
  els['sfs-enregistrer'] = { disabled: false, textContent: '', isConnected: true };
  ctx.document.getElementById = id => els[id] || null;
  ctx.document.querySelector = () => null;
  ctx.sfConfirmer = async () => false;
}

test('enregistrer : le PDF part APRÈS la ligne, sous un nom neutre, sans cache — et seulement s’il est gardé', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: {}, sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
  ecranEnregistrer(ctx);
  const pdf = { octets: 'pdf' };
  injecter(ctx, { sfsPdf: { fichier: pdf, pages: 3, garder: true } });
  const j = dbStockage(ctx);
  await ctx.saveSim();
  const iIns = j.findIndex(x => x.ops?.some(o => o[0] === 'insert'));
  const iEnv = j.findIndex(x => x.stockage === 'upload');
  assert.ok(iIns >= 0 && iEnv > iIns, 'Le PDF part avant que la simulation existe.');
  const env = j[iEnv];
  assert.equal(env.bucket, 'simulations-pdf');
  assert.equal(env.corps, pdf, 'le fichier envoyé est la copie lue');
  assert.match(env.chemin, /^u1\/sim-n1\/[0-9a-f-]{36}-document-banque\.pdf$/, 'Le nom du fichier de l’appareil (le nom de l’emprunteur) part dans le stockage.');
  assert.equal(env.options.cacheControl, '0', 'un document sensible ne se garde pas en cache');
  const maj = j.find(x => x.ops?.some(o => o[0] === 'update'));
  assert.deepEqual(nu(maj.ops.find(o => o[0] === 'update')[1]), { pdf_path: env.chemin, pdf_name: null, pdf_data: null });
  assert.ok(maj.ops.some(o => o[0] === 'eq' && o[1] === 'user_id'), 'l’écriture du chemin est bornée au compte');
  assert.ok(!JSON.stringify(j).includes('pdf_extracted'), 'Du contenu extrait du PDF part en base.');
  assert.equal(lire(ctx, 'sfsPdf'), null, 'le PDF envoyé ne reste pas en mémoire');
  // Décoché : rien ne part.
  const ctx2 = app();
  injecter(ctx2, { sfsColonnesDispo: true, sfsSimulation: {}, sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
  ecranEnregistrer(ctx2);
  injecter(ctx2, { sfsPdf: { fichier: pdf, pages: 3, garder: false } });
  const j2 = dbStockage(ctx2);
  await ctx2.saveSim();
  assert.ok(j2.some(x => x.ops?.some(o => o[0] === 'insert')), 'témoin : la simulation est enregistrée');
  assert.ok(!j2.some(x => x.stockage === 'upload'), 'Le PDF part alors que l’utilisateur a choisi de ne pas le garder.');
});

test('un envoi refusé se dit, et le second appui met à jour au lieu de créer une seconde simulation', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: {}, sfsEtat: { id: null, mode: 'saisie', retour: { page: 'simulateur' } } });
  ecranEnregistrer(ctx);
  injecter(ctx, { sfsPdf: { fichier: {}, pages: 3, garder: true } });
  let j = dbStockage(ctx, { echecEnvoi: true });
  await ctx.saveSim();
  assert.ok(ctx.notifs.some(n => n.err && /Simulation enregistrée, mais le PDF n’a pas pu être envoyé/.test(n.m)));
  assert.equal(lire(ctx, 'sfsEtat.mode'), 'saisie', 'la saisie reste ouverte pour réessayer');
  j = dbStockage(ctx);
  await ctx.saveSim();
  assert.equal(j.filter(x => x.ops?.some(o => o[0] === 'insert')).length, 0, 'Le second appui crée une seconde simulation.');
  assert.ok(j.some(x => x.stockage === 'upload'), 'témoin : le second appui envoie le PDF');
});

test('remplacer un PDF : l’ancien est effacé après que la ligne désigne le nouveau', async () => {
  const ctx = app();
  injecter(ctx, { sfsColonnesDispo: true, sfsSimulation: { id: 'sim-1', pdf_path: 'u1/sim-1/ancien.pdf' },
    sfsEtat: { id: 'sim-1', mode: 'saisie', retour: { page: 'simulateur' } } });
  ecranEnregistrer(ctx);
  injecter(ctx, { sfsPdf: { fichier: {}, pages: 3, garder: true } });
  const j = dbStockage(ctx);
  await ctx.saveSim();
  const iLien = j.findIndex(x => x.ops?.some(o => o[0] === 'update' && o[1]?.pdf_path));
  const iEff = j.findIndex(x => x.stockage === 'remove');
  assert.ok(iLien >= 0 && iEff > iLien, 'L’ancien PDF est effacé avant que la ligne désigne le nouveau.');
  assert.deepEqual(nu(j[iEff].chemins), ['u1/sim-1/ancien.pdf']);
});

test('supprimer : le PDF d’abord, et son échec arrête tout au lieu d’être avalé', async () => {
  const ctx = app();
  injecter(ctx, { sfsSimulation: { id: 'sim-1', pdf_path: 'u1/sim-1/ancien.pdf' }, sfsEtat: { id: 'sim-1', mode: 'saisie', retour: { page: 'simulateur' } } });
  ctx.sfConfirmer = async () => true;
  let j = dbStockage(ctx, { echecEffacement: true });
  await ctx.deleteSim('sim-1');
  assert.ok(!j.some(x => x.ops?.some(o => o[0] === 'delete')), 'Le PDF n’a pas pu être effacé, et la simulation est supprimée : le fichier reste, sans ligne.');
  assert.ok(ctx.notifs.some(n => n.err && /Le PDF n’a pas pu être effacé/.test(n.m)));
  j = dbStockage(ctx);
  await ctx.deleteSim('sim-1');
  const iEff = j.findIndex(x => x.stockage === 'remove'), iSup = j.findIndex(x => x.ops?.some(o => o[0] === 'delete'));
  assert.ok(iEff >= 0 && iSup > iEff, 'témoin : le PDF effacé, puis la ligne');
  assert.ok(j.find(x => x.ops?.some(o => o[0] === 'maybeSingle')).ops.some(o => o[0] === 'eq' && o[1] === 'user_id'));
});

test('retirer le PDF : le fichier d’abord, les chiffres restent ; un échec ne touche pas la ligne', async () => {
  const ctx = app();
  ctx.sfConfirmer = async () => true;
  let j = dbStockage(ctx, { echecEffacement: true });
  await ctx.sfsRetirerPdf('sim-1');
  assert.ok(!j.some(x => x.ops?.some(o => o[0] === 'update')), 'La ligne oublie un PDF qui n’a pas été effacé.');
  assert.ok(ctx.notifs.some(n => n.err && /n’a pas pu être retiré/.test(n.m)));
  j = dbStockage(ctx);
  await ctx.sfsRetirerPdf('sim-1');
  const iEff = j.findIndex(x => x.stockage === 'remove');
  const iMaj = j.findIndex(x => x.ops?.some(o => o[0] === 'update'));
  assert.ok(iEff >= 0 && iMaj > iEff);
  assert.deepEqual(nu(j[iMaj].ops.find(o => o[0] === 'update')[1]), { pdf_path: null, pdf_name: null, pdf_data: null });
  assert.equal(lire(ctx, 'sfsEnvoi'), false, 'la garde contre le double envoi est relâchée');
});

test('ouvrir le PDF : un lien de 60 secondes, jamais en cache, une fenêtre qui ne garde pas la main', async () => {
  const ctx = app();
  const j = dbStockage(ctx);
  const fen = { opener: 'page', location: { href: '' }, closed: false, close() { this.closed = true; } };
  ctx.window.open = () => fen;
  await ctx.openPdfSim('sim-1');
  await ctx.openPdfSim('sim-1');
  const signes = j.filter(x => x.stockage === 'signer');
  assert.equal(signes.length, 2, 'Le lien d’un document sensible est gardé en cache et resservi.');
  assert.ok(signes.every(x => x.duree <= 60), `Un lien de ${signes[0].duree} s pour un document sensible.`);
  assert.equal(fen.opener, null, 'la fenêtre du PDF garde la main sur l’application');
  assert.match(fen.location.href, /^https:\/\/stockage\.exemple\.fr\/u1\/sim-1\/ancien\.pdf/);
  assert.doesNotMatch(corps('openPdfSim'), /document\.write/, 'l’ancien affichage base64 (document.write) est revenu');
});

// ─── La fenêtre d'import ───────────────────────────────────────────────────

/* Une fausse fenêtre : les éléments que sfsImporter va chercher. */
function fenetre(ctx, { tactile = false } = {}) {
  const el = (extra = {}) => ({ innerHTML: '', disabled: false, classList: { add() {}, remove() {} }, focus() {}, querySelector: () => null, ...extra });
  const f = { depot: el(), champ: el({ files: [], value: '', click() { f.clics++; } }), etat: el(), saisir: el(), fermer: [el(), el()], clics: 0, retiree: 0, ecoute: {} };
  f.etat.querySelector = sel => (sel === '[data-continuer]' && /data-continuer/.test(f.etat.innerHTML) ? (f.continuer = el()) : null);
  ctx.matchMedia = () => ({ matches: tactile });
  ctx.document.createElement = () => {
    f.o = el({
      setAttribute() {}, remove() { f.retiree++; }, contains: () => true,
      addEventListener: (type, fn) => { f.ecoute[type] = fn; },
      querySelector: sel => ({ '#sfs-depot': f.depot, '#sfs-import-fichier': f.champ, '#sfs-import-etat': f.etat, '[data-saisir]': f.saisir })[sel] || null,
      querySelectorAll: sel => (sel === '[data-fermer]' ? f.fermer : []),
    });
    return f.o;
  };
  ctx.document.body = { appendChild() {} };
  ctx.document.addEventListener = (t, fn) => { if (t === 'keydown') f.clavier = fn; };
  ctx.document.removeEventListener = () => {};
  ctx.document.contains = () => false;
  return f;
}
const attendre = () => new Promise(r => setImmediate(r));

test('la fenêtre : choisir un fichier le lit une fois, puis ouvre la simulation préremplie pour le bien', async () => {
  const ctx = app();
  const f = fenetre(ctx);
  const ouvertures = [];
  ctx.sfsOuvrir = e => ouvertures.push(e);
  let lectures = 0, finir;
  ctx.sfsLirePdf = () => { lectures++; return new Promise(r => { finir = r; }); };
  ctx.sfsImporter({ bienId: 'b1' });
  assert.match(f.o.innerHTML, /id="sfs-import-titre">Importer un PDF de la banque</, 'le titre de la fenêtre est le libellé du bouton');
  assert.match(f.o.innerHTML, /Déposez le PDF ici/);
  assert.match(f.o.innerHTML, /Lu sur cet appareil : rien n’est envoyé avant l’enregistrement\./);
  f.depot.onclick();
  assert.equal(f.clics, 1, 'la zone ouvre le choix du fichier');
  f.champ.files = [{ name: 'a.pdf' }];
  f.champ.onchange();
  f.champ.files = [{ name: 'a.pdf' }];
  f.champ.onchange();
  assert.equal(lectures, 1, 'Deux choix rapprochés lancent deux lectures.');
  assert.equal(f.depot.disabled, true, 'la zone est fermée pendant la lecture');
  finir({ lu: { montant: 150000 }, pages: 2, fichier: {} });
  await attendre();
  assert.equal(f.retiree, 1, 'la fenêtre se ferme');
  assert.equal(ouvertures.length, 1);
  assert.equal(ouvertures[0].mode, 'saisie');
  assert.equal(ouvertures[0].bienId, 'b1', 'l’import depuis la fiche oublie son bien');
  assert.equal(ouvertures[0].lecture.lu.montant, 150000);
});

test('la fenêtre : fermée pendant la lecture, rien ne s’ouvre ; un PDF sans chiffre ou refusé le dit', async () => {
  const ctx = app();
  let f = fenetre(ctx);
  const ouvertures = [];
  ctx.sfsOuvrir = e => ouvertures.push(e);
  let finir;
  ctx.sfsLirePdf = () => new Promise(r => { finir = r; });
  ctx.sfsImporter();
  f.champ.files = [{}];
  f.champ.onchange();
  f.clavier({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {} });
  finir({ lu: { montant: 1 }, pages: 1, fichier: {} });
  await attendre();
  assert.deepEqual(ouvertures, [], 'Une fenêtre fermée ouvre quand même la simulation à la fin de la lecture.');
  // Un PDF sans chiffre de prêt : la fenêtre reste, et propose de continuer.
  f = fenetre(ctx);
  ctx.sfsLirePdf = async () => ({ lu: { prets: 0, autres: [] }, pages: 1, fichier: {} });
  ctx.sfsImporter();
  f.champ.files = [{}];
  f.champ.onchange();
  await attendre();
  assert.equal(f.retiree, 0);
  assert.match(f.etat.innerHTML, /role="alert">Aucun chiffre de prêt reconnu dans ce PDF/);
  f.continuer.onclick();
  assert.equal(ouvertures.length, 1, '« Continuer avec ce PDF » ouvre la saisie');
  // Une erreur : son message, échappé.
  f = fenetre(ctx);
  ctx.sfsLirePdf = async () => { throw new Error('<img src=x onerror=alert(1)>'); };
  ctx.sfsImporter();
  f.champ.files = [{}];
  f.champ.onchange();
  await attendre();
  assert.ok(!f.etat.innerHTML.includes('<img'), 'Le message d’erreur passe brut dans la fenêtre.');
  assert.match(f.etat.innerHTML, /role="alert">&lt;img/);
  assert.equal(f.depot.disabled, false, 'après un refus, on peut choisir un autre PDF');
});

test('la fenêtre : un PDF lâché est lu, jamais ouvert par le navigateur ; au doigt, elle parle de Fichiers', async () => {
  const ctx = app();
  const f = fenetre(ctx);
  const lus = [];
  ctx.sfsLirePdf = async c => { lus.push(c); return { lu: { montant: 1 }, pages: 1, fichier: {} }; };
  ctx.sfsOuvrir = () => {};
  ctx.sfsImporter();
  let empeche = 0;
  const lache = { preventDefault() { empeche++; }, dataTransfer: { files: [{ name: 'lache.pdf' }], dropEffect: '' } };
  f.ecoute.dragover(lache);
  f.ecoute.drop(lache);
  await attendre();
  assert.equal(empeche, 2, 'Sans preventDefault, le navigateur ouvre le PDF à la place de l’application.');
  assert.deepEqual(lus.map(x => x.name), ['lache.pdf']);
  const g = fenetre(ctx, { tactile: true });
  ctx.sfsImporter();
  assert.match(g.o.innerHTML, /Choisir le PDF<\/span>\s*<span class="sfs-depot__x">dans Fichiers, iCloud Drive ou vos téléchargements/);
  assert.doesNotMatch(g.o.innerHTML, /Déposez/, 'au doigt, on ne dépose pas un fichier sur un iPhone');
  // Depuis la liste, on peut renoncer au PDF ; depuis la saisie, on y est déjà.
  assert.match(g.o.innerHTML, /data-saisir>Saisir à la main</);
  const h = fenetre(ctx);
  ctx.sfsImporter({ surLecture: () => {} });
  assert.match(h.o.innerHTML, /Importer un PDF de la banque/, 'témoin : la fenêtre est rendue');
  assert.doesNotMatch(h.o.innerHTML, /data-saisir/, 'Depuis la saisie, la fenêtre propose de « saisir à la main ».');
});

// ─── Les écrans ────────────────────────────────────────────────────────────

test('deux portes pour créer une simulation : la page, son état vide, la fiche — et le PDF joint se lit', async () => {
  const ctx = app();
  injecter(ctx, { currentPage: 'simulateur' });
  ctx.sfTauxReference = async () => null;
  ctx.sfAssurerBiens = async () => {};
  const sims = [{ id: 's1', nom_simulation: 'Offre', montant_emprunte: 1000, taux_interet: 1, duree_ans: 10, pdf_path: 'u1/s1/x.pdf' }];
  let reponse = sims;
  const db = lire(ctx, 'db');
  db.from = () => new Proxy({}, { get(_, p) { return p === 'then' ? (res => Promise.resolve({ data: reponse, error: null }).then(res)) : () => db.from(); } });
  const el = { innerHTML: '' };
  await ctx.renderSimulateur(el);
  const acts = el.innerHTML.match(/<div class="sff-acts sfs-creer">([\s\S]*?)<\/div>/)[1];
  assert.match(acts, /sf-btn--secondary[^>]*onclick="openNouvelleSimulation\(\)">[\s\S]*?Saisir une simulation<\/button>/);
  assert.match(acts, /sf-btn--primary[^>]*onclick="sfsImporter\(\)">[\s\S]*?Importer un PDF de la banque<\/button>/);
  assert.match(el.innerHTML, /sf-pill sfs-row__doc">[\s\S]*?PDF<span class="sf-sr-only">/, 'au doigt, un « title » ne s’affiche pas : « PDF » se lit');
  reponse = [];
  await ctx.renderSimulateur(el);
  assert.match(el.innerHTML, /sff-empty[\s\S]*Saisir une simulation[\s\S]*Importer un PDF de la banque/, 'l’état vide n’offre qu’une porte');
  // La lecture d'une simulation : ouvrir ou retirer le PDF, ou en joindre un.
  const lecture = { innerHTML: '' };
  injecter(ctx, { sfsEtat: { id: 's1', mode: 'lecture', retour: { page: 'simulateur' } } });
  ctx.sfsRenderLecture(lecture, { id: 's1', nom_simulation: 'Offre', montant_emprunte: 1000, taux_interet: 1, duree_ans: 10, pdf_path: 'u1/s1/x.pdf' }, true);
  assert.match(lecture.innerHTML, /Le PDF de la banque[\s\S]*Ouvrir le PDF[\s\S]*Retirer le PDF/);
  ctx.sfsRenderLecture(lecture, { id: 's1', nom_simulation: 'Offre', duree_ans: 10 }, true);
  assert.match(lecture.innerHTML, /Aucun PDF joint\.[\s\S]*importer: true[\s\S]*Joindre le PDF de la banque/);
});

test('sources uniques : un lecteur, un plan, un envoi — et aucune trace du texte', () => {
  // Le texte du document ne vit que dans sfsLirePdf : il n'en sort que des chiffres.
  assert.doesNotMatch(corps('sfsLireOffre'), /console\./, 'Le lecteur écrit dans le journal.');
  assert.match(corps('sfsLirePdf'), /console\.warn\('lecture du PDF :', e\?\.name \|\| 'erreur'\)/);
  assert.equal((corps('sfsLirePdf').match(/console\./g) || []).length, 1, 'une seule trace, le nom d’une erreur');
  assert.doesNotMatch(MASQUE, /pdf_extracted\s*:/, 'Du contenu extrait du PDF est écrit en base.');
  assert.match(corps('sfsEnvoyerPdf'), /TI_STORAGE\.upload\('simulations-pdf', id, sfsPdf\.fichier, SF_PDF_NOM, \{ cacheControl: '0' \}\)/);
  assert.equal((MASQUE.match(/'simulations-pdf'/g) || []).length, 7, 'un nouveau chemin vers le stockage des PDF : à revoir avec ces gardes');
  assert.doesNotMatch(MASQUE, /signedUrls?\('simulations-pdf'/, 'Un lien d’une heure, en cache, vers le PDF de la banque.');
  assert.match(corps('bkdocGenerate'), /TI_STORAGE\.lienCourt\('simulations-pdf', sim\.pdf_path\)/, 'témoin : l’annexe du dossier banque');
  assert.doesNotMatch(MASQUE, /extractPDF|getElementById\('pdf-input'\)/, 'l’ancien lecteur caché est revenu');
  // L'ancien lecteur collait les pages en une ligne : le texte passe par sfPdfLignes.
  assert.match(corps('sfsLirePdf'), /pages\.push\(sfPdfLignes\(/);
});
