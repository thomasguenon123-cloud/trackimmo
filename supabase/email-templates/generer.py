#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
GÉNÉRATEUR DES GABARITS D'E-MAIL STONEFOLIO

    python3 supabase/email-templates/generer.py

Produit les six fichiers à coller dans
Supabase > Authentication > Emails.

⚠️ POURQUOI UN GÉNÉRATEUR PLUTÔT QUE SIX FICHIERS ÉCRITS À LA MAIN.
Supabase stocke chaque gabarit séparément : aucun partiel, aucun include.
Six copies de la même mise en page divergent dès la première retouche — et
c'est exactement ainsi que l'ancienne identité a survécu si longtemps par
endroits. Ici la mise en page est écrite UNE fois dans `layout.html` ; ce
fichier ne porte que ce qui change d'un message à l'autre.

⚠️ MARQUEURS EN [[DOUBLES CROCHETS]], et pas en accolades. Le contenu final
porte des variables Go ({{ .ConfirmationURL }}) : un marqueur en accolades
serait indiscernable d'une variable Supabase.
"""
import io, os, re

RACINE = os.path.dirname(os.path.abspath(__file__))
POLICE = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, "
          "'Helvetica Neue', Arial, sans-serif")


def p(texte, marge="0 0 16px 0", taille=15, hauteur=25, classe="sf-t2", couleur="#3D5145"):
    return (f'        <p class="{classe}" style="margin:{marge}; font-family:{POLICE}; '
            f'font-size:{taille}px; line-height:{hauteur}px; color:{couleur};">\n'
            f'          {texte}\n        </p>')


def bouton(libelle, url):
    """Bouton à toute épreuve : VML pour Outlook, ancre stylée ailleurs.
       `mso-hide:all` sur l'ancre ferme le cas des Outlook qui interprètent
       mal le conditionnel — les deux gardes sont volontaires."""
    return f"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="sf-cta">
        <tr><td align="left">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                       href="{url}" style="height:48px; v-text-anchor:middle; width:280px;"
                       arcsize="21%" strokecolor="#1E4630" fillcolor="#1E4630">
            <w:anchorlock/>
            <center style="color:#FFFFFF; font-family:'Segoe UI', Arial, sans-serif; font-size:15px; font-weight:600;">
              {libelle}
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="{url}"
             style="display:inline-block; background-color:#1E4630; color:#FFFFFF; font-family:{POLICE}; font-size:15px; font-weight:600; line-height:20px; text-decoration:none; padding:14px 30px; border-radius:10px; mso-hide:all;">
            {libelle}
          </a>
          <!--<![endif]-->
        </td></tr>
        </table>
"""


def code(jeton):
    """Bloc de code à recopier. Pas de bouton : la réauthentification de
       Supabase envoie un jeton, pas un lien."""
    return f"""
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="sf-note" bgcolor="#F5F8F6" style="background-color:#F5F8F6; border:1px solid #D6E2DA; border-radius:12px;">
        <tr><td align="center" style="padding:22px 34px;">
          <div class="sf-code sf-t1" style="font-family:ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace; font-size:32px; line-height:40px; font-weight:700; letter-spacing:9px; color:#0C1710;">{jeton}</div>
        </td></tr>
        </table>
"""


def repli(url):
    """Le lien en toutes lettres : certains clients d'entreprise neutralisent
       les boutons mais laissent passer le texte."""
    return f"""
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="sf-note" bgcolor="#F5F8F6" style="background-color:#F5F8F6; border:1px solid #D6E2DA; border-radius:10px;">
        <tr><td style="padding:14px 16px;">
          <p class="sf-t2" style="margin:0 0 6px 0; font-family:{POLICE}; font-size:12px; line-height:18px; color:#3D5145;">
            Si le bouton ne réagit pas, copiez cette adresse dans votre navigateur :
          </p>
          <a href="{url}" class="sf-link" style="font-family:{POLICE}; font-size:12px; line-height:18px; color:#127A44; text-decoration:underline; word-break:break-all;">{url}</a>
        </td></tr>
        </table>
"""


