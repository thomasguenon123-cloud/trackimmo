/* L'ENCAISSEMENT DES CHARGES — le geste le plus fréquent, et il était fermé.

   ⚠️ LE DÉFAUT QUE CES GARDES TIENNENT. Jusqu'au 27/09/2026, un locataire qui
   virait 850 € (700 de loyer, 150 de provisions) ne pouvait être saisi PAR
   AUCUN CHEMIN :
     · « Partiel » refusait 850, parce que 850 >= 700 ;
     · « Payé intégralement » enregistrait 700.
   L'application disait que la somme était trop grande, puis en stockait une
   plus petite, sans le dire. Mesuré le jour de la découverte : les 17 lignes
   « Payé » de la base portaient un `montant_encaisse` égal AU CENTIME au
   `loyer_du` seul — 8 380 € de provisions jamais soldées.

   ⚠️ ET LE PIÈGE DE LA CORRECTION, qui est le vrai sujet de ce fichier :
   faire entrer les charges dans l'arithmétique des arriérés ferait apparaître
   ces 8 380 € comme dus, sur des mois que le bailleur tient pour soldés depuis
   des semaines. C'est le « piège des arriérés fantômes », déjà rencontré sur ce
   dépôt. D'où la règle que la garde nº 1 protège : `charges_encaissees IS NULL`
   veut dire « non suivi », PAS « zéro ».

   Les sept gardes sont validées par mutation le 27/09/2026. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { charger } = require('./charger-app.js');

const app = charger({ maintenant: new Date('2026-09-27T12:00:00') });
const { sfDuEtEncaisse } = app;

const SRC = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function corps(nom) {
  const debut = SRC.search(new RegExp('^(?:async )?function ' + nom + '\\s*\\(', 'm'));
  assert.notEqual(debut, -1, `fonction ${nom} introuvable`);
  const suite = SRC.slice(debut + 1).search(/^(?:async )?function [A-Za-z0-9_$]+\s*\(/m);
  const bloc = suite === -1 ? SRC.slice(debut) : SRC.slice(debut, debut + 1 + suite);
  return bloc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

test('ARRIÉRÉS FANTÔMES — une ligne d\'avant la migration garde son comptage d\'avant', () => {
  /* Exactement la forme des 17 lignes de la base au 27/09 : le loyer soldé,
     des charges dues, et `charges_encaissees` jamais renseigné. */
  const avant = { loyer_du: 700, charges_dues: 150, montant_encaisse: 700, charges_encaissees: null };
  const r = sfDuEtEncaisse(avant);
  assert.equal(r.du, 700, 'les charges non suivies ne doivent PAS être réclamées');
  assert.equal(r.encaisse, 700);
  assert.equal(r.du - r.encaisse, 0, 'ce mois est soldé : aucun arriéré ne doit apparaître');
  assert.equal(r.chargesSuivies, false);
});

test('une ligne QUI SUIT ses charges les compte des deux côtés', () => {
  const soldee = { loyer_du: 700, charges_dues: 150, montant_encaisse: 700, charges_encaissees: 150 };
  const r = sfDuEtEncaisse(soldee);
  assert.equal(r.du, 850);
  assert.equal(r.encaisse, 850);
  assert.equal(r.chargesSuivies, true);

  /* Et un vrai reste dû se voit : 100 € de provisions manquantes. */
  const partielle = { loyer_du: 700, charges_dues: 150, montant_encaisse: 700, charges_encaissees: 50 };
  const p = sfDuEtEncaisse(partielle);
  assert.equal(p.du - p.encaisse, 100);
});

test('zéro charge encaissée n\'est PAS la même chose que non suivi', () => {
  /* La distinction est tout l'intérêt de laisser la colonne nullable. */
  const suivieAZero = sfDuEtEncaisse({ loyer_du: 700, charges_dues: 150, montant_encaisse: 700, charges_encaissees: 0 });
  const nonSuivie   = sfDuEtEncaisse({ loyer_du: 700, charges_dues: 150, montant_encaisse: 700, charges_encaissees: null });
  assert.equal(suivieAZero.du - suivieAZero.encaisse, 150,
    'charges_encaissees = 0 est une AFFIRMATION : rien n\'est rentré, 150 € restent dus');
  assert.equal(nonSuivie.du - nonSuivie.encaisse, 0,
    'charges_encaissees = null est une ABSENCE : on ne réclame pas ce qu\'on n\'a jamais suivi');
});

test('sfDuEtEncaisse ne lève sur aucune entrée dégradée', () => {
  for (const cas of [null, undefined, {}, { loyer_du: 'x', charges_dues: 'y', charges_encaissees: 'z' }]) {
    const r = sfDuEtEncaisse(cas);
    assert.ok(Number.isFinite(r.du) && Number.isFinite(r.encaisse),
      `entrée ${JSON.stringify(cas)} : des nombres attendus`);
  }
});

test('RÉGRESSION — « Partiel » ne refuse plus un montant supérieur au loyer seul', () => {
  const c = corps('mfPopupConfirm');
  assert.ok(!/Pour ce montant, utilisez/.test(c),
    'Le refus est de retour : un virement loyer + charges redevient impossible à saisir.');
  assert.ok(!/v\s*>=\s*loyerDu/.test(c),
    'Une comparaison au loyer SEUL est revenue garder la saisie partielle.');
});

test('« Payé intégralement » solde les charges, et l\'annonce au bon montant', () => {
  const popup = corps('mfOpenEncaissementPopup');
  assert.match(popup, /Payé intégralement — \$\{sfEur\(totalDu\)\}/,
    'L\'option doit annoncer le TOTAL dû (loyer + charges), pas le loyer seul.');
  const c = corps('mfPopupConfirm');
  assert.match(c, /statut === 'Payé'\)\s*\{[^}]*chargesEnc\s*=/,
    'La branche « Payé » doit renseigner charges_encaissees.');
  assert.match(c, /charges_encaissees:\s*chargesEnc/,
    'La charge encaissée doit partir dans le payload.');
});

test('dépointer un loyer libère AUSSI les charges qu\'il portait', () => {
  /* Sinon des provisions encaissées survivent au loyer annulé : la ligne
     repasse « En attente » en gardant 150 € rentrés de nulle part. */
  for (const fn of ['sfPointerLoyer', 'mfQuickToggleLoyer']) {
    const c = corps(fn);
    const annulation = c.match(/statut:\s*'En attente'[^}]*\}/);
    assert.ok(annulation, `${fn} : branche d'annulation introuvable`);
    assert.match(annulation[0], /charges_encaissees:\s*null/,
      `« ${fn} » remet le loyer à zéro sans libérer les charges.`);
  }
});

test('la déclaration fiscale ne compte TOUJOURS que les loyers', () => {
  /* ⚠️ Garde volontairement « négative ». `mfBilanFeedCompute` forme un couple
     cohérent avec l'exclusion des charges récupérables des déductions : y
     ajouter les provisions sans trancher la question fiscale surestimerait le
     revenu foncier déclaré. Cette garde existe pour que l'ajout soit un choix
     délibéré, et pas un réflexe le jour où quelqu'un verra la colonne. */
  const c = corps('mfBilanFeedCompute');
  assert.ok(!c.includes('charges_encaissees'),
    'Les provisions sont entrées dans le calcul de la 2044. Ce n\'est peut-être ' +
    'pas faux — mais ça ne peut pas se décider sans cesser d\'exclure les ' +
    'charges récupérables des déductions, sinon le revenu déclaré est surestimé.');
  assert.match(c, /loyers \+= parseFloat\(l\.montant_encaisse\)/);
});
