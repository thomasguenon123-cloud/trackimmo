/* UNE GARDE D'AUTORISATION NE SE COMPARE JAMAIS AVEC `!=` — et voici pourquoi
   ce fichier existe.

   Le 27/09/2026, quatre fonctions SECURITY DEFINER de la base se protégeaient
   ainsi :

     IF v_caller_role != 'admin' THEN RAISE EXCEPTION 'Accès refusé'; END IF;

   En SQL, `NULL != 'admin'` ne vaut pas VRAI : il vaut NULL. Et plpgsql traite
   NULL comme faux dans un IF. La garde ne se déclenchait donc pas, et la
   fonction s'exécutait.

   ⚠️ LA FORME À DEUX CLAUSES ÉTAIT PIRE, ET N'AVAIT RIEN DE LATENT :

     IF v_caller_role != 'admin'
        AND (auth.jwt() -> 'app_metadata' ->> 'role') != 'admin' THEN

   Pour un utilisateur ORDINAIRE, qui a bien une ligne dans `profiles` :
     · 'user' != 'admin'  = VRAI        (première clause)
     · NULL  != 'admin'   = NULL        (il n'a pas de rôle dans son JWT)
     · VRAI AND NULL      = NULL        → pas d'exception, la garde est muette.

   Conséquence mesurée : un compte `pending` ou `disabled` pouvait s'auto-
   activer en appelant `admin_enable_user` sur son propre id — le mur de
   validation administrateur se contournait par la personne même qu'il retient.

   CE QUE CETTE GARDE TIENT. Le correctif (`IS DISTINCT FROM`) est invisible :
   rien à l'écran ne dira qu'il a été défait, et le prochain bloc SQL écrit de
   mémoire réintroduira `!=` sans que personne ne le voie. On refuse donc la
   comparaison fautive dans le SQL du dépôt, en ignorant les commentaires —
   qui, eux, DOIVENT pouvoir citer la faute pour l'expliquer.

   ⚠️ CE QU'ELLE NE TIENT PAS, ET IL FAUT LE DIRE : les fonctions vivent dans
   la base, pas dans le dépôt. Un bloc écrit directement dans la console
   Supabase échappe à ce test. La vérification en base est le BLOC 5 de
   MIGRATION-GARDES-ADMIN.sql, qui se rejoue en une requête.

   Validée par mutation le 27/09/2026 : en remettant `!=` dans un des quatre
   blocs, le test échoue en nommant le fichier et la ligne. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.join(__dirname, '..');

/* Les commentaires SQL ont deux formes, et les deux servent ici à EXPLIQUER la
   faute : il faut les retirer avant de la chercher, sinon la garde s'accuse
   elle-même — exactement le piège rencontré par la garde des emojis. */
function sansCommentaires(sql) {
  const c = sql.split('');
  const blanchir = (a, b) => { for (let k = a; k < b; k++) if (c[k] !== '\n') c[k] = ' '; };
  for (const m of sql.matchAll(/\/\*[\s\S]*?\*\//g)) blanchir(m.index, m.index + m[0].length);
  let t = c.join('');
  for (const m of t.matchAll(/--[^\n]*/g)) blanchir(m.index, m.index + m[0].length);
  return c.join('');
}

/* Le rôle lu depuis `profiles` peut être NULL (pas de ligne), et la valeur
   lue dans le JWT l'est dès que l'utilisateur n'est pas admin. Toute
   comparaison d'inégalité sur l'un ou l'autre est donc suspecte. */
const FAUTIVE = /(!=|<>)\s*'(admin|user)'/;

const FICHIERS = fs.readdirSync(RACINE).filter(f => f.endsWith('.sql')).sort();

test('aucune garde SQL ne compare un rôle avec != ou <>', () => {
  assert.ok(FICHIERS.length >= 5, `SQL du dépôt introuvable : ${FICHIERS.length} fichier(s)`);
  const fautifs = [];
  for (const f of FICHIERS) {
    const brut = fs.readFileSync(path.join(RACINE, f), 'utf8');
    const propre = sansCommentaires(brut);
    const brutes = brut.split('\n');
    propre.split('\n').forEach((l, i) => {
      if (FAUTIVE.test(l)) {
        fautifs.push(`  ${f}:${i + 1}  ${brutes[i].trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(fautifs, [],
    'Comparaison de rôle avec != ou <> dans du SQL livré.\n' + fautifs.join('\n') +
    '\n\n  `NULL != \'admin\'` vaut NULL, et plpgsql lit NULL comme faux : la garde\n' +
    '  ne se déclenche pas. Écrire `IS DISTINCT FROM`. Voir l\'en-tête de\n' +
    '  MIGRATION-GARDES-ADMIN.sql pour le détail de ce qui était ouvert.');
});

test('le correctif est bien présent dans les quatre fonctions du dépôt', () => {
  /* Le test ci-dessus est NÉGATIF : il passerait tout aussi bien sur un dépôt
     qui ne contiendrait plus aucune garde. Celui-ci vérifie l'inverse — que
     les quatre fonctions sont là, et qu'elles portent l'opérateur correct. */
  const sql = fs.readFileSync(path.join(RACINE, 'MIGRATION-GARDES-ADMIN.sql'), 'utf8');
  for (const fn of ['admin_disable_user', 'admin_enable_user',
                    'admin_set_user_role', 'admin_set_user_status']) {
    const bloc = sql.split(new RegExp(`FUNCTION public\\.${fn}\\b`))[1];
    assert.ok(bloc, `${fn} absente de MIGRATION-GARDES-ADMIN.sql`);
    const corps = bloc.split('$function$;')[0];
    assert.match(corps, /IS DISTINCT FROM 'admin'/,
      `${fn} ne porte pas IS DISTINCT FROM dans sa garde.`);
  }
});

test('les quatre fonctions disent la vérité quand rien n\'a bougé', () => {
  /* La garde d'autorisation n'était pas le seul mensonge : ces fonctions
     répondaient `success: true` pour un profil introuvable, et l'écran
     affichait « Utilisateur archivé » sans que rien ne le soit. */
  const sql = fs.readFileSync(path.join(RACINE, 'MIGRATION-GARDES-ADMIN.sql'), 'utf8');
  for (const fn of ['admin_disable_user', 'admin_enable_user', 'admin_set_user_status']) {
    const corps = sql.split(new RegExp(`FUNCTION public\\.${fn}\\b`))[1].split('$function$;')[0];
    assert.match(corps, /GET DIAGNOSTICS\s+v_touchees\s*=\s*ROW_COUNT/,
      `${fn} ne vérifie pas qu'une ligne a réellement été touchée.`);
    /* Le RAISE peut tenir sur la même ligne ou sur la suivante : c'est de la
       mise en forme, pas du sens. La garde ne doit pas dépendre de ça. */
    assert.match(corps, /IF v_touchees = 0 THEN\s+RAISE EXCEPTION/,
      `${fn} compte les lignes touchées mais n'en tire rien.`);
  }
});