# ⚠️ AUCUNE DURÉE DE VALIDITÉ N'EST ÉCRITE EN DUR. L'ancien gabarit annonçait
#    « 24 heures » ; ce délai est réglé par `MAILER_OTP_EXP` côté Supabase et
#    personne ne l'a vérifié. Un mail qui annonce une durée fausse envoie
#    l'utilisateur attendre pour rien, ou cliquer trop tard en croyant avoir
#    le temps. La formule ci-dessous est vraie quel que soit le réglage.
USAGE_UNIQUE = ("Ce lien est à usage unique et expire après un délai. "
                "S’il ne fonctionne plus, demandez-en un nouveau.")

URL = "{{ .ConfirmationURL }}"

GABARITS = {

 "invite-user": dict(
    objet   = "Vous êtes invité sur Stonefolio",
    declenche = "auth.admin.inviteUserByEmail() — appelé par l'Edge Function admin-invite-user.",
    variables = "{{ .ConfirmationURL }} · {{ .Data.first_name }}",
    apercu  = "Activez votre accès à Stonefolio et commencez à piloter vos biens.",
    # ⚠️ `{{ if .Data }}` n'est pas décoratif : sans lui, un rendu sans
    #    métadonnées (l'aperçu du tableau de bord, par exemple) fait échouer
    #    l'exécution ENTIÈRE du gabarit et la sortie est vide.
    salut   = "Bonjour{{ if .Data }} {{ .Data.first_name }}{{ end }},",
    titre   = "Votre accès à Stonefolio est prêt",
    corps   = [ "Stonefolio réunit au même endroit vos biens, vos locataires, vos loyers "
                "et vos charges — de la recherche d’un bien au suivi du cashflow réel, "
                "année après année.",
                "Il ne reste qu’à choisir votre mot de passe." ],
    action  = ("bouton", "Choisir mon mot de passe"),
    pied    = "Vous recevez ce message parce que votre adresse a été ajoutée comme "
              "utilisateur. Si vous n’attendiez pas cette invitation, ignorez-le : sans "
              "mot de passe choisi, aucun compte ne s’ouvre.",
 ),

 "reset-password": dict(
    objet   = "Réinitialiser votre mot de passe Stonefolio",
    declenche = "auth.resetPasswordForEmail() — bouton « Mot de passe oublié » de l'écran de connexion.",
    variables = "{{ .ConfirmationURL }} · {{ .Email }}",
    apercu  = "Choisissez un nouveau mot de passe pour votre compte Stonefolio.",
    salut   = None,
    titre   = "Réinitialiser votre mot de passe",
    corps   = [ "Une réinitialisation a été demandée pour <strong>{{ .Email }}</strong>.",
                "Si vous êtes à l’origine de cette demande, choisissez un nouveau mot "
                "de passe. Sinon, ignorez ce message : votre mot de passe actuel reste "
                "valable et personne n’a accès à votre compte." ],
    action  = ("bouton", "Choisir un nouveau mot de passe"),
    pied    = "Vous recevez ce message parce qu’une réinitialisation de mot de passe a "
              "été demandée pour cette adresse.",
 ),

 "confirm-signup": dict(
    objet   = "Confirmez votre adresse e-mail",
    declenche = "auth.signUp() — inscription libre depuis l'écran de connexion.",
    variables = "{{ .ConfirmationURL }}",
    apercu  = "Confirmez votre adresse pour finaliser votre inscription.",
    salut   = None,
    titre   = "Confirmez votre adresse",
    # ⚠️ CE MESSAGE DIT LA VÉRITÉ SUR CE QUI SUIT, et c'est délibéré.
    #    `ensureProfileActive()` déconnecte tout profil `pending` avec
    #    « un administrateur va valider votre accès ». Une inscription libre
    #    crée précisément un profil `pending` (voir handle_new_user_profile).
    #    Promettre un accès immédiat enverrait la personne droit dans ce mur.
    corps   = [ "Confirmez cette adresse pour finaliser votre inscription à Stonefolio.",
                "<strong>Votre accès sera ensuite validé par un administrateur.</strong> "
                "Vous pourrez vous connecter dès que ce sera fait." ],
    action  = ("bouton", "Confirmer mon adresse"),
    pied    = "Vous recevez ce message parce que cette adresse a été utilisée pour créer "
              "un compte. Si ce n’est pas vous, ignorez-le : sans confirmation, aucun "
              "compte ne s’ouvre.",
 ),

 "magic-link": dict(
    objet   = "Votre lien de connexion Stonefolio",
    declenche = "auth.signInWithOtp() — NON UTILISÉ par l'application aujourd'hui "
                "(0 appel dans app.js). Le gabarit existe pour qu'aucun message "
                "à l'ancienne identité ne parte si ce chemin s'ouvrait un jour.",
    variables = "{{ .ConfirmationURL }} · {{ .Email }}",
    apercu  = "Connectez-vous à Stonefolio en un clic.",
    salut   = None,
    titre   = "Votre lien de connexion",
    corps   = [ "Une connexion a été demandée pour <strong>{{ .Email }}</strong>. "
                "Le lien ci-dessous vous connecte directement, sans mot de passe.",
                "Si vous n’êtes pas à l’origine de cette demande, ignorez ce message." ],
    action  = ("bouton", "Me connecter"),
    pied    = "Vous recevez ce message parce qu’une connexion par lien a été demandée "
              "pour cette adresse. Ne le transférez à personne : il ouvre votre compte.",
 ),

 "change-email": dict(
    objet   = "Confirmez votre nouvelle adresse e-mail",
    declenche = "auth.updateUser({ email }) — NON UTILISÉ par l'application aujourd'hui : "
                "le champ e-mail de « Mon compte » porte la mention « Non modifiable ».",
    variables = "{{ .ConfirmationURL }} · {{ .Email }} · {{ .NewEmail }}",
    apercu  = "Confirmez le changement d’adresse de votre compte Stonefolio.",
    salut   = None,
    titre   = "Confirmez votre nouvelle adresse",
    corps   = [ "Votre compte Stonefolio passerait de <strong>{{ .Email }}</strong> "
                "à <strong>{{ .NewEmail }}</strong>.",
                "Le changement ne prend effet qu’après votre confirmation. Tant que vous "
                "n’avez pas confirmé, votre ancienne adresse reste celle du compte." ],
    action  = ("bouton", "Confirmer le changement"),
    pied    = "Vous recevez ce message parce qu’un changement d’adresse a été demandé sur "
              "votre compte. Si ce n’est pas vous, ignorez-le et changez votre mot de passe.",
 ),

 "reauthentication": dict(
    objet   = "Votre code de confirmation Stonefolio",
    declenche = "Réauthentification avant une opération sensible — NON UTILISÉ par "
                "l'application aujourd'hui.",
    variables = "{{ .Token }}",
    apercu  = "Votre code de confirmation à usage unique.",
    salut   = None,
    titre   = "Votre code de confirmation",
    corps   = [ "Saisissez ce code pour confirmer l’opération en cours." ],
    # ⚠️ PAS DE BOUTON ICI : la réauthentification envoie un JETON, pas un lien.
    action  = ("code", "{{ .Token }}"),
    pied    = "Vous recevez ce message parce qu’une opération sensible a été demandée sur "
              "votre compte. Ne communiquez ce code à personne.",
    mention = "Ce code est à usage unique. Ne le partagez avec personne : aucun membre de "
              "Stonefolio ne vous le demandera.",
 ),
}


def entete(nom, g):
    return f"""<!--
  ══════════════════════════════════════════════════════════════════════════
  STONEFOLIO — gabarit « {nom} »
  Supabase Dashboard > Authentication > Emails
  Objet : {g['objet']}
  ══════════════════════════════════════════════════════════════════════════

  ⚠️ FICHIER GÉNÉRÉ. Ne pas le retoucher ici : il serait écrasé.
     La source est supabase/email-templates/ — layout.html pour la mise en
     page, generer.py pour le contenu. Puis `python3 generer.py`.

  Déclenché par : {g['declenche']}
  Variables Go  : {g['variables']}

  CONTRAINTES TENUES, ET POURQUOI :
  · TABLEAUX UNIQUEMENT — Outlook sur Windows rend avec le moteur de Word,
    qui ignore flex, grid et le positionnement.
  · STYLES EN LIGNE pour tout ce qui compte — l'application Gmail retire le
    bloc <style> quand le compte relevé n'est pas un compte Google. Le
    <style> ne porte que du progressif : téléphone et mode sombre.
  · AUCUNE IMAGE — Outlook les bloque par défaut. Le monogramme est fait de
    cellules de tableau colorées.
  · AUCUN DÉGRADÉ — Outlook les ignore et ne retombe sur rien.
  · PAS DE POLICE DISTANTE — ni Gmail ni Outlook ne les chargent. Les
    appeler donnerait la marque à Apple Mail seulement, soit l'incohérence
    même qu'on cherche à éviter.

  COULEURS — jetons du thème clair de tokens.css, aucune inventée. Tous les
  contrastes sont au-dessus de 4,5:1. `--sf-text-3` (#6E8177) a dû être
  écarté : 4,14:1 sur blanc, sous le seuil AA pour du texte de 12-13 px.
-->"""


# ═══════════════════════════════════════════════════════════════════════════
#  VERSION COMPACTE — celle qu'on colle réellement dans Supabase
#
#  ⚠️ L'ÉDITEUR DE SUPABASE NE GARDE PAS UN DOCUMENT TROP LONG. Constaté le
#  27/09/2026 sur `invite-user` : 211 lignes collées, l'éditeur s'arrête à 100.
#  Un document tronqué au milieu d'un tableau ne peut évidemment plus
#  s'afficher — c'est la meilleure explication de l'aperçu resté blanc.
#
#  D'où deux sorties par gabarit :
#    · `<nom>.html`     — lisible, commenté, C'EST LA SOURCE. Elle vit au
#                         dépôt et sert à comprendre et à modifier.
#    · `<nom>.min.html` — la même page, sans un octet de documentation.
#                         C'est CELLE-CI qu'on colle.
#
#  ⚠️ CE N'EST PAS UNE MINIFICATION AVEUGLE. Les commentaires conditionnels
#  d'Outlook (`<!--[if mso]>`, `<!--[if !mso]><!-- -->`, `<!--<![endif]-->`)
#  SONT DU CODE, pas des commentaires : les retirer casse le bouton VML et le
#  cadre fantôme. Ils sont mis à l'abri avant le nettoyage, puis remis.
#  Le piège est réel : le motif `<!--[if !mso]><!-- -->` contient un `<!--`
#  interne qu'un nettoyeur naïf prend pour le début d'un vrai commentaire.

GARDES = ['<!--[if !mso]><!-- -->', '<!--<![endif]-->']


def compacter(html):
    # 1. l'en-tête de documentation ne part pas dans Supabase : il vit au dépôt
    html = html[html.find('<!DOCTYPE'):]

    # 2. mettre les conditionnels à l'abri — les littéraux D'ABORD, sinon le
    #    motif englobant avalerait tout jusqu'au `<![endif]-->` suivant
    abri = []
    for litteral in GARDES:
        while litteral in html:
            html = html.replace(litteral, '\x00%d\x00' % len(abri), 1)
            abri.append(litteral)
    def garder(m):
        abri.append(m.group(0))
        return '\x00%d\x00' % (len(abri) - 1)
    html = re.sub(r'<!--\[if[\s\S]*?<!\[endif\]-->', garder, html)

    # 3. les vrais commentaires partent
    html = re.sub(r'<!--[\s\S]*?-->', '', html)

    # 4. le CSS se resserre : les règles de base sur une ligne, puis une ligne
    #    par requête média — ce sont les trois blocs qu'on relit vraiment.
    def css(m):
        corps = re.sub(r'/\*[\s\S]*?\*/', '', m.group(1))
        corps = re.sub(r'\s+', ' ', corps).strip()
        corps = re.sub(r'(@media[^{]*\{)', r'\n\1', corps)
        corps = re.sub(r'\}\s*\}', '} }', corps)
        return '<style type="text/css">\n' + corps.strip() + '\n</style>'
    html = re.sub(r'<style type="text/css">([\s\S]*?)</style>', css, html)

    # 5. une balise par ligne, sans indentation ni ligne vide. On ne touche
    #    JAMAIS au texte entre deux balises : y coller les lignes changerait
    #    les espaces que le lecteur verra.
    html = re.sub(r'>\s*\n\s*<', '>\n<', html)
    html = re.sub(r'\n[ \t]+', '\n', html)
    html = re.sub(r'\n{2,}', '\n', html)

    # 6. recoller les lignes voisines TANT QUE la précédente finit par `>` et
    #    que la suivante commence par `<`. C'est la même garantie qu'à l'étape
    #    5, appliquée plus loin : on ne touche jamais au texte, seulement à
    #    l'espace entre deux balises, qui n'a aucun effet en HTML de tableau.
    #    Le plafond de largeur garde des lignes qu'un humain peut encore
    #    parcourir dans l'éditeur de Supabase.
    LARGEUR = 260
    sortie = []
    for ligne in html.split('\n'):
        if (sortie and sortie[-1].endswith('>') and ligne.startswith('<')
                and len(sortie[-1]) + len(ligne) <= LARGEUR
                and not sortie[-1].lstrip().startswith('@media')):
            sortie[-1] += ligne
        else:
            sortie.append(ligne)
    html = '\n'.join(sortie)

    # 7. remettre les conditionnels, isolés sur leur ligne : ce sont les seuls
    #    endroits où une erreur de collage ne se verrait pas à l'œil.
    for i, bloc in enumerate(abri):
        html = html.replace('\x00%d\x00' % i,
                            '\n' + re.sub(r'\s*\n\s*', ' ', bloc) + '\n')
    html = re.sub(r'\n{2,}', '\n', html)
    return html.strip() + '\n'


def construire():
    layout = io.open(os.path.join(RACINE, 'layout.html'), encoding='utf-8').read()
    faits = []
    for nom, g in GABARITS.items():
        kind, valeur = g['action']
        action = bouton(valeur, URL) if kind == 'bouton' else code(valeur)

        mentions = p(g.get('mention', USAGE_UNIQUE), marge="22px 0 14px 0",
                     taille=13, hauteur=21)
        if kind == 'bouton':
            mentions += "\n" + repli(URL)

        page = (layout
            .replace('[[ENTETE]]',        entete(nom, g))
            .replace('[[TITRE_ONGLET]]',  g['objet'])
            .replace('[[APERCU]]',        g['apercu'])
            .replace('[[SALUTATION]]',    p(g['salut'], marge="0 0 6px 0", taille=14,
                                            hauteur=22) if g['salut'] else '')
            .replace('[[TITRE]]',         g['titre'])
            .replace('[[CORPS]]',         '\n'.join(
                       p(t, marge=("0 0 28px 0" if i == len(g['corps']) - 1 else "0 0 16px 0"))
                       for i, t in enumerate(g['corps'])))
            .replace('[[ACTION]]',        action)
            .replace('[[MENTIONS]]',      mentions)
            .replace('[[PIED]]',          g['pied']))

        restants = re.findall(r'\[\[[A-Z_]+\]\]', page)
        assert not restants, f'{nom} : marqueurs non remplacés {restants}'

        io.open(os.path.join(RACINE, nom + '.html'), 'w', encoding='utf-8').write(page)

        mini = compacter(page)
        io.open(os.path.join(RACINE, nom + '.min.html'), 'w', encoding='utf-8').write(mini)

        # Les conditionnels d'Outlook doivent avoir survécu au nettoyage.
        for garde in GARDES:
            if garde in page:
                assert garde in mini, f'{nom} : « {garde} » perdu à la compaction'
        assert page.count('<!--[if mso]>') == mini.count('<!--[if mso]>'), \
            f'{nom} : un bloc Outlook a disparu'
        # Et la structure doit etre rigoureusement la meme, commentaires exclus
        # des deux cotes — sinon on comparerait un fichier commente a un autre
        # qui ne l'est plus.
        nu = lambda t: re.sub(r'<!--[\s\S]*?-->', '', t)
        for balise in ('<table', '</table>', '<tr', '</tr>', '<td', '</td>',
                       '{{', '}}', '<a href', '<style'):
            a, b = nu(page).count(balise), nu(mini).count(balise)
            assert a == b, f'{nom} : « {balise} » {a} -> {b} a la compaction'

        faits.append((nom, len(page.encode()), page.count(chr(10)) + 1,
                      len(mini.encode()), mini.count(chr(10)) + 1, g['objet']))
    return faits


if __name__ == '__main__':
    print('%-20s %18s %20s   %s' % ('GABARIT', 'source (dépôt)', 'compact (à coller)', 'OBJET'))
    print('-' * 108)
    pire = 0
    for nom, oS, lS, oM, lM, objet in construire():
        pire = max(pire, lM)
        print('%-20s %8d o %4d l %10d o %4d l   %s' % (nom, oS, lS, oM, lM, objet))
    print('-' * 108)
    print('Le plus long en compact : %d lignes.' % pire)
    print("Coller les fichiers .min.html — l'éditeur de Supabase tronque au-delà de 100 lignes.")
