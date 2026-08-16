const SUPABASE_URL = 'https://dizkljqobgiywxsbsdkd.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpemtsanFvYmdpeXd4c2JzZGtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5NjUyMzgsImV4cCI6MjA4ODU0MTIzOH0.-oVZc0v6IIYATPIAm89C141DMU8w5wuNWc-gdCLTKT8';
const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_KEY);

let currentUser = null;

// ═══════════════════════════════════════════════════════════
//   PONT ENTRE LES JETONS CSS ET LE CANVAS
// ═══════════════════════════════════════════════════════════
// Un graphique Chart.js est dessine dans un <canvas> : il ne connait pas les
// feuilles de style et n'interprete pas `var(--sf-gain)`. Les couleurs des
// courbes doivent donc lui etre passees en valeur resolue.
//
// Les relire ici plutot que de les recopier en dur evite la derive silencieuse
// qui s'est deja produite : la charte peut changer dans tokens.css sans que
// les six graphiques suivent, et personne ne s'en apercoit avant de les
// regarder. Le repli couvre le cas ou la feuille n'est pas encore appliquee.
function sfToken(nom, repli) {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
    return v || repli;
  } catch (e) { return repli; }
}

// Sans ce reglage, Chart.js ecrit ses legendes et ses graduations dans son
// gris par defaut (#666), pratiquement invisible sur le fond sombre.
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = sfToken('--sf-text-2', '#9BAEA4');
  Chart.defaults.borderColor = sfToken('--sf-chart-grid', 'rgba(234,240,236,.07)');
  Chart.defaults.font.family = sfToken('--sf-font-ui', 'system-ui, sans-serif');
}

// ═══════════════════════════════════════════════════════════
//   MODULE STORAGE — Gestion des fichiers via Supabase Storage
//   (remplace progressivement le stockage base64 en DB)
// ═══════════════════════════════════════════════════════════
// Buckets privés. Chemins cloisonnés par user : {user_id}/{record_id}/{uuid}-{filename}
// Accès via URLs signées temporaires (1h). Conforme RGPD (privé strict).
const TI_STORAGE = {
  SIGNED_TTL: 3600,
  _urlCache: {},
  _safeName(filename) {
    const clean = (filename || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-60);
    return `${crypto.randomUUID()}-${clean}`;
  },
  _buildPath(recordId, filename) {
    const uid = currentUser?.id;
    if (!uid) throw new Error('Utilisateur non authentifié');
    const rid = recordId || 'unassigned';
    return `${uid}/${rid}/${this._safeName(filename)}`;
  },
  _dataURLtoBlob(dataURL) {
    const [meta, b64] = dataURL.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  },
  async upload(bucket, recordId, fileOrBlob, originalName) {
    const name = originalName || fileOrBlob.name || 'file';
    const path = this._buildPath(recordId, name);
    const { error } = await db.storage.from(bucket).upload(path, fileOrBlob, {
      cacheControl: '3600', upsert: false, contentType: fileOrBlob.type || undefined,
    });
    if (error) throw error;
    return { path, name, type: fileOrBlob.type || null, size: fileOrBlob.size || null };
  },
  async uploadDataURL(bucket, recordId, dataURL, originalName) {
    const blob = this._dataURLtoBlob(dataURL);
    return this.upload(bucket, recordId, blob, originalName);
  },
  async signedUrl(bucket, path) {
    if (!path) return null;
    const cacheKey = `${bucket}:${path}`;
    const cached = this._urlCache[cacheKey];
    const now = Date.now();
    if (cached && cached.exp > now + 60000) return cached.url;
    const { data, error } = await db.storage.from(bucket).createSignedUrl(path, this.SIGNED_TTL);
    if (error || !data?.signedUrl) {
      console.warn(`signedUrl échec [${bucket}/${path}]:`, error?.message);
      return null;
    }
    this._urlCache[cacheKey] = { url: data.signedUrl, exp: now + this.SIGNED_TTL * 1000 };
    return data.signedUrl;
  },
  async remove(bucket, paths) {
    const arr = Array.isArray(paths) ? paths : [paths];
    const clean = arr.filter(Boolean);
    if (!clean.length) return;
    const { error } = await db.storage.from(bucket).remove(clean);
    if (error) console.warn(`remove échec [${bucket}]:`, error.message);
    clean.forEach(p => delete this._urlCache[`${bucket}:${p}`]);
  },
};

// ═══════════════════════════════════════════════════════════
//   AUTH — FONCTIONS COMPLÈTES
// ═══════════════════════════════════════════════════════════

// ── Affichage des formulaires ──
function showForm(name) {
  ['login','signup','reset','newpwd'].forEach(f => {
    const el = document.getElementById('form-'+f);
    if(el) el.style.display = f===name ? 'block' : 'none';
  });
  clearAuthAlert();
  // Focus auto sur le premier champ
  setTimeout(() => {
    const firstInput = document.querySelector('#form-'+name+' input');
    if(firstInput) firstInput.focus();
  }, 50);
}

// ── Alertes ──
function showAuthAlert(msg, type='error') {
  const el = document.getElementById('auth-alert');
  const icons = {error:'⚠️', success:'✅', info:'ℹ️'};
  el.className = 'auth-alert '+type;
  el.innerHTML = '<span>'+icons[type]+'</span><span>'+msg+'</span>';
  el.style.display = 'flex';
  el.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function clearAuthAlert() {
  const el = document.getElementById('auth-alert');
  if(el) el.style.display='none';
}

// ── Spinner sur bouton ──
function setBtnLoading(btnId, labelId, loading, text) {
  const btn = document.getElementById(btnId);
  const label = document.getElementById(labelId);
  if(!btn||!label) return;
  btn.disabled = loading;
  if(loading) {
    label.innerHTML = '<div class="auth-spinner"></div>';
  } else {
    label.textContent = text;
  }
}

// ── Indicateur de force du mot de passe ──
function getPwdStrength(pwd) {
  let score = 0;
  if(pwd.length >= 8) score++;
  if(pwd.length >= 12) score++;
  if(/[A-Z]/.test(pwd)) score++;
  if(/[0-9]/.test(pwd)) score++;
  if(/[^A-Za-z0-9]/.test(pwd)) score++;
  return Math.min(4, score);
}
function checkPwdStrength() {
  const pwd = document.getElementById('signup-pwd').value;
  const score = getPwdStrength(pwd);
  const cls = score<=1?'weak':score<=2?'medium':score<=3?'medium':'strong';
  const labels = {weak:'Trop court',medium:'Moyen',strong:'Fort'};
  [1,2,3,4].forEach(i => {
    const bar = document.getElementById('bar'+i);
    if(bar) bar.className = 'pwd-bar '+(i<=score ? cls : '');
  });
  const lbl = document.getElementById('pwd-label');
  if(lbl && pwd.length > 0) lbl.textContent = pwd.length<8 ? `Encore ${8-pwd.length} caractère(s)` : labels[cls];
}

// ── Erreurs Supabase → messages humains ──
function authErrorToFr(error) {
  const msg = (error?.message||'').toLowerCase();
  if(msg.includes('invalid login') || msg.includes('invalid credentials') || msg.includes('invalid email or password'))
    return 'Email ou mot de passe incorrect. Vérifiez vos identifiants.';
  if(msg.includes('email not confirmed'))
    return 'Email non confirmé. Vérifiez votre boîte mail.';
  if(msg.includes('user already registered') || msg.includes('already been registered'))
    return 'Un compte existe déjà avec cet email. Connectez-vous.';
  if(msg.includes('password should be'))
    return 'Le mot de passe doit contenir au moins 8 caractères.';
  if(msg.includes('rate limit'))
    return 'Trop de tentatives. Attendez quelques minutes avant de réessayer.';
  if(msg.includes('network') || msg.includes('fetch'))
    return 'Problème de connexion. Vérifiez votre accès internet.';
  if(msg.includes('user not found') || msg.includes('no user found'))
    return 'Aucun compte trouvé avec cet email.';
  return error?.message || 'Une erreur est survenue. Réessayez.';
}

// ─────────────────────────────────────────
//   CONNEXION
// ─────────────────────────────────────────
async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-pwd').value;
  clearAuthAlert();
  if(!email) { document.getElementById('login-email').focus(); showAuthAlert('Saisissez votre email.'); return; }
  if(!pwd) { document.getElementById('login-pwd').focus(); showAuthAlert('Saisissez votre mot de passe.'); return; }
  if(!/\S+@\S+\.\S+/.test(email)) { showAuthAlert('Format d\'email invalide.'); return; }

  setBtnLoading('btn-login','btn-login-label',true,'');
  try {
    await db.auth.signOut().catch(() => {});
    const { data, error } = await db.auth.signInWithPassword({ email, password: pwd });
    if(error) { showAuthAlert(authErrorToFr(error)); return; }

    if(!(await ensureProfileActive())) return;

    await onAuthSuccess(data.user);
  } catch(e) {
    console.error('[Stonefolio] Login error:', e);
    showAuthAlert('Erreur technique : ' + (e?.message || 'connexion impossible. Rechargez la page et réessayez.'));
  } finally {
    setBtnLoading('btn-login','btn-login-label',false,'Se connecter');
  }
}

// Vérifie le statut du profil (pending/disabled) avant de laisser entrer.
// Retourne false (et déconnecte) si l'accès est refusé. Utilisé par le login
// email/mot de passe ET par le retour de connexion Google.
async function ensureProfileActive() {
  try {
    const { data: profile } = await db.rpc('get_my_profile');
    if(profile?.status === 'pending') {
      await db.auth.signOut();
      showAuthAlert(
        '<strong>⏳ Compte en attente de validation</strong><br><br>' +
        'Votre inscription a bien été reçue. Un administrateur va valider votre accès très bientôt. ' +
        'Vous pourrez ensuite vous connecter avec ces identifiants.',
        'info'
      );
      return false;
    }
    if(profile?.status === 'disabled') {
      await db.auth.signOut();
      showAuthAlert(
        '<strong>🚫 Compte désactivé</strong><br><br>' +
        'Votre accès à Stonefolio a été suspendu. Contactez un administrateur pour plus d\'informations.',
        'error'
      );
      return false;
    }
  } catch(e) { /* pas de profil = on laisse passer (cas legacy) */ }
  return true;
}

// ─────────────────────────────────────────
//   CONNEXION GOOGLE (SSO — Option B : login uniquement)
// ─────────────────────────────────────────
// Les inscriptions via Google sont bloquées côté serveur par le trigger
// trg_block_external_signup (TRACKIMMO_SSO_RESTREINT). Seuls les comptes
// existants (email déjà enregistré) peuvent se connecter avec Google.
async function doGoogleLogin() {
  clearAuthAlert();
  setBtnLoading('btn-google','btn-google-label',true,'');
  try {
    // redirectTo = page actuelle sans hash ni query (doit être dans les
    // Redirect URLs autorisées côté Supabase Auth)
    const redirectTo = window.location.origin + window.location.pathname;
    const { error } = await db.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo }
    });
    if(error) {
      showAuthAlert(authErrorToFr(error));
      setBtnLoading('btn-google','btn-google-label',false,'');
      restoreGoogleBtnLabel();
    }
    // Pas de reset du bouton en cas de succès : le navigateur part vers Google.
  } catch(e) {
    console.error('[Stonefolio] Google login error:', e);
    showAuthAlert('Connexion Google impossible. Vérifiez votre accès internet et réessayez.');
    setBtnLoading('btn-google','btn-google-label',false,'');
    restoreGoogleBtnLabel();
  }
}

// setBtnLoading remplace le label par un spinner ; au retour d'erreur on
// restaure le contenu riche (logo SVG + texte) plutôt qu'un texte brut.
function restoreGoogleBtnLabel() {
  const label = document.getElementById('btn-google-label');
  if(!label) return;
  label.innerHTML =
    '<svg width="18" height="18" viewBox="0 0 48 48">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>' +
    '</svg> Continuer avec Google';
}

// ── Erreurs OAuth au retour de redirection ──
// Quand le trigger serveur refuse un signup Google, Supabase redirige ici avec
// #error=server_error&error_description=... (ou en query string selon le flow).
// Retourne le message FR à afficher, ou null si pas d'erreur OAuth dans l'URL.
function checkOAuthErrorInUrl() {
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/,''));
  const queryParams = new URLSearchParams(window.location.search);
  const err = hashParams.get('error') || queryParams.get('error');
  const desc = hashParams.get('error_description') || queryParams.get('error_description') || '';
  if(!err) return null;
  // Nettoyer l'URL pour ne pas ré-afficher l'erreur au refresh
  history.replaceState(null, null, window.location.pathname);
  const d = decodeURIComponent(desc.replace(/\+/g,' '));
  if(d.includes('TRACKIMMO_SSO_RESTREINT') || d.includes('Database error saving new user'))
    return '<strong>🚫 Connexion Google refusée</strong><br><br>' +
      'Aucun compte Stonefolio n\'est associé à cet email Google. ' +
      'La connexion Google est réservée aux comptes existants : connectez-vous d\'abord ' +
      'avec votre email et mot de passe, ou contactez un administrateur pour être invité.';
  if(err === 'access_denied')
    return 'Connexion Google annulée. Vous pouvez réessayer ou utiliser votre email et mot de passe.';
  return 'Connexion Google impossible : ' + (d || err) + '. Réessayez ou utilisez votre email et mot de passe.';
}

// ─────────────────────────────────────────
//   INSCRIPTION
// ─────────────────────────────────────────
async function doSignup() {
  const email = document.getElementById('signup-email').value.trim();
  const pwd = document.getElementById('signup-pwd').value;
  const pwd2 = document.getElementById('signup-pwd2').value;
  clearAuthAlert();
  if(!email || !/\S+@\S+\.\S+/.test(email)) { showAuthAlert('Email invalide.'); return; }
  if(pwd.length < 8) { showAuthAlert('Le mot de passe doit faire au moins 8 caractères.'); return; }
  if(pwd !== pwd2) { showAuthAlert('Les mots de passe ne correspondent pas.'); return; }

  setBtnLoading('btn-signup','btn-signup-label',true,'');
  try {
    // Lors du signup, on stocke le statut 'pending' dans user_metadata
    // pour que le trigger handle_new_user_profile puisse créer un profil pending.
    const { data, error } = await db.auth.signUp({
      email,
      password: pwd,
      options: {
        emailRedirectTo: window.location.href.split('#')[0],
        data: { signup_source: 'self' }
      }
    });
    if(error) { showAuthAlert(authErrorToFr(error)); return; }

    // Confirm email est ACTIF côté Supabase → pas de session immédiate
    // Le user reçoit un mail "Confirmez votre inscription" qu'il doit cliquer.
    showAuthAlert(
      '<strong>📬 Vérifiez vos emails</strong><br><br>' +
      'Nous avons envoyé un lien de confirmation à <strong>' + email + '</strong>. ' +
      'Cliquez dessus pour activer votre compte.<br><br>' +
      '<em style="font-size:11px;color:var(--sf-text-2)">Pensez à vérifier vos spams si vous ne le voyez pas.</em>',
      'info'
    );
    // Vider les champs
    setTimeout(() => {
      document.getElementById('signup-email').value = '';
      document.getElementById('signup-pwd').value = '';
      document.getElementById('signup-pwd2').value = '';
    }, 100);
  } catch(e) {
    showAuthAlert('Erreur de connexion. Vérifiez votre accès internet.');
  } finally {
    setBtnLoading('btn-signup','btn-signup-label',false,'Créer mon compte');
  }
}

// ─────────────────────────────────────────
//   RÉINITIALISATION MOT DE PASSE
// ─────────────────────────────────────────
async function doReset() {
  const email = document.getElementById('reset-email').value.trim();
  clearAuthAlert();
  if(!email || !/\S+@\S+\.\S+/.test(email)) { showAuthAlert('Saisissez un email valide.'); return; }

  setBtnLoading('btn-reset','btn-reset-label',true,'');
  try {
    // redirectTo = page actuelle pour que le lien ramène ici
    const redirectTo = window.location.href.split('#')[0];
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) { showAuthAlert(authErrorToFr(error)); return; }
    showAuthAlert(
      '<strong>📬 Email envoyé</strong><br><br>' +
      'Si un compte existe pour <strong>'+email+'</strong>, un lien de réinitialisation vient de partir. ' +
      'Cliquez sur le lien dans le mail pour définir un nouveau mot de passe.<br><br>' +
      '<em style="font-size:11px;color:var(--sf-text-2)">Pensez à vérifier vos spams. Le lien expire dans 1 heure.</em>',
      'success'
    );
    // Vider le champ
    setTimeout(() => { document.getElementById('reset-email').value = ''; }, 100);
  } catch(e) {
    showAuthAlert('Impossible d\'envoyer l\'email. Vérifiez votre accès internet.');
  } finally {
    setBtnLoading('btn-reset','btn-reset-label',false,'Envoyer le lien');
  }
}

// ─────────────────────────────────────────
//   DÉFINIR NOUVEAU MOT DE PASSE (recovery)
// ─────────────────────────────────────────
async function doSetNewPwd() {
  const pwd = document.getElementById('newpwd').value;
  const pwd2 = document.getElementById('newpwd2').value;
  clearAuthAlert();
  if(pwd.length < 8) { showAuthAlert('Le mot de passe doit faire au moins 8 caractères.'); return; }
  if(pwd !== pwd2) { showAuthAlert('Les mots de passe ne correspondent pas.'); return; }

  setBtnLoading('btn-newpwd','btn-newpwd-label',true,'');
  try {
    const { data, error } = await db.auth.updateUser({ password: pwd });
    if(error) { showAuthAlert(authErrorToFr(error)); return; }
    showAuthAlert('Mot de passe mis à jour ! Connexion en cours...', 'success');
    setTimeout(() => { if(data.user) onAuthSuccess(data.user); }, 1000);
  } catch(e) {
    showAuthAlert('Erreur. Réessayez ou demandez un nouveau lien.');
  } finally {
    setBtnLoading('btn-newpwd','btn-newpwd-label',false,'Définir le mot de passe');
  }
}

// ─────────────────────────────────────────
//   DÉCONNEXION
// ─────────────────────────────────────────
async function doLogout() {
  await db.auth.signOut();
  currentUser = null;
  allBiens = [];
  // Reset UI
  showForm('login');
  clearAuthAlert();
  document.getElementById('auth-screen').style.display = 'flex';
  showNotif('Vous êtes déconnecté(e)');
}

// ─────────────────────────────────────────
//   SUCCÈS AUTH → ENTRÉE DANS L'APP
// ─────────────────────────────────────────
async function onAuthSuccess(user) {
  currentUser = user;
  // Masquer écran auth
  document.getElementById('auth-screen').style.display = 'none';
  // ⚠️ migrate_orphan_data() est volontairement désactivé.
  // Ce hack initial servait à attribuer les anciennes données sans user_id
  // au premier user qui se connectait. En contexte multi-users, c'est dangereux
  // (un user invité pourrait se voir attribuer des données orphelines d'un autre).
  // Toutes les données ont maintenant un user_id, plus aucun orphelin en base.
  // Charger préférences
  loadPreferences();
  // Charger le profil (rôle admin, etc.)
  await loadProfile();
  // Appliquer l'apparence depuis la DB (couleur + toggles), migre le localStorage si besoin
  await applyAppearanceFromPrefs();
  // Démarrer l'app
  await loadAndStart();
}

// ─────────────────────────────────────────
//   DÉTECTION HASH RECOVERY (lien email)
// ─────────────────────────────────────────
function checkRecoveryHash() {
  const hash = window.location.hash;
  if(hash.includes('type=recovery') || hash.includes('type=signup') || hash.includes('type=invite')) {
    // Laisser Supabase parser le hash
    const params = new URLSearchParams(hash.replace('#',''));
    const type = params.get('type');
    if(type === 'recovery' || type === 'invite') {
      // Supabase crée une session automatiquement
      // Pour 'invite' : le user a cliqué sur le lien d'invitation, doit définir son mot de passe
      // Pour 'recovery' : le user a cliqué sur "mot de passe oublié"
      db.auth.getSession().then(({ data: { session } }) => {
        if(session) {
          // Montrer le formulaire de nouveau mot de passe
          document.getElementById('auth-screen').style.display = 'flex';
          showForm('newpwd');
          // Adapter le titre selon le contexte
          const titleEl = document.querySelector('#form-newpwd .auth-welcome h2');
          const subEl   = document.querySelector('#form-newpwd .auth-welcome p');
          if(type === 'invite') {
            if(titleEl) titleEl.textContent = '🎉 Bienvenue sur Stonefolio';
            if(subEl)   subEl.textContent   = 'Pour activer votre compte, définissez votre mot de passe.';
          } else {
            if(titleEl) titleEl.textContent = '🔐 Nouveau mot de passe';
            if(subEl)   subEl.textContent   = 'Définissez un nouveau mot de passe pour votre compte.';
          }
          // Nettoyer le hash de l'URL
          history.replaceState(null, null, window.location.pathname);
        }
      });
    }
  }
}

// Frais de notaire : lit la préférence métier (en %), converti en ratio
function notairePct() { return (userPrefs?.notaire_pct ?? 7.0) / 100; }

let allBiens = [], currentPage = 'accueil', editingId = null, charts = {};
// Vue par defaut : TABLEAU. L'ecran sert a comparer des biens entre eux, ce que
// sept cartes separees ne permettent pas.
let currentView = 'tableau';
let kanbanGroup = 'phase';
let draggedBienId = null;
let bienSortBy = 'cf';
let bienSortAsc = false;
// « Ma prospection » d'abord : c'est la qu'on agit au quotidien.
let bienOnglet = 'prospect';
// La pagination a ete retiree : a six fiches par page, sept biens creaient une
// deuxieme page pour un seul element. Les onglets separent deja les deux
// ensembles, et le tableau est assez dense pour qu'un defilement suffise.

const PHASE_MAP = {
  'Renseignements Web':'prospection','Vendeur contacté (1ère)':'prospection',
  'Vendeur contacté (2ème)':'prospection','Vendeur contacté (3ème)':'prospection',
  '1ère offre - Envoyée':'negociation','1ère offre - Acceptée':'negociation',
  '1ère offre - Refusée':'negociation','Contre offre - Envoyée':'negociation',
  'Contre offre - Acceptée':'negociation','Contre offre - Refusée':'negociation',
  'Accord trouvé !':'banque','Rendez-vous banque':'banque',
  'Dossier déposé':'banque','Obtention crédit':'banque','Dossier non déposé':'banque',
  'Administratifs':'administratif','Compromis signé':'administratif',
  'Acheté':'finalise','Abandonné':'finalise'
};
// Les libelles ne portent plus d'emoji : leur dessin, leur couleur et leur
// graisse dependent du systeme d'exploitation, pas de la charte — ils juraient
// avec le reste de l'interface. Une icone SVG suit la couleur du texte et se
// comporte pareil partout. Meme parti que les Parametres et l'accueil.
const PHASES = [
  {key:'prospection',  label:'Prospection',   icone:'loupe',  dot:'phase-prospection',  defaultStatut:'Renseignements Web'},
  {key:'negociation',  label:'Négociation',   icone:'echange',dot:'phase-negociation',  defaultStatut:'1ère offre - Envoyée'},
  {key:'banque',       label:'Banque',        icone:'banque', dot:'phase-banque',       defaultStatut:'Accord trouvé !'},
  {key:'administratif',label:'Administratif', icone:'doc',    dot:'phase-administratif',defaultStatut:'Administratifs'},
  {key:'finalise',     label:'Finalisé',      icone:'ok',     dot:'phase-finalise',     defaultStatut:'Acheté'},
];

// Regroupement propre au tableau de bord et au filtre par phase. Il diverge
// VOLONTAIREMENT de PHASE_MAP : « Accord trouve ! » compte ici en negociation
// (l'accord se decroche au terme de la negociation) alors que PHASE_MAP le
// range en banque, et « Abandonne » y est isole au lieu d'etre noye dans
// « finalise ». Cette liste etait ecrite deux fois a l'identique — accueil et
// filterByPhase — et rien ne garantissait qu'elles restent d'accord.
// PHASES_ACCUEIL supprimee avec filterByPhase, son unique consommateur.

// ═══════════════════════════════════════════════════════════════
//  TI_BIENS — REGISTRE DES CHAMPS « BIENS », SOURCE UNIQUE
// ═══════════════════════════════════════════════════════════════
// Avant ce registre (01/08/2026), la connaissance des champs vivait dispersee
// dans ~10 000 lignes : la liste des statuts etait recopiee a 4 endroits, la
// correspondance balise -> classe CSS a 4 endroits, la table des emojis a 3,
// les types de bien a 4. Ces copies avaient DIVERGE, avec une consequence
// silencieuse : le formulaire de creation/edition n'offrait que 17 des 19
// statuts. Ouvrir un bien en « Contre offre - Refusee » ou « Dossier non
// depose » puis l'enregistrer le faisait retomber sur la 1ere option de la
// liste — le bien perdait sa position dans le pipeline sans aucun message.
//
// Regle : toute nouvelle lecture de ces listes passe par TI_BIENS. Ne jamais
// recopier une enumeration en dur.
const TI_BIENS = {
  // Derive de PHASE_MAP : un statut sans phase n'existe pas, et l'inverse non
  // plus. Les deux listes ne peuvent donc plus diverger par construction.
  get STATUTS() { return Object.keys(PHASE_MAP); },

  /* Les statuts que l'utilisateur peut CHOISIR dans une liste deroulante.
     ⚠️ « Acheté » n'en fait pas partie, et c'est voulu (15/08/2026).
     Les dix-huit autres statuts decrivent l'avancement d'une negociation :
     reversibles, de meme nature, on passe de l'un a l'autre. « Acheté » n'est
     pas une etape de plus, c'est LA SORTIE DU PIPELINE — le bien quitte
     « Ma prospection » pour « Mon patrimoine », alimente le Suivi financier et
     devient un actif a declarer. Le proposer au milieu d'une liste de dix-neuf
     entrees rangeait la signature chez le notaire au meme niveau qu'un appel
     telephonique, et laissait le changement de statut EN MASSE contourner la
     mise en gestion.
     Il s'atteint desormais par deux gestes volontaires, et deux seulement :
     le bouton « Confirmer l'acquisition » de la fiche, et le depot dans la
     colonne « Finalise » du kanban. Les deux passent par
     `bdDemarrerAcquisition()`.
     ⚠️ La valeur reste evidemment dans STATUTS : c'est elle qui est stockee en
     base, contrainte par `biens_statut_check`, et affichee partout ailleurs —
     badges, filtres, kanban, exports. On ne retire QUE la saisie. */
  get STATUTS_SAISISSABLES() { return this.STATUTS.filter(v => v !== 'Acheté'); },

  TYPES: ['Studio','T1','T2','T3','T4+','Immeuble','Parking','Autre'],

  SOURCES: ['SeLoger','LeBonCoin','PAP','Logic-Immo','Bien\'ici','Jinka','Réseau agence','Particulier','Autre'],

  // Une balise porte sa valeur, son emoji et sa classe CSS au meme endroit.
  // La propriete `emoji` a ete supprimee : elle n'avait plus qu'UN
  // consommateur, `inlineEditField`, qui remettait l'emoji dans la pastille
  // apres une modification en ligne — alors que tous les autres rendus
  // l'avaient abandonne. La meme balise s'affichait donc avec ou sans emoji
  // selon qu'on venait ou non de la changer, jusqu'au rechargement suivant.
  BALISES: [
    { v:'Veille',         cls:'tag-veille' },
    { v:'Négociation',    cls:'tag-negociation' },
    { v:'Dossier banque', cls:'tag-dossier-banque' },
    { v:'Coup de cœur',   cls:'tag-coup-de-coeur' },
  ],

  // Les 27 champs metier de la table biens (hors technique : id, user_id,
  // timestamps, is_test, sci_id, photos*, documents*).
  //   k          nom de colonne Supabase
  //   lab        libelle court, celui affiche dans l'app
  //   type       gouverne le formatage et, a terme, la coercion a l'ecriture
  //   groupe     section metier — sert au regroupement d'un futur export
  //   tab        onglet de la fiche bien ou le champ se saisit. Les cles sont
  //              celles de TAB_DEFS dans renderBienDetail — c'est ce qui permet
  //              au bouton « Completer » d'ouvrir le bon onglet. Depuis le
  //              05/08/2026 : 'bien', 'finances', 'nego' (l'ancien couple
  //              'infos'/'fin' a disparu avec la fusion des deux onglets
  //              financiers et la descente du contact vendeur dans Negociation).
  //   completude rang du champ dans l'indicateur de completude (absent = exclu).
  //              L'ordre est une decision produit — il pilote les 3 noms cites
  //              dans le rail — et non un effet de bord de l'ordre du schema.
  //   cle        son absence empeche tout calcul de rentabilite
  CHAMPS: [
    { k:'titre',                     lab:"Titre de l'annonce",   type:'texte',     groupe:'bien',        tab:'bien', requis:true },
    { k:'ville',                     lab:'Ville',                type:'texte',     groupe:'bien',        tab:'bien' },
    { k:'code_postal',               lab:'Code postal',          type:'texte',     groupe:'bien',        tab:'bien' },
    { k:'type_bien',                 lab:'Type de bien',         type:'enum',      groupe:'bien',        tab:'bien', valeurs:'TYPES' },
    { k:'surface_m2',                lab:'Surface',              type:'m2',        groupe:'bien',        tab:'bien', completude:4, cle:false },
    { k:'statut',                    lab:'Statut',               type:'enum',      groupe:'bien',        tab:'bien', valeurs:'STATUTS' },
    { k:'balise',                    lab:'Balise',               type:'enum',      groupe:'bien',        tab:'bien', valeurs:'BALISES' },
    { k:'source',                    lab:'Source',               type:'enum',      groupe:'bien',        tab:'bien', valeurs:'SOURCES' },
    { k:'lien_annonce',              lab:"Lien de l'annonce",    type:'url',       groupe:'bien',        tab:'bien' },

    { k:'prix_affiche',              lab:'Prix affiché',         type:'euro',      groupe:'acquisition', tab:'finances', completude:1, cle:true },
    { k:'frais_notaire',             lab:'Frais de notaire',     type:'euro',      groupe:'acquisition', tab:'finances', calcule:true },
    { k:'travaux',                   lab:'Travaux',              type:'euro',      groupe:'acquisition', tab:'finances' },
    { k:'frais_agence',              lab:"Frais d'agence",       type:'euro',      groupe:'acquisition', tab:'finances' },
    { k:'creation_sci',              lab:'Création SCI',         type:'euro',      groupe:'acquisition', tab:'finances' },

    { k:'mensualite_credit',         lab:'Mensualité crédit',    type:'euro_mois', groupe:'credit',      tab:'finances', completude:3, cle:true },
    { k:'duree_credit_ans',          lab:'Durée du crédit',      type:'annees',    groupe:'credit',      tab:'finances' },

    { k:'charge_copro',              lab:'Charges copro',        type:'euro_mois', groupe:'charges',     tab:'finances', completude:6, cle:false },
    { k:'assurance_logement',        lab:'Assurance',            type:'euro_mois', groupe:'charges',     tab:'finances', completude:7, cle:false },
    { k:'taxe_fonciere',             lab:'Taxe foncière',        type:'euro_mois', groupe:'charges',     tab:'finances', completude:5, cle:false },

    { k:'loyer_en_etat',             lab:'Loyer estimé',         type:'euro_mois', groupe:'loyers',      tab:'finances', completude:2, cle:true },
    { k:'charges_locataire_etat',    lab:'Charges locataire',    type:'euro_mois', groupe:'loyers',      tab:'finances' },
    { k:'loyer_apres_travaux',       lab:'Loyer après travaux',  type:'euro_mois', groupe:'loyers',      tab:'finances' },
    { k:'charges_locataire_travaux', lab:'Charges loc. après travaux', type:'euro_mois', groupe:'loyers', tab:'finances' },

    { k:'intermediaire',             lab:'Intermédiaire',        type:'texte',     groupe:'contact',     tab:'nego' },
    { k:'telephone',                 lab:'Téléphone',            type:'tel',       groupe:'contact',     tab:'nego' },
    { k:'mail',                      lab:'Mail',                 type:'email',     groupe:'contact',     tab:'nego' },
    // Les notes restent EN DERNIER : `exportBiensCSV` construit ses colonnes
    // dans l'ordre de cette liste, deplacer une entree deplacerait la colonne
    // correspondante dans tous les fichiers exportes.
    { k:'notes',                     lab:'Notes',                type:'notes',     groupe:'bien',        tab:'bien' },
  ],

  champ(k) { return this.CHAMPS.find(c => c.k === k) || null; },
  balise(v) { return this.BALISES.find(b => b.v === v) || null; },

  // Options d'un <select>, marquage de la valeur courante inclus. Remplace les
  // .map(...) recopies dans chaque formulaire.
  options(liste, courant, vide) {
    const vals = (liste === 'BALISES') ? this.BALISES.map(b => b.v) : this[liste];
    const tete = vide ? `<option value="">${vide}</option>` : '';
    return tete + vals.map(v =>
      `<option value="${v}"${v === courant ? ' selected' : ''}>${v}</option>`).join('');
  },
};

// Formate une valeur de bien pour l'affichage ou l'export. Une valeur absente
// rend '' et jamais 0 : un loyer non saisi n'est pas un loyer nul (regle issue
// de l'audit Marche).
function tiFormatChamp(bien, k) {
  const c = TI_BIENS.champ(k);
  if (!c) return '';
  const brut = bien?.[k];
  if (brut === null || brut === undefined || brut === '') return '';
  switch (c.type) {
    case 'euro':      return `${fmt(parseFloat(brut) || 0)} €`;
    case 'euro_mois': return `${fmt(parseFloat(brut) || 0)} €/mois`;
    case 'm2':        return `${fmt(parseFloat(brut) || 0)} m²`;
    case 'annees':    { const n = parseInt(brut, 10) || 0; return `${n} an${n > 1 ? 's' : ''}`; }
    default:          return String(brut);
  }
}

// ═══════════════════════════════════════════════════════════════
//  EXPORT CSV
// ═══════════════════════════════════════════════════════════════
// Cible assumee : Excel en francais. Trois choix qui n'ont rien d'anodin :
//   - separateur ';'  Excel FR attend le point-virgule, pas la virgule
//   - decimale ','    idem, sinon les montants sont lus comme du texte
//   - BOM UTF-8       sans lui, Excel rend les accents en mojibake
// Et surtout : les nombres sortent BRUTS. Ne jamais passer un montant par
// fmt() ou tiFormatChamp() ici — ils produisent un separateur de milliers
// U+202F (espace insecable etroite) qu'Excel refuse de lire comme un nombre.

const TI_CSV_UNITES = { euro:' (€)', euro_mois:' (€/mois)', m2:' (m²)', annees:' (ans)' };

function tiCsvValeur(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
  const s = String(v);
  // Guillemets, separateur ou saut de ligne dans la valeur -> on encadre et on
  // double les guillemets internes (RFC 4180).
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function tiCsv(entetes, lignes) {
  return [entetes, ...lignes].map(l => l.map(tiCsvValeur).join(';')).join('\r\n');
}

function tiTelechargerCsv(base, contenu) {
  const nom = `stonefolio-${base}-${new Date().toISOString().slice(0, 10)}.csv`;
  const blob = new Blob(['﻿' + contenu], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: nom });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return nom;
}

// Valeur d'un champ de bien destinee au CSV : numerique quand le type l'est,
// chaine vide quand la donnee est absente — jamais 0, un loyer non saisi
// n'etant pas un loyer nul (regle de l'audit Marche).
function tiCsvChamp(bien, c) {
  const brut = bien?.[c.k];
  if (brut === null || brut === undefined || brut === '') return '';
  if (c.type === 'euro' || c.type === 'euro_mois' || c.type === 'm2') {
    const n = parseFloat(brut); return Number.isNaN(n) ? '' : n;
  }
  if (c.type === 'annees') { const n = parseInt(brut, 10); return Number.isNaN(n) ? '' : n; }
  return String(brut);
}

function tiDateFr(d) {
  if (!d) return '';
  const dt = new Date(d);
  return isNaN(dt) ? String(d) : dt.toLocaleDateString('fr-FR');
}

// ── Export des fiches biens ──────────────────────────────────────
// Exporte ce que l'utilisateur a sous les yeux : getFilteredBiens() applique
// les filtres et le tri courants. Exporter tout le portefeuille alors que
// l'ecran en montre trois serait une mauvaise surprise.
function exportBiensCSV(biensChoisis) {
  const biens = biensChoisis || getFilteredBiens();
  if (!biens.length) { showNotif('Aucun bien à exporter avec ces filtres', true); return; }

  const champs = TI_BIENS.CHAMPS;
  const entetes = [
    ...champs.map(c => c.lab + (TI_CSV_UNITES[c.type] || '')),
    'Cashflow prévisionnel (€/mois)', 'Rendement brut (%)', "Date d'ajout",
  ];

  const lignes = biens.map(b => {
    const prix = parseFloat(b.prix_affiche) || 0;
    const loyer = parseFloat(b.loyer_en_etat) || 0;
    // Un cashflow n'a de sens que si au moins une mensualite ou un loyer est
    // saisi ; un rendement, que si prix ET loyer le sont. Sinon on laisse vide.
    const cfCalculable = !!(b.mensualite_credit || b.loyer_en_etat);
    return [
      ...champs.map(c => tiCsvChamp(b, c)),
      cfCalculable ? Math.round(computeCF(b) * 100) / 100 : '',
      (prix > 0 && loyer > 0) ? Math.round((loyer * 12 / prix) * 1000) / 10 : '',
      tiDateFr(b.created_at),
    ];
  });

  const nom = tiTelechargerCsv('biens', tiCsv(entetes, lignes));
  showNotif(`${biens.length} bien${biens.length > 1 ? 's' : ''} exporté${biens.length > 1 ? 's' : ''} · ${nom}`);
}

// ── Export des loyers d'une annee ────────────────────────────────
function exportLoyersCSV(annee) {
  const lignesAn = allLoyers.filter(l => l.annee === annee);
  if (!lignesAn.length) { showNotif(`Aucun loyer saisi en ${annee}`, true); return; }

  const entetes = ['Bien', 'Ville', 'Année', 'Mois', 'Locataire', 'Loyer dû (€)',
    'Charges dues (€)', 'Montant encaissé (€)', 'Statut', 'Date encaissement'];

  const lignes = lignesAn
    .sort((a, b) => a.mois - b.mois)
    .map(l => {
      const bien = allBiens.find(x => x.id === l.bien_id);
      const loc = allLocataires.find(x => x.id === l.locataire_id);
      const enc = parseFloat(l.montant_encaisse);
      return [
        bien?.titre || '', bien?.ville || '', l.annee, MOIS_LONGS[l.mois - 1] || l.mois,
        loc ? [loc.prenom, loc.nom].filter(Boolean).join(' ') : '',
        parseFloat(l.loyer_du) || 0, parseFloat(l.charges_dues) || 0,
        Number.isNaN(enc) ? '' : enc,
        l.statut || '', tiDateFr(l.date_encaissement),
      ];
    });

  const nom = tiTelechargerCsv(`loyers-${annee}`, tiCsv(entetes, lignes));
  showNotif(`${lignes.length} ligne${lignes.length > 1 ? 's' : ''} de loyer exportée${lignes.length > 1 ? 's' : ''} · ${nom}`);
}

// ── Export des charges d'une annee ───────────────────────────────
function exportChargesCSV(annee) {
  const chargesAn = allCharges.filter(c => (c.date_charge || '').startsWith(String(annee)));
  if (!chargesAn.length) { showNotif(`Aucune charge saisie en ${annee}`, true); return; }

  const entetes = ['Bien', 'Ville', 'Date', 'Catégorie', 'Libellé', 'Montant (€)',
    'Fréquence', 'Récupérable locataire', 'Lissable', 'Notes'];

  const lignes = chargesAn
    .sort((a, b) => (a.date_charge || '').localeCompare(b.date_charge || ''))
    .map(c => {
      const bien = allBiens.find(x => x.id === c.bien_id);
      return [
        bien?.titre || '', bien?.ville || '', tiDateFr(c.date_charge),
        c.categorie || '', c.libelle || '', parseFloat(c.montant) || 0,
        c.frequence || '',
        c.recuperable_locataire ? 'Oui' : 'Non',
        c.lissable ? 'Oui' : 'Non',
        c.notes || '',
      ];
    });

  const nom = tiTelechargerCsv(`charges-${annee}`, tiCsv(entetes, lignes));
  showNotif(`${lignes.length} charge${lignes.length > 1 ? 's' : ''} exportée${lignes.length > 1 ? 's' : ''} · ${nom}`);
}
let sciOui = false;


// ═══════════════════════════════════════════════════════════
//   ADMIN — GESTION DES ACCÈS
// ═══════════════════════════════════════════════════════════
let currentProfile = null;
// Préférences métier (chargées depuis la DB, valeurs par défaut en fallback)
let userPrefs = { notaire_pct: 7.0, duree_credit_ans: 20, assurance_mois: 33, seuil_rentabilite: 5.0 };
const ADMIN_EMAIL = 'thomasguenon123@gmail.com';

async function loadProfile() {
  try {
    const { data } = await db.rpc('get_my_profile');
    currentProfile = data;
  } catch(e) {
    currentProfile = null;
  }
  // Charger les préférences métier (frais notaire, durée, assurance, seuil)
  try {
    const { data: prefs } = await db.rpc('get_my_preferences');
    if(prefs) userPrefs = prefs;
  } catch(e) { /* garde les défauts */ }
  sfRefreshTopnav();
}

// Etat du bandeau qui depend du profil : acces Utilisateurs et initiales.
function sfRefreshTopnav() {
  const isAdmin = currentProfile?.role === 'admin' || currentUser?.email === ADMIN_EMAIL;

  // « Utilisateurs » est sorti des Parametres en phase 4 : c'est une fonction
  // d'administration, pas un reglage. Le masquage DOM n'est qu'un confort —
  // la vraie barriere reste renderAdmin(), qui refuse un non-admin, et les
  // policies RLS cote Supabase. Ne jamais compter sur ce style:none seul.
  const btnUsers = document.getElementById('nav-admin-users');
  const sep = document.getElementById('sf-sep-admin');
  if(btnUsers) btnUsers.style.display = isAdmin ? '' : 'none';
  if(sep) sep.style.display = isAdmin ? '' : 'none';

  // Initiales : prenom + nom, a defaut la premiere lettre de l'e-mail.
  const av = document.getElementById('sf-avatar');
  if(av) {
    const p = (currentProfile?.prenom || '').trim();
    const n = (currentProfile?.nom || '').trim();
    const ini = (p[0] || '') + (n[0] || '');
    av.textContent = (ini || (currentUser?.email || '?')[0] || '?').toUpperCase();
    const nom = [p, n].filter(Boolean).join(' ') || currentUser?.email || 'Mon compte';
    av.parentElement?.setAttribute('title', nom);
    av.parentElement?.setAttribute('aria-label', 'Mon compte — ' + nom);
  }

  // Le panneau des reglages depend du role : il se reconstruit ici, apres que
  // le profil est connu, et jamais avant.
  sfBuildParamsMenu();
}

// Raccourci vers la section Compte des Parametres. renderParametres lit le
// hash au montage : on le pose avant de naviguer.
function sfGoCompte() { sfGoParam('compte'); }

// Ouvre une section precise des Parametres depuis le bandeau.
function sfGoParam(id) {
  history.replaceState(null, '', '#parametres/' + id);
  sfCloseMenus();
  if(currentPage === 'parametres') renderParametres(document.getElementById('content'));
  else navigate('parametres');
}

// Panneau de la roue dentee, CONSTRUIT DEPUIS PARAMS_SECTIONS.
// L'ecrire en dur dans index.html aurait cree une seconde liste a maintenir,
// qui aurait fini par diverger de la page — et, plus grave, par diverger de
// son cloisonnement admin. Ici la meme source nourrit les deux.
// NB : ce filtrage n'est qu'un confort de lecture. La vraie garde est dans
// renderParamsSection(), qui refuse de rendre une section admin a un non-admin
// meme par URL directe, et les policies RLS cote Supabase.
function sfBuildParamsMenu() {
  const p = document.getElementById('panel-param');
  if(!p || typeof PARAMS_SECTIONS === 'undefined') return;
  const isAdmin = currentProfile?.role === 'admin' || currentUser?.email === ADMIN_EMAIL;

  p.innerHTML = PARAMS_SECTIONS
    .filter(f => !f.adminOnly || isAdmin)
    .map(f => {
      const items = f.items.filter(i => !i.adminOnly || isAdmin);
      if(!items.length) return '';
      return `<div class="sf-menu__group">${esc(f.family)}</div>` + items.map(i => {
        const soon = i.status === 'soon';
        // Une section « Bientot » reste visible mais inerte : la masquer
        // priverait l'utilisateur de la carte du produit.
        return `<button class="sf-menu__row" role="menuitem" type="button"
          ${soon ? 'aria-disabled="true"' : `onclick="sfGoParam('${i.id}')"`}>
          <span class="ic" aria-hidden="true">${sfIcon(i.icon)}</span>
          <span class="lab">${esc(i.label)}</span>
          ${soon ? '<span class="sf-menu__soon">Bientôt</span>' : ''}
        </button>`;
      }).join('');
    }).join('');
}

// ───────────────────────────────────────────────────────
//   GESTION UTILISATEURS — V2 (sans password en clair)
// ───────────────────────────────────────────────────────
let adminUsersFilter = 'all'; // 'all' | 'active' | 'pending' | 'disabled'

// Génère les lignes du tableau utilisateurs
function buildUserRowsHtml(users, myEmail) {
  if(!users || !users.length) {
    return '<tr><td colspan="7" style="padding:32px;text-align:center;color:var(--sf-text-3);font-size:13px">Aucun utilisateur dans cette catégorie</td></tr>';
  }
  return users.map(function(u) {
    var isMe = u.email === myEmail;
    var fullName = esc([u.first_name, u.last_name].filter(Boolean).join(' ') || '—');
    var statusCls = u.status === 'active' ? 'active' : u.status === 'pending' ? 'pending' : 'disabled';
    var statusLabel = u.status === 'active' ? sfAccIcon("ok",13)+' Actif'
      : u.status === 'pending' ? sfAccIcon("horloge",13)+' En attente'
      : sfAccIcon("interdit",13)+' Archivé';
    var meBadge = isMe ? '<span style="font-size:9px;background:var(--accent);color:white;padding:1px 6px;border-radius:4px;font-weight:700;margin-left:6px">MOI</span>' : '';
    var roleLabel = u.role === 'admin' ? sfAccIcon("couronne",13)+' Admin' : sfAccIcon("user",13)+' Utilisateur';
    var roleCls = u.role === 'admin' ? 'role-badge admin' : 'role-badge user';
    var bg = isMe ? 'background:var(--sf-brand-wash)' : 'background:var(--sf-surface)';
    var dateInscription = u.created_at ? new Date(u.created_at).toLocaleDateString('fr-FR') : '—';

    // Actions selon le statut
    var actions = [];
    if(isMe) {
      actions.push('<span style="font-size:11px;color:var(--sf-text-3);font-style:italic">Mon compte</span>');
    } else if(u.status === 'pending') {
      // En attente : valider l'accès OU renvoyer l'invitation
      actions.push('<button class="admin-action-btn is-validate admin-validate-btn" data-id="'+u.id+'" data-email="'+esc(u.email)+'" aria-label="Valider l\'accès" title="Activer le compte"><span class="ic">'+sfAccIcon("check",14)+'</span> Valider</button>');
      actions.push('<button class="admin-action-btn is-resend admin-resend-btn" data-email="'+esc(u.email)+'" data-fn="'+esc(u.first_name||'')+'" data-ln="'+esc(u.last_name||'')+'" data-role="'+u.role+'" aria-label="Renvoyer l\'invitation" title="Renvoyer un email d\'invitation"><span class="ic">'+sfAccIcon("envoi",14)+'</span> Renvoyer</button>');
    } else if(u.status === 'active') {
      // Actif : envoyer reset password OU archiver
      actions.push('<button class="admin-action-btn is-reset admin-resetpwd-btn" data-email="'+esc(u.email)+'" aria-label="Envoyer un email de réinitialisation de mot de passe" title="Envoyer un email de réinitialisation"><span class="ic">'+sfAccIcon("cle",14)+'</span> Reset</button>');
      actions.push('<button class="admin-action-btn is-disable admin-disable-btn" data-id="'+u.id+'" aria-label="Archiver l\'utilisateur" title="Archiver"><span class="ic">'+sfAccIcon("interdit",14)+'</span> Archiver</button>');
    } else if(u.status === 'disabled') {
      // Archivé : réactiver
      actions.push('<button class="admin-action-btn is-enable admin-enable-btn" data-id="'+u.id+'" aria-label="Réactiver le compte" title="Réactiver le compte"><span class="ic">'+sfAccIcon("ok",14)+'</span> Réactiver</button>');
    }
    var actionHtml = '<div class="admin-actions-cell">' + actions.join('') + '</div>';

    return '<tr style="'+bg+'">'
      + '<td style="padding:12px 14px;font-size:13px;font-weight:600;border-bottom:1px solid var(--sf-border)">'+fullName+meBadge+'</td>'
      + '<td style="padding:12px 14px;font-size:12px;color:var(--sf-text-2);border-bottom:1px solid var(--sf-border)">'+esc(u.email)+'</td>'
      + '<td style="padding:12px 14px;font-size:12px;color:var(--sf-text-2);border-bottom:1px solid var(--sf-border)">'+esc(u.phone||'—')+'</td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid var(--sf-border)"><span class="'+roleCls+'">'+roleLabel+'</span></td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid var(--sf-border)"><span class="status-badge '+statusCls+'">'+statusLabel+'</span></td>'
      + '<td style="padding:12px 14px;font-size:11px;color:var(--sf-text-2);border-bottom:1px solid var(--sf-border)">'+dateInscription+'</td>'
      + '<td style="padding:12px 14px;border-bottom:1px solid var(--sf-border)">'+actionHtml+'</td>'
      + '</tr>';
  }).join('');
}

// Délégation d'événements pour les boutons admin
document.addEventListener('click', function(e) {
  var disBtn      = e.target.closest('.admin-disable-btn');
  var enBtn       = e.target.closest('.admin-enable-btn');
  var validateBtn = e.target.closest('.admin-validate-btn');
  var resendBtn   = e.target.closest('.admin-resend-btn');
  var resetBtn    = e.target.closest('.admin-resetpwd-btn');
  if(disBtn) adminDisableUser(disBtn.dataset.id);
  if(enBtn) adminEnableUser(enBtn.dataset.id);
  if(validateBtn) adminValidateUser(validateBtn.dataset.id, validateBtn.dataset.email);
  if(resendBtn) adminResendInvite(resendBtn.dataset.email, resendBtn.dataset.fn, resendBtn.dataset.ln, resendBtn.dataset.role);
  if(resetBtn) adminSendResetPwd(resetBtn.dataset.email);
});


// ── Page principale "Gestion utilisateurs" ──
async function renderAdmin(el) {
  const isAdmin = currentProfile?.role === 'admin' || currentUser?.email === ADMIN_EMAIL;
  if(!isAdmin) {
    el.innerHTML = `<div class="empty-state"><h3>${sfAccIcon('lock',20)} Accès refusé</h3><p>Cette section est réservée aux administrateurs.</p></div>`;
    return;
  }

  el.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement des utilisateurs...</div>`;

  let users = [];
  try {
    const { data, error } = await db.from('profiles').select('*').order('created_at', { ascending: true });
    if(error) throw error;
    users = data || [];
  } catch(e) {
    el.innerHTML = `<div class="empty-state"><h3>Erreur de chargement</h3><p>${e.message}</p><p style="font-size:11px;color:var(--c-muted);margin-top:8px">Reconnectez-vous pour rafraîchir votre session.</p></div>`;
    return;
  }

  // KPIs
  const total    = users.length;
  const active   = users.filter(u => u.status === 'active').length;
  const pending  = users.filter(u => u.status === 'pending').length;
  const disabled = users.filter(u => u.status === 'disabled').length;
  const admins   = users.filter(u => u.role === 'admin').length;

  // Filtre actif
  const filtered = adminUsersFilter === 'all' ? users : users.filter(u => u.status === adminUsersFilter);
  const myEmail = currentUser?.email || '';

  el.innerHTML = `
    <div class="admin-hero">
      <div>
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.6;margin-bottom:4px">Admin</div>
        <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px">Gestion des utilisateurs</div>
        <div style="font-size:13px;opacity:0.65;margin-top:4px">Invitez et modérez les accès à Stonefolio</div>
      </div>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div class="admin-hero-stat"><div class="admin-hero-num">${total}</div><div class="admin-hero-lbl">Total</div></div>
        <div class="admin-hero-stat"><div class="admin-hero-num" style="color:var(--sf-gain)">${active}</div><div class="admin-hero-lbl">Actifs</div></div>
        <div class="admin-hero-stat"><div class="admin-hero-num" style="color:var(--sf-alert)">${pending}</div><div class="admin-hero-lbl">En attente</div></div>
        <div class="admin-hero-stat"><div class="admin-hero-num" style="color:var(--sf-info)">${admins}</div><div class="admin-hero-lbl">Admins</div></div>
      </div>
    </div>

    <!-- Formulaire d'invitation -->
    <div class="invite-form-card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:700;color:var(--c-text)">${sfAccIcon('envoi',16)} Inviter un nouvel utilisateur</div>
          <div style="font-size:12px;color:var(--c-dim);margin-top:3px">Un email d'invitation sera envoyé. L'utilisateur définira lui-même son mot de passe.</div>
        </div>
      </div>
      <div class="invite-form-grid">
        <div class="form-group">
          <label class="form-label">Prénom <span style="color:var(--sf-loss)">*</span></label>
          <input class="form-input" id="invite-prenom" placeholder="Marie" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">Nom <span style="color:var(--sf-loss)">*</span></label>
          <input class="form-input" id="invite-nom" placeholder="Dupont" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">Adresse email <span style="color:var(--sf-loss)">*</span></label>
          <input class="form-input" id="invite-email" type="email" placeholder="marie.dupont@gmail.com" autocomplete="off">
        </div>
        <div class="form-group">
          <label class="form-label">Rôle</label>
          <select class="form-select" id="invite-role" style="width:100%">
            <option value="user">Utilisateur — accès à son espace uniquement</option>
            <option value="admin">Admin — accès complet + gestion des utilisateurs</option>
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Notes (optionnel)</label>
          <textarea class="form-input" id="invite-notes" rows="2" style="resize:vertical;font-family:inherit" placeholder="Ex : Investisseur partenaire de l'agence Lyon Nord"></textarea>
        </div>
      </div>
      <div style="background:rgba(23,160,107,0.06);border:1px solid rgba(23,160,107,0.15);border-radius:8px;padding:10px 14px;margin-top:14px;font-size:12px;color:var(--c-dim);display:flex;gap:10px;align-items:flex-start">
        <span class="adm-info-ic">${sfAccIcon('info',16)}</span>
        <span>L'utilisateur recevra un email de bienvenue avec un lien sécurisé. Il définira lui-même son mot de passe en cliquant sur ce lien. Aucun mot de passe n'est jamais visible pour vous.</span>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary" id="btn-invite-send" onclick="adminInviteUser()" style="padding:10px 20px">
          ${sfAccIcon('envoi',14)} Envoyer l'invitation
        </button>
      </div>
    </div>

    <!-- Liste des utilisateurs -->
    <div style="background:var(--sf-surface);border-radius:14px;box-shadow:var(--c-shadow);padding:20px;margin-top:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:14px">
        <div style="font-size:14px;font-weight:700;color:var(--c-text)">${sfAccIcon('doc',16)} Utilisateurs enregistrés</div>
        <div class="mf-filter-pills">
          <button class="mf-filter-pill ${adminUsersFilter==='all'?'active':''}" onclick="setAdminUsersFilter('all')">
            Tous <span class="count">${total}</span>
          </button>
          <button class="mf-filter-pill ${adminUsersFilter==='active'?'active':''}" onclick="setAdminUsersFilter('active')">
            ${sfAccIcon('ok',13)} Actifs <span class="count">${active}</span>
          </button>
          <button class="mf-filter-pill ${adminUsersFilter==='pending'?'active':''}" onclick="setAdminUsersFilter('pending')">
            ${sfAccIcon('horloge',13)} En attente <span class="count">${pending}</span>
          </button>
          <button class="mf-filter-pill ${adminUsersFilter==='disabled'?'active':''}" onclick="setAdminUsersFilter('disabled')">
            ${sfAccIcon('interdit',13)} Archivés <span class="count">${disabled}</span>
          </button>
        </div>
      </div>
      <div class="users-table-wrap">
        <table style="width:100%;border-collapse:collapse;background:var(--sf-surface)">
          <thead>
            <tr style="background:var(--sf-surface-2)">
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Nom</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Email</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Téléphone</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Rôle</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Statut</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Inscription</th>
              <th style="text-align:left;padding:10px 14px;font-size:11px;font-weight:700;color:var(--sf-text-2);text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--sf-border)">Actions</th>
            </tr>
          </thead>
          <tbody>${buildUserRowsHtml(filtered, myEmail)}</tbody>
        </table>
      </div>
    </div>`;
}

function setAdminUsersFilter(f) {
  adminUsersFilter = f;
  renderAdmin(document.getElementById('content'));
}

// ── Inviter un nouvel utilisateur ──
async function adminInviteUser() {
  const prenom = document.getElementById('invite-prenom')?.value?.trim();
  const nom    = document.getElementById('invite-nom')?.value?.trim();
  const email  = document.getElementById('invite-email')?.value?.trim().toLowerCase();
  const role   = document.getElementById('invite-role')?.value || 'user';
  const notes  = document.getElementById('invite-notes')?.value?.trim();

  if(!prenom) { showNotif('Saisissez un prénom', true); return; }
  if(!nom)    { showNotif('Saisissez un nom', true); return; }
  if(!email || !/\S+@\S+\.\S+/.test(email)) { showNotif('Email invalide', true); return; }

  const btn = document.getElementById('btn-invite-send');
  if(btn) { btn.disabled = true; btn.innerHTML = '<span class="sci-spinner"></span>Envoi en cours...'; }

  try {
    // Appel de l'Edge Function admin-invite-user
    const { data, error } = await db.functions.invoke('admin-invite-user', {
      body: { email, firstName: prenom, lastName: nom, role, notes: notes || null }
    });
    if(error) {
      // Récupérer le message d'erreur de la function
      let msg = error.message || 'Erreur inconnue';
      try {
        const ctx = error.context || {};
        if(ctx.body) {
          const parsed = typeof ctx.body === 'string' ? JSON.parse(ctx.body) : ctx.body;
          if(parsed.error) msg = parsed.error;
        }
      } catch {}
      throw new Error(msg);
    }
    if(data?.error) throw new Error(data.error);

    const message = data?.alreadyRegistered
      ? (data.message || 'Mail de réinitialisation envoyé à ' + email)
      : (data?.message || 'Invitation envoyée à ' + email);
    showNotif(message);

    // Reset du formulaire
    ['invite-prenom','invite-nom','invite-email','invite-notes'].forEach(id => {
      const e = document.getElementById(id); if(e) e.value = '';
    });
    document.getElementById('invite-role').value = 'user';

    // Recharger la liste
    renderAdmin(document.getElementById('content'));
  } catch(e) {
    console.error('[admin-invite]', e);
    showNotif('Erreur : ' + e.message, true);
  } finally {
    if(btn) { btn.disabled = false; btn.innerHTML = sfAccIcon("envoi",14)+' Envoyer l\'invitation'; }
  }
}

// ── Renvoyer une invitation existante ──
async function adminResendInvite(email, firstName, lastName, role) {
  if(!email) return;
  if(!confirm('Renvoyer un email d\'invitation à ' + email + ' ?')) return;
  try {
    const { data, error } = await db.functions.invoke('admin-invite-user', {
      body: { email, firstName, lastName, role: role || 'user' }
    });
    if(error || data?.error) throw new Error(data?.error || error.message);
    showNotif('Invitation renvoyée à ' + email);
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Envoyer un reset password depuis l'admin ──
async function adminSendResetPwd(email) {
  if(!email) return;
  if(!confirm('Envoyer un email de réinitialisation de mot de passe à ' + email + ' ?')) return;
  try {
    const redirectTo = window.location.href.split('#')[0];
    const { error } = await db.auth.resetPasswordForEmail(email, { redirectTo });
    if(error) throw error;
    showNotif('Email de réinitialisation envoyé à ' + email);
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Valider l'accès d'un user pending ──
async function adminValidateUser(profileId, email) {
  if(!profileId) return;
  if(!confirm('Activer l\'accès de ' + (email || 'cet utilisateur') + ' ?')) return;
  try {
    const { error } = await db.rpc('admin_set_user_status', { p_profile_id: profileId, p_status: 'active' });
    if(error) throw error;
    showNotif('Accès activé pour ' + email);
    renderAdmin(document.getElementById('content'));
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Désactiver un user ──
async function adminDisableUser(profileId) {
  if(!confirm('Archiver cet utilisateur ? Il ne pourra plus se connecter.')) return;
  try {
    const { error } = await db.rpc('admin_disable_user', { p_profile_id: profileId });
    if(error) throw error;
    showNotif('Utilisateur archivé');
    renderAdmin(document.getElementById('content'));
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Réactiver un user ──
async function adminEnableUser(profileId) {
  try {
    const { error } = await db.rpc('admin_enable_user', { p_profile_id: profileId });
    if(error) throw error;
    showNotif('Utilisateur réactivé');
    renderAdmin(document.getElementById('content'));
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}


async function init() {
  checkRecoveryHash();
  // Erreur OAuth au retour de Google (ex : signup bloqué par trg_block_external_signup)
  const oauthError = checkOAuthErrorInUrl();
  if(oauthError) {
    document.getElementById('auth-screen').style.display = 'flex';
    showForm('login');
    showAuthAlert(oauthError, 'error');
    return;
  }
  db.auth.onAuthStateChange(async (event, session) => {
    if(event === 'SIGNED_OUT') { currentUser = null; return; }
    // Si Supabase parse un lien recovery alors qu'on était déjà sur le site
    if(event === 'PASSWORD_RECOVERY') {
      document.getElementById('auth-screen').style.display = 'flex';
      showForm('newpwd');
      const titleEl = document.querySelector('#form-newpwd .auth-welcome h2');
      const subEl   = document.querySelector('#form-newpwd .auth-welcome p');
      if(titleEl) titleEl.textContent = '🔐 Nouveau mot de passe';
      if(subEl)   subEl.textContent   = 'Définissez un nouveau mot de passe pour votre compte.';
    }
  });
  try {
    const { data: { session }, error } = await db.auth.getSession();
    if (error) throw error;
    if (session?.user) {
      // Contrôle pending/disabled aussi ici : couvre le retour de connexion
      // Google (la session arrive par redirection, sans passer par doLogin)
      if(!(await ensureProfileActive())) {
        document.getElementById('auth-screen').style.display = 'flex';
        const form = document.getElementById('form-login');
        if(form) form.style.display = 'block';
        return;
      }
      await onAuthSuccess(session.user);
    } else {
      document.getElementById('auth-screen').style.display = 'flex';
      showForm('login');
    }
  } catch(e) {
    console.warn('[Stonefolio] Session expirée:', e?.message);
    await db.auth.signOut().catch(() => {});
    document.getElementById('auth-screen').style.display = 'flex';
    showForm('login');
  }
}

async function loadAndStart() {
  // P2 : loyers, charges et locataires chargés dès le démarrage — le cashflow
  // réel s'affiche dans tout le pipeline, plus seulement dans le Module financier
  await Promise.all([loadBiens(), loadLocataires(), loadMfFinancialData()]);
  // Routage hash au démarrage : #parametres ou #parametres/section
  if (window.location.hash.startsWith('#parametres')) {
    navigate('parametres');
  } else {
    navigate('accueil');
  }
}

// Réagir aux changements de hash (navigation profonde / bouton retour)
window.addEventListener('hashchange', () => {
  if (window.location.hash.startsWith('#parametres')) {
    if (currentPage !== 'parametres') navigate('parametres');
    else renderParametres(document.getElementById('content'));
  }
});

async function loadBiens() {
  if(!currentUser) return;
  // Filtre user_id explicite côté client (défense en profondeur en plus du RLS)
  const { data, error } = await db.from('biens')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { showNotif('Erreur connexion : '+error.message, true); return; }
  allBiens = data || [];
  // data-manager is now in settings panel
}


// ── CASHFLOW ──
// Cashflow PRÉVISIONNEL mensuel — seule formule de prévisionnel de l'app (P2).
// mfCashflowPrevisionnel délègue ici : ne jamais réintroduire de copie.
function computeCF(b) {
  const loyer = (parseFloat(b.loyer_en_etat)||0) + (parseFloat(b.charges_locataire_etat)||0);
  const ch = (parseFloat(b.mensualite_credit)||0)+(parseFloat(b.charge_copro)||0)+(parseFloat(b.assurance_logement)||0)+(parseFloat(b.taxe_fonciere)||0);
  return loyer - ch;
}

// ── INFORMATIONS ESSENTIELLES ────────────────────────────────────────────────
// Sans l'une d'elles, un bien ne peut pas être chiffré honnêtement.
//
// Cette liste fait autorité pour TOUTE la plateforme : la page « Mes biens »
// écarte ces fiches de ses indicateurs, la fiche affiche « — » sur les valeurs
// absentes, et l'accueil les remonte dans « À traiter ». Trois écrans, une
// seule définition — sinon ils finiraient par ne plus être d'accord sur ce
// qu'est une fiche complète.
const SF_ESSENTIELS = [
  { k:'prix_affiche',  lab:'Prix',   num:true  },
  { k:'loyer_en_etat', lab:'Loyer',  num:true  },
  { k:'statut',        lab:'Statut', num:false },
  { k:'ville',         lab:'Ville',  num:false },
];
function sfManquants(b) {
  return SF_ESSENTIELS.filter(c => {
    const v = b[c.k];
    if(v == null || v === '') return true;
    return c.num ? !((parseFloat(v) || 0) > 0) : false;
  });
}
function sfBienComplet(b) { return sfManquants(b).length === 0; }

// ── P2 : quel cashflow afficher pour un bien ──
// « Acheté » avec loyers saisis → réel (moyenne mensuelle sur 12 mois), prévisionnel en rappel.
// Fiche à qui il manque une information essentielle → AUCUN chiffre.
// Autres statuts               → prévisionnel, étiqueté comme tel.
function cfDisplayData(b) {
  const prev = computeCF(b);
  const hasPrev = !!(b.mensualite_credit || b.loyer_en_etat);
  const acquis = b.statut === 'Acheté';
  const manque = sfManquants(b);
  const hasLoyers = acquis && allLoyers.some(l =>
    l.bien_id === b.id && (l.statut === 'Payé' || l.statut === 'Partiel')
    && (parseFloat(l.montant_encaisse) || 0) > 0);
  // Le réel prime : quand les loyers sont encaissés, le cashflow est constaté,
  // même si la fiche reste incomplète par ailleurs.
  if(hasLoyers) return { mode:'reel', value: mfCashflowReel12M(b).cashflow / 12, prev, hasPrev, attenteReel:false, manque };
  // ⚠️ Sans loyer estimé, `computeCF` retranche les charges d'un loyer nul et
  // sort un gros négatif : la plateforme déclarait « Déficitaire » une fiche
  // dont le loyer n'avait jamais été saisi. Une donnée manquante n'est pas une
  // conclusion — on ne chiffre pas.
  if(manque.length) return { mode:'incomplet', value:null, prev, hasPrev, attenteReel:false, manque };
  return { mode:'previsionnel', value: hasPrev ? prev : null, prev, hasPrev, attenteReel: acquis, manque };
}
function fmt(n){return Math.round(n).toLocaleString('fr-FR');}

// Montant et pourcentage avec l'ESPACE FINE INSECABLE U+202F devant l'unite.
// Une espace ordinaire laisse le « € » ou le « % » passer seul a la ligne quand
// la colonne se resserre — le nombre et son unite se retrouvent separes.
function sfEur(n){ return fmt(n) + ' €'; }
function sfPct(v){ return v + ' %'; }
// ⚠️ `sfPct` attend une valeur DEJA mise en forme : il ne fait que coller
// l'espace fine et le signe. Un nombre brut y passerait tel quel
// (« 0.5126582278481 % »). Pour un resultat de calcul, passer par celui-ci, qui
// arrondit et pose la virgule francaise. Retourne « non disponible » et jamais
// 0 quand la valeur ne l'est pas : un indicateur incalculable n'est pas nul.
function sfPctNum(v, dec = 2){
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return 'non disponible';
  // `minimumFractionDigits:0` : les decimales nulles tombent. « 0 % » et non
  // « 0,00 % », « 33 % » et non « 33,00 % » — c'est ce que montre la maquette,
  // et une decimale a zero n'apporte aucune precision.
  return sfPct(Number(v).toLocaleString('fr-FR',
    { minimumFractionDigits: 0, maximumFractionDigits: dec }));
}
// Petits nombres en toutes lettres dans une PHRASE — « Deux de vos 3 biens »
// melait les deux registres. Au-dela de neuf, le chiffre reste plus lisible.
// `majuscule` sert quand le nombre ouvre la phrase.
const SF_LETTRES = ['zéro','un','deux','trois','quatre','cinq','six','sept','huit','neuf'];
function sfNombreEnLettres(n, majuscule = false){
  const m = SF_LETTRES[n];
  if (m === undefined) return String(n);
  return majuscule ? m.charAt(0).toUpperCase() + m.slice(1) : m;
}
function cfCls(cf){return cf>0?'positive':cf<0?'negative':'neutral';}
// Échappement HTML global (réutilisable partout)
function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// URL destinee a un href. `esc()` ne suffit pas ici : il rend l'URL inoffensive
// pour l'ANALYSE HTML, mais `javascript:alert(1)` reste une URL valide une fois
// echappee, et s'execute au clic.
//
// Deux sources alimentent ces liens : le lien d'annonce saisi par
// l'utilisateur, et surtout les URL d'articles renvoyees par NewsAPI — une
// donnee tierce que nous ne controlons pas. Seuls http et https passent ; tout
// le reste retombe sur '#'.
function safeUrl(u){
  const s = (u == null ? '' : String(u)).trim();
  return /^https?:\/\//i.test(s) ? esc(s) : '#';
}
// Date d'action (YYYY-MM-DD) → format FR court, neutre au fuseau
function fmtActionDate(d){ if(!d) return '—'; const dt=new Date(d+'T12:00:00'); return isNaN(dt)?d:dt.toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}); }

// ── ACCUEIL ──
// ═══════════════════════════════════════════════════════════════
//   ECRAN D'ACCUEIL — phase 5
// ═══════════════════════════════════════════════════════════════
// Parti arrete avec Thomas : « l'ecran du matin ». La page repond AVANT de
// decrire — un verdict en une phrase, puis ce qui demande une action.
// Remplace l'ancien tableau de bord et ses 11 indicateurs.
//
// Chaque point d'attention dit CE QUI SE PASSE, POURQUOI c'est un probleme,
// et porte L'ACTION qui le resout. Un point sans action est une inquietude
// sans issue : on ne l'affiche pas.

// ═══════════════════════════════════════════════════════════════════════════
//   JEU D'ICONES UNIQUE DE STONEFOLIO
// ═══════════════════════════════════════════════════════════════════════════
// Il existait TROIS jeux separes — celui-ci pour l'accueil, `SF_PARAM_ICONS`
// pour les Parametres, et des <svg> ecrits en ligne au fil des ecrans. Trois
// jeux, c'est trois dessins possibles pour la meme idee : la « banque » n'avait
// deja pas le meme trait selon l'ecran. Tout passe desormais par ici.
//
// Conventions : trait de 1,9, viewBox 24, `currentColor` — donc l'icone suit la
// couleur du texte, ce qu'un emoji ne fait jamais.
const SF_ACC_ICONS = {
  maison:  '<path d="M3 21h18M6 21V9l6-5 6 5v12M10 21v-5h4v5"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  doc:     '<path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M19 8v11a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7Z"/><path d="M9 13h6M9 17h4"/>',
  graph:   '<path d="M12 20V10M18 20V4M6 20v-6"/>',
  banque:  '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 9.5V19M9.8 9.5V19M14.2 9.5V19M18.5 9.5V19"/><path d="M3 21h18"/>',
  plus:    '<path d="M12 5v14M5 12h14"/>',
  check:   '<path d="M20 6 9 17l-5-5"/>',
  loupe:   '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  credit:  '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  agenda:  '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  alerte:  '<path d="M12 8v5"/><circle cx="12" cy="16.5" r=".6" fill="currentColor"/><path d="M10.3 3.6 2.5 17.2A2 2 0 0 0 4.2 20h15.6a2 2 0 0 0 1.7-2.8L13.7 3.6a2 2 0 0 0-3.4 0Z"/>',
  ok:      '<circle cx="12" cy="12" r="9"/><path d="m8.5 12.2 2.4 2.4 4.6-4.8"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  // Ajoutees pour les colonnes du kanban, qui portaient des emojis.
  echange: '<path d="M7 8h11l-3-3"/><path d="M17 16H6l3 3"/>',
  pin:     '<path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>',

  // ── Reprises de SF_PARAM_ICONS, desormais fondu ici ──────────────────────
  user:    '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c0-3.6 3.2-5.6 7.5-5.6s7.5 2 7.5 5.6"/>',
  lock:    '<rect x="4" y="10.5" width="16" height="10" rx="2.2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  bell:    '<path d="M18 8.6a6 6 0 1 0-12 0c0 5.2-2 6.4-2 6.4h16s-2-1.2-2-6.4"/><path d="M13.7 19a2 2 0 0 1-3.4 0"/>',
  palette: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" opacity=".35"/>',
  sliders: '<path d="M5 20v-7M5 9V4M12 20v-9M12 7V4M19 20v-5M19 11V4"/><path d="M2.5 13h5M9.5 7h5M16.5 15h5"/>',
  plug:    '<path d="M9 3v6M15 3v6"/><path d="M6.5 9h11v3a5.5 5.5 0 0 1-11 0Z"/><path d="M12 17.5V21"/>',
  data:    '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
  bank:    '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 9.5V19M9.8 9.5V19M14.2 9.5V19M18.5 9.5V19"/><path d="M3 21h18"/>',
  wrench:  '<path d="M15.5 4.5a5 5 0 0 0-6.4 6.4L4 16l4 4 5.1-5.1a5 5 0 0 0 6.4-6.4L16.6 9.4 14.6 7.4Z"/>',
  info:    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5"/><circle cx="12" cy="7.9" r=".7" fill="currentColor" stroke="none"/>',

  // ── Actions, etats vides et titres de section (lots 2b / 2c) ─────────────
  crayon:   '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/>',
  poubelle: '<path d="M4 7h16"/><path d="M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2"/><path d="M6.5 7l.8 12a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-12"/><path d="M10.5 11v6M13.5 11v6"/>',
  croix:    '<path d="M6 6l12 12M18 6 6 18"/>',
  envoi:    '<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/><path d="M4 20h16"/>',
  interdit: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  mallette: '<rect x="3" y="7.5" width="18" height="12.5" rx="2"/><path d="M9 7.5V6a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1.5"/><path d="M3 13h18"/>',
  image:    '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 17 5-4.5 4.5 4 3-2.5L20 18"/>',
  trombone: '<path d="M20 11.5 12 19.4a5 5 0 0 1-7.1-7.1l8.5-8.4a3.3 3.3 0 0 1 4.7 4.7l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.6"/>',
  couronne: '<path d="M4 18h16"/><path d="M3 7l4 4 5-6 5 6 4-4-2 8H5L3 7Z"/>',
  boite:    '<path d="M3 8.5 12 4l9 4.5v7L12 20l-9-4.5v-7Z"/><path d="m3 8.5 9 4.5 9-4.5M12 13v7"/>',
  balance:  '<path d="M12 4v16M7 20h10"/><path d="M4 8h16"/><path d="M4 8 1.5 14a2.8 2.8 0 0 0 5 0L4 8Z"/><path d="M20 8l-2.5 6a2.8 2.8 0 0 0 5 0L20 8Z"/>',
  ampoule:  '<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5.9 1.1 1 1.6h5c.1-.5.4-1.1 1-1.6A6 6 0 0 0 12 3Z"/>',
  etoile:   '<path d="m12 3.5 2.6 5.5 5.9.8-4.3 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.5 9.8l5.9-.8L12 3.5Z"/>',
  bulle:    '<path d="M20 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-4.6A7.5 7.5 0 1 1 20 12.5Z"/>',
  travaux:  '<path d="M3 9h18v6H3z"/><path d="m7 9 3 6M13 9l3 6"/><path d="M4 19h16M4 5h16"/>',

  // ── Onglets de la fiche bien ─────────────────────────────────────────────
  euro:    '<path d="M17.5 6.5A6.5 6.5 0 0 0 7 12a6.5 6.5 0 0 0 10.5 5.5"/><path d="M4.5 10.5h8M4.5 14h8"/>',
  carnet:  '<path d="M6.5 3h11a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-13A2.5 2.5 0 0 1 6.5 3Z"/><path d="M4 17.5h15"/><path d="M8.5 7.5h7"/>',
  cle:     '<circle cx="8" cy="12" r="4"/><path d="M12 12h9l-2.2 2.6M17.5 12v3"/>',
  colonne: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 9.5V19M9.8 9.5V19M14.2 9.5V19M18.5 9.5V19"/><path d="M3 21h18"/>',
  ville:   '<path d="M3 21h18"/><path d="M5 21V8l6-4v17"/><path d="M11 11h6a1 1 0 0 1 1 1v9"/><path d="M8 11v.01M8 15v.01M14 15v.01M14 18v.01"/>',
  gens:    '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.3 2.9-5.2 6.5-5.2s6.5 1.9 6.5 5.2"/><path d="M16.5 5.4a3.2 3.2 0 0 1 0 6.2M18 14.4c2.1.6 3.5 2 3.5 4.1"/>',

  // ── Remplacent les derniers caracteres hors police de la fiche bien ───────
  // Les fleches Unicode et les emojis tombent en police systeme : leur dessin
  // depend du systeme d'exploitation, pas de la charte.
  retour:  '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  lien:    '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/>',
  tel:     '<path d="M6.5 3.5h3l1.5 4-2 1.5a12 12 0 0 0 6 6L16.5 13l4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2Z"/>',
  mail:    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6 8.5-6"/>',
};
function sfAccIcon(n, t) {
  // Cle inconnue : on ne rend RIEN. La version precedente emettait un <svg>
  // vide, qui occupait sa largeur sans rien dessiner — un trou invisible a la
  // relecture du code mais bien visible a l'ecran.
  const d = SF_ACC_ICONS[n];
  if(!d) return '';
  return `<svg width="${t||17}" height="${t||17}" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// Detecteurs. Chacun ne produit un point QUE s'il se declenche reellement :
// le nombre affiche est donc toujours vrai, jamais une liste figee.
function sfPointsAttention() {
  const pts = [];
  const acquis      = allBiens.filter(b => b.statut === 'Acheté');
  const prospection = allBiens.filter(b => b.statut !== 'Acheté' && b.statut !== 'Abandonné');
  const now = new Date(), annee = now.getFullYear(), moisCourant = now.getMonth() + 1;
  const pl = (n, s, p) => n > 1 ? p : s;

  // 1. Du capital immobilise qui ne produit rien : le plus couteux.
  const sansLoc = acquis.filter(b => !allLocataires.some(l => l.bien_id === b.id && l.statut === 'Actif'));
  if (sansLoc.length) {
    const mensu = sansLoc.reduce((s, b) => s + (parseFloat(b.mensualite_credit) || 0), 0);
    pts.push({ rang: 0, type: 'loss', icone: 'maison',
      titre: `${sansLoc.length} bien${pl(sansLoc.length,'','s')} acquis sans locataire`,
      enjeu: mensu > 0
        ? `<strong class="sf-loss">−${fmt(mensu)} €</strong> de mensualités chaque mois, zéro loyer en face.`
        : `Aucun loyer en face de ${pl(sansLoc.length,'cette acquisition','ces acquisitions')}.`,
      action: 'Ajouter un locataire', cible: `navigate('module-financier')` });
  }

  /* 1 bis. Un bien acquis dont le MODE DE DÉTENTION n'est pas renseigné.
     Règle obligatoire du 12/08/2026 : tout bien passé en « Acheté » déclare
     s'il est détenu en propre ou via une SCI. La règle rend le cas impossible
     pour tout nouveau bien ; ce détecteur est le RATTRAPAGE DE L'EXISTANT —
     les biens acquis avant elle. Sans mode, ni les loyers ni les charges
     n'entrent dans une déclaration fiscale. */
  const sansMode = acquis.filter(b => !b.mode_detention);
  if (sansMode.length) {
    pts.push({ rang: 1, type: 'alert', icone: 'balance',
      titre: `${sansMode.length} bien${pl(sansMode.length,'','s')} sans mode de détention`,
      enjeu: `Ni les loyers ni les charges ${pl(sansMode.length,"de ce bien n'entrent","de ces biens n'entrent")} dans une déclaration tant que ce n'est pas renseigné.`,
      action: 'Renseigner', cible: `bdOpenMiseEnGestion('${sansMode[0].id}')` });
  }

  // 2. Loyers deja echus mais non pointes : le cashflow reel est fausse.
  const echus = allLoyers.filter(l =>
    l.annee === annee && l.mois < moisCourant && l.statut !== 'Payé');

  // Le filtre ci-dessus ecarte le mois EN COURS (`mois < moisCourant`), et il ne
  // voit que les lignes deja creees en base — or un loyer du mois courant n'a
  // souvent aucune ligne. Les retards du mois en cours viennent donc des loyers
  // ATTENDUS, deduits des baux actifs. Pas de double comptage : les deux
  // ensembles portent sur des mois disjoints.
  const retards = sfLoyersAttendus().filter(a => a.enRetard);
  const total = echus.length + retards.length;

  if (total) {
    const manque = echus.reduce((s, l) => s + (parseFloat(l.loyer_du) || 0), 0)
                 + retards.reduce((s, a) => s + a.montant, 0);
    const titre = !echus.length
      ? `${retards.length} loyer${pl(retards.length,'','s')} en retard`
      : retards.length
        ? `${total} loyers non pointés, dont ${retards.length} en retard`
        : `${echus.length} loyer${pl(echus.length,'','s')} échu${pl(echus.length,'','s')} non pointé${pl(echus.length,'','s')}`;
    pts.push({
      // Un loyer en retard passe devant les autres points : c'est de l'argent
      // attendu qui n'est pas arrive, pas seulement un chiffre fausse.
      rang: retards.length ? 0.5 : 1,
      type: retards.length ? 'loss' : '', icone: 'horloge',
      titre,
      enjeu: retards.length
        ? `<strong class="sf-loss">${fmt(manque)} €</strong> attendus et non encaissés.`
        : `Votre cashflow est sous-estimé de <strong>${fmt(manque)} €</strong>.`,
      action: 'Pointer', cible: `navigate('module-financier')` });
  }

  // 3. Sans charges, le cashflow parait MEILLEUR qu'il n'est — piege inverse
  //    du precedent, et bien plus trompeur.
  const chargesAnnee = allCharges.filter(c => String(c.date_charge || '').startsWith(String(annee)));
  if (acquis.length && !chargesAnnee.length) {
    pts.push({ rang: 2, type: 'info', icone: 'doc',
      titre: `Aucune charge saisie en ${annee}`,
      enjeu: `Votre cashflow paraît meilleur qu'il ne l'est.`,
      action: 'Saisir', cible: `navigate('module-financier')` });
  }

  // 4. Fiche a qui il manque une information essentielle : elle n'est pas
  //    chiffrable, et surtout elle est ECARTEE des indicateurs de « Mes biens ».
  //    Le detecteur s'appuie sur SF_ESSENTIELS, la meme liste que la page biens
  //    et la fiche — les trois ecrans ne peuvent donc pas etre en desaccord sur
  //    ce qu'est une fiche complete.
  const incompletes = allBiens.filter(b => b.statut !== 'Abandonné' && !sfBienComplet(b));
  if (incompletes.length) {
    // On nomme le champ le plus souvent absent : « complétez vos fiches » ne dit
    // pas quoi faire, « il manque le loyer » si.
    const compte = {};
    incompletes.forEach(b => sfManquants(b).forEach(c => { compte[c.lab] = (compte[c.lab]||0) + 1; }));
    const top = Object.entries(compte).sort((a,b) => b[1]-a[1])[0];
    pts.push({ rang: 3, type: 'info', icone: 'graph',
      titre: `${incompletes.length} fiche${pl(incompletes.length,'','s')} à compléter`,
      enjeu: `${pl(incompletes.length,'Elle est exclue','Elles sont exclues')} de vos indicateurs` +
             (top ? ` — il manque le plus souvent <strong>${esc(top[0].toLowerCase())}</strong>.` : '.'),
      action: 'Compléter', cible: `navigate('biens')` });
  }

  // 5. Un bien acquis sans mensualite faussee aussi le cashflow, dans l'autre sens.
  const sansMensu = acquis.filter(b => !((parseFloat(b.mensualite_credit) || 0) > 0));
  if (sansMensu.length) {
    pts.push({ rang: 4, type: 'info', icone: 'banque',
      titre: `${sansMensu.length} bien${pl(sansMensu.length,'','s')} acquis sans mensualité de crédit`,
      enjeu: `Leur cashflow est calculé comme s'ils étaient payés comptant.`,
      action: 'Renseigner', cible: `navigate('biens')` });
  }

  return pts.sort((a, b) => a.rang - b.rang);
}

// Loyers attendus des 60 prochains jours, deduits du jour de paiement du bail.
// Un loyer est POINTE quand il porte le statut « Payé ». Definition volontairement
// placee ici et nulle part ailleurs : l'agenda, sa case a cocher et le detecteur
// de retards doivent repondre la meme chose, sinon la case peut se decocher sans
// que le point a traiter disparaisse.
// « Partiel » n'est PAS considere comme pointe : il reste un solde du.
function sfLoyerPointe(ligne) {
  return !!ligne && ligne.statut === 'Payé';
}

// État d'une échéance de loyer, pour un mois donné d'une année donnée.
//
// ⚠️ CE QUE CETTE FONCTION CORRIGE : la matrice de la fiche bien déduisait
// l'état du seul `statut` de la ligne. Or `bdGenererLoyers` crée les DOUZE
// mois de l'année d'un coup, avec le statut « Impayé » par défaut. En août,
// septembre à décembre s'affichaient donc en rouge — des loyers déclarés
// impayés alors que leur échéance n'était pas arrivée. Un signal d'alerte qui
// se déclenche pour dix mois d'avance ne signale plus rien.
//
// La règle du retard est CELLE DE L'AGENDA, pas une seconde écrite à la main :
// un loyer dû le 5 n'est en retard que le 6, seuil suivant `jour_paiement`.
//
//   'ok'     payé              'part'   partiellement payé
//   'ko'     échu, non soldé   'avenir' échéance pas encore arrivée
//   'none'   rien en base
function sfLoyerEtat(ligne, mois, annee, locataire) {
  if (ligne && ligne.statut === 'Payé')    return 'ok';
  if (ligne && ligne.statut === 'Partiel') return 'part';

  const jour = Math.min(Math.max(parseInt(locataire?.jour_paiement, 10) || 5, 1), 28);
  const aujourdhui = new Date(); aujourdhui.setHours(0, 0, 0, 0);
  // Même seuil qu'à l'agenda : le lendemain de l'échéance.
  const limiteRetard = new Date(annee, mois - 1, jour + 1);
  if (aujourdhui < limiteRetard) return 'avenir';

  return ligne ? 'ko' : 'none';
}

// Loyers attendus, deduits des baux actifs et croises avec loyers_mensuels.
//
// Le calcul part du MOIS COURANT et non de la date du jour. L'ancienne version
// ecartait toute echeance passee (`if (d < aujourdhui) continue`) : un loyer
// oublie disparaissait donc de l'agenda le lendemain de son echeance, au moment
// precis ou il devenait interessant. On ne retire desormais une echeance passee
// que si elle a effectivement ete pointee.
function sfLoyersAttendus() {
  const out = [];
  const now = new Date();
  const aujourdhui = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fin = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 60);
  const MOIS = ['janv','févr','mars','avr','mai','juin','juil','août','sept','oct','nov','déc'];

  for (const loc of allLocataires) {
    if (loc.statut !== 'Actif' || !loc.bien_id) continue;
    const bien = allBiens.find(b => b.id === loc.bien_id);
    const jour = Math.min(Math.max(parseInt(loc.jour_paiement, 10) || 5, 1), 28);

    for (let i = 0; i < 3; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, jour);
      if (d > fin) continue;
      const mois = d.getMonth() + 1, annee = d.getFullYear();
      const ligne = mfFindLoyer(loc.bien_id, mois, annee) || null;
      const pointe = sfLoyerPointe(ligne);

      // Un jour de grace : un loyer du le 5 n'est en retard que le 6. Le seuil
      // suit `jour_paiement` au lieu d'etre fixe au 6 du mois, sans quoi un bail
      // paye le 28 serait declare en retard trois semaines trop tot.
      const limiteRetard = new Date(annee, mois - 1, jour + 1);
      const enRetard = !pointe && aujourdhui >= limiteRetard;

      // Echeance passee ET pointee : le sujet est clos, on ne l'affiche plus.
      if (d < aujourdhui && !enRetard) continue;

      out.push({
        bienId: loc.bien_id, locataireId: loc.id, mois, annee,
        jour: d.getDate(), moisCourt: MOIS[d.getMonth()], tri: d.getTime(),
        titre: `Loyer attendu — ${esc(bien?.titre || 'Bien')}`,
        meta: `${esc([loc.prenom, loc.nom].filter(Boolean).join(' ') || 'Locataire')} · le ${jour} de chaque mois`,
        // Le montant du fait foi quand la ligne existe : il peut porter un
        // prorata loi 1989 que le loyer de bail ne reflete pas.
        montant: ligne ? (parseFloat(ligne.loyer_du) || 0) : (parseFloat(loc.loyer_bail_hc) || 0),
        ligneId: ligne?.id || null, pointe, enRetard,
      });
    }
  }
  return out.sort((a, b) => a.tri - b.tri);
}

function sfAgenda60j() {
  return sfLoyersAttendus().slice(0, 6);
}

// Pointer un loyer directement depuis l'agenda.
//
// L'echeance affichee est CALCULEE a partir du bail : la ligne correspondante
// peut ne pas exister encore dans loyers_mensuels. Cocher la case doit donc
// pouvoir la creer, et pas seulement basculer un statut — sinon la case reste
// sans effet sur les mois jamais generes, ce qui est le cas courant.
//
// La creation passe par le meme upsert que le Suivi mensuel, avec la meme
// contrainte `user_id,bien_id,mois,annee` et le meme prorata loi 1989 : deux
// chemins d'ecriture divergents finiraient par produire deux montants dus
// differents pour le meme mois.
async function sfPointerLoyer(bienId, mois, annee, boite) {
  if (boite) boite.disabled = true;
  const today = new Date().toISOString().slice(0, 10);

  try {
    const ligne = mfFindLoyer(bienId, mois, annee);

    if (ligne) {
      const patch = sfLoyerPointe(ligne)
        ? { statut: 'En attente', montant_encaisse: null, date_encaissement: null }
        : { statut: 'Payé', montant_encaisse: ligne.loyer_du, date_encaissement: today };
      const { data, error } = await db.from('loyers_mensuels')
        .update(patch).eq('id', ligne.id).eq('user_id', currentUser.id)
        .select().maybeSingle();
      if (error) throw error;
      if (data) Object.assign(ligne, data);
      showNotif(patch.statut === 'Payé' ? '✓ Loyer pointé' : 'Pointage annulé');

    } else {
      const loc = mfLocataireForBienMonth(bienId, mois, annee);
      if (!loc) { showNotif('Aucun bail actif sur ce mois', true); return; }
      const prorata = mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, mois, annee, loc.date_entree, loc.date_sortie);
      if (prorata.montant === 0) { showNotif('Pas d\'occupation ce mois', true); return; }

      const { data, error } = await db.from('loyers_mensuels').upsert({
        user_id: currentUser.id, bien_id: bienId, locataire_id: loc.id,
        mois, annee,
        loyer_du: prorata.montant,
        charges_dues: parseFloat(loc.charges_bail) || 0,
        statut: 'Payé', montant_encaisse: prorata.montant, date_encaissement: today,
        notes: prorata.prorata ? `Prorata loi 1989 : ${prorata.jours}/${prorata.joursMois} jours` : null
      }, { onConflict: 'user_id,bien_id,mois,annee' }).select().maybeSingle();
      if (error) throw error;
      if (data) {
        const i = allLoyers.findIndex(l => l.id === data.id);
        if (i >= 0) allLoyers[i] = data; else allLoyers.push(data);
      }
      showNotif('Loyer pointé');
    }

    // Le pointage change le verdict, le compte des points a traiter et les KPI
    // de patrimoine : on redessine l'ecran entier plutot que la seule ligne.
    if (currentPage === 'accueil') renderAccueil(document.getElementById('content'));

  } catch (e) {
    showNotif('Erreur : ' + e.message, true);
    if (boite) { boite.checked = !boite.checked; boite.disabled = false; }
  }
}

function renderAccueil(el) {
  const acquis      = allBiens.filter(b => b.statut === 'Acheté');
  const prospection = allBiens.filter(b => b.statut !== 'Acheté' && b.statut !== 'Abandonné');

  // ── Patrimoine reel, memes helpers que le Module financier ──
  let patCF = 0, patLoyers = 0;
  for (const b of acquis) {
    const r = mfCashflowReel12M(b);
    patCF += r.cashflow;
    patLoyers += r.loyer_encaisse;
  }

  // Temps loue, en BIEN-MOIS sur 12 mois glissants : un bien loue 6 mois sur
  // 12 ne vaut pas un bien loue toute l'annee, ce qu'un comptage a l'instant t
  // ne saurait pas dire. Une ligne de loyer n'existe que pour un bail actif.
  const mois12 = mf12LastMonths();
  let bmLoues = 0;
  for (const b of acquis)
    for (const m of mois12)
      if (allLoyers.some(l => l.bien_id === b.id && l.mois === m.mois && l.annee === m.annee)) bmLoues++;
  const bmTotal = acquis.length * 12;
  const tauxLoue = bmTotal ? Math.round((bmLoues / bmTotal) * 100) : null;

  const sansLoyerProsp = prospection.filter(b => !((parseFloat(b.loyer_en_etat) || 0) > 0)).length;
  const pts = sfPointsAttention();
  const agenda = sfAgenda60j();
  const coutent = pts.filter(p => p.type === 'loss').length;
  const prenom = (currentProfile?.prenom || '').trim();
  const dateJour = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  const verdict = pts.length === 0
    ? { type:'ok', icone:'ok', txt:'Rien ne demande votre attention',
        sub:'Vos loyers sont pointés et vos fiches sont complètes.' }
    : { type:'alerte', icone:'alerte',
        txt:`${pts.length} point${pts.length>1?'s':''} demande${pts.length>1?'nt':''} votre attention`,
        sub: coutent
          ? `${coutent === 1 ? 'L\'un d\'eux vous coûte' : coutent + ' d\'entre eux vous coûtent'} de l'argent chaque mois${pts.length > coutent ? ' ; les autres faussent vos chiffres.' : '.'}`
          : `Aucun ne vous coûte d'argent — ils faussent vos chiffres.` };

  el.innerHTML = `
    <div class="acc-hello">
      <h1>Bonjour${prenom ? ' ' + esc(prenom) : ''}</h1>
      <span class="acc-date sf-num">${dateJour}</span>
    </div>

    <div class="acc-verdict acc-verdict--${verdict.type}">
      <span class="acc-verdict__ic">${sfAccIcon(verdict.icone, 20)}</span>
      <div>
        <div class="acc-verdict__txt">${verdict.txt}</div>
        <div class="acc-verdict__sub">${verdict.sub}</div>
      </div>
    </div>

    <div class="acc-bento">
      <section>
        <h2 class="acc-sec">À traiter <span class="acc-sec__n sf-num">${pts.length} point${pts.length>1?'s':''}</span></h2>
        <div class="sf-card sf-card--flat">
          ${pts.length ? pts.map(p => `
            <div class="sf-alert${p.type ? ' sf-alert--' + p.type : ''}">
              <span class="sf-alert__icon">${sfAccIcon(p.icone)}</span>
              <div class="sf-alert__body">
                <p class="sf-alert__title">${p.titre}</p>
                <p class="sf-alert__why">${p.enjeu}</p>
              </div>
              <span class="sf-alert__action">
                <button class="sf-btn sf-btn--secondary sf-btn--sm" type="button" onclick="${p.cible}">${p.action}</button>
              </span>
            </div>`).join('') : `
            <div class="sf-empty">
              <div class="sf-empty__icon">${sfAccIcon('ok', 22)}</div>
              <h3 class="sf-empty__title">Tout est à jour</h3>
              <p class="sf-empty__text">Aucun loyer en attente, aucune fiche incomplète. Vous pouvez prospecter l'esprit tranquille.</p>
              <div class="sf-empty__actions">
                <button class="sf-btn sf-btn--primary" type="button" onclick="navigate('marche-recherche')">Explorer une ville</button>
              </div>
            </div>`}
        </div>
      </section>

      <section>
        <h2 class="acc-sec">Actions</h2>
        <div class="acc-quick">
          <button class="sf-quick" type="button" onclick="navigate('nouveau')">
            <span class="sf-quick__icon">${sfAccIcon('plus', 18)}</span>
            <span class="sf-quick__label">Ajouter un bien<span class="sf-quick__sub">depuis une annonce</span></span>
          </button>
          <button class="sf-quick" type="button" onclick="navigate('module-financier')">
            <span class="sf-quick__icon">${sfAccIcon('check', 18)}</span>
            <span class="sf-quick__label">Pointer un loyer<span class="sf-quick__sub">suivi mensuel</span></span>
          </button>
          <button class="sf-quick" type="button" onclick="navigate('marche-recherche')">
            <span class="sf-quick__icon">${sfAccIcon('loupe', 18)}</span>
            <span class="sf-quick__label">Explorer une ville<span class="sf-quick__sub">prix, emploi, marché</span></span>
          </button>
          <button class="sf-quick" type="button" onclick="navigate('simulateur')">
            <span class="sf-quick__icon">${sfAccIcon('credit', 18)}</span>
            <span class="sf-quick__label">Simuler un crédit<span class="sf-quick__sub">mensualité, capacité</span></span>
          </button>
          <button class="sf-quick" type="button" onclick="navigate('module-financier')">
            <span class="sf-quick__icon">${sfAccIcon('doc', 18)}</span>
            <span class="sf-quick__label">Saisir une charge<span class="sf-quick__sub">taxe foncière, copropriété</span></span>
          </button>
        </div>
      </section>
    </div>

    <h2 class="acc-sec">Votre patrimoine
      <span class="acc-sec__n sf-num">${acquis.length} bien${acquis.length>1?'s':''} acquis · 12 derniers mois</span></h2>
    <div class="acc-kpis">
      <div class="sf-kpi">
        <span class="sf-kpi__label">Ce que ça rapporte</span>
        ${acquis.length
          ? `<span class="sf-kpi__value ${patCF>=0?'sf-kpi__value--gain':'sf-kpi__value--loss'}">${patCF>=0?'+':'−'}${fmt(Math.abs(patCF/12))} €</span>
             <span class="sf-kpi__sub">par mois · loyers moins charges et crédit</span>`
          : `<span class="sf-kpi__value sf-kpi__value--none">non disponible</span>
             <span class="sf-kpi__sub">aucun bien acquis</span>`}
      </div>
      <div class="sf-kpi">
        <span class="sf-kpi__label">Loyers encaissés</span>
        <span class="sf-kpi__value">${fmt(patLoyers)} €</span>
        <span class="sf-kpi__sub">sur 12 mois</span>
      </div>
      <div class="sf-kpi">
        <span class="sf-kpi__label">Turnover</span>
        ${tauxLoue === null
          ? `<span class="sf-kpi__value sf-kpi__value--none">non disponible</span>
             <span class="sf-kpi__sub">aucun bien acquis</span>`
          : `<span class="sf-kpi__value ${tauxLoue>=70?'sf-kpi__value--gain':'sf-kpi__value--loss'}">${tauxLoue} %</span>
             <span class="sf-kpi__sub">${bmLoues} mois loués sur ${bmTotal} mois de détention</span>`}
      </div>
      <div class="sf-kpi">
        <span class="sf-kpi__label">Fiches en prospection</span>
        <span class="sf-kpi__value">${prospection.length}</span>
        <span class="sf-kpi__sub">${sansLoyerProsp ? sansLoyerProsp + ' sans loyer estimé' : 'toutes chiffrées'}</span>
      </div>
    </div>

    <div class="acc-bento">
      <section>
        <h2 class="acc-sec">Agenda <span class="acc-sec__n sf-num">60 prochains jours</span></h2>
        <div class="sf-card sf-card--flat">
          <div class="sf-agenda">
            ${agenda.map(a => `
              <div class="sf-ag${a.enRetard ? ' sf-ag--retard' : ''}${a.pointe ? ' sf-ag--pointe' : ''}">
                <span class="sf-ag__date"><span class="sf-ag__day">${a.jour}</span><span class="sf-ag__mon">${a.moisCourt}</span></span>
                <div class="sf-ag__body">
                  <p class="sf-ag__title">${esc(a.titre)}</p>
                  <p class="sf-ag__meta">${a.enRetard
                    ? `<span class="sf-ag__retard">En retard</span> · échu le ${a.jour} ${a.moisCourt}`
                    : a.meta}</p>
                </div>
                <span class="sf-ag__amount">${fmt(a.montant)} €</span>
                <label class="sf-ag__check" title="${esc(a.pointe ? 'Annuler le pointage' : 'Pointer ce loyer comme encaissé')}">
                  <input type="checkbox" ${a.pointe ? 'checked' : ''}
                         onchange="sfPointerLoyer('${a.bienId}', ${a.mois}, ${a.annee}, this)">
                  <span class="sf-ag__box">${sfAccIcon('check', 12)}</span>
                  <span class="sr-only">Pointer le loyer de ${a.moisCourt}</span>
                </label>
              </div>`).join('')}
            <div class="sf-empty" style="padding:var(--sf-space-8) var(--sf-space-7)">
              <div class="sf-empty__icon">${sfAccIcon('agenda', 20)}</div>
              <h3 class="sf-empty__title">Aucune échéance administrative programmée</h3>
              <p class="sf-empty__text">Assurance PNO, assemblée générale de copropriété, déclaration 2044&nbsp;: les dates qui coûtent cher quand on les oublie.</p>
              <div class="sf-empty__actions">
                <button class="sf-btn sf-btn--secondary sf-btn--sm" type="button" onclick="navigate('administration')">Programmer une échéance</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h2 class="acc-sec">Prospection <span class="acc-sec__n sf-num">${prospection.length} fiche${prospection.length>1?'s':''}</span></h2>
        <div class="sf-card sf-card--flat">
          ${prospection.length ? prospection.slice(0, 5).map(b => `
            <div class="acc-pipe" onclick="openDetail('${b.id}')">
              <span class="sf-pill">${esc(b.statut || '—')}</span>
              <span class="acc-pipe__t">${esc(b.titre || 'Sans titre')}</span>
              <span class="acc-pipe__c sf-num">${b.prix_affiche ? fmt(b.prix_affiche) + ' €' : '—'}</span>
            </div>`).join('') + `
            <div style="padding:var(--sf-space-5) var(--sf-space-6)">
              <button class="sf-btn sf-btn--ghost sf-btn--sm sf-btn--block" type="button" onclick="navigate('biens')">
                Ouvrir le pipeline ${sfAccIcon('chevron', 13)}
              </button>
            </div>` : `
            <div class="sf-empty">
              <div class="sf-empty__icon">${sfAccIcon('loupe', 22)}</div>
              <h3 class="sf-empty__title">Aucune fiche en prospection</h3>
              <p class="sf-empty__text">Ajoutez une annonce pour suivre son rendement et son avancement jusqu'à la signature.</p>
              <div class="sf-empty__actions">
                <button class="sf-btn sf-btn--primary sf-btn--sm" type="button" onclick="navigate('nouveau')">Ajouter un bien</button>
              </div>
            </div>`}
        </div>
      </section>
    </div>
  `;
}

// ── BIENS ──
// ═══════════════════════════════════════════════════════════════════════════
//   MES BIENS — phase 5
// ═══════════════════════════════════════════════════════════════════════════
// L'écran sert à ARBITRER entre des biens. Il présentait sept cartes séparées :
// comparer sept rendements demandait de balayer sept blocs. La vue TABLEAU
// devient donc la vue par défaut ; grille et kanban restent disponibles.
//
// Deux ONGLETS au lieu de deux sections empilées — sans quoi il fallait
// traverser tout le patrimoine pour atteindre la prospection. « Ma prospection »
// vient en premier : c'est là qu'on agit au quotidien.
//
// Le kanban n'est PAS proposé sur le patrimoine : il range par phase, et les
// biens détenus partagent tous le statut « Acheté » — une colonne, aucune
// information.

const sfDetenu = b => b.statut === 'Acheté';
const sfRendement = b => (b.prix_affiche && b.loyer_en_etat)
  ? (parseFloat(b.loyer_en_etat) * 12 / parseFloat(b.prix_affiche)) * 100 : null;
// Charges mensuelles hors loyer — la colonne qui manquait pour comprendre d'où
// vient un cashflow négatif.
const sfCharges = b => (parseFloat(b.mensualite_credit)||0) + (parseFloat(b.charge_copro)||0)
  + (parseFloat(b.assurance_logement)||0) + (parseFloat(b.taxe_fonciere)||0);
const sfNum = (v, suf) => (v == null || v === '' || !(parseFloat(v) >= 0))
  ? '<span class="sfb-vide-val">—</span>' : fmt(parseFloat(v)) + (suf || '');

function renderBiens(el) {
  el.innerHTML = `
    <div class="sfb-head">
      <h1>Mes biens</h1>
      <span class="sfb-head__n sf-num" id="sfb-cpt"></span>
    </div>

    <div class="sfb-tabs" role="tablist">
      <button class="sfb-tab" role="tab" id="sfb-t-prospect" onclick="sfSetOnglet('prospect')">
        Ma prospection <span class="sfb-tab__n sf-num" id="sfb-n-prospect"></span>
        <span class="sfb-tab__todo" id="sfb-dot-prospect" title="Des fiches sont à compléter"></span>
      </button>
      <button class="sfb-tab" role="tab" id="sfb-t-detenus" onclick="sfSetOnglet('detenus')">
        Mon patrimoine <span class="sfb-tab__n sf-num" id="sfb-n-detenus"></span>
        <span class="sfb-tab__todo" id="sfb-dot-detenus" title="Des biens sont à compléter"></span>
      </button>
    </div>

    <div class="sfb-tools">
      <div class="sfb-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input id="f-recherche" type="search" placeholder="Titre, ville, code postal…" oninput="applyFilters()" aria-label="Rechercher un bien">
      </div>
      <select class="sfb-sel" id="f-filtre-type" onchange="applyFilters()" aria-label="Type de bien">
        ${TI_BIENS.options('TYPES', null, 'Tous types')}
      </select>
      <select class="sfb-sel" id="f-etat" onchange="applyFilters()" aria-label="Complétude">
        <option value="">Complètes et à compléter</option>
        <option value="ok">Fiches complètes</option>
        <option value="ko">À compléter seulement</option>
      </select>
      <select class="sfb-sel" id="f-dens" onchange="sfSetDensite(this.value)" aria-label="Densité">
        <option value="confort">Confort</option><option value="compact">Compact</option>
      </select>
      <span class="sfb-spacer"></span>
      <div class="sfb-views" role="group" aria-label="Vue">
        <button class="sfb-view" id="sfb-v-tableau" onclick="setView('tableau')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 5h18M3 12h18M3 19h18"/></svg>Tableau</button>
        <button class="sfb-view" id="sfb-v-grille" onclick="setView('grille')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>Grille</button>
        <button class="sfb-view" id="sfb-v-kanban" onclick="setView('kanban')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="11" rx="1"/><rect x="17" y="4" width="4" height="7" rx="1"/></svg>Kanban</button>
      </div>
      <select class="sfb-sel" id="sfb-group" onchange="setKanbanGroup(this.value)" aria-label="Grouper le kanban par">
        <option value="phase">Grouper par phase</option>
        <option value="ville">Grouper par département</option>
        <option value="type">Grouper par type</option>
      </select>
      <button class="sf-btn sf-btn--secondary sf-btn--sm" type="button" onclick="exportBiensCSV()"
              title="Exporte les biens actuellement affichés, filtres compris">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/></svg> CSV</button>
      <button class="sf-btn sf-btn--primary sf-btn--sm" type="button" onclick="navigate('nouveau')">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg> Ajouter</button>
    </div>

    <div class="sfb-kpis" id="sfb-kpis"></div>
    <p class="sfb-foot" id="sfb-foot"></p>

    <!-- Actions groupées. La barre reste dans le flux et n'apparaît qu'à la
         première sélection : des actions qui ne se révèlent qu'au survol sont
         invisibles au clavier et au doigt. -->
    <div class="sfb-bulk" id="sfb-bulk" data-on="0" role="region" aria-label="Actions groupées">
      <span class="sfb-bulk__n" id="sfb-bulk-n"></span>
      <select class="sfb-sel" id="sfb-bulk-statut" aria-label="Nouveau statut">
        ${TI_BIENS.options('STATUTS_SAISISSABLES', null, 'Changer le statut…')}
      </select>
      <button class="sf-btn sf-btn--secondary sf-btn--sm" type="button" onclick="sfBulkStatut()">Appliquer</button>
      <button class="sf-btn sf-btn--secondary sf-btn--sm" type="button" onclick="sfBulkExport()">Exporter la sélection</button>
      <button class="sf-btn sf-btn--ghost sf-btn--sm" type="button" onclick="sfViderSelection()">Annuler</button>
    </div>

    <div id="biens-content"></div>

    <div class="sfb-legend">
      <span><span class="sfb-src sfb-src--reel">Réel</span> Calculé sur vos loyers encaissés</span>
      <span><span class="sfb-src sfb-src--attente">Attente</span> Bien acquis, loyers pas encore pointés</span>
      <span><span class="sfb-src sfb-src--estime">Estimé</span> Projection avant achat</span>
      <span><span class="sfb-src sfb-src--manque">À compléter</span> Une information essentielle manque</span>
    </div>`;
  applyFilters();
}

// Redessine tout ce qui dépend des filtres et de l'onglet. Un seul point
// d'entrée : les indicateurs ne peuvent pas se désynchroniser de la liste.
function renderBiensContent(biens) {
  const detenus = biens.filter(sfDetenu);
  const prospect = biens.filter(b => !sfDetenu(b));
  const l = getSortedBiens(bienOnglet === 'detenus' ? detenus : prospect);

  const $ = id => document.getElementById(id);
  if($('sfb-cpt')) $('sfb-cpt').textContent = `${biens.length} fiche${biens.length>1?'s':''} sur ${allBiens.length}`;
  if($('sfb-n-prospect')) $('sfb-n-prospect').textContent = prospect.length;
  if($('sfb-n-detenus'))  $('sfb-n-detenus').textContent  = detenus.length;
  if($('sfb-t-prospect')) $('sfb-t-prospect').setAttribute('aria-selected', String(bienOnglet==='prospect'));
  if($('sfb-t-detenus'))  $('sfb-t-detenus').setAttribute('aria-selected', String(bienOnglet==='detenus'));
  if($('sfb-dot-prospect')) $('sfb-dot-prospect').style.display = prospect.every(sfBienComplet) ? 'none' : '';
  if($('sfb-dot-detenus'))  $('sfb-dot-detenus').style.display  = detenus.every(sfBienComplet)  ? 'none' : '';
  // Kanban et regroupement n'ont de sens que sur la prospection.
  if($('sfb-v-kanban')) $('sfb-v-kanban').style.display = bienOnglet==='detenus' ? 'none' : '';
  if($('sfb-group'))    $('sfb-group').style.display    = (bienOnglet==='prospect' && currentView==='kanban') ? '' : 'none';
  ['tableau','grille','kanban'].forEach(k => {
    const btn = $('sfb-v-'+k); if(btn) btn.setAttribute('aria-pressed', String(k===currentView));
  });

  // Les fiches incomplètes sont écartées de TOUS les indicateurs : additionner
  // des charges sans le loyer en face exagère la perte.
  const chiffres = l.filter(b => cfDisplayData(b).value != null);
  const aFaire   = l.filter(b => !sfBienComplet(b));
  const somme    = chiffres.reduce((s,b) => s + cfDisplayData(b).value, 0);
  const seuil    = parseFloat(userPrefs?.seuil_rentabilite) || 5;
  const auSeuil  = chiffres.filter(b => (sfRendement(b) ?? 0) >= seuil).length;
  const capital  = l.reduce((s,b) => s + (parseFloat(b.prix_affiche) || 0), 0);
  const kpi = (lab,val,sub,cl) => `<div class="sfb-kpi"><span class="sfb-kpi__l">${lab}</span>
    <span class="sfb-kpi__v${cl?' '+cl:''}">${val}</span><span class="sfb-kpi__s">${sub}</span></div>`;
  const cfCl = chiffres.length ? (somme>=0 ? 'sfb-kpi__v--gain' : 'sfb-kpi__v--loss') : '';
  const cfVal = chiffres.length ? (somme>=0?'+':'−')+fmt(Math.abs(somme))+' €' : '—';

  if($('sfb-kpis')) $('sfb-kpis').innerHTML = bienOnglet==='detenus'
    ? kpi('Cashflow mensuel', cfVal, 'Loyers moins charges et crédits', cfCl)
      + kpi('Au-dessus de votre seuil', `${auSeuil} <span class="sfb-kpi__sur">sur ${chiffres.length}</span>`,
            `Rendement brut supérieur à ${seuil} %`)
      + kpi('Capital engagé', fmt(capital)+' €', "Total des prix d'achat")
      + kpi('Biens à compléter', String(aFaire.length), 'Une information essentielle manque',
            aFaire.length ? 'sfb-kpi__v--alerte' : '')
    : kpi('Cashflow projeté', cfVal, 'Si vous achetiez aux conditions saisies', cfCl)
      + kpi('Au-dessus de votre seuil', `${auSeuil} <span class="sfb-kpi__sur">sur ${chiffres.length}</span>`,
            `Rendement brut supérieur à ${seuil} %`)
      + kpi('Budget étudié', fmt(capital)+' €', 'Total des prix affichés')
      + kpi('Fiches à compléter', String(aFaire.length), 'Une information essentielle manque',
            aFaire.length ? 'sfb-kpi__v--alerte' : '');

  if($('sfb-foot')) $('sfb-foot').innerHTML = aFaire.length
    ? `<b>${aFaire.length} fiche${aFaire.length>1?'s':''}</b> ${aFaire.length>1?'sont exclues':'est exclue'} des indicateurs
       ci-dessus, faute d'une information essentielle. ${aFaire.length>1?'Elles apparaissent':'Elle apparaît'}
       aussi dans « À traiter » sur l'accueil.` : '';

  if(!l.length) return `
    <div class="bd-empty-state">
      <div class="bd-empty-icon">${sfAccIcon('maison', 24)}</div>
      <h3>${bienOnglet==='detenus' ? 'Aucun bien acquis' : 'Aucune fiche en prospection'}</h3>
      <p>${bienOnglet==='detenus'
        ? 'Vos biens apparaîtront ici une fois leur statut passé à « Acheté ».'
        : 'Ajoutez une annonce pour suivre son rendement jusqu\'à la signature.'}</p>
      <button class="sf-btn sf-btn--primary sf-btn--sm" type="button" onclick="navigate('nouveau')">Ajouter un bien</button>
    </div>`;

  if(currentView === 'kanban' && bienOnglet === 'prospect') return renderKanban(l);
  if(currentView === 'grille') return `<div class="sfb-grid">${l.map(renderCard).join('')}</div>`;
  return renderBiensTableau(l);
}

// ── VUE TABLEAU ─────────────────────────────────────────────────────────────
// Tout est aligné à gauche, en-têtes comprises : le sens de lecture de la
// plateforme est gauche → droite. `tabular-nums` maintient l'alignement des
// chiffres entre eux, ce que l'alignement à droite assurait autrement.
function renderBiensTableau(l) {
  const seuil = parseFloat(userPrefs?.seuil_rentabilite) || 5;
  // `num` aligne l'en-tête à droite avec sa colonne : une en-tête à gauche
  // au-dessus de chiffres à droite laisse un trou au milieu de la colonne.
  const th = (c,t,num) => `<th data-sort="${c}"${num?' class="sf-num"':''}${bienSortBy===c?` aria-sort="${bienSortAsc?'ascending':'descending'}"`:''}
      onclick="setTriBiens('${c}')" tabindex="0" onkeydown="if(event.key==='Enter')setTriBiens('${c}')">
      ${t}<span class="ar">${bienSortAsc?'↑':'↓'}</span></th>`;
  const tousCoches = l.length > 0 && l.every(b => bienSelection.has(b.id));
  return `<div class="sfb-tablewrap"><table class="sfb-t">
    <thead><tr>
      <th class="sfb-t__case"><input type="checkbox" ${tousCoches?'checked':''}
        onclick="event.stopPropagation()" onchange="sfToutSelectionner(this.checked)"
        aria-label="Tout sélectionner"></th>
      ${th('nom','Bien')}<th>Ville</th>${th('prix','Prix',true)}${th('loyer','Loyer',true)}
      <th class="sf-num">Charges</th>${th('rend','Rendement',true)}${th('cf','Cashflow / mois',true)}<th>Statut</th>
    </tr></thead>
    <tbody>${l.map(b => {
      /* ⚠️ Commentaires en JS, JAMAIS en HTML dans ce gabarit : un commentaire
         place dans le litteral serait recopie sur CHAQUE ligne du tableau, et
         un accent grave y refermerait le litteral (defaut commis le 14/08). */
      // Le statut s'edite directement ici. `stopPropagation` sur la cellule :
      // la LIGNE porte `openDetail`, si bien qu'un clic sur le statut emmenait
      // sur la fiche au lieu d'ouvrir la liste. Le badge annoncait pourtant une
      // interaction — `cursor:pointer`, herite de la ligne — qu'aucun
      // gestionnaire ne tenait : il n'etait tout simplement pas cliquable.
      const d = cfDisplayData(b), r = sfRendement(b), ch = sfCharges(b);
      const srcCls = d.mode==='reel' ? 'reel' : d.mode==='incomplet' ? 'manque'
                   : d.attenteReel ? 'attente' : 'estime';
      const srcLbl = d.mode==='reel' ? 'Réel' : d.mode==='incomplet' ? 'À compléter'
                   : d.attenteReel ? 'Attente' : 'Estimé';
      return `<tr class="${d.mode==='incomplet'?'incomplet':''}${bienSelection.has(b.id)?' choisie':''}" onclick="openDetail('${b.id}')">
        <td class="sfb-t__case" onclick="event.stopPropagation()">
          <input type="checkbox" ${bienSelection.has(b.id)?'checked':''}
                 onchange="sfBasculerSelection('${b.id}')"
                 aria-label="Sélectionner ${esc(b.titre || 'ce bien')}"></td>
        <td><div class="sfb-t__b">${esc(b.titre || 'Sans titre')}</div>
            <div class="sfb-t__s">${esc(b.type_bien || '—')}${b.surface_m2?' · '+esc(b.surface_m2)+' m²':''}${b.balise?' · '+esc(b.balise):''}</div></td>
        <td>${b.ville ? esc(b.ville) : '<span class="sfb-vide-val">—</span>'}
            <div class="sfb-t__s">${esc(b.code_postal || '')}</div></td>
        <td class="sf-num">${sfNum(b.prix_affiche,' €')}</td>
        <td class="sf-num">${sfNum(b.loyer_en_etat,' €')}</td>
        <td class="sf-num sfb-charges">${ch>0 ? '−'+sfEur(ch) : '<span class="sfb-vide-val">—</span>'}</td>
        <td class="sf-num">${r==null ? '<span class="sfb-vide-val">—</span>' : `
          <span class="sfb-rend"><span class="sfb-rend__b"><span class="sfb-rend__f"
            style="width:${Math.min(100, r/10*100)}%;background:${r>=seuil?'var(--sf-gain)':'var(--sf-alert)'}"></span></span>
          <span class="sfb-rend__v ${r>=seuil?'sf-gain':''}">${sfPct(r.toFixed(1).replace('.',','))}</span></span>`}</td>
        <td class="sf-num">${d.mode==='incomplet'
          ? `<span class="sfb-src sfb-src--manque sfb-src--seul">À compléter</span>
             <span class="sfb-part">${d.manque.map(x=>x.lab).join(', ')} à renseigner</span>`
          : d.value == null
            ? '<span class="sfb-vide-val">—</span>'
            : `<span class="${d.value>0?'sf-gain':d.value<0?'sf-loss':''}">${(d.value>=0?'+':'−')+sfEur(Math.abs(d.value))}</span>
               <span class="sfb-src sfb-src--${srcCls}">${srcLbl}</span>`}</td>
        <td onclick="event.stopPropagation()">${sfDetenu(b)
          ? `<span class="statut-pill phase-${(PHASE_MAP[b.statut]||'generic')}">${esc(b.statut || '—')}</span>`
          : `<span class="inline-edit"
              data-id="${b.id}" data-field="statut" data-type="select-statut"
              data-value="${(b.statut||'').replace(/"/g,'&quot;')}"
              onclick="inlineEditField(this)"><span class="statut-pill phase-${(PHASE_MAP[b.statut]||'generic')}">${esc(b.statut || '—')}</span></span>`}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── KANBAN ──
// ── DÉPARTEMENTS FRANÇAIS ──
const DEPT_NAMES = {
  '01':'Ain','02':'Aisne','03':'Allier','04':'Alpes-de-Haute-Provence','05':'Hautes-Alpes',
  '06':'Alpes-Maritimes','07':'Ardèche','08':'Ardennes','09':'Ariège','10':'Aube',
  '11':'Aude','12':'Aveyron','13':'Bouches-du-Rhône','14':'Calvados','15':'Cantal',
  '16':'Charente','17':'Charente-Maritime','18':'Cher','19':'Corrèze','2A':'Corse-du-Sud',
  '2B':'Haute-Corse','21':'Côte-d\'Or','22':'Côtes-d\'Armor','23':'Creuse','24':'Dordogne',
  '25':'Doubs','26':'Drôme','27':'Eure','28':'Eure-et-Loir','29':'Finistère',
  '30':'Gard','31':'Haute-Garonne','32':'Gers','33':'Gironde','34':'Hérault',
  '35':'Ille-et-Vilaine','36':'Indre','37':'Indre-et-Loire','38':'Isère','39':'Jura',
  '40':'Landes','41':'Loir-et-Cher','42':'Loire','43':'Haute-Loire','44':'Loire-Atlantique',
  '45':'Loiret','46':'Lot','47':'Lot-et-Garonne','48':'Lozère','49':'Maine-et-Loire',
  '50':'Manche','51':'Marne','52':'Haute-Marne','53':'Mayenne','54':'Meurthe-et-Moselle',
  '55':'Meuse','56':'Morbihan','57':'Moselle','58':'Nièvre','59':'Nord',
  '60':'Oise','61':'Orne','62':'Pas-de-Calais','63':'Puy-de-Dôme','64':'Pyrénées-Atlantiques',
  '65':'Hautes-Pyrénées','66':'Pyrénées-Orientales','67':'Bas-Rhin','68':'Haut-Rhin',
  '69':'Rhône','70':'Haute-Saône','71':'Saône-et-Loire','72':'Sarthe','73':'Savoie',
  '74':'Haute-Savoie','75':'Paris','76':'Seine-Maritime','77':'Seine-et-Marne',
  '78':'Yvelines','79':'Deux-Sèvres','80':'Somme','81':'Tarn','82':'Tarn-et-Garonne',
  '83':'Var','84':'Vaucluse','85':'Vendée','86':'Vienne','87':'Haute-Vienne',
  '88':'Vosges','89':'Yonne','90':'Territoire de Belfort','91':'Essonne',
  '92':'Hauts-de-Seine','93':'Seine-Saint-Denis','94':'Val-de-Marne','95':'Val-d\'Oise',
  '971':'Guadeloupe','972':'Martinique','973':'Guyane','974':'La Réunion','976':'Mayotte'
};

function getDept(b) {
  const cp = (b.code_postal||'').toString().trim();
  if(!cp) return null;
  // DOM-TOM 3 chiffres
  if(/^97[1-6]/.test(cp)) return cp.slice(0,3);
  // Corse
  if(/^2[AB]/i.test(cp)) return cp.slice(0,2).toUpperCase();
  // Standard
  if(cp.length >= 2) return cp.slice(0,2);
  return null;
}

function getDeptLabel(dept) {
  const name = DEPT_NAMES[dept];
  return name ? `${dept} — ${name}` : `Dépt. ${dept}`;
}

function renderKanban(biens) {
  const isDraggable = kanbanGroup === 'phase';
  let columns = [];

  if(kanbanGroup === 'phase') {
    columns = PHASES.map(ph => ({
      // `icone` doit etre recopie ici : la colonne est un objet NEUF, elle
      // n'herite de rien. Il manquait, et `sfAccIcon(undefined)` produisait un
      // <svg> vide qui occupait sa place sans rien dessiner — d'ou un blanc
      // entre le point de couleur et le titre.
      key: ph.key, label: ph.label, dot: ph.dot, icone: ph.icone,
      biens: biens.filter(b => (PHASE_MAP[b.statut]||'prospection') === ph.key)
    }));

  } else if(kanbanGroup === 'ville') {
    // Grouper par département (2 premiers chiffres du code postal)
    const deptMap = {};
    biens.forEach(b => {
      const dept = getDept(b);
      if(dept) {
        if(!deptMap[dept]) deptMap[dept] = [];
        deptMap[dept].push(b);
      }
    });
    const depts = Object.keys(deptMap).sort((a,b) => a.localeCompare(b));
    if(!depts.length) return '<div class="empty-state"><h3>Aucun code postal renseigné</h3><p>Ajoutez des codes postaux à vos biens pour utiliser ce regroupement.</p></div>';
    columns = depts.map(dept => ({
      key: dept,
      label: getDeptLabel(dept), icone:'pin',
      dot: 'phase-generic',
      biens: deptMap[dept]
    }));
    // Biens sans code postal
    const sans = biens.filter(b => !getDept(b));
    if(sans.length) columns.push({
      key:'__sans__', label:'Sans localisation', icone:'pin', dot:'phase-generic', biens:sans
    });

  } else if(kanbanGroup === 'type') {
    const presentTypes = TI_BIENS.TYPES.filter(t => biens.some(b=>b.type_bien===t));
    if(!presentTypes.length) return '<div class="empty-state"><h3>Aucun type renseigné</h3><p>Ajoutez des types à vos biens pour utiliser ce regroupement.</p></div>';
    columns = presentTypes.map(t => ({
      key: t, label: t, icone:'maison', dot: 'phase-generic', biens: biens.filter(b=>b.type_bien===t)
    }));
    const autres = biens.filter(b=>!b.type_bien||!TYPES.includes(b.type_bien));
    if(autres.length) columns.push({key:'__autre__',label:'Non renseigné',icone:'maison',dot:'phase-generic',biens:autres});
  }

  // Badge "lecture seule" si pas en mode phase
  const readonlyBadge = !isDraggable
    ? `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(148,163,184,0.1);border:1px solid var(--c-border);border-radius:8px;font-size:11px;color:var(--c-muted);margin-bottom:12px;">
        Vue lecture — le glisser-déposer est disponible uniquement en mode <strong style="color:var(--accent)">Phase</strong>
       </div>`
    : '';

  const cols = columns.map(col => {
    const dropAttrs = isDraggable
      ? `data-colkey="${col.key.replace(/"/g,'&quot;')}"
         ondragover="kanbanDragOver(event,this)"
         ondragleave="kanbanDragLeave(event)"
         ondrop="kanbanDrop(event,this)"`
      : '';
    return `
    <div class="kanban-col${isDraggable?'':' no-drop'}" ${dropAttrs}>
      <div class="kanban-col-header">
        <div class="kanban-col-title">
          <span class="kanban-col-dot ${col.dot}"></span>
          <span class="kanban-col-ic">${sfAccIcon(col.icone || 'tag', 14)}</span>${esc(col.label)}
        </div>
        <span class="kanban-col-count">${col.biens.length}</span>
      </div>
      <div class="kanban-cards">
        ${col.biens.length
          ? col.biens.map(b=>renderKanbanCard(b, isDraggable)).join('')
          : `<div class="kanban-empty">${isDraggable?'Déposer ici':'Aucun bien'}</div>`}
      </div>
    </div>`;
  // Un lien « Gérer mes SCI → » etait concatene ici. Il appartient au panneau
  // SCI des Parametres (il y figure toujours) : un copier-coller l'avait
  // ramene dans le kanban, ou il n'avait aucun rapport avec les colonnes.
  }).join('');

  return `
    ${readonlyBadge}
    <div class="kanban-scroll"><div class="kanban-board">${cols}</div></div>`;
}

function renderKanbanCard(b, draggable=true) {
  // P2 : même logique d'affichage que les cartes grille
  const d = cfDisplayData(b);
  const cfC = d.value == null ? 'neutral' : cfCls(d.value);
  const cfTxt = d.value != null
    ? (d.value>0?'+':'')+fmt(d.value)+'€'+(d.mode==='reel'?' réel':'')
    : '—';
  const bmap = Object.fromEntries(TI_BIENS.BALISES.map(b => [b.v, b.cls]));
  const dept = getDept(b);
  const locParts = [];
  if(b.ville) locParts.push(b.ville);
  if(b.code_postal) locParts.push(b.code_postal);
  const loc = locParts.join(' ') || '—';
  const dragAttrs = draggable
    ? `draggable="true" ondragstart="kanbanDragStart(event,'${b.id}')" ondragend="kanbanDragEnd(event)"`
    : `style="cursor:pointer"`;
  return `<div class="kanban-card ${cfC}" ${dragAttrs} onclick="openDetail('${b.id}')">
    ${b.is_test?'<div class="test-ribbon">TEST</div>':''}
    <div class="kc-top">
      <div class="kc-title">${esc(b.titre)}</div>
      <div class="kc-cf ${cfC}">${cfTxt}</div>
    </div>
    <div class="kc-loc">📍 ${loc}</div>
    <div class="kc-meta">
      ${b.type_bien?`<span class="kc-tag">${b.type_bien}${b.surface_m2?' · '+b.surface_m2+'m²':''}</span>`:''}
      ${b.prix_affiche?`<span class="kc-tag">${fmt(b.prix_affiche)}€</span>`:''}
      ${b.balise?`<span class="kc-tag ${bmap[b.balise]||''}">${esc(b.balise)}</span>`:''}
      <span class="kc-statut">${b.statut||'—'}</span>
    </div>
  </div>`;
}

// ── DRAG & DROP (Phase uniquement) ──
function kanbanDragStart(e, id) {
  draggedBienId = id;
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(()=>e.target.classList.add('dragging'), 0);
}
function kanbanDragEnd(e) {
  e.target.classList.remove('dragging');
  document.querySelectorAll('.kanban-col').forEach(c=>c.classList.remove('drag-over'));
}
function kanbanDragOver(e, colEl) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  colEl.classList.add('drag-over');
}
function kanbanDragLeave(e) {
  if(!e.currentTarget.contains(e.relatedTarget))
    e.currentTarget.classList.remove('drag-over');
}
async function kanbanDrop(e, colEl) {
  e.preventDefault();
  colEl.classList.remove('drag-over');
  if(!draggedBienId || kanbanGroup !== 'phase') return;
  const bien = allBiens.find(b=>b.id===draggedBienId);
  if(!bien) return;

  const colKey = colEl.dataset.colkey;
  const phase = PHASES.find(p=>p.key===colKey);
  if(!phase) return;
  const currentPhase = PHASE_MAP[bien.statut]||'prospection';
  if(currentPhase === colKey) { draggedBienId=null; return; }

  const newStatut = phase.defaultStatut;

  /* ⚠️ « Acheté » ne s'écrit plus ici. Déposer dans « Finalisé » est un geste
     volontaire, donc un point d'entrée légitime de l'acquisition — mais c'est
     le WORKFLOW qui écrit, et seulement après confirmation. On rend donc la
     carte à sa colonne et on ouvre la fenêtre : si l'utilisateur renonce, rien
     n'aura bougé, ni à l'écran ni en base.
     ⚠️ La colonne « Finalisé » accueille aussi « Abandonné » : un dépôt y est
     donc ambigu. On l'interprète comme une acquisition, ce qu'il était déjà
     (`defaultStatut`), et la fenêtre demande confirmation avant tout. */
  if(newStatut === 'Acheté') {
    const id = draggedBienId;
    draggedBienId = null;
    const content0 = document.getElementById('biens-content');
    if(content0) content0.innerHTML = renderKanban(getFilteredBiens());
    await bdDemarrerAcquisition(id);
    if(bdAcq) bdAcq.origine = 'kanban';
    return;
  }

  bien.statut = newStatut;
  const content = document.getElementById('biens-content');
  if(content) content.innerHTML = renderKanban(getFilteredBiens());

  const {error} = await db.from('biens')
    .update({statut:newStatut, updated_at:new Date().toISOString()})
    .eq('id', draggedBienId);
  if(error) {
    console.error('Erreur update kanban:', error);
    const {data} = await db.from('biens').select('*').order('created_at',{ascending:false});
    allBiens = data||[];
    if(content) content.innerHTML = renderKanban(getFilteredBiens());
  }
  draggedBienId = null;
}

// ── SÉLECTION MULTIPLE ET ACTIONS GROUPÉES ──────────────────────────────────
// La sélection porte sur des identifiants, pas sur des lignes du DOM : elle
// survit donc à un tri, à un changement de filtre ou de vue.
const bienSelection = new Set();

function sfBasculerSelection(id) {
  bienSelection.has(id) ? bienSelection.delete(id) : bienSelection.add(id);
  sfMajBarreSelection();
}
function sfToutSelectionner(coche) {
  const visibles = getSortedBiens(getFilteredBiens()
    .filter(b => bienOnglet==='detenus' ? sfDetenu(b) : !sfDetenu(b)));
  visibles.forEach(b => coche ? bienSelection.add(b.id) : bienSelection.delete(b.id));
  applyFilters();
}
function sfViderSelection() { bienSelection.clear(); applyFilters(); }

function sfMajBarreSelection() {
  const barre = document.getElementById('sfb-bulk');
  if(!barre) return;
  const n = bienSelection.size;
  barre.dataset.on = n ? '1' : '0';
  const lbl = document.getElementById('sfb-bulk-n');
  if(lbl) lbl.textContent = `${n} bien${n>1?'s':''} sélectionné${n>1?'s':''}`;
}

function sfBiensSelectionnes() {
  return allBiens.filter(b => bienSelection.has(b.id));
}
function sfBulkExport() {
  const choisis = sfBiensSelectionnes();
  if(!choisis.length) { showNotif('Aucun bien sélectionné', true); return; }
  exportBiensCSV(choisis);
}
async function sfBulkStatut() {
  const sel = document.getElementById('sfb-bulk-statut');
  const statut = sel?.value;
  if(!statut) { showNotif('Choisissez un statut', true); return; }
  const choisis = sfBiensSelectionnes();
  if(!choisis.length) { showNotif('Aucun bien sélectionné', true); return; }
  if(!confirm(`Passer ${choisis.length} bien${choisis.length>1?'s':''} au statut « ${statut} » ?`)) return;
  try {
    const { error } = await db.from('biens').update({ statut })
      .in('id', choisis.map(b => b.id)).eq('user_id', currentUser.id);
    if(error) throw error;
    // Mise a jour en memoire : eviter un rechargement complet pour un champ.
    choisis.forEach(b => { b.statut = statut; });
    showNotif(`${choisis.length} bien${choisis.length>1?'s':''} mis à jour`);
    bienSelection.clear();
    applyFilters();
  } catch(e) { showNotif('Erreur : ' + e.message, true); }
}

// ── HELPERS VUE ──
function setView(v) {
  currentView = v;
  applyFilters();
}
function sfSetOnglet(o) {
  bienOnglet = o;
  // Le kanban range par phase : sur le patrimoine il n'y aurait qu'une colonne
  // « Acheté ». On retombe sur le tableau plutôt que d'afficher une vue vide de sens.
  if(bienOnglet === 'detenus' && currentView === 'kanban') currentView = 'tableau';
  applyFilters();
}
function sfSetDensite(d) {
  document.body.dataset.densite = d;
  try { localStorage.setItem('sf_densite', d); } catch(e){}
}
function setKanbanGroup(g) { kanbanGroup = g; applyFilters(); }

function getFilteredBiens() {
  const q    = (document.getElementById('f-recherche')?.value || '').toLowerCase().trim();
  const type = document.getElementById('f-filtre-type')?.value || '';
  const etat = document.getElementById('f-etat')?.value || '';
  return allBiens.filter(b => {
    if(type && b.type_bien !== type) return false;
    if(etat === 'ok' && !sfBienComplet(b)) return false;
    if(etat === 'ko' &&  sfBienComplet(b)) return false;
    if(q) {
      const foin = `${b.titre||''} ${b.ville||''} ${b.code_postal||''}`.toLowerCase();
      if(!foin.includes(q)) return false;
    }
    return true;
  });
}

// Tri par colonne : un second clic sur la meme colonne inverse le sens.
function setTriBiens(c) {
  if(bienSortBy === c) bienSortAsc = !bienSortAsc;
  else { bienSortBy = c; bienSortAsc = false; }
  applyFilters();
}

function getSortedBiens(biens) {
  const cle = b => {
    switch(bienSortBy) {
      case 'nom':   return (b.titre || '').toLowerCase();
      case 'prix':  return parseFloat(b.prix_affiche)  || -Infinity;
      case 'loyer': return parseFloat(b.loyer_en_etat) || -Infinity;
      case 'rend':  return sfRendement(b) ?? -Infinity;
      case 'cf':    return cfDisplayData(b).value ?? -Infinity;
      default:      return new Date(b.created_at).getTime() || 0;
    }
  };
  const sens = bienSortAsc ? 1 : -1;
  return [...biens].sort((a,b) => {
    const x = cle(a), y = cle(b);
    return (typeof x === 'string' ? x.localeCompare(y, 'fr') : x - y) * sens;
  });
}

// Point d'entrée unique du redessin : indicateurs, onglets et liste sont
// recalculés ensemble, ils ne peuvent donc pas diverger.
function applyFilters() {
  const contentEl = document.getElementById('biens-content');
  if(contentEl) contentEl.innerHTML = renderBiensContent(getFilteredBiens());
  sfMajBarreSelection();
}

function renderCard(b) {
  const d = cfDisplayData(b), r = sfRendement(b), ch = sfCharges(b);
  // Le seuil vient des préférences. Il était codé en dur à 6 % / 4 %, si bien
  // qu'un même 5,7 % s'affichait « bon » sur la fiche et « moyen » sur la carte.
  const seuil = parseFloat(userPrefs?.seuil_rentabilite) || 5;
  const srcCls = d.mode==='reel' ? 'reel' : d.mode==='incomplet' ? 'manque'
               : d.attenteReel ? 'attente' : 'estime';
  const srcLbl = d.mode==='reel' ? 'Réel' : d.mode==='incomplet' ? 'À compléter'
               : d.attenteReel ? 'Attente' : 'Estimé';
  return `<article class="sfb-card ${d.mode==='incomplet'?'incomplet':''}" onclick="openDetail('${b.id}')">
    ${b.is_test?'<div class="test-ribbon">TEST</div>':''}
    <div class="sfb-card__top">
      <div class="sfb-card__st">
        <span class="statut-pill phase-${(PHASE_MAP[b.statut]||'generic')}">${esc(b.statut || '—')}</span>
        ${b.balise?`<span class="sf-pill">${esc(b.balise)}</span>`:''}
      </div>
      <h3 class="sfb-card__t" title="${esc(b.titre || 'Sans titre')}">${esc(b.titre || 'Sans titre')}</h3>
      <p class="sfb-card__loc">${b.ville
        ? esc([b.ville, b.code_postal].filter(Boolean).join(' '))
        : '<span class="sfb-vide-val">Ville à renseigner</span>'} · ${esc(b.type_bien || '—')}${b.surface_m2?' · '+esc(b.surface_m2)+' m²':''}</p>
    </div>
    <div class="sfb-card__cf">
      <span class="sfb-card__cfl">Cashflow<span class="sfb-src sfb-src--${srcCls}">${srcLbl}</span></span>
      <span class="sfb-card__cfv ${d.value>0?'sf-gain':d.value<0?'sf-loss':''}">${
        d.value != null ? (d.value>0?'+':'')+fmt(d.value)+' €' : '—'}</span>
    </div>
    <div class="sfb-card__stats">
      <div class="sfb-card__cell"><span class="sfb-card__cl">Prix</span><span class="sfb-card__cv">${sfNum(b.prix_affiche,' €')}</span></div>
      <div class="sfb-card__cell"><span class="sfb-card__cl">Loyer</span><span class="sfb-card__cv">${sfNum(b.loyer_en_etat,' €')}</span></div>
      <div class="sfb-card__cell"><span class="sfb-card__cl">Charges</span><span class="sfb-card__cv sfb-charges">${ch>0?fmt(ch)+' €':'<span class="sfb-vide-val">—</span>'}</span></div>
      <div class="sfb-card__cell"><span class="sfb-card__cl">Rdt</span>
        <span class="sfb-card__cv ${r==null?'':r>=seuil?'sf-gain':''}">${r==null?'<span class="sfb-vide-val">—</span>':r.toFixed(1)+' %'}</span></div>
    </div>
  </article>`;
}

// ── NOUVEAU BIEN ──
let bienPhotos = [], bienDocs = [];

async function renderNouveau(el, bien) {
  // Charger les SCI si pas encore fait (pour la picklist SCI associée)
  if (!allSCI.length && currentUser) await loadSCIList();
  editingId = bien ? bien.id : null;
  sciOui = bien ? (parseFloat(bien.creation_sci)||0) > 0 : false;
  // Modèle hybride : on normalise photos/docs en objets {kind, path?, bucket?, data?, name?}
  // Storage d'abord (photos_paths), fallback base64 (photos) pour compat transition.
  bienPhotos = tiNormalizePhotos(bien?.photos_paths, bien?.photos, 'biens-photos');
  bienDocs = tiNormalizeDocs(bien?.documents_paths, bien?.documents, 'biens-documents');

  el.innerHTML = `
    <div class="form-sticky-save">
      <div class="info">${bien?'<strong>Modifier le bien :</strong> '+(bien.titre||'').replace(/</g,'&lt;'):'<strong>Ajouter un nouveau bien</strong>'}</div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-secondary" onclick="navigate('biens')" style="padding:7px 14px;font-size:12px">Annuler</button>
        <button class="btn btn-primary" id="btn-save-top" onclick="saveBien()" style="padding:7px 16px;font-size:12px">${bien?sfAccIcon('check',14)+' Enregistrer':'＋ Ajouter le bien'}</button>
      </div>
    </div>
    <div>
      <div class="page-title">${bien?'Modifier le bien':'Ajouter un bien'}</div>
      <div class="page-sub">${bien?'Mettez à jour les informations':'Renseignez les informations du bien prospecté'} <span style="color:var(--negative);font-weight:600">* champ obligatoire</span></div>
    </div>

    <div class="nouveau-wrap" style="margin-top:18px">
      <!-- COLONNE FORMULAIRE -->
      <div class="nouveau-form-col">

        <!-- Bien -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('pin',16)} Informations du bien</div>
          <div class="form-grid">
            <div class="form-group form-full"><label class="req">Titre de l'annonce</label><input type="text" id="f-titre" value="${esc(bien?.titre||'')}" oninput="updatePrev()" placeholder="ex: T3 Paris Montmartre 65m²" style="border-color:${!bien?.titre?'rgba(220,38,38,0.3)':''}"></div>
            <div class="form-group"><label class="req">Ville</label><input type="text" id="f-ville" value="${esc(bien?.ville||'')}" placeholder="Paris"></div>
            <div class="form-group"><label>Code postal</label><input type="text" id="f-cp" value="${esc(bien?.code_postal||'')}" placeholder="75018"></div>
            <div class="form-group"><label>Type de bien</label>
              <select id="f-type">${TI_BIENS.options('TYPES', bien?.type_bien)}</select>
            </div>
            <div class="form-group"><label>Surface (m²)</label><input type="number" id="f-surface" value="${esc(bien?.surface_m2||'')}" placeholder="45"></div>
            <div class="form-group"><label>Prix affiché (€)</label><input type="number" id="f-prix" value="${esc(bien?.prix_affiche||'')}" oninput="updatePrev()" placeholder="300 000"></div>
            <div class="form-group"><label>Statut</label>
              ${/* Bien acquis : le statut ne se change plus par une liste. Le
                    select est desactive et porte la valeur reelle ; l'aller
                    comme le retour passent par les actions dediees de la fiche.
                    ⚠️ Un champ `disabled` n'est PAS soumis — d'ou le champ
                    cache qui l'accompagne : sans lui `getFormData()` lirait une
                    chaine vide et retrograderait le bien a « Renseignements
                    Web » au premier enregistrement.
                    ⚠️ Commentaire en JS et non en HTML : un accent grave dans
                    un commentaire HTML REFERME le litteral (piege du 14/08). */''}
              ${sfDetenu(bien || {}) ? `
                <select id="f-statut-affiche" disabled aria-describedby="f-statut-aide">
                  <option>${esc(bien.statut)}</option>
                </select>
                <input type="hidden" id="f-statut" value="${esc(bien.statut)}">
                <p class="form-aide" id="f-statut-aide">Bien acquis. Pour le remettre en prospection, utilisez l'action prévue sur sa fiche.</p>`
              : `<select id="f-statut">${TI_BIENS.options('STATUTS_SAISISSABLES', bien?.statut)}</select>`}
            </div>
            <div class="form-group form-full"><label>Lien de l'annonce</label><input type="url" id="f-lien" value="${esc(bien?.lien_annonce||'')}" placeholder="https://www.seloger.com/..."></div>
            <div class="form-group"><label>Source</label>
              <select id="f-source">${TI_BIENS.options('SOURCES', bien?.source, '—')}</select>
            </div>
            <div class="form-group"><label>Balise</label>
              <select id="f-balise">${TI_BIENS.options('BALISES', bien?.balise, '— Sans balise —')}</select>
            </div>
            <div class="form-group"><label>SCI associée</label>
              <select id="f-sci-id">
                <option value="">— Aucune SCI —</option>
                ${allSCI.map(s=>`<option value="${s.id}" ${bien?.sci_id===s.id?'selected':''}>${esc(s.nom_sci)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <!-- Acquisition -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('euro',16)} Coûts d'acquisition</div>
          <div class="form-grid cols3">
            <div class="form-group"><label>Prix HA (€)</label><input type="number" id="f-ha" value="${esc(bien?.prix_affiche||'')}" oninput="updateNotaire();updatePrev()" placeholder="300 000"></div>
            <div class="form-group">
              <label>Frais de notaire <span style="color:var(--positive-c);font-weight:600">(${+(notairePct()*100).toFixed(1)}% auto)</span></label>
              <div class="calc-field" id="f-notaire-display">
                <span class="calc-field-badge">🔒 Auto</span>
                <span id="notaire-val">${bien?.prix_affiche?fmt(Math.round((bien.prix_affiche||0)*notairePct()))+' €':'—'}</span>
              </div>
            </div>
            <div class="form-group"><label>Travaux (€)</label><input type="number" id="f-travaux" value="${esc(bien?.travaux||'')}" oninput="updatePrev()" placeholder="0"></div>
            <div class="form-group"><label>Frais d'agence (€)</label><input type="number" id="f-agence" value="${esc(bien?.frais_agence||'')}" oninput="updatePrev()" placeholder="0"></div>
            <div class="form-group">
              <label>Création SCI</label>
              <div class="sci-toggle">
                <button class="sci-btn ${!sciOui?'active':''}" onclick="setSCI(false)">Non — 0 €</button>
                <button class="sci-btn ${sciOui?'active':''}" onclick="setSCI(true)">Oui</button>
              </div>
              <div class="sci-amount" id="sci-amount-wrap" style="display:${sciOui?'block':'none'}">
                <input type="number" id="f-sci" value="${esc(bien?.creation_sci&&parseFloat(bien.creation_sci)>0?bien.creation_sci:'')}" placeholder="Montant SCI (€)" oninput="updatePrev()">
              </div>
            </div>
          </div>
        </div>

        <!-- Crédit -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('banque',16)} Crédit bancaire</div>
          <div class="form-grid">
            <div class="form-group"><label>Mensualité (€/mois)</label><input type="number" id="f-mensualite" value="${esc(bien?.mensualite_credit||'')}" oninput="updatePrev()" placeholder="1 200"></div>
            <div class="form-group"><label>Durée (ans)</label><input type="number" id="f-duree" value="${esc(bien?.duree_credit_ans||userPrefs.duree_credit_ans||20)}"></div>
          </div>
        </div>

        <!-- Charges -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('doc',16)} Charges mensuelles</div>
          <div class="form-grid cols3">
            <div class="form-group"><label>Charges copro (€/mois)</label><input type="number" id="f-copro" value="${esc(bien?.charge_copro||'')}" oninput="updatePrev()" placeholder="0"></div>
            <div class="form-group"><label>Assurance (€/mois)</label><input type="number" id="f-assurance" value="${esc(bien?.assurance_logement||userPrefs.assurance_mois||33)}" oninput="updatePrev()"></div>
            <div class="form-group"><label>Taxe foncière (€/mois)</label><input type="number" id="f-taxe" value="${esc(bien?.taxe_fonciere||'')}" oninput="updatePrev()" placeholder="0"></div>
          </div>
        </div>

        <!-- Loyers -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('maison',16)} Revenus locatifs (en état)</div>
          <div class="form-grid">
            <div class="form-group"><label>Loyer hors charges (€/mois)</label><input type="number" id="f-loyer" value="${esc(bien?.loyer_en_etat||'')}" oninput="updatePrev()" placeholder="1 500"></div>
            <div class="form-group"><label>Charges locataire (€/mois)</label><input type="number" id="f-charges-loc" value="${esc(bien?.charges_locataire_etat||'')}" oninput="updatePrev()" placeholder="0"></div>
          </div>
        </div>

        <!-- Loyers après travaux -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('wrench',16)} Revenus locatifs (après travaux)</div>
          <div class="form-grid">
            <div class="form-group"><label>Loyer après travaux (€/mois)</label><input type="number" id="f-loyer-travaux" value="${esc(bien?.loyer_apres_travaux||'')}" placeholder="1 800"></div>
            <div class="form-group"><label>Charges locataire après travaux (€/mois)</label><input type="number" id="f-charges-travaux" value="${esc(bien?.charges_locataire_travaux||'')}" placeholder="0"></div>
          </div>
        </div>

        <!-- Contact -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('user',16)} Contact</div>
          <div class="form-grid cols3">
            <div class="form-group"><label>Intermédiaire</label><input type="text" id="f-inter" value="${esc(bien?.intermediaire||'')}" placeholder="Agence / Particulier"></div>
            <div class="form-group"><label>Téléphone</label><input type="text" id="f-tel" value="${esc(bien?.telephone||'')}"></div>
            <div class="form-group"><label>Mail</label><input type="email" id="f-mail" value="${esc(bien?.mail||'')}"></div>
          </div>
        </div>

        <!-- Médias -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('trombone',16)} Photos & documents</div>
          <div class="form-group" style="margin-bottom:12px">
            <label>Photos du bien</label>
            <div class="photo-upload-area" onclick="document.getElementById('bien-photo-input').click()" style="padding:14px">
              📸 Ajouter des photos (JPG, PNG)
            </div>
            <input type="file" id="bien-photo-input" accept="image/*" multiple style="display:none" onchange="handleBienPhotos(event)">
            <div class="media-grid" id="bien-photos-grid">
              ${bienPhotos.map((p,i)=>`<div class="media-thumb-wrap"><img class="media-thumb" src="${p}"><button class="media-remove" onclick="removeBienPhoto(${i})">✕</button></div>`).join('')}
            </div>
          </div>
          <div class="form-group">
            <label>Documents (PDF)</label>
            <div class="photo-upload-area" onclick="document.getElementById('bien-doc-input').click()" style="padding:14px">
              📄 Ajouter des PDF (offre, compromis, devis...)
            </div>
            <input type="file" id="bien-doc-input" accept="application/pdf" multiple style="display:none" onchange="handleBienDocs(event)">
            <div class="media-grid" id="bien-docs-grid">
              ${bienDocs.map((d,i)=>`<div class="media-thumb-wrap"><div class="media-thumb-doc">📄<span>${d.name||'PDF'}</span></div><button class="media-remove" onclick="removeBienDoc(${i})">✕</button></div>`).join('')}
            </div>
          </div>
        </div>

        <!-- Notes -->
        <div class="form-card">
          <div class="form-card-title">${sfAccIcon('crayon',16)} Notes & commentaires</div>
          <div class="form-group"><textarea id="f-notes" placeholder="Points d'attention, observations, négociation prévue...">${esc(bien?.notes||'')}</textarea></div>
        </div>

        <div class="form-actions">
          ${bien?`<button class="btn btn-danger" onclick="deleteBienPage('${bien.id}')">${sfAccIcon('poubelle',14)} Supprimer</button>`:''}
          <button class="btn btn-secondary" onclick="navigate('biens')">Annuler</button>
          <button class="btn btn-primary" id="btn-save" onclick="saveBien()">${bien?sfAccIcon('check',14)+' Enregistrer':'＋ Ajouter le bien'}</button>
        </div>
      </div>

      <!-- COLONNE SYNTHÈSE (droite sticky) -->
      <div class="nouveau-sticky-col">

        <!-- Cashflow -->
        <div class="cf-preview-big" style="margin-bottom:0">
          <div class="cf-preview-label">Cashflow mensuel estimé</div>
          <div class="cf-preview-value" id="cf-preview">— €/mois</div>
        </div>

        <!-- Synthèse financière -->
        <div class="synthese-card">
          <div class="synthese-title">${sfAccIcon('graph',16)} Synthèse financière</div>
          <div class="synthese-row">
            <span class="synthese-label">Prix affiché</span>
            <span class="synthese-value" id="syn-prix">—</span>
          </div>
          <div class="synthese-row">
            <span class="synthese-label">Montant à emprunter</span>
            <span class="synthese-value" id="syn-emprunt">—</span>
          </div>
          <div class="synthese-row">
            <span class="synthese-label">Frais notaire (${+(notairePct()*100).toFixed(1)}%)</span>
            <span class="synthese-value" id="syn-notaire">—</span>
          </div>
          <div class="synthese-row">
            <span class="synthese-label">Loyer estimé</span>
            <span class="synthese-value" id="syn-loyer">—</span>
          </div>
          <div class="synthese-row">
            <span class="synthese-label">Charges totales/mois</span>
            <span class="synthese-value" id="syn-charges">—</span>
          </div>
          <div class="synthese-row">
            <span class="synthese-label">Rendement brut</span>
            <span class="synthese-value" id="syn-rendement">—</span>
          </div>
        </div>

        <!-- Checklist de complétion -->
        <div class="synthese-card">
          <div class="synthese-title">${sfAccIcon('ok',16)} Complétion de la fiche</div>
          <div class="checklist-item"><div class="check-dot" id="chk-titre"></div>Titre de l'annonce</div>
          <div class="checklist-item"><div class="check-dot" id="chk-ville"></div>Ville</div>
          <div class="checklist-item"><div class="check-dot" id="chk-prix"></div>Prix affiché</div>
          <div class="checklist-item"><div class="check-dot" id="chk-loyer"></div>Loyer estimé</div>
          <div class="checklist-item"><div class="check-dot" id="chk-mensualite"></div>Mensualité crédit</div>
          <div class="checklist-item"><div class="check-dot" id="chk-lien"></div>Lien de l'annonce</div>
          <div class="checklist-item"><div class="check-dot" id="chk-contact"></div>Contact renseigné</div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--c-border)">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--c-dim);margin-bottom:5px">
              <span>Complétion</span><span id="chk-pct" style="font-weight:700">0%</span>
            </div>
            <div style="height:6px;background:var(--c-bg);border-radius:3px;overflow:hidden">
              <div id="chk-bar" style="height:100%;border-radius:3px;background:var(--accent);transition:width 0.4s;width:0%"></div>
            </div>
          </div>
        </div>

      </div>
    </div>
  `;
  // P5 : arrivée depuis « Créer une fiche bien ici » (section Marché)
  if(!bien && nouveauPrefill) {
    const v = document.getElementById('f-ville'), c = document.getElementById('f-cp');
    if(v) v.value = nouveauPrefill.ville || '';
    if(c) c.value = nouveauPrefill.code_postal || '';
    showNotif(`${nouveauPrefill.ville} pré-rempli depuis l'analyse de marché`);
    nouveauPrefill = null;
    document.getElementById('f-titre')?.focus();
  }
  updatePrev();
}

// ── Normalisation hybride Storage / base64 ──
// Storage prioritaire (paths), fallback base64 (legacy) pour la transition.
function tiNormalizePhotos(paths, legacyB64, bucket) {
  if (Array.isArray(paths) && paths.length) {
    return paths.map(p => ({ kind: 'storage', bucket, path: p.path, name: p.name || 'photo' }));
  }
  if (Array.isArray(legacyB64) && legacyB64.length) {
    return legacyB64.map(d => ({ kind: 'b64', data: d, name: 'photo' }));
  }
  return [];
}
function tiNormalizeDocs(paths, legacyB64, bucket) {
  if (Array.isArray(paths) && paths.length) {
    return paths.map(p => ({ kind: 'storage', bucket, path: p.path, name: p.name || 'document.pdf' }));
  }
  if (Array.isArray(legacyB64) && legacyB64.length) {
    return legacyB64.map(d => ({ kind: 'b64', data: d.data || d, name: d.name || 'document.pdf' }));
  }
  return [];
}

// ═══════════════════════════════════════════════════════════
//   MIGRATION base64 → Storage (idempotente, admin uniquement)
// ═══════════════════════════════════════════════════════════
async function tiMigrateToStorage() {
  if (!currentUser) { showNotif('Non authentifié', true); return; }
  const logEl = document.getElementById('ti-migration-log');
  const btn = document.getElementById('ti-migration-btn');
  const log = (msg) => { if(logEl){ logEl.innerHTML += msg + '<br>'; logEl.scrollTop = logEl.scrollHeight; } };
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Migration en cours...'; }
  if(logEl){ logEl.style.display = 'block'; logEl.innerHTML = ''; }

  let totalMigrated = 0, totalErrors = 0;

  try {
    // ── 1. BIENS : photos + documents ──
    log('<strong>📦 Biens (photos + documents)...</strong>');
    const { data: biens, error: bErr } = await db.from('biens')
      .select('id, photos, documents, photos_paths, documents_paths')
      .eq('user_id', currentUser.id);
    if (bErr) throw bErr;

    for (const b of biens || []) {
      const needPhotos = (!b.photos_paths || b.photos_paths.length === 0) && Array.isArray(b.photos) && b.photos.length > 0;
      const needDocs = (!b.documents_paths || b.documents_paths.length === 0) && Array.isArray(b.documents) && b.documents.length > 0;
      if (!needPhotos && !needDocs) continue;

      const update = {};
      if (needPhotos) {
        const paths = [];
        for (let i = 0; i < b.photos.length; i++) {
          try {
            const up = await TI_STORAGE.uploadDataURL('biens-photos', b.id, b.photos[i], `photo-${i+1}.jpg`);
            paths.push({ path: up.path, name: up.name });
            totalMigrated++;
          } catch(e) { totalErrors++; log(`&nbsp;&nbsp;⚠️ photo ${i+1} bien ${b.id.slice(0,8)} : ${e.message}`); }
        }
        update.photos_paths = paths;
      }
      if (needDocs) {
        const paths = [];
        for (let i = 0; i < b.documents.length; i++) {
          const d = b.documents[i];
          try {
            const up = await TI_STORAGE.uploadDataURL('biens-documents', b.id, d.data || d, d.name || `doc-${i+1}.pdf`);
            paths.push({ path: up.path, name: up.name });
            totalMigrated++;
          } catch(e) { totalErrors++; log(`&nbsp;&nbsp;⚠️ doc ${i+1} bien ${b.id.slice(0,8)} : ${e.message}`); }
        }
        update.documents_paths = paths;
      }
      if (Object.keys(update).length) {
        const { error: uErr } = await db.from('biens').update(update).eq('id', b.id);
        if (uErr) { totalErrors++; log(`&nbsp;&nbsp;⚠️ update bien ${b.id.slice(0,8)} : ${uErr.message}`); }
        else log(`&nbsp;&nbsp;✓ Bien ${b.id.slice(0,8)} migré`);
      }
    }

    log(`<br><strong>📸 Visites (photos)...</strong>`);
    const { data: visites, error: vErr } = await db.from('visites')
      .select('id, photos, photos_paths')
      .eq('user_id', currentUser.id);
    if (vErr) throw vErr;
    for (const v of visites || []) {
      const need = (!v.photos_paths || v.photos_paths.length === 0) && Array.isArray(v.photos) && v.photos.length > 0;
      if (!need) continue;
      const paths = [];
      for (let i = 0; i < v.photos.length; i++) {
        try {
          const up = await TI_STORAGE.uploadDataURL('visites-photos', v.id, v.photos[i], `photo-${i+1}.jpg`);
          paths.push({ path: up.path, name: up.name });
          totalMigrated++;
        } catch(e) { totalErrors++; log(`&nbsp;&nbsp;⚠️ photo ${i+1} visite ${v.id.slice(0,8)} : ${e.message}`); }
      }
      const { error: uErr } = await db.from('visites').update({ photos_paths: paths }).eq('id', v.id);
      if (uErr) { totalErrors++; log(`&nbsp;&nbsp;⚠️ update visite ${v.id.slice(0,8)} : ${uErr.message}`); }
      else log(`&nbsp;&nbsp;✓ Visite ${v.id.slice(0,8)} migrée`);
    }

    log(`<br><strong>🏦 Simulations (PDF)...</strong>`);
    const { data: sims, error: sErr } = await db.from('simulations_credit')
      .select('id, pdf_data, pdf_name, pdf_path')
      .eq('user_id', currentUser.id);
    if (sErr) throw sErr;
    for (const sim of sims || []) {
      const need = !sim.pdf_path && sim.pdf_data && sim.pdf_data.startsWith('data:');
      if (!need) continue;
      try {
        const up = await TI_STORAGE.uploadDataURL('simulations-pdf', sim.id, sim.pdf_data, sim.pdf_name || 'simulation.pdf');
        const { error: uErr } = await db.from('simulations_credit').update({ pdf_path: up.path }).eq('id', sim.id);
        if (uErr) { totalErrors++; log(`&nbsp;&nbsp;⚠️ update sim ${sim.id.slice(0,8)} : ${uErr.message}`); }
        else { totalMigrated++; log(`&nbsp;&nbsp;✓ Simulation ${sim.id.slice(0,8)} migrée`); }
      } catch(e) { totalErrors++; log(`&nbsp;&nbsp;⚠️ PDF sim ${sim.id.slice(0,8)} : ${e.message}`); }
    }

    log(`<br><strong>👤 Locataires (documents)...</strong>`);
    const { data: locs, error: lErr } = await db.from('locataires')
      .select('id, documents')
      .eq('user_id', currentUser.id);
    if (lErr) throw lErr;
    for (const loc of locs || []) {
      if (!Array.isArray(loc.documents) || !loc.documents.length) continue;
      let needUpdate = false;
      const migrated = [];
      for (const doc of loc.documents) {
        if (doc.storage_path) { migrated.push(doc); continue; }
        if (doc.data && doc.data.startsWith('data:')) {
          try {
            const up = await TI_STORAGE.uploadDataURL('locataires-documents', loc.id, doc.data, doc.name);
            migrated.push({ name:doc.name, type:doc.type, mime:doc.mime, size:doc.size, uploaded_at:doc.uploaded_at, storage_path:up.path, data:null });
            needUpdate = true;
            totalMigrated++;
          } catch(e) { totalErrors++; migrated.push(doc); log(`&nbsp;&nbsp;⚠️ doc locataire ${loc.id.slice(0,8)} : ${e.message}`); }
        } else { migrated.push(doc); }
      }
      if (needUpdate) {
        const { error: uErr } = await db.from('locataires').update({ documents: migrated }).eq('id', loc.id);
        if (uErr) { totalErrors++; log(`&nbsp;&nbsp;⚠️ update locataire ${loc.id.slice(0,8)} : ${uErr.message}`); }
        else log(`&nbsp;&nbsp;✓ Locataire ${loc.id.slice(0,8)} migré`);
      }
    }

    log(`<br><strong>✅ Migration terminée</strong>`);
    log(`Fichiers migrés : ${totalMigrated} · Erreurs : ${totalErrors}`);
    log(`<em>Note : les colonnes base64 d'origine sont conservées (filet de sécurité). On les videra plus tard une fois la validation confirmée.</em>`);
    if (totalMigrated > 0) await loadBiens();
    showNotif(`Migration : ${totalMigrated} fichier(s) migré(s)${totalErrors?', '+totalErrors+' erreur(s)':''}`, totalErrors>0);
  } catch(e) {
    log(`<br><strong style="color:var(--sf-loss)">❌ Erreur globale : ${e.message}</strong>`);
    showNotif('Erreur migration : '+e.message, true);
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = '🔄 Lancer la migration base64 → Storage'; }
  }
}

// ── Remplit les vignettes Storage en post-rendu (data-thumb-bucket/path) ──
async function tiFillThumbs(scopeEl) {
  const root = scopeEl || document;
  const thumbs = root.querySelectorAll('[data-thumb-path]');
  for (const el of thumbs) {
    const bucket = el.getAttribute('data-thumb-bucket');
    const path = el.getAttribute('data-thumb-path');
    if (!bucket || !path) continue;
    const url = await TI_STORAGE.signedUrl(bucket, path);
    if (url) {
      el.style.backgroundImage = `url('${url}')`;
      el.textContent = '';
    }
    el.removeAttribute('data-thumb-path'); // évite de re-signer
  }
}

// ── Résolution média pour AFFICHAGE (Storage → signed URL, fallback base64) ──
async function tiResolveMedia(paths, legacyB64, bucket) {
  if (Array.isArray(paths) && paths.length) {
    const out = [];
    for (const p of paths) {
      const url = await TI_STORAGE.signedUrl(bucket, p.path);
      if (url) out.push({ url, name: p.name || 'photo' });
    }
    return out;
  }
  if (Array.isArray(legacyB64) && legacyB64.length) {
    return legacyB64.map(d => ({ url: d, name: 'photo' }));
  }
  return [];
}
async function tiResolveDocs(paths, legacyB64, bucket) {
  if (Array.isArray(paths) && paths.length) {
    const out = [];
    for (const p of paths) {
      const url = await TI_STORAGE.signedUrl(bucket, p.path);
      if (url) out.push({ url, name: p.name || 'document.pdf' });
    }
    return out;
  }
  if (Array.isArray(legacyB64) && legacyB64.length) {
    return legacyB64.map(d => ({ url: d.data || d, name: d.name || 'document.pdf' }));
  }
  return [];
}

function handleBienPhotos(e) {
  Array.from(e.target.files).forEach(f=>{
    if(!f.type.startsWith('image/')) return;
    const r=new FileReader();
    r.onload=ev=>{bienPhotos.push({kind:'b64', data:ev.target.result, name:f.name, _file:f});refreshBienPhotos();};
    r.readAsDataURL(f);
  });
}

function removeBienPhoto(i){bienPhotos.splice(i,1);refreshBienPhotos();}

async function refreshBienPhotos(){
  const el=document.getElementById('bien-photos-grid');
  if(!el) return;
  // Affichage : b64 direct, storage via URL signée (async)
  const items = await Promise.all(bienPhotos.map(async (p,i)=>{
    let src = p.kind==='b64' ? p.data : await TI_STORAGE.signedUrl(p.bucket||'biens-photos', p.path);
    return `<div class="media-thumb-wrap"><img class="media-thumb" src="${src||''}"><button class="media-remove" onclick="removeBienPhoto(${i})">✕</button></div>`;
  }));
  el.innerHTML = items.join('');
}

function handleBienDocs(e){
  Array.from(e.target.files).forEach(f=>{
    const r=new FileReader();
    r.onload=ev=>{bienDocs.push({kind:'b64', data:ev.target.result, name:f.name, _file:f});refreshBienDocs();};
    r.readAsDataURL(f);
  });
}

function removeBienDoc(i){bienDocs.splice(i,1);refreshBienDocs();}

function refreshBienDocs(){
  const el=document.getElementById('bien-docs-grid');
  if(el)el.innerHTML=bienDocs.map((d,i)=>`<div class="media-thumb-wrap"><div class="media-thumb-doc">📄<span style="font-size:9px;text-align:center;padding:2px">${(d.name||'').substring(0,10)}</span></div><button class="media-remove" onclick="removeBienDoc(${i})">✕</button></div>`).join('');
}

function setSCI(oui) {
  sciOui = oui;
  document.querySelectorAll('.sci-btn').forEach((b,i)=>b.classList.toggle('active',i===(oui?1:0)));
  document.getElementById('sci-amount-wrap').style.display = oui ? 'block' : 'none';
  if (!oui) { const el=document.getElementById('f-sci'); if(el)el.value=''; }
  updatePrev();
}

function updateNotaire() {
  const ha = parseFloat(document.getElementById('f-ha')?.value)||0;
  const el = document.getElementById('notaire-val');
  if (el) el.textContent = ha > 0 ? fmt(Math.round(ha*notairePct()))+' €' : '—';
}

function updatePrev() {
  const v = id => parseFloat(document.getElementById(id)?.value)||0;
  const s = id => document.getElementById(id)?.value||'';
  const ha = v('f-ha')||v('f-prix');
  const prix = v('f-prix');
  const notaire = Math.round(ha*notairePct());
  const travaux = v('f-travaux');
  const agence = v('f-agence');
  const sciVal = sciOui ? v('f-sci') : 0;
  const emprunt = ha + notaire + travaux + agence + sciVal;
  const loyer = v('f-loyer') + v('f-charges-loc');
  const ch = v('f-mensualite') + v('f-copro') + v('f-assurance') + v('f-taxe');
  const cf = loyer - ch;
  const rendement = prix && v('f-loyer') ? ((v('f-loyer')*12/prix)*100).toFixed(1)+'%' : '—';

  // Cashflow preview
  const cfEl = document.getElementById('cf-preview');
  if (cfEl) {
    if (!loyer && !ch) { cfEl.textContent='— €/mois'; cfEl.className='cf-preview-value'; }
    else { cfEl.textContent=fmt(cf)+' €/mois'; cfEl.className='cf-preview-value '+(cf>=0?'positive':'negative'); }
  }

  // Synthèse panel
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  set('syn-prix', prix?fmt(prix)+' €':'—');
  set('syn-emprunt', emprunt>0?fmt(emprunt)+' €':'—');
  set('syn-notaire', ha?fmt(notaire)+' €':'—');
  set('syn-loyer', v('f-loyer')?fmt(v('f-loyer'))+' €/mois':'—');
  set('syn-charges', ch?fmt(ch)+' €/mois':'—');
  set('syn-rendement', rendement);

  // Apply color to cashflow synthèse
  const cfSyn = document.getElementById('cf-preview');
  if(cfSyn && (loyer||ch)) cfSyn.className='cf-preview-value '+(cf>=0?'positive':'negative');

  // Checklist
  const checks = [
    ['chk-titre', !!s('f-titre')],
    ['chk-ville', !!s('f-ville')],
    ['chk-prix', !!v('f-prix')],
    ['chk-loyer', !!v('f-loyer')],
    ['chk-mensualite', !!v('f-mensualite')],
    ['chk-lien', !!s('f-lien')],
    ['chk-contact', !!(s('f-inter')||s('f-tel')||s('f-mail'))],
  ];
  let done = 0;
  checks.forEach(([id, ok]) => {
    const dot = document.getElementById(id);
    if(dot) dot.className = 'check-dot'+(ok?' done':'');
    if(ok) done++;
  });
  const pct = Math.round(done/checks.length*100);
  const pctEl = document.getElementById('chk-pct');
  const barEl = document.getElementById('chk-bar');
  if(pctEl) pctEl.textContent = pct+'%';
  if(barEl) { barEl.style.width=pct+'%'; barEl.style.background=pct===100?'var(--positive-c)':pct>=50?'var(--accent)':'var(--warning)'; }

  updateNotaire();
}

function getFormData() {
  const v = id => parseFloat(document.getElementById(id)?.value)||0;
  const s = id => document.getElementById(id)?.value||null;
  const ha = v('f-ha')||v('f-prix');
  const sciVal = sciOui ? (v('f-sci')||0) : 0;
  return {
    titre:s('f-titre'),ville:s('f-ville'),code_postal:s('f-cp'),type_bien:s('f-type'),
    surface_m2:v('f-surface')||null,prix_affiche:v('f-prix')||null,lien_annonce:s('f-lien'),
    source:s('f-source'),
    statut:s('f-statut')||'Renseignements Web',
    balise:s('f-balise')||null,
    frais_notaire: Math.round(ha*notairePct()),
    travaux:v('f-travaux'),frais_agence:v('f-agence'),creation_sci:sciVal,
    mensualite_credit:v('f-mensualite'),duree_credit_ans:parseInt(s('f-duree'))||20,
    charge_copro:v('f-copro'),assurance_logement:v('f-assurance')||33,taxe_fonciere:v('f-taxe'),
    loyer_en_etat:v('f-loyer'),charges_locataire_etat:v('f-charges-loc'),
    loyer_apres_travaux:v('f-loyer-travaux')||null,
    charges_locataire_travaux:v('f-charges-travaux')||null,
    /* ⚠️ `mode_detention` s'écrit AVEC `sci_id`, dans le même enregistrement.
       Le formulaire porte « SCI associée » avec une option « — Aucune SCI — » :
       la choisir sur un bien marqué 'sci' écrivait `sci_id = null` en laissant
       le mode, et l'invariant `biens_mode_detention_coherent` aurait alors fait
       ÉCHOUER TOUT L'ENREGISTREMENT — perdant les autres modifications de la
       fiche. C'est pour cela que la partie B de la migration attendait.
       ⚠️ Retirer la SCI ne veut pas dire « en propre » : cela rouvre la
       question. On remet `null` plutôt que de deviner. Un bien déjà déclaré
       « en propre » garde son mode : il n'avait pas de SCI à perdre. */
    sci_id:s('f-sci-id')||null,
    mode_detention: s('f-sci-id') ? 'sci'
      : (allBiens.find(b => b.id === editingId)?.mode_detention === 'propre' ? 'propre' : null),
    intermediaire:s('f-inter'),telephone:s('f-tel'),mail:s('f-mail'),notes:s('f-notes'),
    user_id: currentUser?.id,
  };
}

async function saveBien() {
  const btn=document.getElementById('btn-save');
  const data=getFormData();
  if(!data.titre){showNotif('Le titre est requis',true);return;}
  btn.disabled=true;btn.textContent='⏳ Enregistrement...';
  try {
    // 1. Insert/update du bien SANS les fichiers → on récupère l'id
    let bienId = editingId;
    if(editingId){
      const {error} = await db.from('biens').update(data).eq('id',editingId);
      if(error) throw error;
    } else {
      const {data:inserted, error} = await db.from('biens').insert(data).select('id').single();
      if(error) throw error;
      bienId = inserted.id;
    }

    // 2. Upload des NOUVEAUX fichiers (kind:'b64') vers Storage
    btn.textContent='⏳ Upload des fichiers...';
    const photosPaths = [];
    for(const p of bienPhotos){
      if(p.kind==='storage'){ photosPaths.push({path:p.path, name:p.name}); }
      else if(p.kind==='b64'){
        const up = await TI_STORAGE.upload('biens-photos', bienId, p._file || TI_STORAGE._dataURLtoBlob(p.data), p.name);
        photosPaths.push({path:up.path, name:up.name});
      }
    }
    const docsPaths = [];
    for(const d of bienDocs){
      if(d.kind==='storage'){ docsPaths.push({path:d.path, name:d.name}); }
      else if(d.kind==='b64'){
        const up = await TI_STORAGE.upload('biens-documents', bienId, d._file || TI_STORAGE._dataURLtoBlob(d.data), d.name);
        docsPaths.push({path:up.path, name:up.name});
      }
    }

    // 3. Mise à jour des colonnes paths (et on vide le base64 legacy pour ce bien)
    const {error:upErr} = await db.from('biens').update({
      photos_paths: photosPaths,
      documents_paths: docsPaths,
      photos: [],      // legacy vidé : les fichiers vivent dans Storage désormais
      documents: [],
    }).eq('id', bienId);
    if(upErr) throw upErr;

    showNotif(editingId?'✓ Bien mis à jour':'✓ Bien ajouté !');
    await loadBiens();navigate('biens');
  } catch(error) {
    showNotif('Erreur : '+error.message,true);
    btn.innerHTML=editingId?sfAccIcon('check',14)+' Enregistrer':'＋ Ajouter le bien';
  } finally {
    btn.disabled=false;
  }
}

async function deleteBienPage(id) {
  if(!confirm('Supprimer ce bien définitivement ?'))return;
  // Nettoyer les fichiers Storage rattachés (best-effort, avant suppression DB)
  const b = allBiens.find(x=>x.id===id);
  if(b){
    const ph = (Array.isArray(b.photos_paths)?b.photos_paths:[]).map(p=>p.path).filter(Boolean);
    const dc = (Array.isArray(b.documents_paths)?b.documents_paths:[]).map(p=>p.path).filter(Boolean);
    if(ph.length) await TI_STORAGE.remove('biens-photos', ph);
    if(dc.length) await TI_STORAGE.remove('biens-documents', dc);
  }
  const{error}=await db.from('biens').delete().eq('id',id);
  if(error){showNotif('Erreur',true);return;}
  showNotif('Bien supprimé');await loadBiens();navigate('biens');
}

// ── DETAIL ──
// ── LIGHTBOX ──
// filterByPhase supprimee en phase 5 : elle alimentait les pastilles de
// phase de l ancien tableau de bord, qui n existent plus.

function openLightbox(src) {
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.getElementById('lightbox-img').src = '';
}
document.addEventListener('keydown', e => { if(e.key==='Escape') closeLightbox(); });

async function genTestData() {
  // 3 biens rentables + 2 négatifs, données réalistes
  const positifs = [
    {v:'Paris 18e',cp:'75018',t:'Immeuble',s:180,p:650000,loyer:4200,mens:2800,statut:'Vendeur contacté (1ère)',note:'Immeuble de rapport 4 lots. Fort potentiel locatif, emplacement prime.'},
    {v:'Lyon',cp:'69007',t:'T3',s:68,p:220000,loyer:1050,mens:850,statut:'1ère offre - Envoyée',note:'Bien en bon état, proche métro. Rendement brut 5.7%.'},
    {v:'Bordeaux',cp:'33000',t:'T2',s:45,p:175000,loyer:850,mens:700,statut:'Dossier déposé',note:'Studio rénové, quartier Saint-Michel. Locataire en place.'},
  ];
  const negatifs = [
    {v:'Paris 16e',cp:'75016',t:'T4+',s:95,p:850000,loyer:2800,mens:3600,statut:'Renseignements Web',note:'Prix marché très élevé. Cashflow négatif mais plus-value potentielle.'},
    {v:'Nice',cp:'06000',t:'T2',s:40,p:320000,loyer:1100,mens:1380,statut:'Rendez-vous banque',note:'Zone tendue, prix élevé. À surveiller pour une revente.'},
  ];
  const inserts = [...positifs,...negatifs].map(v => {
    const ha = v.p; const notaire = Math.round(ha*notairePct());
    const agence = Math.round(ha*0.05); const sci = 200;
    return {
      titre:`${v.t} ${v.v} — Test`,ville:v.v,code_postal:v.cp,type_bien:v.t,
      surface_m2:v.s,prix_affiche:v.p,statut:v.statut,notes:v.note,
      frais_notaire:notaire,frais_agence:agence,creation_sci:sci,
      mensualite_credit:v.mens,duree_credit_ans:20,
      charge_copro:Math.round(v.loyer*0.03),assurance_logement:33,taxe_fonciere:Math.round(v.loyer*0.04),
      loyer_en_etat:v.loyer,
      is_test:true,
      user_id:currentUser?.id
    };
  });
  const {error} = await db.from('biens').insert(inserts);
  if(error){showNotif('Erreur génération : '+error.message,true);return;}
  showNotif(`${inserts.length} fiches tests générées`);
  await loadBiens(); navigate(currentPage);
}

async function purgeTestData() {
  const n=allBiens.filter(b=>b.is_test).length;
  if(!n){showNotif('Aucune fiche test à supprimer');return;}
  if(!confirm(`Supprimer les ${n} fiche(s) test ?`))return;
  const{error}=await db.from('biens').delete().eq('is_test',true);
  if(error){showNotif('Erreur',true);return;}
  showNotif(`${n} fiche(s) test supprimée(s)`);
  await loadBiens();navigate(currentPage);
}

async function purgeAllData() {
  if(!confirm(`⚠️ ATTENTION : supprimer TOUTES les ${allBiens.length} fiches ? Cette action est irréversible.`))return;
  if(!confirm('Dernière confirmation : supprimer définitivement toutes les fiches ?'))return;
  const{error}=await db.from('biens').delete().neq('id','00000000-0000-0000-0000-000000000000');
  if(error){showNotif('Erreur',true);return;}
  showNotif('Toutes les fiches supprimées');
  await loadBiens();navigate(currentPage);
}

// ── DETAIL BIEN ENRICHI ──
// ─── Helpers d'édition inline (Notion-style) sur fiche bien ───
// Pattern : un span affiche la valeur, clic → input/select inline → blur/Entrée → sauve en BDD
//
// Format invocation : ie('bien-id', 'champ', 'affichage', 'type', extras?, brut?)
//   type : 'text' | 'number' | 'textarea' | 'select-statut' | 'select-type' | 'select-balise' | 'tel' | 'email'
//
// ⚠️ PERTE DE DONNEES CORRIGEE LE 05/08/2026 — `brut` n'existait pas.
// `data-value` recevait la valeur AFFICHEE, mise en forme : « 175 000 € ».
// `inlineEditField` la réinjectait dans un `<input type="number">`, qui refuse
// tout ce qui n'est pas un nombre : le champ s'ouvrait donc VIDE. Cliquer
// ailleurs sans rien saisir déclenchait alors une sauvegarde de la chaîne
// vide, que `inlineSaveBienField` convertit en `null` — le montant était
// effacé en base par un simple clic à côté. Tous les champs monétaires et la
// surface étaient concernés.
// Depuis : `brut` porte la valeur telle qu'elle est stockée, l'affichage reste
// mis en forme. Sans `brut`, on retombe sur l'affichage — sans risque pour les
// champs texte, où les deux coïncident.
function ie(bienId, field, value, type, extras, brut) {
  const safeVal = (value === null || value === undefined) ? '' : String(value);
  const display = safeVal || '—';
  const dataType = type || 'text';
  const extra = extras ? ' ' + extras : '';
  const dataVal = (brut === null || brut === undefined) ? safeVal : String(brut);
  return `<span class="inline-edit" data-id="${bienId}" data-field="${field}" data-type="${dataType}" data-value="${dataVal.replace(/"/g,'&quot;')}"${extra} onclick="inlineEditField(this)">${display.replace(/</g,'&lt;')}</span>`;
}

// Champ monétaire : affichage mis en forme, valeur brute conservée à part.
function ieEur(bienId, field, brut) {
  const v = parseFloat(brut) || 0;
  return ie(bienId, field, v ? sfEur(v) : '', 'number', null, v || '');
}

// Sauvegarde en BDD + mise à jour de la cache locale
async function inlineSaveBienField(span, newValue) {
  const id = span.dataset.id;
  const field = span.dataset.field;
  const type = span.dataset.type;

  // Validation côté client
  if(type === 'number' && newValue !== '' && newValue !== null) {
    const n = parseFloat(String(newValue).replace(',','.'));
    if(!Number.isFinite(n)) { showNotif('Valeur numérique invalide', true); return false; }
    newValue = n;
  } else if(newValue === '' || newValue === '—') {
    newValue = null;
  }

  span.classList.add('saving');
  const patch = { [field]: newValue };
  // Si on modifie le prix : recalculer frais_notaire (7%) auto
  if(field === 'prix_affiche' && newValue !== null) {
    patch.frais_notaire = Math.round(parseFloat(newValue) * notairePct());
  }

  try {
    const { error } = await db.from('biens').update(patch).eq('id', id).eq('user_id', currentUser.id);
    if(error) throw error;
    // Update cache locale
    const idx = allBiens.findIndex(x => x.id === id);
    if(idx >= 0) Object.assign(allBiens[idx], patch);
    span.classList.remove('saving');
    span.classList.add('saved-flash');
    setTimeout(() => span.classList.remove('saved-flash'), 600);
    showNotif('Mis à jour');
    // Si modification d'un champ financier, on recalcule le hero du modal
    if(['prix_affiche','frais_notaire','travaux','frais_agence','creation_sci','mensualite_credit','loyer_en_etat','charges_locataire_etat','charge_copro','assurance_logement','taxe_fonciere'].includes(field)) {
      inlineRefreshHero(id);
    }
    /* Le statut s'edite desormais aussi depuis la vue Tableau. Or la liste, ses
       onglets et ses indicateurs se calculent TOUS sur le statut : les laisser
       en place ferait diverger l'affichage de la donnee — c'est precisement ce
       que `applyFilters()` existe pour empecher (voir son en-tete). On repasse
       donc par ce point d'entree unique, et par lui seul. */
    if(field === 'statut' && currentPage === 'biens') applyFilters();
    // P4 : le bien vient de basculer en gestion → proposer les gestes qui suivent
    /* Plus de crochet « Acheté » ici : ce statut ne figure plus dans aucune
       liste déroulante (voir `TI_BIENS.STATUTS_SAISISSABLES`), l'édition en
       ligne ne peut donc plus le produire. L'acquisition passe par
       `bdDemarrerAcquisition()`. */
    return true;
  } catch(e) {
    span.classList.remove('saving');
    showNotif('Erreur : ' + (e.message || 'sauvegarde impossible'), true);
    console.error('[inlineSaveBienField]', e);
    return false;
  }
}

// Rafraîchit le hero du modal (cashflow + montant acquisition) après édition financière
function inlineRefreshHero(bienId) {
  const b = allBiens.find(x => x.id === bienId);
  if(!b) return;
  const cf = computeCF(b), has = b.mensualite_credit || b.loyer_en_etat;
  const emprunt = (parseFloat(b.prix_affiche)||0) + (parseFloat(b.frais_notaire)||0) + (parseFloat(b.travaux)||0) + (parseFloat(b.frais_agence)||0) + (parseFloat(b.creation_sci)||0);
  const cfEl = document.querySelector('#detail-content .bien-detail-cf');
  if(cfEl) {
    cfEl.style.color = !has ? 'rgba(255,255,255,0.5)' : cf >= 0 ? '#bbf7d0' : '#fecdd3';
    cfEl.textContent = has ? fmt(cf) + ' €/mois' : '—';
  }
  const acqEl = document.querySelector('#detail-content .bien-detail-hero div:first-child div:last-child');
  if(acqEl && acqEl.textContent.startsWith('Acquisition totale')) {
    acqEl.textContent = 'Acquisition totale : ' + (emprunt ? fmt(emprunt) + ' €' : '—');
  }
  // Frais notaire affiché peut aussi avoir bougé
  const fnSpan = document.querySelector(`#detail-content .inline-edit[data-id="${bienId}"][data-field="frais_notaire"]`);
  if(fnSpan && b.frais_notaire != null) {
    fnSpan.dataset.value = b.frais_notaire;
    fnSpan.textContent = fmt(b.frais_notaire);
  }
}

// Active l'édition inline sur un span
function inlineEditField(span) {
  if(span.classList.contains('saving') || span.querySelector('input,select,textarea')) return;
  const type = span.dataset.type;
  const currentValue = span.dataset.value || '';
  const originalHtml = span.innerHTML;

  let inputEl;

  if(type === 'textarea') {
    inputEl = document.createElement('textarea');
    inputEl.className = 'inline-edit-textarea';
    inputEl.value = currentValue;
  } else if(type === 'select-statut') {
    inputEl = document.createElement('select');
    inputEl.className = 'inline-edit-input';
    inputEl.innerHTML = TI_BIENS.options('STATUTS_SAISISSABLES', currentValue);
  } else if(type === 'select-type') {
    inputEl = document.createElement('select');
    inputEl.className = 'inline-edit-input';
    inputEl.innerHTML = TI_BIENS.options('TYPES', currentValue);
  } else if(type === 'select-balise') {
    inputEl = document.createElement('select');
    inputEl.className = 'inline-edit-input';
    const balises = [{v:'',l:'— Sans balise —'},
      ...TI_BIENS.BALISES.map(b => ({ v:b.v, l:b.v }))];
    inputEl.innerHTML = balises.map(b => `<option value="${b.v}" ${b.v===currentValue?'selected':''}>${b.l}</option>`).join('');
  } else {
    inputEl = document.createElement('input');
    inputEl.className = 'inline-edit-input';
    inputEl.type = (type === 'number') ? 'number' : (type === 'tel') ? 'tel' : (type === 'email') ? 'email' : 'text';
    inputEl.value = currentValue;
  }

  span.innerHTML = '';
  span.appendChild(inputEl);

  let closing = false;
  const close = async (commit) => {
    if(closing) return;
    closing = true;
    if(commit) {
      const newVal = inputEl.value;
      if(String(newVal) !== String(currentValue)) {
        const ok = await inlineSaveBienField(span, newVal);
        if(ok) {
          // Re-render le span avec la nouvelle valeur
          const displayVal = (newVal === '' || newVal === null) ? '—' : newVal;
          // Si statut, on met le pill phase
          if(type === 'select-statut') {
            const phase = getStatutPhase(newVal);
            span.dataset.value = newVal;
            span.innerHTML = `<span class="statut-pill phase-${phase}">${newVal}</span>`;
          } else if(type === 'select-balise') {
            span.dataset.value = newVal;
            const bmap = Object.fromEntries(TI_BIENS.BALISES.map(b => [b.v, b.cls]));
            if(newVal && bmap[newVal]) {
              // Sans emoji : c'est ainsi que la balise est rendue partout
              // ailleurs. Sa COULEUR la distingue deja.
              span.innerHTML = `<span class="tag-pill ${bmap[newVal]}">${esc(newVal)}</span>`;
            } else {
              span.innerHTML = '— Sans balise —';
            }
          } else {
            // `data-value` garde la valeur BRUTE : c'est elle qui repartira
            // dans le champ à la prochaine ouverture, l'affichage seul est
            // mis en forme. Voir la mise en garde sur `ie()`.
            span.dataset.value = String(newVal ?? '');
            const moneyFields = ['prix_affiche','frais_notaire','travaux','frais_agence','creation_sci','mensualite_credit','loyer_en_etat','charges_locataire_etat','charge_copro','assurance_logement','taxe_fonciere','loyer_apres_travaux','charges_locataire_travaux'];
            if(moneyFields.includes(span.dataset.field) && newVal !== '') {
              span.textContent = sfEur(parseFloat(newVal));
            } else if(span.dataset.field === 'surface_m2' && newVal !== '') {
              span.textContent = newVal + ' m²';
            } else {
              span.textContent = String(displayVal).replace(/</g,'&lt;');
            }
          }
        } else {
          span.innerHTML = originalHtml;
        }
      } else {
        span.innerHTML = originalHtml;
      }
    } else {
      span.innerHTML = originalHtml;
    }
  };

  /* ── LES LISTES DÉROULANTES PASSENT PAR LE COMPOSANT DE LA PLATEFORME ─────
     ⚠️ DÉFAUT CORRIGÉ LE 14/08/2026 — la picklist « Statut » ne s'ouvrait pas.
     Deux mécanismes se disputaient le même `<select>` :
       · ici, on le créait et on lui donnait le focus ;
       · 30 ms plus tard, l'observateur de `.sf-pick` le DÉPLAÇAIT dans une
         enveloppe, le passait en `opacity:0; pointer-events:none` et posait un
         bouton à sa place.
     Le premier clic ne pouvait donc rien ouvrir : la cible changeait de forme
     et de nature sous le curseur, et le focus partait sans un événement (voir
     la mise en garde dans `sfSelectInit`). Il fallait un second clic, sur un
     bouton apparu entre-temps — d'où l'impression de « cliquer dans le vide ».

     Désormais on habille NOUS-MÊMES, du même geste, et on ouvre la liste dans
     la foulée : UN clic, la liste. Plus de course, et plus de double clic. */
  if (inputEl.tagName === 'SELECT' && sfSelectHabillerMaintenant(inputEl)) {
    const bouton = inputEl.closest('.sf-pick').querySelector('.sf-pick__btn');
    inputEl.addEventListener('change', () => close(true));
    /* Fermeture sans choix (Échap, clic dehors) → on rend son apparence de
       lecture au champ. Après un choix, `sfSelectChoisir` émet `change` AVANT
       de fermer : `close(true)` a déjà posé son drapeau, ce `close(false)` est
       donc sans effet — il n'écrase pas la valeur qu'on vient d'enregistrer. */
    sfSelectOuvrir(inputEl, bouton, () => close(false));
    return;
  }

  // Sans habillage — mobile, où le sélecteur natif fait mieux. On garde le
  // comportement d'origine : focus, puis fermeture à la perte de focus.
  inputEl.focus();
  if(inputEl.select) inputEl.select();

  // Ferme à la perte de focus, valide à Entrée, annule à Échap
  inputEl.addEventListener('blur', () => close(true));
  inputEl.addEventListener('keydown', (ev) => {
    if(ev.key === 'Enter' && type !== 'textarea') { ev.preventDefault(); close(true); }
    else if(ev.key === 'Escape') { ev.preventDefault(); close(false); }
  });
  // Pour les selects : on ferme aussi au change
  if(inputEl.tagName === 'SELECT') {
    inputEl.addEventListener('change', () => close(true));
  }
}

// ═══════════════════════════════════════════════════════════
//   FICHE BIEN 360° — page plein écran (P1)
// ═══════════════════════════════════════════════════════════
// Le bien est le pivot du modèle : six tables pointent vers lui. Cette page
// les expose toutes, au lieu d'obliger à savoir dans quelle section chaque
// information a été rangée.
let currentBienId = null;
let bienDetailTab = 'bien';
let bienDetailBack = 'biens';
let bdPhotos = [];    // URLs résolues de la fiche courante (galerie)

// Point d'entrée historique — appelé depuis les cartes, le kanban, le dashboard.
function openDetail(id) {
  const b = allBiens.find(x => x.id === id);
  if(!b) { showNotif('Bien introuvable', true); return; }
  if(currentPage !== 'bien-detail') bienDetailBack = currentPage;
  currentBienId = id;
  bienDetailTab = _reopenDetailTab || 'bien';
  _reopenDetailTab = null;
  navigate('bien-detail');
}

function switchBienTab(tab) {
  bienDetailTab = tab;
  document.querySelectorAll('.sff-tab').forEach(t =>
    t.setAttribute('aria-selected', String(t.dataset.tab === tab)));
  // `hidden` plutot qu'un style en ligne : l'attribut retire le panneau de
  // l'arbre d'accessibilite en meme temps que de l'affichage, et il ne bat pas
  // les regles de la feuille de style comme le faisait `style.display`.
  document.querySelectorAll('.sff-pane').forEach(p => { p.hidden = (p.dataset.pane !== tab); });
}

// Re-rendu de la fiche courante (après ajout d'action, rattachement SCI…)
function bdRefresh() {
  if(currentPage !== 'bien-detail') return;
  const el = document.getElementById('content');
  if(el) renderBienDetail(el);
}

// Ponts vers le Module financier en conservant le contexte du bien
function bdGoToSuivi(bienId) {
  mfSuiviBienFilter = bienId; mfSuiviPreviousBienId = bienId; mfTab = 'suivi';
  navigate('module-financier');
}
// « Rentabilité » a fusionné dans « Performance », qui est consolidée : le pont
// depuis la fiche bien pose donc le PÉRIMÈTRE sur ce bien, ce qui reproduit
// exactement l'ancien comportement (un bien à la fois) sans onglet dédié.
function bdGoToRenta(bienId) {
  mfPerfBienId = bienId; mfTab = 'performance';
  navigate('module-financier');
}

async function renderBienDetail(el) {
  const b = allBiens.find(x => x.id === currentBienId);
  if(!b) { navigate('biens'); return; }
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement de la fiche…</div>`;

  const cf=computeCF(b),has=b.mensualite_credit||b.loyer_en_etat;
  const dHero = cfDisplayData(b);   // P2 : réel vs prévisionnel selon le statut
  // Tout ce qui pointe vers ce bien, chargé en parallèle
  const [actRes, visRes, simRes, photoItems, docItems] = await Promise.all([
    db.from('actions').select('*').eq('bien_id', b.id).order('date_action', {ascending:false}),
    db.from('visites').select('*').eq('bien_id', b.id).order('date_visite', {ascending:false}),
    db.from('simulations_credit').select('*').eq('bien_id', b.id).order('created_at', {ascending:false}),
    tiResolveMedia(b.photos_paths, b.photos, 'biens-photos'),
    tiResolveDocs(b.documents_paths, b.documents, 'biens-documents'),
  ]);
  if(!allSCI.length && currentUser) await loadSCIList();
  // L'utilisateur a pu naviguer ailleurs pendant les requêtes
  if(currentPage !== 'bien-detail' || currentBienId !== b.id) return;

  const actions = actRes.data || [];
  const visites = visRes.data || [];
  const sims    = simRes.data || [];
  const photos = photoItems.map(x=>x.url);
  const docs = docItems;
  // Virgule decimale et espace fine insecable : « 5.8% » etait de l'anglais,
  // et le « % » colle au nombre finissait par passer seul a la ligne.
  const rendementVal = (b.prix_affiche && b.loyer_en_etat) ? (b.loyer_en_etat*12/b.prix_affiche)*100 : null;
  const rendement = rendementVal == null ? '—' : sfPct(rendementVal.toFixed(1).replace('.', ','));
  const emprunt = (b.prix_affiche||0)+(b.frais_notaire||0)+(b.travaux||0)+(b.frais_agence||0)+(b.creation_sci||0);

  const phase = getStatutPhase(b.statut || 'Renseignements Web');
  // `baliseEmoji` vivait ici. L'emoji a disparu des libellés de balise : leur
  // COULEUR les distingue déjà, et il était de toute façon impossible à
  // remplacer par un SVG dans une <option>, où seul du texte est permis.
  const bmap = Object.fromEntries(TI_BIENS.BALISES.map(b => [b.v, b.cls]));

  // Données locatives (déjà en mémoire depuis le démarrage — P2)
  const locataires = allLocataires.filter(l => l.bien_id === b.id);
  const locActif   = locataires.find(l => l.statut === 'Actif') || null;
  const occupation = mfStatutOccupation(b.id);
  const sciBien    = allSCI.find(s => s.id === b.sci_id) || null;
  const annee      = new Date().getFullYear();
  const loyersAnnee  = allLoyers.filter(l => l.bien_id === b.id && l.annee === annee);
  const chargesAnnee = allCharges.filter(c => c.bien_id === b.id && new Date(c.date_charge).getFullYear() === annee);
  const reel12 = mfCashflowReel12M(b);

  bdPhotos = photos;   // consultées par la galerie au clic sur la vignette
  const prixM2 = (b.prix_affiche && b.surface_m2) ? Math.round(b.prix_affiche / b.surface_m2) : null;
  const acquis = b.statut === 'Acheté';
  // Le « /mois » quittait le libellé pour le sous-titre : un indicateur dit ce
  // qu'il EST, sa périodicité se lit en dessous avec le reste de sa qualification.
  const cfLab = dHero.mode === 'reel' ? 'Cashflow réel' : 'Cashflow prévisionnel';
  const cfVal = dHero.value != null ? (dHero.value>=0?'+':'−')+sfEur(Math.abs(dHero.value)) : 'Non calculé';
  const cfSub = dHero.mode === 'reel' && dHero.hasPrev ? `par mois · prévisionnel ${dHero.prev>=0?'+':'−'}${sfEur(Math.abs(dHero.prev))}`
              : dHero.attenteReel ? 'réel dès la saisie des loyers'
              : dHero.hasPrev ? 'par mois, sur données estimées' : 'loyer ou mensualité manquant';

  // SIX onglets et non sept. « Finances » et « Financement » n'en font plus
  // qu'un : ils affichaient les MEMES cinq postes d'acquisition — modifiables
  // d'un cote, en lecture seule de l'autre — et les MEMES trois montants
  // mensuels, en saisie d'un cote et en jauge de l'autre.
  // « Actions » devient « Negociation » et accueille le contact du vendeur :
  // le numero se trouve ainsi la ou l'on vient consigner l'appel qu'on vient
  // de passer.
  // Ordre selon l'etape du cycle de vie : en prospection le locatif et la SCI
  // n'ont rien a dire, une fois acquis ils passent devant.
  const TAB_DEFS = {
    bien:     { lab:sfAccIcon('maison',15)+' Le bien', badge:'' },
    finances: { lab:sfAccIcon('euro',15)+' Finances', badge: sims.length ? `<span class="sff-tab__n">${sims.length}</span>` : '' },
    visites:  { lab:sfAccIcon('carnet',15)+' Visites', badge: visites.length ? `<span class="sff-tab__n">${visites.length}</span>` : '' },
    nego:     { lab:sfAccIcon('echange',15)+' Négociation', badge: actions.length ? `<span class="sff-tab__n">${actions.length}</span>` : '' },
    locatif:  { lab:sfAccIcon('cle',15)+' Locatif', badge: locActif ? '<span class="sff-tab__n on">1</span>' : '' },
    sci:      { lab:sfAccIcon('colonne',15)+' SCI', badge: sciBien ? `<span class="sff-tab__n on">${sfAccIcon('check',11)}</span>` : '' },
  };
  const etapesGestion = bdEtapesGestion(b);   // P4 : SCI, locataire, loyers

  // Complétude : les champs sans lesquels les indicateurs de la fiche sont faux
  // ou absents. « cle » = bloquant pour le rendement et le cashflow.
  // Derivee du registre TI_BIENS : les libelles et les onglets ne peuvent plus
  // diverger de ceux du formulaire. Les champs cles d'abord, pour que le bouton
  // « Completer » ouvre en priorite ce qui bloque la rentabilite.
  const BD_CHAMPS = TI_BIENS.CHAMPS.filter(c => c.completude)
    .sort((a, b) => a.completude - b.completude);
  const manquants    = BD_CHAMPS.filter(c => !((parseFloat(b[c.k]) || 0) > 0));
  const manquantsCle = manquants.filter(c => c.cle);
  const pctComplet   = Math.round((BD_CHAMPS.length - manquants.length) / BD_CHAMPS.length * 100);
  const compCls      = manquantsCle.length ? 'ko' : manquants.length ? 'warn' : 'ok';
  const tabCible     = (manquantsCle[0] || manquants[0])?.tab || 'finances';

  // ── Onglet Finances ───────────────────────────────────────────────────────
  // Decomposition du cout d'acquisition. Les cinq postes gardent chacun leur
  // teinte : la pastille de la ligne et le segment de la barre sont le meme
  // objet, on doit pouvoir passer de l'un a l'autre sans chercher.
  // `travaux` figure dans la liste meme a zero — c'est un poste qu'on oublie
  // de renseigner, le masquer le ferait disparaitre de l'attention.
  const finPostes = [
    { lab:'Prix affiché',          k:'prix_affiche',  col:'var(--sf-brand-3)',      fixe:false },
    { lab:'Frais de notaire',      k:'frais_notaire', col:'var(--sf-text-3)',       fixe:true,
      note:`calculés à ${+(notairePct()*100).toFixed(1)} %` },
    { lab:"Frais d'agence",        k:'frais_agence',  col:'var(--sf-info)',         fixe:false },
    { lab:'Constitution de la SCI',k:'creation_sci',  col:'var(--sf-alert)',        fixe:false },
    { lab:'Travaux',               k:'travaux',       col:'var(--sf-border-strong)',fixe:false },
  ].map(p => { const val = parseFloat(b[p.k]) || 0;
    return { ...p, val, pct: emprunt ? (val / emprunt) * 100 : 0 }; });

  const mensu        = parseFloat(b.mensualite_credit) || 0;
  const loyerHC      = parseFloat(b.loyer_en_etat) || 0;
  const chargesLoc   = parseFloat(b.charges_locataire_etat) || 0;
  const loyerAttendu = loyerHC + chargesLoc;
  const chargesFixes = (parseFloat(b.charge_copro)||0) + (parseFloat(b.assurance_logement)||0) + (parseFloat(b.taxe_fonciere)||0);
  const gaugeMax     = Math.max(mensu, loyerAttendu, chargesFixes, 1);
  // Reperes : deux grandeurs DERIVEES des montants ci-dessus. Rien a saisir,
  // rien d'invente — elles ne s'affichent que si leur denominateur existe.
  const coutM2   = (emprunt && b.surface_m2) ? Math.round(emprunt / b.surface_m2) : null;
  const fraisAcq = (parseFloat(b.frais_notaire)||0) + (parseFloat(b.frais_agence)||0) + (parseFloat(b.creation_sci)||0);
  const fraisPct = (fraisAcq && b.prix_affiche) ? (fraisAcq / b.prix_affiche) * 100 : null;
  // Meme formule que computeCF, mais sur les loyers d'apres travaux.
  const cfTravaux = ((parseFloat(b.loyer_apres_travaux)||0) + (parseFloat(b.charges_locataire_travaux)||0))
                  - (mensu + chargesFixes);

  const tabOrder = acquis
    ? ['bien','locatif','finances','nego','visites','sci']
    : ['bien','finances','visites','nego','locatif','sci'];
  const dimTabs = acquis ? [] : ['locatif','sci'];
  // Les anciennes cles ('infos', 'fin', 'financement', 'actions') peuvent
  // encore etre en memoire quand la page est rouverte apres mise a jour.
  if(!TAB_DEFS[bienDetailTab]) bienDetailTab = 'bien';

  // Ligne d'un poste chiffré du bloc « Coût d'acquisition ». La colonne du
  // crayon reste réservée même quand la valeur est calculée : sans elle, les
  // montants saisis et les montants calculés ne s'aligneraient pas.
  const ligneCout = p => `
    <div class="sff-line${p.val ? '' : ' sff-line--zero'}">
      <span class="sff-line__d" style="background:${p.col}"></span>
      <span class="sff-line__l">${p.lab}${p.note ? ` <small>· ${p.note}</small>` : ''}</span>
      <span class="sff-line__v">${p.fixe ? sfEur(p.val) : ieEur(b.id, p.k, p.val)}</span>
      <span></span>
      <span class="sff-line__p">${!emprunt ? '—' : p.val ? (p.pct < 1 ? '&lt; 1 %' : sfPct(Math.round(p.pct))) : '—'}</span>
    </div>`;

  // Ligne d'un sous-total modifiable, sans pastille ni pourcentage.
  const lignePlate = (lab, k, note) => `
    <div class="sff-line">
      <span class="sff-line__l">${lab}${note ? ` <small>· ${note}</small>` : ''}</span>
      <span class="sff-line__v">${ieEur(b.id, k, b[k])}</span>
      <span></span>
    </div>`;

  el.innerHTML = `
  <div class="sff-page">
    <div class="sff-top">
      <button class="sff-back" onclick="navigate(bienDetailBack)">
        ${sfAccIcon('retour',14)} ${esc(PAGE_LABELS[bienDetailBack] || 'Retour')}
      </button>
      <div class="sff-titleline">
        <div class="sff-titleline__id">
          <h1 class="sff-h1">${esc(b.titre || 'Sans titre')}</h1>
          <p class="sff-sub">${[b.ville, b.code_postal, b.type_bien, b.surface_m2 ? b.surface_m2+' m²' : null].filter(Boolean).map(esc).join(' · ')}</p>
        </div>
        <div class="sff-acts">
          ${b.ville ? `<button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdVoirMarche('${(b.ville||'').replace(/'/g,"\\'")}')">${sfAccIcon('pin',15)} Le marché à ${esc(b.ville)}</button>` : ''}
          <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="openDossierModal('${b.id}')">${sfAccIcon('doc',15)} Dossier banque</button>
          <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="editBien('${b.id}')">${sfAccIcon('crayon',15)} Modifier la fiche</button>
        </div>
      </div>
    </div>

    <!-- Quatre indicateurs : ceux qu'on vient chercher en premier. Le prix au
         m² est devenu le sous-titre du prix, dont il n'est qu'une lecture. -->
    <div class="sff-kpis">
      <div class="sff-kpi">
        <span class="sff-kpi__l">Prix affiché</span>
        <span class="sff-kpi__v${b.prix_affiche ? '' : ' sff-kpi__v--none'}">${b.prix_affiche ? sfEur(b.prix_affiche) : 'Non renseigné'}</span>
        <span class="sff-kpi__s">${prixM2 ? sfEur(prixM2)+' le m²' : 'surface non renseignée'}</span>
      </div>
      <div class="sff-kpi">
        <span class="sff-kpi__l">Rendement brut</span>
        <span class="sff-kpi__v ${rendement==='—' ? 'sff-kpi__v--none' : parseFloat(rendement)>=userPrefs.seuil_rentabilite ? 'sff-kpi__v--gain' : 'sff-kpi__v--loss'}">${rendement==='—' ? 'Non calculé' : rendement}</span>
        <span class="sff-kpi__s">${rendement==='—' ? 'loyer non renseigné' : (parseFloat(rendement)>=userPrefs.seuil_rentabilite ? 'au-dessus de' : 'en dessous de')+' votre seuil de '+sfPct(userPrefs.seuil_rentabilite)}</span>
      </div>
      <div class="sff-kpi sff-kpi--hi">
        <span class="sff-kpi__l">${cfLab}</span>
        <span class="sff-kpi__v ${dHero.value==null ? 'sff-kpi__v--none' : dHero.value>=0 ? 'sff-kpi__v--gain' : 'sff-kpi__v--loss'}">${cfVal}</span>
        <span class="sff-kpi__s">${cfSub}</span>
      </div>
      <div class="sff-kpi">
        <span class="sff-kpi__l">Coût total de l'opération</span>
        <span class="sff-kpi__v${emprunt ? '' : ' sff-kpi__v--none'}">${emprunt ? sfEur(emprunt) : 'Non calculé'}</span>
        <span class="sff-kpi__s">frais et travaux compris</span>
      </div>
    </div>

    <div class="sff-body">
      <!-- Rail : l'état du dossier, rien d'autre. Les photos et les documents
           en sont sortis pour l'onglet « Le bien » — le rail n'affiche plus
           une grande vignette vide quand la fiche n'a pas de photo, et les
           documents ne sont plus une liste tronquée dans 262 px de large. -->
      <aside class="sff-rail">
        ${photos.length ? `
          <button class="sff-thumb sff-thumb--photo" onclick="bdOpenGallery()" style="background-image:url('${photos[0]}')" title="Voir les ${photos.length} photos">
            <span class="sff-thumb__n">${sfAccIcon('image',13)} ${photos.length}</span>
          </button>` : ''}

        <div class="sff-rail__b">
          <span class="sff-rail__l">Statut</span>
          ${sfDetenu(b)
            ? `<span class="statut-pill phase-${phase}">${esc(b.statut||'—')}</span>`
            : `<span class="inline-edit" data-id="${b.id}" data-field="statut" data-type="select-statut" data-value="${(b.statut||'').replace(/"/g,'&quot;')}" onclick="inlineEditField(this)"><span class="statut-pill phase-${phase}">${esc(b.statut||'—')}</span></span>`}

          ${b.statut === 'Abandonné' ? '' : sfDetenu(b)
            ? `<button class="sf-btn sf-btn--ghost sf-btn--sm sf-btn--block sff-rail__act"
                       onclick="bdRemettreEnProspection('${b.id}')">Remettre en prospection</button>`
            : `<button class="sf-btn sf-btn--primary sf-btn--sm sf-btn--block sff-rail__act"
                       onclick="bdDemarrerAcquisition('${b.id}')">${sfAccIcon('check',14)} Confirmer l'acquisition</button>`}
        </div>

        <div class="sff-rail__b">
          <span class="sff-rail__l">Balise</span>
          <span class="inline-edit" data-id="${b.id}" data-field="balise" data-type="select-balise" data-value="${(b.balise||'').replace(/"/g,'&quot;')}" onclick="inlineEditField(this)">${b.balise && bmap[b.balise] ? `<span class="tag-pill ${bmap[b.balise]}">${esc(b.balise)}</span>` : '<span class="sff-rail__none">Sans balise</span>'}</span>
        </div>

        <div class="sff-rail__b">
          <span class="sff-rail__l">SCI détentrice</span>
          ${sciBien ? `<span class="sff-rail__v">${esc(sciBien.nom_sci)}</span>`
                    : `<span class="sff-rail__none">Aucune
                         <button class="sff-add" onclick="editBien('${b.id}')">${sfAccIcon('plus',13)} Ajouter</button>
                       </span>`}
        </div>

        <div class="sff-rail__b">
          <span class="sff-rail__l">Dernière action</span>
          ${actions.length ? `<span class="sff-rail__v">${esc(actions[0].type_action)}</span>
                              <span class="sff-rail__s">${fmtActionDate(actions[0].date_action)}</span>`
                           : `<span class="sff-rail__none">Aucune
                                <button class="sff-add" onclick="openActionModal('${b.id}')">${sfAccIcon('plus',13)} Ajouter</button>
                              </span>`}
        </div>

        <div class="sff-rail__b">
          <span class="sff-rail__l">Complétude</span>
          <div class="sff-prog"><div class="sff-prog__f ${compCls}" style="width:${pctComplet}%"></div></div>
          ${manquants.length === 0
            ? `<span class="sff-prog__t ok">${sfAccIcon('check',14)} Tous les champs sont renseignés</span>`
            : `<span class="sff-prog__t ${compCls}">
                 ${manquants.length} champ${manquants.length>1?'s':''} manquant${manquants.length>1?'s':''}${manquantsCle.length ? ' pour calculer la rentabilité' : ' pour affiner le cashflow'}
               </span>
               <span class="sff-rail__s">${manquants.slice(0,3).map(c=>esc(c.lab)).join(' · ')}${manquants.length>3?` · +${manquants.length-3}`:''}</span>
               <button class="sff-add" onclick="switchBienTab('${tabCible}')">${sfAccIcon('crayon',13)} Compléter</button>`}
        </div>
      </aside>

      <div class="sff-main">
        <div class="sff-tabs" role="tablist">
          ${tabOrder.map(k => `<button class="sff-tab${dimTabs.includes(k)?' sff-tab--dim':''}" role="tab" aria-selected="false" data-tab="${k}" onclick="switchBienTab('${k}')">${TAB_DEFS[k].lab}${TAB_DEFS[k].badge}</button>`).join('')}
        </div>

        <!-- ══════════════ LE BIEN ══════════════ -->
        <section class="sff-pane" data-pane="bien" hidden>
          <div class="sff-block">
            <div class="sff-block__h"><p class="sff-block__t">Caractéristiques</p></div>
            <div class="sff-block__b">
              <div class="sff-fields">
                <div class="sff-f"><div class="sff-f__l">Type</div><div class="sff-f__v">${ie(b.id,'type_bien',b.type_bien,'select-type')}</div></div>
                <div class="sff-f"><div class="sff-f__l">Surface</div><div class="sff-f__v">${ie(b.id,'surface_m2',b.surface_m2 ? b.surface_m2+' m²' : '','number',null,b.surface_m2||'')}</div></div>
                <div class="sff-f"><div class="sff-f__l">Ville</div><div class="sff-f__v">${ie(b.id,'ville',b.ville,'text')}</div></div>
                <div class="sff-f"><div class="sff-f__l">Code postal</div><div class="sff-f__v">${ie(b.id,'code_postal',b.code_postal,'text')}</div></div>
                <div class="sff-f sff-f--wide">
                  <div class="sff-f__l">Annonce d'origine</div>
                  <div class="sff-f__v">${b.lien_annonce
                    ? `<a class="sff-link" href="${safeUrl(b.lien_annonce)}" target="_blank" rel="noopener">${sfAccIcon('lien',15)} Consulter l'annonce</a>`
                    : `<span class="sff-rail__none">Aucun lien enregistré</span>`}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Photos</p>
              ${photos.length ? `<span class="sff-block__n">${photos.length} photo${photos.length>1?'s':''}</span>` : ''}
            </div>
            <div class="sff-block__b${photos.length ? '' : ' sff-block__b--flush'}">
              ${photos.length
                ? `<div class="sff-gal">${photos.map((u,i)=>`<button class="sff-gal__i" style="background-image:url('${u}')" onclick="openLightbox('${u}')" aria-label="Photo ${i+1}"></button>`).join('')}</div>`
                : `<div class="sff-empty">
                     <div class="sff-empty__ic">${sfAccIcon('image',34)}</div>
                     <div class="sff-empty__t">Aucune photo</div>
                     <div class="sff-empty__x">Les visuels de l'annonce et les clichés pris en visite se rassemblent ici. Le premier sert de vignette dans la liste de vos biens.</div>
                     <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="editBien('${b.id}')">Ajouter des photos</button>
                   </div>`}
            </div>
          </div>

          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Documents</p>
              ${docs.length ? `<span class="sff-block__n">${docs.length} document${docs.length>1?'s':''}</span>` : ''}
            </div>
            <div class="sff-block__b${docs.length ? '' : ' sff-block__b--flush'}">
              ${docs.length
                ? `<div class="sff-docs">${docs.map(d=>`<button class="sff-doc" onclick="openDoc('${d.url||''}')" title="${esc(d.name||'Document')}">${sfAccIcon('doc',15)} <span>${esc(d.name||'Document')}</span></button>`).join('')}</div>`
                : `<div class="sff-empty">
                     <div class="sff-empty__ic">${sfAccIcon('doc',34)}</div>
                     <div class="sff-empty__t">Aucun document</div>
                     <div class="sff-empty__x">Diagnostics, règlement de copropriété, procès-verbaux d'assemblée générale, compromis : les pièces que la banque et le notaire réclameront le moment venu.</div>
                     <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="editBien('${b.id}')">Déposer un document</button>
                   </div>`}
            </div>
          </div>

          <div class="sff-block">
            <div class="sff-block__h"><p class="sff-block__t">Notes</p></div>
            <div class="sff-block__b"><div class="sff-f__v sff-notes">${ie(b.id,'notes',b.notes,'textarea')}</div></div>
          </div>
        </section>

        <!-- ══════════════ FINANCES ══════════════ -->
        <section class="sff-pane" data-pane="finances" hidden>
          <div class="sff-grid2">
            <div class="sff-block">
              <div class="sff-block__h"><p class="sff-block__t">Coût d'acquisition</p></div>
              <div class="sff-block__b">
                ${emprunt ? `<div class="sff-split">
                  ${finPostes.filter(p=>p.val>0).map(p=>`<div class="sff-split__s" style="width:${p.pct}%;background:${p.col}" title="${p.lab} — ${sfEur(p.val)}"></div>`).join('')}
                </div>` : ''}
                <div class="sff-lines">
                  ${finPostes.map(ligneCout).join('')}
                  <div class="sff-line sff-line--tot">
                    <span></span>
                    <span class="sff-line__l">Coût total de l'opération</span>
                    <span class="sff-line__v">${emprunt ? sfEur(emprunt) : '—'}</span>
                    <span></span><span></span>
                  </div>
                </div>
                ${(coutM2 || fraisPct != null) ? `
                <p class="sff-sep sff-sep--pied">Repères</p>
                <div class="sff-lines">
                  ${coutM2 ? `<div class="sff-line"><span></span><span class="sff-line__l">Coût au m², frais compris</span><span class="sff-line__v">${sfEur(coutM2)}</span><span></span><span></span></div>` : ''}
                  ${fraisPct != null ? `<div class="sff-line"><span></span><span class="sff-line__l">Frais et honoraires <small>· ${sfPct(fraisPct.toFixed(1).replace('.',','))} du prix</small></span><span class="sff-line__v">${sfEur(fraisAcq)}</span><span></span><span></span></div>` : ''}
                </div>` : ''}
              </div>
            </div>

            <div class="sff-block">
              <div class="sff-block__h"><p class="sff-block__t">Équilibre mensuel</p></div>
              <div class="sff-block__b">
                ${(mensu || loyerAttendu || chargesFixes) ? `
                  <div class="sff-gauges">
                    <!-- Une jauge qui AGRÈGE reste en lecture seule : sa
                         composition se saisit plus bas. Rendre « Loyer attendu »
                         modifiable serait ambigu — deux champs s'y additionnent. -->
                    <div class="sff-g">
                      <span class="sff-g__l">Loyer attendu</span>
                      <div class="sff-g__bar"><div class="sff-g__f" style="width:${Math.round(loyerAttendu/gaugeMax*100)}%;background:var(--sf-gain)"></div></div>
                      <span class="sff-g__v">${sfEur(loyerAttendu)}</span><span></span>
                    </div>
                    <div class="sff-g">
                      <span class="sff-g__l">Mensualité de crédit</span>
                      <div class="sff-g__bar"><div class="sff-g__f" style="width:${Math.round(mensu/gaugeMax*100)}%;background:var(--sf-loss)"></div></div>
                      <span class="sff-g__v">${ieEur(b.id,'mensualite_credit',mensu)}</span><span></span>
                    </div>
                    <div class="sff-g">
                      <span class="sff-g__l">Charges</span>
                      <div class="sff-g__bar"><div class="sff-g__f" style="width:${Math.round(chargesFixes/gaugeMax*100)}%;background:var(--sf-alert)"></div></div>
                      <span class="sff-g__v">${sfEur(chargesFixes)}</span><span></span>
                    </div>
                  </div>
                  <div class="sff-solde">
                    <span class="sff-solde__l">Solde mensuel</span>
                    <span class="sff-solde__v ${cf>=0?'sf-gain':'sf-loss'}">${cf>=0?'+':'−'}${sfEur(Math.abs(cf))}</span>
                    ${mensu ? `<span class="sff-solde__s">Le loyer couvre ${sfPct(Math.round(loyerAttendu/mensu*100))} de la mensualité de crédit.</span>` : ''}
                  </div>` : ''}

                <p class="sff-sep">Composition du loyer</p>
                <div class="sff-lines sff-lines--plain">
                  ${lignePlate('Loyer hors charges','loyer_en_etat')}
                  ${lignePlate('Charges refacturées au locataire','charges_locataire_etat')}
                </div>

                <p class="sff-sep">Composition des charges</p>
                <div class="sff-lines sff-lines--plain">
                  ${lignePlate('Charges de copropriété','charge_copro')}
                  ${lignePlate('Assurance propriétaire non occupant','assurance_logement')}
                  ${lignePlate('Taxe foncière','taxe_fonciere','lissée sur 12 mois')}
                </div>
              </div>
            </div>
          </div>

          ${(b.loyer_apres_travaux || b.charges_locataire_travaux) ? `
          <div class="sff-block">
            <div class="sff-block__h"><p class="sff-block__t">Après travaux</p></div>
            <div class="sff-block__b">
              <div class="sff-lines sff-lines--plain">
                ${lignePlate('Loyer après travaux','loyer_apres_travaux')}
                ${lignePlate('Charges refacturées après travaux','charges_locataire_travaux')}
                <div class="sff-line sff-line--tot">
                  <span class="sff-line__l">Solde mensuel après travaux</span>
                  <span class="sff-line__v ${cfTravaux>=0?'sf-gain':'sf-loss'}">${cfTravaux>=0?'+':'−'}${sfEur(Math.abs(cfTravaux))}</span>
                  <span></span>
                </div>
              </div>
            </div>
          </div>` : ''}

          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Plan de financement</p>
              <span class="sff-block__n">${sims.length ? sims.length+' simulation'+(sims.length>1?'s':'') : 'Aucune simulation rattachée'}</span>
            </div>
            <div class="sff-block__b${sims.length ? '' : ' sff-block__b--flush'}">
              ${sims.length
                ? `<div class="sff-list">${sims.map(s=>`
                    <div class="sff-row" onclick="openReadSimulation('${s.id}')">
                      <div class="sff-row__m">${esc(s.nom_simulation||'Simulation')}
                        <div class="sff-row__s">${sfEur(s.montant_emprunte||0)} sur ${s.duree_ans||20} ans · ${sfPct((s.taux_interet||0).toFixed(2).replace('.',','))}</div>
                      </div>
                      <div class="sff-row__a">${sfEur(s.mensualite_calculee||0)} /mois</div>
                    </div>`).join('')}</div>
                   <div class="sff-cta">
                     <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="openDossierModal('${b.id}')">${sfAccIcon('doc',15)} Générer le dossier banque</button>
                     <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="navigate('simulateur')">${sfAccIcon('banque',15)} Nouvelle simulation</button>
                   </div>`
                : `<div class="sff-empty">
                     <div class="sff-empty__ic">${sfAccIcon('banque',34)}</div>
                     <div class="sff-empty__t">Aucune simulation de crédit</div>
                     <div class="sff-empty__x">${mensu ? `La mensualité de ${sfEur(mensu)} renseignée plus haut est une hypothèse. Une` : 'Une'} simulation établit la mensualité réelle à partir du taux, de la durée et de l'apport, puis alimente le dossier remis à la banque.</div>
                     <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="navigate('simulateur')">Simuler ce crédit</button>
                   </div>`}
            </div>
          </div>
        </section>

        <!-- ══════════════ VISITES ══════════════ -->
        <section class="sff-pane" data-pane="visites" hidden>
          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Comptes rendus de visite</p>
              ${visites.length ? `<div class="sff-block__a"><button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="openNouvelleVisite('${b.id}')">${sfAccIcon('plus',15)} Nouveau compte rendu</button></div>` : ''}
            </div>
            <div class="sff-block__b${visites.length ? '' : ' sff-block__b--flush'}">
              ${visites.length
                ? `<div class="sff-list">${visites.map(v=>`
                    <div class="sff-row" onclick="openDetailVisite('${v.id}')">
                      <div class="sff-row__d">${fmtActionDate(v.date_visite)}</div>
                      <div class="sff-row__m">${v.type_visite==='locataire'?'Visite locataire':'Visite achat'}${v.adresse?` — ${esc(v.adresse)}`:''}
                        ${v.notes?`<div class="sff-row__s">${esc(v.notes.slice(0,110))}${v.notes.length>110?'…':''}</div>`:''}
                      </div>
                      ${v.note_sur_5?`<span class="sff-stars" title="${v.note_sur_5} sur 5">${sfAccIcon('etoile',13).repeat(v.note_sur_5)}</span>`:''}
                    </div>`).join('')}</div>`
                : `<div class="sff-empty">
                     <div class="sff-empty__ic">${sfAccIcon('carnet',34)}</div>
                     <div class="sff-empty__t">Aucune visite enregistrée</div>
                     <div class="sff-empty__x">Consignez chaque visite : impression générale, points de vigilance, travaux à prévoir, photos. Les comptes rendus se retrouvent ici et dans la section Outils.</div>
                     <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="openNouvelleVisite('${b.id}')">Rédiger le premier compte rendu</button>
                   </div>`}
            </div>
          </div>
        </section>

        <!-- ══════════════ NÉGOCIATION ══════════════
             Le contact du vendeur est descendu ici depuis « Informations » :
             le numéro se trouve à l'endroit exact où l'on vient consigner
             l'appel qu'on vient de passer. -->
        <section class="sff-pane" data-pane="nego" hidden>
          <div class="sff-block">
            <div class="sff-block__h"><p class="sff-block__t">Contact vendeur</p></div>
            <div class="sff-block__b">
              <div class="sff-fields">
                <div class="sff-f"><div class="sff-f__l">Intermédiaire</div><div class="sff-f__v">${ie(b.id,'intermediaire',b.intermediaire,'text')}</div></div>
                <div class="sff-f">
                  <div class="sff-f__l">Téléphone</div>
                  <div class="sff-f__v sff-f__v--dual">${ie(b.id,'telephone',b.telephone,'tel')}${b.telephone ? `<a class="sff-link" href="tel:${esc(String(b.telephone).replace(/[^\d+]/g,''))}" title="Appeler">${sfAccIcon('tel',15)}</a>` : ''}</div>
                </div>
                <div class="sff-f sff-f--wide">
                  <div class="sff-f__l">Adresse électronique</div>
                  <div class="sff-f__v sff-f__v--dual">${ie(b.id,'mail',b.mail,'email')}${b.mail ? `<a class="sff-link" href="mailto:${esc(b.mail)}" title="Écrire">${sfAccIcon('mail',15)}</a>` : ''}</div>
                </div>
              </div>
            </div>
          </div>

          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Historique des échanges</p>
              ${actions.length ? `<div class="sff-block__a"><button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="openActionModal('${b.id}')">${sfAccIcon('plus',15)} Ajouter un échange</button></div>` : ''}
            </div>
            <div class="sff-block__b${actions.length ? '' : ' sff-block__b--flush'}">
              ${actions.length
                ? `<div class="sff-list">${actions.map(a=>`
                    <div class="sff-row" onclick="openActionModal('${b.id}','${a.id}')" title="Modifier">
                      <div class="sff-row__d">${fmtActionDate(a.date_action)}</div>
                      <div class="sff-row__m">${esc(a.type_action)}
                        ${a.commentaire?`<div class="sff-row__s">${esc(a.commentaire)}</div>`:''}
                      </div>
                    </div>`).join('')}</div>`
                : `<div class="sff-empty">
                     <div class="sff-empty__ic">${sfAccIcon('agenda',34)}</div>
                     <div class="sff-empty__t">Aucun échange enregistré</div>
                     <div class="sff-empty__x">Appels, offres, relances et rendez-vous : cet historique vous rappellera où vous en êtes avec ce vendeur dans trois semaines.</div>
                     <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="openActionModal('${b.id}')">Enregistrer le premier échange</button>
                   </div>`}
            </div>
          </div>
        </section>

        <!-- ══════════════ LOCATIF ══════════════ -->
        <section class="sff-pane" data-pane="locatif" hidden>
          ${!acquis ? `
            <div class="sff-msg">${sfAccIcon('info',17)}
              <span>Ce bien est en cours d'acquisition. Le suivi locatif — locataire, loyers encaissés, charges réelles — s'ouvrira au passage au statut « Acheté ».</span>
            </div>` : ''}

          ${acquis && etapesGestion.some(e => !e.fait) ? `
          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Mise en gestion</p>
              <div class="sff-block__a"><button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdOpenMiseEnGestion('${b.id}')">Reprendre</button></div>
            </div>
            <div class="sff-block__b">
              <p class="sff-inline">${etapesGestion.filter(e=>!e.fait).length} étape${etapesGestion.filter(e=>!e.fait).length>1?'s':''} avant que le suivi de ce bien soit opérationnel</p>
              <div class="sff-chips">
                ${etapesGestion.map(e => `<span class="sff-chip${e.fait?' done':''}">${e.fait?sfAccIcon('check',12):''} ${esc(e.lab)}</span>`).join('')}
              </div>
            </div>
          </div>` : ''}

          <div class="sff-grid2">
            <div class="sff-block">
              <div class="sff-block__h"><p class="sff-block__t">Locataire</p></div>
              <div class="sff-block__b">
                ${locActif ? `
                  <div class="bd-loc" onclick="openLocataireModal('${locActif.id}')">
                    <div class="bd-loc-av">${((locActif.prenom?.[0]||'')+(locActif.nom?.[0]||'')||'?').toUpperCase()}</div>
                    <div style="min-width:0">
                      <div class="bd-loc-name">${esc([locActif.prenom,locActif.nom].filter(Boolean).join(' ')||'—')}</div>
                      <div class="bd-loc-sub">${esc(locActif.email||locActif.telephone||'')}${locActif.loyer_bail_hc?` · ${sfEur(locActif.loyer_bail_hc)} /mois HC`:''}</div>
                    </div>
                    <span class="bd-occ ${occupation.type}">${occupation.label}</span>
                  </div>` : `
                  <p class="sff-inline">Aucun locataire actif
                    <button class="sff-add" onclick="openLocataireModal(null)">${sfAccIcon('plus',13)} Ajouter</button>
                  </p>`}
                ${locataires.length > (locActif?1:0) ? `<div class="bd-hist">${locataires.filter(l=>l!==locActif).map(l=>`<div class="bd-hist-row" onclick="openLocataireModal('${l.id}')"><span>${esc([l.prenom,l.nom].filter(Boolean).join(' '))}</span><span class="st">${esc(l.statut||'')}</span></div>`).join('')}</div>` : ''}
              </div>
            </div>

            <div class="sff-block">
              <div class="sff-block__h"><p class="sff-block__t">${acquis ? 'Réel sur 12 mois' : 'Projection locative'}</p></div>
              <div class="sff-block__b">
                <div class="sff-lines sff-lines--plain">
                  ${acquis ? `
                    <div class="sff-line"><span class="sff-line__l">Loyers encaissés</span><span class="sff-line__v">${sfEur(reel12.loyer_encaisse)}</span><span></span></div>
                    <div class="sff-line"><span class="sff-line__l">Charges payées</span><span class="sff-line__v">${sfEur(reel12.charges_payees)}</span><span></span></div>
                    <div class="sff-line"><span class="sff-line__l">Mensualités de crédit</span><span class="sff-line__v">${sfEur(reel12.mensualites_credit)}</span><span></span></div>
                    <div class="sff-line sff-line--tot"><span class="sff-line__l">Cashflow réel</span><span class="sff-line__v ${reel12.cashflow>=0?'sf-gain':'sf-loss'}">${reel12.cashflow>=0?'+':'−'}${sfEur(Math.abs(reel12.cashflow))}</span><span></span></div>`
                  : `
                    <div class="sff-line"><span class="sff-line__l">Loyer encaissé</span><span class="sff-line__v">${sfEur(loyerAttendu)}</span><span></span></div>
                    <div class="sff-line"><span class="sff-line__l">Charges et mensualité de crédit</span><span class="sff-line__v">${sfEur(mensu + chargesFixes)}</span><span></span></div>
                    <div class="sff-line sff-line--tot"><span class="sff-line__l">Solde mensuel</span><span class="sff-line__v ${cf>=0?'sf-gain':'sf-loss'}">${cf>=0?'+':'−'}${sfEur(Math.abs(cf))}</span><span></span></div>`}
                </div>
              </div>
            </div>
          </div>

          ${acquis ? `
          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Loyers ${annee}</p>
              ${loyersAnnee.length ? `<div class="sff-block__a"><button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdGoToSuivi('${b.id}')">Suivi mensuel</button></div>` : ''}
            </div>
            <div class="sff-block__b">
              ${loyersAnnee.length === 0
                ? `<p class="sff-inline">Aucun loyer saisi pour ${annee}
                     <button class="sff-add" onclick="bdGoToSuivi('${b.id}')">${sfAccIcon('chevron',13)} Ouvrir le suivi mensuel</button>
                   </p>`
                : `<div class="bd-months">
                    ${MOIS_LABELS.map((lab,i) => {
                      const mois = i + 1;
                      const l = loyersAnnee.find(x => x.mois === mois);
                      // Le bail peut changer en cours d'année : on prend celui
                      // du mois concerné, pas le locataire courant.
                      const loc = mfLocataireForBienMonth(b.id, mois, annee) || locActif;
                      const st = sfLoyerEtat(l, mois, annee, loc);
                      const tip = st === 'avenir' ? `${lab} : échéance à venir`
                                : !l ? `${lab} : rien de saisi`
                                : `${lab} : ${esc(l.statut||'')} — ${sfEur(l.montant_encaisse||0)} sur ${sfEur(l.loyer_du||0)} dus`;
                      return `<div class="bd-month ${st}" title="${tip}"><span>${lab}</span></div>`;
                    }).join('')}
                   </div>
                   <div class="bd-month-legend"><span><i class="ok"></i>Payé</span><span><i class="part"></i>Partiel</span><span><i class="ko"></i>Impayé</span><span><i class="avenir"></i>À venir</span><span><i class="none"></i>Non saisi</span></div>`}
            </div>
          </div>

          <div class="sff-block">
            <div class="sff-block__h">
              <p class="sff-block__t">Charges ${annee}</p>
              ${chargesAnnee.length ? `<span class="sff-block__n">${sfEur(chargesAnnee.reduce((s,c)=>s+(parseFloat(c.montant)||0),0))}</span>` : ''}
            </div>
            <div class="sff-block__b">
              ${chargesAnnee.length === 0
                ? `<p class="sff-inline">Aucune charge enregistrée cette année</p>`
                : `<div class="sff-list">${chargesAnnee.slice(0,8).map(c=>`
                    <div class="sff-row" style="cursor:default">
                      <div class="sff-row__d">${fmtActionDate(c.date_charge)}</div>
                      <div class="sff-row__m">${esc(c.categorie||'Autre')}
                        ${c.libelle?`<div class="sff-row__s">${esc(c.libelle)}</div>`:''}
                      </div>
                      <div class="sff-row__a">${sfEur(c.montant)}</div>
                    </div>`).join('')}</div>
                   ${chargesAnnee.length>8?`<p class="sff-inline" style="margin-top:8px">+ ${chargesAnnee.length-8} autre${chargesAnnee.length-8>1?'s':''}</p>`:''}`}
            </div>
          </div>

          <div class="sff-cta">
            <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdGoToSuivi('${b.id}')">${sfAccIcon('agenda',15)} Suivi mensuel</button>
            <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdGoToRenta('${b.id}')">${sfAccIcon('euro',15)} Rentabilité</button>
          </div>` : ''}
        </section>

        <!-- ══════════════ SCI ══════════════ -->
        <section class="sff-pane" data-pane="sci" hidden>
          <div class="sff-block">
            <div class="sff-block__h"><p class="sff-block__t">Société détentrice</p></div>
            <div class="sff-block__b${sciBien ? '' : ' sff-block__b--flush'}">
              ${sciBien ? `
                <div class="sff-fields">
                  <div class="sff-f"><div class="sff-f__l">Dénomination</div><div class="sff-f__v">${esc(sciBien.nom_sci)}</div></div>
                  <div class="sff-f"><div class="sff-f__l">SIRET</div><div class="sff-f__v">${sciBien.siret?esc(sciBien.siret):'<span class="sff-rail__none">Non renseigné</span>'}</div></div>
                  <div class="sff-f"><div class="sff-f__l">Capital social</div><div class="sff-f__v">${sciBien.capital_social?sfEur(sciBien.capital_social):'<span class="sff-rail__none">Non renseigné</span>'}</div></div>
                </div>
                <div class="sff-cta">
                  <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="navigate('administration')">Administration</button>
                  <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdGoToRenta('${b.id}')">Alimenter le bilan</button>
                </div>`
              : `<div class="sff-empty">
                   <div class="sff-empty__ic">${sfAccIcon('colonne',34)}</div>
                   <div class="sff-empty__t">Aucune société rattachée</div>
                   <div class="sff-empty__x">Le rattachement sert à une seule chose, mais elle compte : les loyers encaissés et les charges payées de ce bien alimentent alors le bilan comptable de la société.</div>
                   <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="editBien('${b.id}')">Rattacher une SCI</button>
                 </div>`}
            </div>
          </div>
        </section>

      </div><!-- /sff-main -->
    </div><!-- /sff-body -->
  </div>`;

  switchBienTab(bienDetailTab);
}

// ═══════════════════════════════════════════════════════════
//   P4 — MISE EN GESTION AU PASSAGE « ACHETÉ »
// ═══════════════════════════════════════════════════════════
// Passer un bien en « Acheté » le fait basculer du pipeline vers la gestion :
// il apparaît alors dans quatre onglets du Module financier. Sans SCI, sans
// locataire et sans loyers, il y reste vide. Ces trois gestes sont désormais
// proposés au moment exact où ils deviennent nécessaires.
/* DEUX étapes depuis le 15/08/2026, et non plus trois. « Générer les loyers »
   était la troisième : elle demandait un clic pour un geste qui n'a jamais eu
   d'alternative — dès qu'un locataire est rattaché avec sa date d'entrée et
   son loyer, les douze lignes du calendrier en découlent. `autoGenerateLoyers`
   les crée désormais seule, au rattachement comme à la création. Une étape de
   moins à l'écran, et une fenêtre qui tient sans défilement. */
function bdEtapesGestion(b) {
  const locActif = allLocataires.find(l => l.bien_id === b.id && l.statut === 'Actif') || null;
  return [
    /* ⚠️ RÈGLE OBLIGATOIRE, arrêtée le 12/08/2026 : un bien passé en « Acheté »
       DÉCLARE COMMENT IL EST DÉTENU — en propre (personne physique) ou via une
       SCI (personne morale). Cette étape était auparavant « Rattacher une SCI »
       et restait FACULTATIVE : `sci_id IS NULL` voulait alors dire deux choses
       opposées, « détenu en nom propre » et « on ne sait pas encore ». C'est
       cette confusion qui produisait des phrases orphelines dans la déclaration
       fiscale. Elle passe donc PREMIÈRE et devient obligatoire. */
    /* `ic` = une CLE de SF_ACC_ICONS, jamais un emoji : jeu unique, viewBox 24,
       `currentColor` — l'icone suit la couleur du texte, ce qu'un emoji ne fait
       jamais. Trois emojis subsistaient ici (14/08/2026). */
    { k:'detention', ic:'banque', lab:'Mode de détention',
      sub:"En votre nom propre, ou via une SCI. C'est ce choix qui détermine où ce bien se déclare.",
      fait: !!b.mode_detention,
      valeur: b.mode_detention === 'propre' ? 'En nom propre'
            : (allSCI.find(s => s.id === b.sci_id)?.nom_sci || null) },
    { k:'loc', ic:'user', lab:'Enregistrer le locataire',
      sub:"Bail, loyer hors charges et date d'entrée : la base de tout le suivi locatif.",
      fait: !!locActif,
      valeur: locActif ? ([locActif.prenom, locActif.nom].filter(Boolean).join(' ') || 'Locataire actif') : null },
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
   DEMANDER CONFIRMATION, À LA CHARTE — remplaçante de `confirm()`.

   ⚠️ `confirm()` affiche une boîte du NAVIGATEUR : sa typographie, ses boutons,
   ses libellés système, et une bannière « …github.io indique » en tête. Sur une
   plateforme dont la cohérence visuelle est un mot d'ordre, c'est la seule
   fenêtre qui trahit l'application. Signalé par Thomas le 15/08/2026.

   Rend une promesse : `if (await sfConfirmer({ … })) { … }`.
   Réutilise le cadre `modal-detail` — elle ne s'empile donc jamais avec le
   workflow d'acquisition, les deux ne coexistent pas.

   ⚠️ `question` est ÉCHAPPÉE (elle porte souvent un titre de bien saisi par
   l'utilisateur). `detail` ne l'est PAS : elle accepte du balisage pour mettre
   en avant un nom de section — à l'appelant d'échapper ce qu'il y interpole. */
function sfConfirmer({ titre, question, detail, ok = 'Confirmer',
                       annuler = 'Annuler', danger = false }) {
  return new Promise(resolve => {
    const overlay = document.getElementById('modal-detail');
    document.getElementById('detail-titre').textContent = titre || 'Confirmation';
    document.getElementById('detail-content').innerHTML = `
      <div class="bd-acq">
        <div class="bd-acq__q">
          <div class="bd-acq__qic${danger ? ' bd-acq__qic--danger' : ''}">${sfAccIcon(danger ? 'alerte' : 'info', 20)}</div>
          <div>
            <p class="bd-acq__qt">${esc(question)}</p>
            ${detail ? `<p class="bd-acq__qx">${detail}</p>` : ''}
          </div>
        </div>
        <div class="bd-step-pied">
          <button class="sf-btn sf-btn--ghost" id="sf-conf-non">${esc(annuler)}</button>
          <button class="sf-btn ${danger ? 'sf-btn--danger' : 'sf-btn--primary'}" id="sf-conf-oui">${esc(ok)}</button>
        </div>
      </div>`;
    overlay.classList.add('modal-overlay--acq');
    overlay.dataset.verrou = '1';
    const croix = overlay.querySelector('.btn-close');
    if(croix) croix.hidden = true;
    openModal('modal-detail');

    const repondre = (v) => {
      delete overlay.dataset.verrou;
      if(croix) croix.hidden = false;
      overlay.classList.remove('modal-overlay--acq');
      closeModal('modal-detail');
      document.removeEventListener('keydown', surTouche);
      resolve(v);
    };
    // Ici Échap est légitime : une question fermée se refuse, contrairement au
    // workflow d'acquisition qui exige une réponse explicite.
    const surTouche = e => { if(e.key === 'Escape') { e.preventDefault(); repondre(false); } };
    document.getElementById('sf-conf-oui').onclick = () => repondre(true);
    document.getElementById('sf-conf-non').onclick = () => repondre(false);
    document.addEventListener('keydown', surTouche);
    document.getElementById('sf-conf-oui').focus();
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   LE BROUILLON D'ACQUISITION — rien n'est écrit avant la confirmation.

   ⚠️ C'est le choix de conception central de cette fenêtre (15/08/2026).
   Auparavant chaque bouton écrivait aussitôt en base : « En nom propre »
   enregistrait, « Rattacher » enregistrait. Un utilisateur qui se ravisait
   laissait donc derrière lui un bien à moitié déclaré, et « Annuler » aurait
   dû repasser derrière pour défaire — chaque défaire étant une occasion de
   laisser une trace.
   Désormais la fenêtre COLLECTE, et « Confirmer l'acquisition » écrit tout
   d'un bloc. Le statut « Acheté » lui-même n'est écrit qu'à ce moment : tant
   qu'on n'a pas confirmé, le bien n'a pas bougé, et « Annuler » n'a
   strictement rien à défaire.

   `vue`  : 'confirmation' → 'gestion' → 'succes'
   `mode` : 'acquisition' (le bien bascule) | 'reprise' (bien déjà acquis dont
            la mise en gestion est restée incomplète — points d'attention,
            onglet Locatif, tableau de bord). En reprise, on entre directement
            sur 'gestion' et le statut n'est pas touché.               */
let bdAcq = null;

/* Point d'entrée de l'ACQUISITION. Deux gestes volontaires y mènent, et deux
   seulement : le bouton de la fiche et le dépôt dans la colonne « Finalisé »
   du kanban. Voir `TI_BIENS.STATUTS_SAISISSABLES`. */
async function bdDemarrerAcquisition(bienId) {
  const b = allBiens.find(x => x.id === bienId);
  if(!b) { showNotif('Bien introuvable', true); return; }
  if(sfDetenu(b)) { showNotif('Ce bien fait déjà partie de votre patrimoine'); return; }
  if(!allSCI.length && currentUser) await loadSCIList();
  bdAcq = { bienId, mode:'acquisition', vue:'confirmation',
            detention:null, sciId:null, locChoix:null, locId:null, enCours:false };
  bdAcqRender();
  openModal('modal-detail');
}

/* Point d'entrée de la REPRISE — un bien déjà acquis qu'il reste à déclarer.
   Conservé tel quel : cinq appelants s'en servent (points d'attention, onglet
   Locatif, tableau de bord, Suivi financier). */
async function bdOpenMiseEnGestion(bienId) {
  const b = allBiens.find(x => x.id === bienId);
  if(!b) return;
  if(!allSCI.length && currentUser) await loadSCIList();
  const locActif = allLocataires.find(l => l.bien_id === b.id && l.statut === 'Actif') || null;
  bdAcq = { bienId, mode:'reprise', vue:'gestion',
            detention: b.mode_detention || null, sciId: b.sci_id || null,
            locChoix: locActif ? 'existant' : null, locId: locActif?.id || null,
            enCours:false };
  bdAcqRender();
  openModal('modal-detail');
}

/* Trois vues successives dans LE MÊME cadre, plutôt qu'un empilement de
   fenêtres : confirmation → mise en gestion → félicitations. */
function bdAcqRender() {
  if(!bdAcq) return;
  const b = allBiens.find(x => x.id === bdAcq.bienId);
  if(!b) { bdAcqFermer(); return; }
  const vues = { confirmation: bdAcqVueConfirmation,
                 gestion:      bdAcqVueGestion,
                 succes:       bdAcqVueSucces };
  const { titre, corps } = vues[bdAcq.vue](b);
  document.getElementById('detail-titre').textContent = titre;
  document.getElementById('detail-content').innerHTML = corps;
  // Plafonne la hauteur de la fenêtre le temps du workflow, et pas au-delà :
  // les autres écrans partagent `#detail-content`.
  document.getElementById('modal-detail')?.classList.add('modal-overlay--acq');
  // Sur l'écran de félicitations, l'acte est passé : on rend la sortie libre.
  bdAcqVerrouiller(bdAcq.vue !== 'succes');
}

/* Pendant le workflow, la fenêtre se ferme par « Annuler » ou « Confirmer », et
   par rien d'autre — ni croix, ni clic sur le fond, ni Échap. C'est la lecture
   littérale de « obligatoirement rempli » : les deux issues restent explicites,
   donc rien n'est piégé. */
function bdAcqVerrouiller(actif) {
  const o = document.getElementById('modal-detail');
  if(!o) return;
  if(actif) o.dataset.verrou = '1'; else delete o.dataset.verrou;
  const croix = o.querySelector('.btn-close');
  if(croix) croix.hidden = !!actif;
}

// ── Vue 1 : la question ────────────────────────────────────────────────────
function bdAcqVueConfirmation(b) {
  return { titre: "Confirmer l'acquisition", corps: `
    <div class="bd-acq">
      <div class="bd-acq__q">
        <div class="bd-acq__qic">${sfAccIcon('maison', 20)}</div>
        <div>
          <p class="bd-acq__qt">Confirmez-vous l'acquisition de « ${esc(b.titre || 'ce bien')} » ?</p>
          <p class="bd-acq__qx">Ce bien quitte <strong>Ma prospection</strong> pour rejoindre
            <strong>Mon patrimoine</strong>, et ses loyers et charges alimenteront le
            <strong>Suivi financier</strong>. Vous allez ensuite déclarer son mode de détention
            et son locataire.</p>
        </div>
      </div>
      <div class="bd-step-pied">
        <button class="sf-btn sf-btn--ghost" onclick="bdAcqAnnuler()">Pas encore</button>
        <button class="sf-btn sf-btn--primary" onclick="bdAcqVersGestion()">${sfAccIcon('check',16)} Oui, ce bien est acheté</button>
      </div>
    </div>` };
}

// ── Vue 2 : les deux déclarations ──────────────────────────────────────────
function bdAcqVueGestion(b) {
  const acquisition = bdAcq.mode === 'acquisition';
  // Locataires réutilisables : tous sauf les sortis. Ceux rattachés ailleurs
  // restent proposés, simplement signalés.
  const locDispos = allLocataires.filter(l => l.statut !== 'Sorti');
  const pret = !!bdAcq.detention && (bdAcq.detention !== 'sci' || !!bdAcq.sciId) && !!bdAcq.locChoix;
  const sel = (a, b2) => a === b2 ? ' est-choisi' : '';

  return { titre: acquisition ? "Confirmer l'acquisition" : `Mise en gestion — ${b.titre || 'Bien'}`, corps: `
    <div class="bd-acq">
     <div class="bd-acq__corps">
      <p class="bd-acq__intro">${acquisition
        ? `<strong>${esc(b.titre || 'Ce bien')}</strong> rejoint votre patrimoine. Deux déclarations, et son suivi est opérationnel.`
        : `Il reste à déclarer ce bien pour que son suivi soit complet.`}</p>

      <section class="bd-acq__s">
        <h3 class="bd-acq__st">${sfAccIcon('banque',15)} Mode de détention</h3>
        <p class="bd-acq__sx">En votre nom propre, ou via une SCI. C'est ce choix qui détermine où ce bien se déclare.</p>
        <div class="bd-acq__choix">
          <button type="button" class="bd-choix${sel(bdAcq.detention,'propre')}" onclick="bdAcqSetDetention('propre')">
            <span class="bd-choix__t">En nom propre</span>
            <span class="bd-choix__x">Vous le détenez en personne physique</span>
          </button>
          <button type="button" class="bd-choix${sel(bdAcq.detention,'sci')}" onclick="bdAcqSetDetention('sci')"
                  ${allSCI.length ? '' : 'disabled'}>
            <span class="bd-choix__t">Via une SCI</span>
            <span class="bd-choix__x">${allSCI.length ? 'Une société que vous avez créée' : 'Aucune SCI enregistrée'}</span>
          </button>
        </div>
        ${bdAcq.detention === 'sci' ? `
          <div class="bd-acq__sous">
            <select class="sfb-sel" id="mg-sci" aria-label="SCI détentrice" onchange="bdAcqSetSci(this.value)">
              <option value="">Choisissez la SCI…</option>
              ${allSCI.map(s => `<option value="${s.id}"${s.id===bdAcq.sciId?' selected':''}>${esc(s.nom_sci)}</option>`).join('')}
            </select>
          </div>` : ''}
        ${!allSCI.length ? `
          <p class="bd-acq__note">Aucune SCI enregistrée.
            <button class="bd-acq__lien" onclick="bdAcqAnnuler();navigate('administration')">En créer une</button></p>` : ''}
      </section>

      <section class="bd-acq__s">
        <h3 class="bd-acq__st">${sfAccIcon('user',15)} Locataire</h3>
        <p class="bd-acq__sx">Les loyers se génèrent ensuite tout seuls, à partir du bail et de la date d'entrée.</p>
        <div class="bd-acq__choix bd-acq__choix--3">
          <button type="button" class="bd-choix${sel(bdAcq.locChoix,'existant')}" onclick="bdAcqSetLoc('existant')"
                  ${locDispos.length ? '' : 'disabled'}>
            <span class="bd-choix__t">Un locataire existant</span>
            <span class="bd-choix__x">${locDispos.length ? 'Le rattacher à ce bien' : 'Aucun locataire enregistré'}</span>
          </button>
          <button type="button" class="bd-choix${sel(bdAcq.locChoix,'nouveau')}" onclick="bdAcqSetLoc('nouveau')">
            <span class="bd-choix__t">Un nouveau locataire</span>
            <span class="bd-choix__x">Sa fiche s'ouvrira juste après</span>
          </button>
          <button type="button" class="bd-choix${sel(bdAcq.locChoix,'aucun')}" onclick="bdAcqSetLoc('aucun')">
            <span class="bd-choix__t">Pas de locataire</span>
            <span class="bd-choix__x">Le bien est vacant pour l'instant</span>
          </button>
        </div>
        ${bdAcq.locChoix === 'existant' && locDispos.length ? `
          <div class="bd-acq__sous">
            <select class="sfb-sel" id="mg-loc" aria-label="Locataire à rattacher" onchange="bdAcqSetLocId(this.value)">
              <option value="">Choisissez le locataire…</option>
              ${locDispos.map(l => {
                const nom = [l.prenom, l.nom].filter(Boolean).join(' ') || 'Sans nom';
                const autre = l.bien_id && l.bien_id !== b.id ? allBiens.find(x => x.id === l.bien_id) : null;
                const t = autre ? (autre.titre || 'un bien') : '';
                const suffixe = autre ? ` · déjà sur ${t.length > 24 ? t.slice(0,24)+'…' : t}` : '';
                return `<option value="${l.id}"${l.id===bdAcq.locId?' selected':''}>${esc(nom)}${esc(suffixe)}</option>`;
              }).join('')}
            </select>
          </div>` : ''}
      </section>
     </div>

      <div class="bd-step-pied">
        <button class="sf-btn sf-btn--ghost" onclick="bdAcqAnnuler()">Annuler</button>
        <button class="sf-btn sf-btn--primary" id="bd-acq-ok" ${pret ? '' : 'disabled'}
                onclick="bdAcqConfirmer()">${sfAccIcon('check',16)} ${acquisition ? "Confirmer l'acquisition" : 'Enregistrer'}</button>
      </div>
    </div>` };
}

// ── Vue 3 : l'acquisition est faite ────────────────────────────────────────
/* ⚠️ Acheter un bien immobilier n'est pas un enregistrement de formulaire. On
   marque le moment — sobrement : une coche qui se dessine, le nom du bien, les
   trois chiffres qui comptent. L'animation festive dure moins d'une seconde et
   respecte `prefers-reduced-motion`. */
function bdAcqVueSucces(b) {
  const r = bdAcq.resume || {};
  const cout = (parseFloat(b.prix_affiche)||0) + (parseFloat(b.frais_notaire)||0)
             + (parseFloat(b.travaux)||0) + (parseFloat(b.frais_agence)||0)
             + (b.mode_detention === 'sci' ? (parseFloat(b.creation_sci)||0) : 0);
  const chiffres = [
    { l:"Coût d'acquisition", v: sfEur(cout) },
    { l:'Mensualité de crédit', v: b.mensualite_credit ? sfEur(b.mensualite_credit) + '/mois' : '—' },
    { l:'Détention', v: b.mode_detention === 'sci'
        ? (allSCI.find(s => s.id === b.sci_id)?.nom_sci || 'Via une SCI') : 'En nom propre' },
  ];
  return { titre: 'Félicitations', corps: `
    <div class="bd-acq bd-acq--succes">
      <div class="bd-succes__eclat" aria-hidden="true">
        ${Array.from({length:12}, (_,i) => `<i style="--i:${i}"></i>`).join('')}
      </div>
      <div class="bd-succes__coche" aria-hidden="true">
        <svg viewBox="0 0 52 52" width="56" height="56" fill="none" stroke="currentColor"
             stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">
          <circle class="bd-succes__c" cx="26" cy="26" r="23"/>
          <path class="bd-succes__v" d="M15 27l8 8 15-16"/>
        </svg>
      </div>
      <p class="bd-succes__t">${esc(b.titre || 'Ce bien')} rejoint votre patrimoine</p>
      <p class="bd-succes__x">Félicitations pour cette acquisition. Le bien alimente désormais
        votre Suivi financier${r.loyers ? `, et ses ${r.loyers} échéances de loyer sont déjà au calendrier` : ''}.</p>

      <dl class="bd-succes__kpis">
        ${chiffres.map(c => `<div><dt>${c.l}</dt><dd>${c.v}</dd></div>`).join('')}
      </dl>

      ${r.locNouveau ? `
        <p class="bd-acq__note">Il reste à créer la fiche du locataire : sa date d'entrée et son
          loyer déclencheront la génération des échéances.</p>` : ''}
      ${r.locSansDate ? `
        <p class="bd-acq__note">Le locataire rattaché n'a pas de date d'entrée : renseignez-la pour
          que ses loyers se génèrent.</p>` : ''}

      <div class="bd-step-pied">
        <button class="sf-btn sf-btn--ghost" onclick="bdAcqFermer()">Fermer</button>
        ${r.locNouveau
          ? `<button class="sf-btn sf-btn--primary" onclick="bdAcqFermer();openLocataireModal(null,'${b.id}')">${sfAccIcon('plus',16)} Créer le locataire</button>`
          : `<button class="sf-btn sf-btn--primary" onclick="bdAcqFermer();bdGoToSuivi('${b.id}')">${sfAccIcon('agenda',16)} Ouvrir le suivi mensuel</button>`}
      </div>
    </div>` };
}

// ── Le brouillon : ces fonctions n'écrivent RIEN, elles notent ─────────────
function bdAcqVersGestion() { if(bdAcq) { bdAcq.vue = 'gestion'; bdAcqRender(); } }
function bdAcqSetDetention(mode) {
  if(!bdAcq) return;
  bdAcq.detention = mode;
  if(mode !== 'sci') bdAcq.sciId = null;
  // Une seule SCI : la choisir d'office évite un clic qui n'a pas d'alternative.
  else if(!bdAcq.sciId && allSCI.length === 1) bdAcq.sciId = allSCI[0].id;
  bdAcqRender();
}
function bdAcqSetSci(id)   { if(bdAcq) { bdAcq.sciId = id || null; bdAcqRender(); } }
function bdAcqSetLoc(choix){ if(bdAcq) { bdAcq.locChoix = choix;
                                          if(choix !== 'existant') bdAcq.locId = null;
                                          bdAcqRender(); } }
function bdAcqSetLocId(id) { if(bdAcq) { bdAcq.locId = id || null; bdAcqRender(); } }

/* ═══════════════════════════════════════════════════════════════════════════
   L'ÉCRITURE — le seul endroit du workflow qui touche la base.
   ⚠️ `mode_detention` et `sci_id` partent dans le MÊME `update`, avec le
   statut : c'est ce que l'invariant `biens_mode_detention_coherent` exige.  */
async function bdAcqConfirmer() {
  if(!bdAcq || bdAcq.enCours) return;
  const b = allBiens.find(x => x.id === bdAcq.bienId);
  if(!b) return;
  if(!bdAcq.detention) { showNotif('Déclarez le mode de détention', true); return; }
  if(bdAcq.detention === 'sci' && !bdAcq.sciId) { showNotif('Choisissez la SCI détentrice', true); return; }
  if(!bdAcq.locChoix) { showNotif('Indiquez la situation locative', true); return; }
  if(bdAcq.locChoix === 'existant' && !bdAcq.locId) { showNotif('Choisissez le locataire', true); return; }

  const loc = bdAcq.locChoix === 'existant'
    ? allLocataires.find(l => l.id === bdAcq.locId) : null;
  // Un locataire déjà actif ailleurs n'est pas bloqué, mais on ne le déplace
  // pas en douce.
  if(loc && loc.bien_id && loc.bien_id !== b.id) {
    const autre = allBiens.find(x => x.id === loc.bien_id);
    const nom = [loc.prenom, loc.nom].filter(Boolean).join(' ') || 'Ce locataire';
    if(!confirm(`${nom} est actuellement rattaché à « ${autre?.titre || 'un autre bien'} ».\n\nLe déplacer vers ce bien ?`)) return;
  }

  bdAcq.enCours = true;
  const bouton = document.getElementById('bd-acq-ok');
  if(bouton) { bouton.disabled = true; bouton.textContent = 'Enregistrement…'; }

  const patchBien = { mode_detention: bdAcq.detention,
                      sci_id: bdAcq.detention === 'sci' ? bdAcq.sciId : null };
  if(bdAcq.mode === 'acquisition') patchBien.statut = 'Acheté';

  try {
    const { error } = await db.from('biens').update(patchBien).eq('id', b.id);
    if(error) throw error;
    Object.assign(b, patchBien);

    const resume = { loyers: 0, locNouveau: bdAcq.locChoix === 'nouveau', locSansDate: false };

    if(loc) {
      const patchLoc = { bien_id: b.id };
      if(loc.statut !== 'Actif') patchLoc.statut = 'Actif';
      const { error: eLoc } = await db.from('locataires').update(patchLoc).eq('id', loc.id);
      if(eLoc) throw eLoc;
      Object.assign(loc, patchLoc);
      /* Génération AUTOMATIQUE des loyers — c'était une étape à cliquer, elle
         n'a jamais eu d'alternative. `autoGenerateLoyers` est la source unique
         (prorata loi 1989 compris) ; ce chemin-ci ne l'appelait pas, alors que
         `saveLocataire` le faisait déjà. Les deux s'alignent. */
      if(loc.date_entree) {
        resume.loyers = await autoGenerateLoyers(loc);
        if(resume.loyers > 0 && typeof loadMfFinancialData === 'function') await loadMfFinancialData();
      } else {
        resume.locSansDate = true;
      }
    }

    bdAcq.resume = resume;
    bdAcq.vue = 'succes';
    bdAcqRender();
    await loadBiens?.();
    bdRefresh();
  } catch(e) {
    bdAcq.enCours = false;
    showNotif('Erreur : ' + (e.message || 'enregistrement impossible'), true);
    bdAcqRender();
  }
}

/* « Annuler » n'a RIEN à défaire : tant qu'on n'a pas confirmé, le bien n'a pas
   bougé. On se contente de redessiner — le kanban, notamment, a pu déplacer la
   carte à l'écran alors que le statut n'a jamais changé en base. */
function bdAcqAnnuler() {
  const revenirAuKanban = bdAcq?.origine === 'kanban';
  bdAcqFermer();
  if(revenirAuKanban && typeof applyFilters === 'function') applyFilters();
  else bdRefresh();
}

function bdAcqFermer() {
  bdAcqVerrouiller(false);
  document.getElementById('modal-detail')?.classList.remove('modal-overlay--acq');
  closeModal('modal-detail');
  bdAcq = null;
}

/* Le retour en arrière. Sans lui, un bien passé en « Acheté » y resterait
   pour toujours : « Acheté » ne figure plus dans aucune liste déroulante, donc
   la sortie ne peut plus venir de là non plus. */
/* ⚠️ On repose le bien sur « Compromis signé » — la dernière étape avant
   l'acquisition — et PAS sur un statut choisi dans une liste numérotée : le
   bien redevient en prospection, donc sa picklist redevient éditable et
   l'utilisateur l'ajuste d'un clic, avec le composant de la plateforme. Une
   décision de moins à prendre dans une boîte de dialogue.
   Le mode de détention est remis à NULL : un bien qui n'est plus acquis n'a
   plus de déclarant, et l'invariant `biens_mode_detention_coherent` exige que
   `sci_id` parte avec. Locataires, loyers et charges sont conservés. */
const BD_STATUT_RETOUR = 'Compromis signé';

async function bdRemettreEnProspection(bienId) {
  const b = allBiens.find(x => x.id === bienId);
  if(!b || !sfDetenu(b)) return;
  const ok = await sfConfirmer({
    titre: 'Remettre en prospection',
    question: `Remettre « ${b.titre || 'ce bien'} » en prospection ?`,
    detail: `Il quittera <strong>Mon patrimoine</strong> et cessera d'alimenter le
      <strong>Suivi financier</strong>. Son mode de détention sera à redéclarer.<br><br>
      Ses locataires, loyers et charges sont conservés. Le bien repassera au statut
      « ${esc(BD_STATUT_RETOUR)} », que vous pourrez ajuster ensuite.`,
    ok: 'Remettre en prospection', annuler: 'Garder dans le patrimoine', danger: true });
  if(!ok) return;
  try {
    const patch = { statut: BD_STATUT_RETOUR, mode_detention: null, sci_id: null };
    const { error } = await db.from('biens').update(patch).eq('id', b.id).eq('user_id', currentUser.id);
    if(error) throw error;
    Object.assign(b, patch);
    showNotif(`Bien remis en prospection · ${BD_STATUT_RETOUR}`);
    bdRefresh();
    if(currentPage === 'biens') applyFilters();
  } catch(e) { showNotif('Erreur : ' + e.message, true); }
}

// Galerie photos du bien : ouverte depuis la vignette du rail
function bdOpenGallery() {
  if(!bdPhotos.length) return;
  const b = allBiens.find(x => x.id === currentBienId);
  document.getElementById('detail-titre').textContent =
    `${bdPhotos.length} photo${bdPhotos.length>1?'s':''} — ${b?.titre || 'Bien'}`;
  document.getElementById('detail-content').innerHTML = `
    <div style="padding:12px 16px 18px">
      <div class="bien-gallery">
        ${bdPhotos.map(p => `<img src="${p}" onclick="openLightbox('${p}')" title="Cliquer pour agrandir">`).join('')}
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:16px">
        <button class="sf-btn sf-btn--secondary" onclick="closeModal('modal-detail')">Fermer</button>
      </div>
    </div>`;
  openModal('modal-detail');
}

function openDoc(dataUrl) {
  if(!dataUrl) return;
  const w = window.open('');
  if(w) {
    w.document.write(`<iframe src="${dataUrl}" style="width:100%;height:100vh;border:none"></iframe>`);
    w.document.close();
  }
}

function editBien(id) {
  const b=allBiens.find(x=>x.id===id);
  if(!b)return;
  navigate('nouveau');
  setTimeout(()=>renderNouveau(document.getElementById('content'),b),10);
}

// ═══════════════════════════════════════════════════════════
//   ACTIONS SUR UN BIEN (V2) — CRUD via adm-modal-overlay
// ═══════════════════════════════════════════════════════════
let _reopenDetailTab = null;          // onglet à réactiver après rebuild de openDetail
let editingActionId = null;           // null = création, sinon édition
let actionModalBienId = null;         // bien rattaché à l'action en cours

const ACTION_TYPES = ['Appel téléphonique','Email envoyé','Visite','Offre envoyée','Relance','Rendez-vous','Document reçu','Note libre'];

async function openActionModal(bienId, actionId) {
  actionModalBienId = bienId;
  editingActionId = actionId || null;
  let a = null;
  if(editingActionId) {
    // Recharge l'action depuis la base (source de vérité), scope user implicite via RLS
    const { data } = await db.from('actions').select('*').eq('id', editingActionId).maybeSingle();
    a = data || null;
  }
  const today = new Date().toISOString().slice(0,10);
  const curType = a?.type_action || '';
  // Si le type existant n'est pas dans la liste prédéfinie → mode "Autre" pré-rempli
  const isCustom = curType && !ACTION_TYPES.includes(curType);

  document.getElementById('adm-modal-title').textContent = editingActionId ? 'Modifier l\'action' : '＋ Nouvelle action';
  document.getElementById('adm-modal-del').style.display = editingActionId ? 'flex' : 'none';
  document.getElementById('adm-modal-save').onclick = saveAction;
  document.getElementById('adm-modal-del').onclick = deleteAction;

  document.getElementById('adm-modal-body').innerHTML = `
    <div class="sci-form-group">
      <label class="sci-form-label">Type d'action <span style="color:var(--sf-loss)">*</span></label>
      <select class="sci-form-input" id="act-type" onchange="actionTypeToggle()">
        ${ACTION_TYPES.map(t=>`<option value="${esc(t)}" ${curType===t?'selected':''}>${esc(t)}</option>`).join('')}
        <option value="__autre__" ${isCustom?'selected':''}>Autre…</option>
      </select>
    </div>
    <div class="sci-form-group" id="act-type-custom-wrap" style="display:${isCustom?'block':'none'}">
      <label class="sci-form-label">Préciser le type</label>
      <input class="sci-form-input" id="act-type-custom" type="text" maxlength="60" value="${isCustom?esc(curType):''}" placeholder="Ex : Signature mandat">
    </div>
    <div class="sci-form-group">
      <label class="sci-form-label">Date <span style="color:var(--sf-loss)">*</span></label>
      <input class="sci-form-input" id="act-date" type="date" value="${esc(a?.date_action || today)}">
    </div>
    <div class="sci-form-group">
      <label class="sci-form-label">Commentaire</label>
      <textarea class="sci-form-input" id="act-comment" rows="3" style="resize:vertical" placeholder="Détails, interlocuteur, montant évoqué…">${a?.commentaire ? esc(a.commentaire) : ''}</textarea>
    </div>`;

  document.getElementById('adm-modal-overlay').classList.add('open');
}

function actionTypeToggle() {
  const sel = document.getElementById('act-type').value;
  const wrap = document.getElementById('act-type-custom-wrap');
  if(wrap) wrap.style.display = sel === '__autre__' ? 'block' : 'none';
}

async function saveAction() {
  const sel = document.getElementById('act-type').value;
  const type = sel === '__autre__'
    ? (document.getElementById('act-type-custom').value || '').trim()
    : sel;
  const date = document.getElementById('act-date').value;
  if(!type) { showNotif('Le type d\'action est obligatoire.', true); return; }
  if(!date) { showNotif('La date est obligatoire.', true); return; }

  const btn = document.getElementById('adm-modal-save');
  btn.disabled = true; btn.innerHTML = '<span class="sci-spinner"></span>Enregistrement…';

  const payload = {
    bien_id: actionModalBienId,
    type_action: type,
    date_action: date,
    commentaire: (document.getElementById('act-comment').value || '').trim() || null,
    user_id: currentUser.id
  };
  try {
    let res;
    if(editingActionId) res = await db.from('actions').update(payload).eq('id', editingActionId).eq('user_id', currentUser.id);
    else res = await db.from('actions').insert(payload);
    if(res.error) throw res.error;
    showNotif(editingActionId ? 'Action mise à jour ✓' : 'Action ajoutée ✓');
    closeAdmModal();
    _reopenDetailTab = 'actions';
    openDetail(actionModalBienId);
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  } finally {
    btn.disabled = false; btn.innerHTML = sfAccIcon("check",14)+' Enregistrer';
  }
}

async function deleteAction() {
  if(!editingActionId || !confirm('Supprimer cette action ? Cette opération est irréversible.')) return;
  const { error } = await db.from('actions').delete().eq('id', editingActionId).eq('user_id', currentUser.id);
  if(error) { showNotif('Erreur : ' + error.message, true); return; }
  showNotif('Action supprimée');
  const bienId = actionModalBienId;
  closeAdmModal();
  _reopenDetailTab = 'actions';
  openDetail(bienId);
}

// ═══════════════════════════════════════════════════════════
//   EXPORT PDF — DOSSIER BANCAIRE (module bkdoc)
//   Bouton fiche bien → modal config → génération client
//   html2canvas (pages) + jsPDF (assemblage) + pdf-lib (annexe)
// ═══════════════════════════════════════════════════════════

const BKDOC_ASSETS = 'https://dizkljqobgiywxsbsdkd.supabase.co/storage/v1/object/public/bank-assets/';
const BKDOC_COVER_URL = BKDOC_ASSETS + 'assets/cover-photo.jpg';
let bkdocLibsPromise = null;
let bkdocPresetsCache = null;
let bkdocCtx = null; // contexte du modal en cours { bien, scis, sims, photoPaths, selPhotos }

function bkdocLoadScript(src){
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res;
    s.onerror = () => rej(new Error('Échec de chargement : ' + src));
    document.head.appendChild(s);
  });
}

function bkdocEnsureLibs(){
  if(!bkdocLibsPromise){
    bkdocLibsPromise = (async () => {
      if(!document.getElementById('bkdoc-font')){
        const l = document.createElement('link');
        l.id = 'bkdoc-font'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,500;0,600;0,800;1,500&display=swap';
        document.head.appendChild(l);
      }
      const jobs = [];
      if(!window.html2canvas) jobs.push(bkdocLoadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'));
      if(!(window.jspdf && window.jspdf.jsPDF)) jobs.push(bkdocLoadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'));
      if(!window.PDFLib) jobs.push(bkdocLoadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js'));
      await Promise.all(jobs);
    })();
    bkdocLibsPromise.catch(() => { bkdocLibsPromise = null; }); // permet un retry si échec réseau
  }
  return bkdocLibsPromise;
}

// ── Helpers de formatage ──
function bkdocEUR(n){ return (n == null || isNaN(n)) ? '—' : fmt(n) + ' €'; }
function bkdocDateFR(d){ const dt = d ? new Date(d) : new Date(); return dt.toLocaleDateString('fr-FR', {day:'numeric', month:'long', year:'numeric'}); }
function bkdocFilename(titre){
  const d = new Date();
  const ymd = d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const clean = (titre || 'bien').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,60);
  return ymd + '_Demande_de_financement_' + clean + '.pdf';
}
function bkdocInitials(prenom, nom){ return ((prenom||' ')[0] + (nom||' ')[0]).toUpperCase().trim() || '–'; }
function bkdocLogoErr(img){ const d = document.createElement('div'); d.className = 'logo-fallback'; d.textContent = img.getAttribute('data-bank') || 'Banque'; img.replaceWith(d); }

// Pré-découpe la photo de couverture en triangle dans un canvas (html2canvas ne
// supporte pas clip-path). Retourne un dataURL JPEG fond blanc, prêt à poser en
// fond de page. Fallback : triangle dégradé aux couleurs de la banque.
function bkdocMakeCoverWedge(url, preset){
  return new Promise(resolve => {
    const W = 1588, H = 2246; // A4 @ scale 2 pour la qualité d'impression
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    const clipTriangle = () => { ctx.beginPath(); ctx.moveTo(0.176*W, H); ctx.lineTo(W, 0.385*H); ctx.lineTo(W, H); ctx.closePath(); ctx.clip(); };
    const gradientFallback = () => {
      ctx.save(); clipTriangle();
      const g = ctx.createLinearGradient(0.176*W, 0.385*H, W, H);
      g.addColorStop(0, preset.couleur_secondaire || '#008080');
      g.addColorStop(1, preset.couleur_primaire || '#006040');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
      resolve(c.toDataURL('image/jpeg', 0.9));
    };
    if(!url){ gradientFallback(); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => { img.src = ''; gradientFallback(); }, 12000);
    img.onload = () => {
      clearTimeout(timer);
      try {
        ctx.save(); clipTriangle();
        // Cadrage "cover" avec point focal 65% / 55% (identique au template validé)
        const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
        const sw = W / scale, sh = H / scale;
        const sx = (img.naturalWidth - sw) * 0.65, sy = (img.naturalHeight - sh) * 0.55;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
        ctx.restore();
        resolve(c.toDataURL('image/jpeg', 0.9));
      } catch(e) { ctx.restore && ctx.restore(); gradientFallback(); }
    };
    img.onerror = () => { clearTimeout(timer); gradientFallback(); };
    img.src = url;
  });
}

// ── Ouverture du modal de configuration ──
async function openDossierModal(bienId){
  const b = allBiens.find(x => x.id === bienId);
  if(!b){ showNotif('Bien introuvable.', true); return; }

  document.getElementById('adm-modal-title').textContent = '📄 Dossier banque — ' + (b.titre || 'Bien');
  document.getElementById('adm-modal-del').style.display = 'none';
  const saveBtn = document.getElementById('adm-modal-save');
  saveBtn.innerHTML = '🧾 Générer le dossier';
  saveBtn.disabled = true; // activé quand les données sont chargées
  saveBtn.onclick = bkdocGenerate;
  document.getElementById('adm-modal-body').innerHTML = '<div style="padding:18px 4px;font-size:13px;color:var(--c-dim)"><span class="sci-spinner"></span>Chargement des options…</div>';
  document.getElementById('adm-modal-overlay').classList.add('open');

  try {
    // Chargement parallèle : presets banque, SCI du compte, simulations du compte
    const [presetsRes, scisRes, simsRes] = await Promise.all([
      bkdocPresetsCache ? Promise.resolve({ data: bkdocPresetsCache }) : db.from('bank_presets').select('*').order('ordre'),
      db.from('sci').select('*').eq('user_id', currentUser.id).order('nom_sci'),
      db.from('simulations_credit').select('id, nom_simulation, montant_emprunte, taux_interet, duree_ans, mensualite_calculee, taux_endettement, pdf_path, pdf_name, date_document').eq('user_id', currentUser.id).order('created_at', { ascending: false })
    ]);
    if(presetsRes.error) throw presetsRes.error;
    if(scisRes.error) throw scisRes.error;
    if(simsRes.error) throw simsRes.error;
    bkdocPresetsCache = presetsRes.data || [];

    const photoPaths = Array.isArray(b.photos_paths) ? b.photos_paths : [];
    bkdocCtx = { bien: b, presets: bkdocPresetsCache, scis: scisRes.data || [], sims: simsRes.data || [], photoPaths, selPhotos: new Set() };

    // Présélection : 5 premières photos si plus de 5
    photoPaths.slice(0, 5).forEach((_, i) => bkdocCtx.selPhotos.add(i));

    const presetOpts = bkdocCtx.presets.map(p =>
      `<option value="${p.key}" ${!p.actif ? 'disabled' : ''} ${p.key === 'credit-agricole' ? 'selected' : ''}>${esc(p.nom)}${!p.actif ? ' (bientôt)' : ''}</option>`).join('');
    const sciOpts = ['<option value="">Sans SCI</option>']
      .concat(bkdocCtx.scis.map(s => `<option value="${s.id}" ${b.sci_id === s.id ? 'selected' : ''}>${esc(s.nom_sci)}</option>`)).join('');
    const simOpts = ['<option value="">Aucune</option>']
      .concat(bkdocCtx.sims.map(s => `<option value="${s.id}">${esc(s.nom_simulation || 'Simulation')}${s.pdf_path ? ' 📎' : ''}</option>`)).join('');

    let photosBlock = '';
    if(photoPaths.length === 0){
      photosBlock = '<div style="font-size:12px;color:var(--c-muted);padding:6px 0">Ce bien n\'a aucune photo — la page galerie sera omise.</div>';
    } else if(photoPaths.length <= 5){
      photosBlock = `<div style="font-size:12px;color:var(--c-muted);padding:6px 0">Les ${photoPaths.length} photo${photoPaths.length > 1 ? 's' : ''} du bien ser${photoPaths.length > 1 ? 'ont incluses' : 'a incluse'}.</div>`;
    } else {
      photosBlock = `<div style="font-size:12px;color:var(--c-muted);margin-bottom:2px">Ce bien a ${photoPaths.length} photos — sélectionnez-en 5 maximum (<span id="bkdoc-photo-count">5</span>/5) :</div>
        <div class="bkdoc-photo-grid" id="bkdoc-photo-grid">${photoPaths.map((p, i) =>
          `<div class="bkdoc-photo-item ${i < 5 ? 'sel' : ''}" data-idx="${i}" onclick="bkdocTogglePhoto(${i})"><img data-bkpath="${esc(p.path || '')}" alt=""><span class="tick">✓</span></div>`).join('')}</div>`;
    }

    document.getElementById('adm-modal-body').innerHTML = `
      <div class="sci-form-group">
        <label class="sci-form-label">Banque (charte graphique)</label>
        <select class="sci-form-input" id="bkdoc-bank">${presetOpts}</select>
      </div>
      <div class="sci-form-group">
        <label class="sci-form-label">SCI emprunteuse</label>
        <select class="sci-form-input" id="bkdoc-sci">${sciOpts}</select>
        ${bkdocCtx.scis.length === 0 ? '<div style="font-size:11px;color:var(--c-muted);margin-top:3px">Aucune SCI enregistrée — le dossier sera établi à votre nom.</div>' : ''}
      </div>
      <div class="sci-form-group">
        <label class="sci-form-label">Simulation de crédit à joindre</label>
        <select class="sci-form-input" id="bkdoc-sim">${simOpts}</select>
        <div style="font-size:11px;color:var(--c-muted);margin-top:3px">📎 = PDF de la banque joint en annexe. Sans simulation, la page « Plan de financement » est omise.</div>
      </div>
      <div class="sci-form-group">
        <label class="sci-form-label">Photos du bien</label>
        ${photosBlock}
      </div>
      <div class="bkdoc-progress" id="bkdoc-progress"></div>`;

    // Miniatures : résolution asynchrone des URLs signées (sans bloquer l'ouverture)
    document.querySelectorAll('#bkdoc-photo-grid img[data-bkpath]').forEach(async img => {
      try { img.src = await TI_STORAGE.signedUrl('biens-photos', img.getAttribute('data-bkpath')); } catch(e) { /* vignette grise */ }
    });

    saveBtn.disabled = false;
  } catch(e) {
    document.getElementById('adm-modal-body').innerHTML = `<div style="padding:14px 4px;font-size:13px;color:var(--sf-loss)">Erreur de chargement : ${esc(e.message)}</div>`;
  }
}

function bkdocTogglePhoto(idx){
  const item = document.querySelector(`.bkdoc-photo-item[data-idx="${idx}"]`);
  if(!item) return;
  if(bkdocCtx.selPhotos.has(idx)){ bkdocCtx.selPhotos.delete(idx); item.classList.remove('sel'); }
  else {
    if(bkdocCtx.selPhotos.size >= 5){ showNotif('5 photos maximum dans le dossier.', true); return; }
    bkdocCtx.selPhotos.add(idx); item.classList.add('sel');
  }
  const c = document.getElementById('bkdoc-photo-count');
  if(c) c.textContent = bkdocCtx.selPhotos.size;
}

function bkdocProgress(msg){
  const el = document.getElementById('bkdoc-progress');
  if(el){ el.style.display = 'block'; el.innerHTML = '<span class="sci-spinner"></span>' + esc(msg); }
}

// ── Construction du HTML des pages ──
function bkdocBuildPages(d){
  // d = { bien, profil, sci, preset, sim, photoUrls, extraPhotos, coverUrl, logoUrl, caption }
  const P = d.preset;
  const vars = `--bk-primary:${P.couleur_primaire};--bk-secondary:${P.couleur_secondaire};--bk-accent:${P.couleur_accent}`;
  const propName = ((d.profil?.first_name || '') + ' ' + (d.profil?.last_name || '')).trim() || (currentUser?.email || '');
  const propTel = d.profil?.phone || '';
  const propMail = d.profil?.email || currentUser?.email || '';
  const sciName = d.sci?.nom_sci || '';
  const sciDate = d.sci?.created_at ? 'Créée le ' + bkdocDateFR(d.sci.created_at) : '';
  const b = d.bien;
  const logoImg = d.logoUrl
    ? `<img src="${d.logoUrl}" crossorigin="anonymous" data-bank="${esc(P.nom)}" onerror="bkdocLogoErr(this)">`
    : `<div class="logo-fallback">${esc(P.nom)}</div>`;

  const hdr = `
    <div class="ihdr">
      <div><div class="ihdr-kicker">INVESTISSEMENT LOCATIF</div><div class="ihdr-name">${esc(propName)}</div></div>
      <div class="right">${sciName ? `<div class="ihdr-name accent">${esc(sciName)}</div><div class="ihdr-sub">${esc(sciDate)}</div>` : ''}</div>
    </div><div class="irule"></div>`;
  const foot = `<div class="ifoot"><div class="ifoot-logo">${logoImg}</div></div>`;

  // Calculs métier (formules Stonefolio)
  const num = v => parseFloat(v) || 0;
  const loyer = num(b.loyer_en_etat), chLoc = num(b.charges_locataire_etat);
  const cred = num(b.mensualite_credit), copro = num(b.charge_copro), assur = num(b.assurance_logement), tf = num(b.taxe_fonciere);
  const cashflow = (loyer + chLoc) - (cred + copro + assur + tf);
  const prix = num(b.prix_affiche), notaire = num(b.frais_notaire), travaux = num(b.travaux), agence = num(b.frais_agence), csci = num(b.creation_sci);
  const totalAcq = prix + notaire + travaux + agence + csci;
  const rendement = prix > 0 ? (loyer * 12 / prix) * 100 : 0;
  const cfCls2 = cashflow > 0 ? 'pos' : (cashflow < 0 ? 'neg' : '');
  const cfTxt = (cashflow > 0 ? '+' : '') + fmt(cashflow) + ' €';

  // Indicateurs clés conditionnels : seuls les indicateurs renseignés ET présentables
  // figurent en page 2 (un cashflow négatif ou un loyer absent n'est pas un "indicateur clé" ;
  // la synthèse financière page 4 expose de toute façon la réalité complète des chiffres).
  const inds = [];
  if(cashflow > 0) inds.push({ v: '+' + fmt(cashflow) + ' €/mois', l: 'Cashflow mensuel positif' });
  if(rendement > 0) inds.push({ v: rendement.toFixed(2).replace('.', ',') + ' %', l: 'Rendement brut' });
  if(loyer > 0) inds.push({ v: bkdocEUR(loyer), l: 'Loyer mensuel attendu' });
  if(prix > 0 && num(b.surface_m2) > 0) inds.push({ v: fmt(prix / num(b.surface_m2)) + ' €/m²', l: 'Prix au m²' });
  const indicHtml = inds.length
    ? `<div class="bcard hl"><div class="bcard-h">Indicateurs clés</div>${inds.slice(0,3).map(i => `<div class="pf"><span class="pf-dot"></span><div><b>${i.v}</b><div class="pf-l">${i.l}</div></div></div>`).join('')}</div>`
    : '';

  const pages = [];

  // ── Page 1 : couverture ──
  pages.push(`<div class="page" style="${vars}">
    <img class="wedge-img" src="${d.coverData}">
    <div class="hdr">
      <div><div class="name">${esc(propName)}</div><div class="sub">${esc([propTel, propMail].filter(Boolean).join(' ; '))}</div></div>
      <div class="right">${sciName ? `<div class="name">${esc(sciName)}</div><div class="sub">${esc(sciDate)}</div>` : ''}</div>
    </div>
    <div class="rule"></div>
    <div class="title">DEMANDE DE<br>FINANCEMENT</div>
    <div class="subtitle">INVESTISSEMENT LOCATIF</div>
    <div class="bien-title">${esc(b.titre || '')}</div>
    <div class="cbar green"></div>
    <div class="cbar teal"></div>
    <div class="logo-card">${logoImg}${d.caption ? `<div class="caption">${d.caption}</div>` : ''}</div>
  </div>`);

  // ── Page 2 : présentation du bien ──
  pages.push(`<div class="page" style="${vars}">${hdr}
    <div class="ibody">
      <div class="sec-kicker">PRÉSENTATION</div>
      <h2 class="sec-title">Présentation du bien</h2>
      <p class="blead">${esc(b.type_bien || 'Bien')} situé à ${esc(b.ville || '')}${b.surface_m2 ? ', d\u2019une surface de ' + fmt(num(b.surface_m2)) + ' m²' : ''}, destiné à la location. Les principales caractéristiques et indicateurs financiers sont présentés ci-dessous.</p>
      <div class="two-col">
        <div class="bcard">
          <div class="bcard-h">Le bien</div>
          <div class="bkv"><span>Type</span><b>${esc(b.type_bien || '—')}</b></div>
          <div class="bkv"><span>Surface</span><b>${b.surface_m2 ? fmt(num(b.surface_m2)) + ' m²' : '—'}</b></div>
          <div class="bkv"><span>Localisation</span><b>${esc(b.ville || '—')}${b.code_postal ? ' (' + esc(b.code_postal) + ')' : ''}</b></div>
          <div class="bkv"><span>Prix affiché</span><b class="big">${bkdocEUR(prix)}</b></div>
        </div>
        ${indicHtml}
      </div>
    </div>${foot}
  </div>`);

  // ── Page 3 : galerie (si photos) ──
  if(d.photoUrls.length > 0){
    const [p1, p2, p3, p4, p5] = d.photoUrls;
    const cell = u => u ? `<div class="g-cell"><img src="${u}" crossorigin="anonymous"></div>` : '';
    pages.push(`<div class="page" style="${vars}">${hdr}
      <div class="ibody">
        <div class="sec-kicker">GALERIE</div>
        <h2 class="sec-title">Photographies du bien</h2>
        <div class="gallery">
          <div class="g-main">${p1 ? `<img src="${p1}" crossorigin="anonymous">` : ''}</div>
          ${(p2 || p3) ? `<div class="g-side">${cell(p2)}${cell(p3)}</div>` : ''}
        </div>
        ${(p4 || p5) ? `<div class="gallery-bot">${cell(p4)}${cell(p5)}</div>` : ''}
        ${d.extraPhotos ? '<div class="extra-photos">D\u2019autres photographies du bien sont disponibles sur demande.</div>' : ''}
      </div>${foot}
    </div>`);
  }

  // ── Page 4 : synthèse financière ──
  pages.push(`<div class="page" style="${vars}">${hdr}
    <div class="ibody">
      <div class="sec-kicker">FINANCES</div>
      <h2 class="sec-title">Synthèse financière</h2>
      <div class="two-col tables">
        <div class="ftable">
          <div class="ft-h">Montant d'acquisition</div>
          <div class="ft-r"><span>Prix affiché</span><b>${bkdocEUR(prix)}</b></div>
          <div class="ft-r"><span>Frais de notaire (7 %)</span><b>${bkdocEUR(notaire)}</b></div>
          <div class="ft-r"><span>Travaux</span><b>${bkdocEUR(travaux)}</b></div>
          <div class="ft-r"><span>Frais d'agence</span><b>${bkdocEUR(agence)}</b></div>
          <div class="ft-r"><span>Création SCI</span><b>${bkdocEUR(csci)}</b></div>
          <div class="ft-r total"><span>Total acquisition</span><b>${bkdocEUR(totalAcq)}</b></div>
        </div>
        <div class="ftable">
          <div class="ft-h">Exploitation mensuelle</div>
          <div class="ft-r"><span>Loyer (en l'état)</span><b>${bkdocEUR(loyer)}</b></div>
          <div class="ft-r"><span>Charges locataire</span><b>${bkdocEUR(chLoc)}</b></div>
          <div class="ft-r sep"><span>Mensualité crédit</span><b>${cred > 0 ? '− ' : ''}${bkdocEUR(cred)}</b></div>
          <div class="ft-r"><span>Charges copropriété</span><b>${copro > 0 ? '− ' : ''}${bkdocEUR(copro)}</b></div>
          <div class="ft-r"><span>Assurance</span><b>${assur > 0 ? '− ' : ''}${bkdocEUR(assur)}</b></div>
          <div class="ft-r"><span>Taxe foncière (/12)</span><b>${tf > 0 ? '− ' : ''}${bkdocEUR(tf)}</b></div>
        </div>
      </div>
      <div class="kpi-row">
        <div class="kpi-big ${cfCls2}"><div class="kpi-l">Cashflow mensuel</div><div class="kpi-v">${cfTxt}</div></div>
        <div class="kpi-big"><div class="kpi-l">Rendement brut</div><div class="kpi-v accent-txt">${rendement > 0 ? rendement.toFixed(2).replace('.', ',') + ' %' : '—'}</div></div>
      </div>
    </div>${foot}
  </div>`);

  // ── Page 5 : plan de financement (si simulation) ──
  if(d.sim){
    const s = d.sim;
    const te = num(s.taux_endettement);
    const teCls = te <= 33 ? 'ok' : (te <= 40 ? 'warn' : 'bad');
    const teNote = te <= 33 ? 'Sous le seuil recommandé de 33 %' : (te <= 40 ? 'Entre 33 % et 40 %' : 'Au-dessus de 40 %');
    pages.push(`<div class="page" style="${vars}">${hdr}
      <div class="ibody">
        <div class="sec-kicker">FINANCEMENT</div>
        <h2 class="sec-title">Plan de financement</h2>
        <p class="blead">Simulation : ${esc(s.nom_simulation || '—')}${s.date_document ? ' — ' + bkdocDateFR(s.date_document) : ''}</p>
        <div class="fin-grid">
          <div class="fin-card"><div class="fin-l">Montant emprunté</div><div class="fin-v">${bkdocEUR(num(s.montant_emprunte))}</div></div>
          <div class="fin-card"><div class="fin-l">Taux d'intérêt</div><div class="fin-v">${num(s.taux_interet).toFixed(2).replace('.', ',')} %</div></div>
          <div class="fin-card"><div class="fin-l">Durée</div><div class="fin-v">${fmt(num(s.duree_ans))} ans</div></div>
          <div class="fin-card"><div class="fin-l">Mensualité</div><div class="fin-v">${bkdocEUR(num(s.mensualite_calculee))}</div></div>
        </div>
        ${te ? `<div class="endet"><div class="endet-l">Taux d'endettement</div><div class="endet-badge ${teCls}">${te.toFixed(0)} %</div><div class="endet-note">${teNote}</div></div>` : ''}
        ${d.hasAnnex ? '<p class="annex-note">La simulation détaillée est jointe en annexe de ce dossier.</p>' : ''}
      </div>${foot}
    </div>`);
  }

  // ── Page 6 : présentation de la SCI (si SCI choisie) ──
  if(d.sci){
    const s = d.sci;
    const assocs = Array.isArray(s.associes) ? s.associes : [];
    const cards = assocs.map(a => {
      const facts = [
        a.profession ? `<div class="af"><span class="af-l">Profession</span><span class="af-v">${esc(a.profession)}</span></div>` : '',
        a.employeur ? `<div class="af"><span class="af-l">Employeur / Entreprise</span><span class="af-v">${esc(a.employeur)}</span></div>` : '',
        a.type_contrat ? `<div class="af"><span class="af-l">Type de contrat</span><span class="af-v">${esc(a.type_contrat)}</span></div>` : '',
        (a.revenus_mensuels != null && a.revenus_mensuels !== '') ? `<div class="af"><span class="af-l">Revenus mensuels nets</span><span class="af-v">${bkdocEUR(num(a.revenus_mensuels))}</span></div>` : ''
      ].filter(Boolean).join('');
      const contact = [
        a.telephone ? `<span class="lbl">Tél.</span>${esc(a.telephone)}` : '',
        a.email ? `<span class="lbl" style="margin-left:14px">Email</span>${esc(a.email)}` : ''
      ].filter(Boolean).join('');
      return `<div class="bassoc">
        <div class="bassoc-avatar">${bkdocInitials(a.prenom, a.nom)}</div>
        <div class="bassoc-body">
          <div class="bassoc-name">${esc(((a.prenom || '') + ' ' + (a.nom || '')).trim() || 'Associé')}</div>
          <div class="bassoc-role">Associé${a.parts_pct ? ' · ' + a.parts_pct + ' % des parts' : ''}</div>
          ${contact ? `<div class="bassoc-contact">${contact}</div>` : ''}
          ${facts ? `<div class="assoc-facts">${facts}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    pages.push(`<div class="page" style="${vars}">${hdr}
      <div class="ibody">
        <div class="sec-kicker">L'EMPRUNTEUR</div>
        <h2 class="sec-title">Présentation de la société</h2>
        <p class="blead">Le présent dossier est porté par la société civile immobilière désignée ci-dessous, constituée en vue de l'acquisition et de la gestion de biens locatifs.</p>
        <div class="sci-id">
          <div class="sci-id-row"><span>Dénomination</span><b>${esc(s.nom_sci || '—')}</b></div>
          ${s.siret ? `<div class="sci-id-row"><span>SIRET</span><b>${esc(s.siret)}</b></div>` : ''}
          ${s.adresse ? `<div class="sci-id-row"><span>Siège social</span><b>${esc(s.adresse)}</b></div>` : ''}
          ${s.capital_social ? `<div class="sci-id-row"><span>Capital social</span><b>${bkdocEUR(num(s.capital_social))}</b></div>` : ''}
        </div>
        ${assocs.length ? `<div class="sci-assoc-title">Associés</div>${cards}` : ''}
      </div>${foot}
    </div>`);
  }

  return pages.join('');
}

// Attend le chargement de toutes les images d'un conteneur (résolu même en cas d'erreur individuelle)
function bkdocWaitImages(root, timeoutMs){
  const imgs = Array.from(root.querySelectorAll('img'));
  return Promise.race([
    Promise.all(imgs.map(im => (im.complete ? Promise.resolve() : new Promise(res => { im.onload = res; im.onerror = res; })))),
    new Promise(res => setTimeout(res, timeoutMs || 15000))
  ]);
}

// ── Génération ──
async function bkdocGenerate(){
  if(!bkdocCtx) return;
  const btn = document.getElementById('adm-modal-save');
  btn.disabled = true;

  try {
    bkdocProgress('Chargement des librairies…');
    await bkdocEnsureLibs();
    try { await document.fonts.ready; } catch(e) {}

    const b = bkdocCtx.bien;
    const presetKey = document.getElementById('bkdoc-bank').value;
    const preset = bkdocCtx.presets.find(p => p.key === presetKey) || bkdocCtx.presets[0];
    const sciId = document.getElementById('bkdoc-sci').value;
    const sci = sciId ? bkdocCtx.scis.find(s => s.id === sciId) : null;
    const simId = document.getElementById('bkdoc-sim').value;
    const sim = simId ? bkdocCtx.sims.find(s => s.id === simId) : null;

    bkdocProgress('Préparation des photos…');
    const chosen = bkdocCtx.photoPaths.length > 5
      ? bkdocCtx.photoPaths.filter((_, i) => bkdocCtx.selPhotos.has(i)).slice(0, 5)
      : bkdocCtx.photoPaths.slice(0, 5);
    const photoUrls = [];
    for(const p of chosen){
      try { photoUrls.push(await TI_STORAGE.signedUrl('biens-photos', p.path)); } catch(e) { /* photo ignorée */ }
    }

    bkdocProgress('Construction des pages…');
    const coverData = await bkdocMakeCoverWedge(BKDOC_COVER_URL, preset);
    let root = document.getElementById('bkdoc-root');
    if(root) root.remove();
    root = document.createElement('div');
    root.id = 'bkdoc-root';
    root.innerHTML = bkdocBuildPages({
      bien: b, profil: currentProfile, sci, preset, sim,
      photoUrls,
      extraPhotos: bkdocCtx.photoPaths.length > 5,
      coverData,
      logoUrl: preset.logo_path ? BKDOC_ASSETS + preset.logo_path : null,
      caption: preset.key === 'credit-agricole' ? 'DE LA TOURAINE<br>ET DU POITOU' : '',
      hasAnnex: !!(sim && sim.pdf_path)
    });
    document.body.appendChild(root);
    await bkdocWaitImages(root);

    const pagesEls = Array.from(root.querySelectorAll('.page'));
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    for(let i = 0; i < pagesEls.length; i++){
      bkdocProgress(`Rendu de la page ${i + 1} / ${pagesEls.length}…`);
      const canvas = await html2canvas(pagesEls[i], { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false });
      if(i > 0) pdf.addPage();
      pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
    }

    let finalBytes;
    if(sim && sim.pdf_path){
      bkdocProgress('Fusion de la simulation en annexe…');
      try {
        const url = await TI_STORAGE.signedUrl('simulations-pdf', sim.pdf_path);
        const annexBuf = await (await fetch(url)).arrayBuffer();
        const main = await PDFLib.PDFDocument.load(pdf.output('arraybuffer'));
        const annex = await PDFLib.PDFDocument.load(annexBuf, { ignoreEncryption: true });
        const copied = await main.copyPages(annex, annex.getPageIndices());
        copied.forEach(pg => main.addPage(pg));
        finalBytes = await main.save();
      } catch(e) {
        console.warn('Annexe non fusionnée :', e.message);
        showNotif('Annexe non jointe (' + e.message + ') — dossier généré sans elle.', true);
        finalBytes = pdf.output('arraybuffer');
      }
    } else {
      finalBytes = pdf.output('arraybuffer');
    }

    bkdocProgress('Téléchargement…');
    const blob = new Blob([finalBytes], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = bkdocFilename(b.titre);
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);

    root.remove();

    // FLX-007 : traçabilité — chaque dossier généré est journalisé dans dossiers_bancaires
    try {
      await db.from('dossiers_bancaires').insert({
        nom_dossier: bkdocFilename(b.titre), bien_id: b.id,
        sci_id: sci?.id || null, simulation_id: sim?.id || null,
        date_generation: new Date().toISOString().slice(0, 10),
        user_id: currentUser.id
      });
    } catch(e) { console.warn('trace dossier:', e.message); }

    closeAdmModal();
    showNotif('Dossier banque généré ✓');
  } catch(e) {
    console.error('bkdocGenerate:', e);
    bkdocProgress('');
    const el = document.getElementById('bkdoc-progress');
    if(el){ el.style.display = 'block'; el.innerHTML = '<span style="color:var(--sf-loss)">Erreur : ' + esc(e.message) + '</span>'; }
    showNotif('Erreur lors de la génération : ' + e.message, true);
  } finally {
    btn.disabled = false;
  }
}



let visitPhotos = [], visitRating = 0, simEditId = null;

const PAGE_LABELS = {accueil:'Tableau de bord',biens:'Mes biens',nouveau:'Ajouter un bien','bien-detail':'Fiche bien',simulateur:'Simulateur crédit',visites:'Comptes rendus',portails:'Portails immo',administration:'Administration','module-financier':'Suivi financier','admin-users':'Gestion utilisateurs','marche-recherche':'Recherche par ville','marche-carte':'Carte de France',parametres:'Paramètres'};
// PAGE_SECTIONS supprime avec le fil d'Ariane du bandeau : il ne servait qu'a
// le remplir. SF_MENU_PAGES porte desormais le rattachement page -> section,
// pour surligner le bon menu.
// PIPELINE_PAGES supprime en phase 4 : il ne servait qu'a montrer ou masquer
// la sous-navigation de l'ancienne barre haute. SF_MENU_PAGES porte desormais
// cette connaissance, pour surligner la section active du bandeau.

// ═══════════════════════════════════════════════════════════
//   PAGE PARAMÈTRES — Lot A
// ═══════════════════════════════════════════════════════════
// Navigation interne par familles + routage hash (#parametres/section).
// Sections existantes migrées + nouvelles en "Bientôt disponible".

// Ces dix icones vivaient ici, en double du jeu de l'accueil. Elles sont
  // desormais dans SF_ACC_ICONS, le jeu unique de la plateforme. `sfIcon` reste
  // comme point d'entree — une trentaine d'appels s'y referent — mais lit la
  // meme source que `sfAccIcon`. Deux jeux distincts finissaient par proposer
  // deux dessins pour la meme idee.
  function sfIcon(nom, taille) {
    const d = SF_ACC_ICONS[nom];
    if(!d) return '';
    const t = taille || 17;
    return '<svg width="' + t + '" height="' + t + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
           'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  }

const PARAMS_SECTIONS = [
  { family:'Mon compte', items:[
    { id:'compte',       label:'Compte',           icon:'user', status:'ready' },
    { id:'securite',     label:'Sécurité',         icon:'lock', status:'soon' },
    { id:'notifications',label:'Notifications',    icon:'bell', status:'soon' },
  ]},
  { family:'Préférences', items:[
    { id:'apparence',    label:'Apparence',        icon:'palette', status:'ready' },
    { id:'metier',       label:'Préférences métier',icon:'sliders', status:'ready' },
    { id:'integrations', label:'Intégrations',     icon:'plug', status:'soon', adminOnly:true },
  ]},
  { family:'Données & gestion', items:[
    { id:'donnees',      label:'Données',          icon:'data', status:'ready' },
    { id:'sci',          label:'Mes SCI',          icon:'bank', status:'ready' },
  ]},
  // « Utilisateurs » a quitte les Parametres en phase 4 : la gestion des
  // comptes est une fonction d'administration, pas un reglage personnel. Elle
  // vit desormais dans le bandeau, derriere sa propre icone, visible des seuls
  // administrateurs. La sortir d'ici rend ce cloisonnement lisible plutot que
  // de la noyer au milieu des preferences.
  { family:'Administration', adminOnly:true, items:[
    { id:'maintenance',  label:'Maintenance',      icon:'wrench', status:'ready', adminOnly:true },
  ]},
  { family:'Aide', items:[
    { id:'apropos',      label:'À propos',         icon:'info', status:'ready' },
  ]},
];

let currentParamsSection = 'compte';

// Détecte si une section est réservée aux admins (item ou famille marqué adminOnly)
function isParamsSectionAdminOnly(id) {
  let res = false;
  PARAMS_SECTIONS.forEach(f => f.items.forEach(i => {
    if(i.id === id && (i.adminOnly || f.adminOnly)) res = true;
  }));
  return res;
}

function renderParametres(el) {
  const isAdmin = currentProfile?.role === 'admin' || currentUser?.email === ADMIN_EMAIL;
  // Section demandée via hash ?
  const hashSection = (window.location.hash.match(/#parametres\/([a-z]+)/)||[])[1];
  if (hashSection && PARAMS_SECTIONS.some(f=>f.items.some(i=>i.id===hashSection))) {
    // Bloquer l'accès direct par URL à une section admin-only pour un non-admin
    if (isParamsSectionAdminOnly(hashSection) && !isAdmin) {
      currentParamsSection = 'compte';
    } else {
      currentParamsSection = hashSection;
    }
  } else if (!PARAMS_SECTIONS.some(f=>f.items.some(i=>i.id===currentParamsSection))) {
    currentParamsSection = 'compte';
  }
  // Si la section courante est admin-only et l'utilisateur n'est pas admin, revenir à Compte
  if (isParamsSectionAdminOnly(currentParamsSection) && !isAdmin) {
    currentParamsSection = 'compte';
  }

  // Construire la nav interne
  const navHtml = PARAMS_SECTIONS.filter(f => !f.adminOnly || isAdmin).map(f => `
    <div class="params-nav-family">
      <div class="params-nav-family-label">${f.family}</div>
      ${f.items.filter(i => !i.adminOnly || isAdmin).map(i => `
        <div class="params-nav-item ${i.id===currentParamsSection?'active':''}" onclick="selectParamsSection('${i.id}')">
          <span class="pni-icon">${sfIcon(i.icon)}</span>
          <span>${i.label}</span>
          ${i.status==='soon'?'<span class="pni-soon">Bientôt</span>':''}
        </div>
      `).join('')}
    </div>
  `).join('');

  el.innerHTML = `
    <div class="params-layout">
      <div class="params-nav">${navHtml}</div>
      <div class="params-content" id="params-content"></div>
    </div>
  `;
  renderParamsSection();
}

function selectParamsSection(id) {
  currentParamsSection = id;
  // Met à jour le hash sans recharger
  history.replaceState(null, '', '#parametres/'+id);
  // Met à jour l'état actif de la nav
  document.querySelectorAll('.params-nav-item').forEach(el=>el.classList.remove('active'));
  event.currentTarget.classList.add('active');
  renderParamsSection();
}

function renderParamsSection() {
  const c = document.getElementById('params-content');
  if(!c) return;
  const isAdmin = currentProfile?.role === 'admin' || currentUser?.email === ADMIN_EMAIL;
  const sec = currentParamsSection;

  // Garde de sécurité : une section admin-only ne peut JAMAIS être rendue pour un non-admin,
  // même via navigation directe par URL (double cloisonnement : nav + rendu).
  if (isParamsSectionAdminOnly(sec) && !isAdmin) {
    c.innerHTML = `
      <div class="params-section-title">${sfIcon('lock',20)} Accès réservé</div>
      <div class="params-section-sub">Cette section est réservée aux administrateurs.</div>`;
    return;
  }

  // Trouver le statut de la section
  let meta = null;
  PARAMS_SECTIONS.forEach(f=>f.items.forEach(i=>{ if(i.id===sec) meta=i; }));
  if(!meta){ c.innerHTML=''; return; }

  // Section "soon"
  if(meta.status==='soon'){
    c.innerHTML = `
      <div class="params-section-title">${sfIcon(meta.icon, 20)} ${meta.label}</div>
      <div class="params-section-sub">Cette section sera disponible prochainement.</div>
      <div class="params-soon-box">
        <div class="psb-icon">${sfAccIcon('travaux', 26)}</div>
        <div class="psb-title">Bientôt disponible</div>
        <div>La section « ${meta.label} » est en cours de préparation.</div>
      </div>`;
    return;
  }

  // Sections prêtes
  if(sec==='compte') c.innerHTML = paramsCompteHtml();
  else if(sec==='apparence') { c.innerHTML = paramsApparenceHtml(); syncAppearanceControls(); }
  else if(sec==='metier') c.innerHTML = paramsMetierHtml();
  else if(sec==='apropos') c.innerHTML = paramsAproposHtml();
  else if(sec==='donnees') c.innerHTML = paramsDonneesHtml();
  else if(sec==='sci') { c.innerHTML = paramsSciHtml(); loadSCIList(); }
  // Compatibilite : les anciens liens #parametres/utilisateurs renvoient vers
  // la page dediee. Une seule route vers la gestion des comptes, pas deux.
  else if(sec==='utilisateurs') { navigate('admin-users'); return; }
  else if(sec==='maintenance' && isAdmin) c.innerHTML = paramsMaintenanceHtml();
  else c.innerHTML = `<div class="params-soon-box"><div class="psb-title">Section indisponible</div></div>`;
}

// ── Section COMPTE ──
function paramsCompteHtml() {
  const email = currentUser?.email || '—';
  const p = currentProfile || {};
  const esc = (s) => (s||'').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  return `
    <div class="params-section-title">${sfIcon('user',20)} Compte</div>
    <div class="params-section-sub">Informations de votre compte et déconnexion.</div>
    <div class="params-card">
      <div class="params-card-title">Identité</div>
      <div class="params-field-grid">
        <div class="params-field">
          <label class="params-field-label">Prénom</label>
          <input class="params-input" id="acc-first-name" type="text" value="${esc(p.first_name)}" placeholder="Votre prénom">
        </div>
        <div class="params-field">
          <label class="params-field-label">Nom</label>
          <input class="params-input" id="acc-last-name" type="text" value="${esc(p.last_name)}" placeholder="Votre nom">
        </div>
        <div class="params-field">
          <label class="params-field-label">Téléphone</label>
          <input class="params-input" id="acc-phone" type="tel" value="${esc(p.phone)}" placeholder="06 12 34 56 78">
        </div>
        <div class="params-field">
          <label class="params-field-label">Email de connexion</label>
          <input class="params-input" type="email" value="${esc(email)}" disabled title="L'email de connexion n'est pas modifiable ici">
          <div class="params-field-hint">🔒 Non modifiable</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button class="btn btn-primary" id="acc-save-btn" onclick="saveMyProfile()">${sfAccIcon('check',14)} Enregistrer</button>
      </div>
    </div>
    <div class="params-card">
      <div class="params-card-title">Session</div>
      <div class="settings-action" onclick="doLogout()">🚪 Se déconnecter</div>
    </div>`;
}

// Sauvegarde du profil utilisateur (nom/prénom/téléphone)
async function saveMyProfile() {
  const btn = document.getElementById('acc-save-btn');
  const firstName = document.getElementById('acc-first-name')?.value || '';
  const lastName = document.getElementById('acc-last-name')?.value || '';
  const phone = document.getElementById('acc-phone')?.value || '';
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Enregistrement...'; }
  try {
    const { error } = await db.rpc('update_my_profile', {
      p_first_name: firstName,
      p_last_name: lastName,
      p_phone: phone
    });
    if(error) throw error;
    // Recharger le profil en mémoire pour refléter les changements
    await loadProfile();
    showNotif('Profil mis à jour');
  } catch(e) {
    showNotif('Erreur : '+e.message, true);
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = sfAccIcon('check',14)+' Enregistrer'; }
  }
}

// ── Section APPARENCE ──
// Le nuancier de six couleurs a ete retire : l'accent n'est plus configurable
// (arbitrage « DA unique » du 01/08/2026). Il ne s'agit pas d'un reglage perdu
// mais d'une decision de conception — une couleur choisie au hasard par
// l'utilisateur ne peut pas garantir les contrastes ni la separation entre le
// vert de marque et le vert « valeur positive ».
function paramsApparenceHtml() {
  return `
    <div class="params-section-title">${sfIcon('palette', 20)} Apparence</div>
    <div class="params-section-sub">Le thème de Stonefolio.</div>
    <div class="params-card">
      <div class="params-card-title">Thème sombre</div>
      <p class="sci-form-hint">
        Stonefolio s'affiche en sombre. Les couleurs ne sont plus modifiables :
        elles portent du sens — le vert signale une valeur positive, le corail une
        valeur négative — et un accent choisi librement pouvait entrer en conflit
        avec cette lecture ou tomber sous le seuil de lisibilité.
      </p>
      <p class="sci-form-hint">Un mode clair est prévu, il n'est pas encore activé.</p>
    </div>`;
}

// La section Apparence n'a plus de controle a synchroniser : les interrupteurs
// de graphiques sont partis en phase 5 avec les graphiques, et le nuancier de
// couleurs avec l'arbitrage « DA unique ». Conservee pour son appelant.
// `colorMatches`, qui ne servait qu'a retrouver la pastille active du
// nuancier, est supprimee avec lui.
function syncAppearanceControls() { /* plus rien a synchroniser */ }

// ── Section PRÉFÉRENCES MÉTIER ──
function paramsMetierHtml() {
  const p = userPrefs || {};
  return `
    <div class="params-section-title">${sfIcon('sliders',20)} Préférences métier</div>
    <div class="params-section-sub">Constantes de calcul utilisées dans l'application. Modifient les valeurs par défaut des nouveaux biens et le seuil de rendement considéré comme « bon ».</div>
    <div class="params-card">
      <div class="params-card-title">Valeurs par défaut des nouveaux biens</div>
      <div class="params-field-grid">
        <div class="params-field">
          <label class="params-field-label">Frais de notaire (%)</label>
          <input class="params-input" id="pref-notaire" type="number" step="0.1" min="0" max="30" value="${p.notaire_pct ?? 7}">
          <div class="params-field-hint">Appliqué automatiquement au prix d'achat (défaut : 7 %)</div>
        </div>
        <div class="params-field">
          <label class="params-field-label">Durée de crédit (ans)</label>
          <input class="params-input" id="pref-duree" type="number" step="1" min="1" max="40" value="${p.duree_credit_ans ?? 20}">
          <div class="params-field-hint">Pré-rempli à la création d'un bien (défaut : 20 ans)</div>
        </div>
        <div class="params-field">
          <label class="params-field-label">Assurance (€/mois)</label>
          <input class="params-input" id="pref-assurance" type="number" step="1" min="0" value="${p.assurance_mois ?? 33}">
          <div class="params-field-hint">Pré-rempli à la création d'un bien (défaut : 33 €)</div>
        </div>
        <div class="params-field">
          <label class="params-field-label">Seuil de rentabilité (%)</label>
          <input class="params-input" id="pref-seuil" type="number" step="0.1" min="0" max="100" value="${p.seuil_rentabilite ?? 5}">
          <div class="params-field-hint">Au-dessus, le rendement s'affiche en vert (défaut : 5 %)</div>
        </div>
      </div>
      <div style="display:flex;justify-content:flex-end;margin-top:14px">
        <button class="btn btn-primary" id="pref-save-btn" onclick="saveMyPreferences()">${sfAccIcon('check',14)} Enregistrer</button>
      </div>
    </div>`;
}

async function saveMyPreferences() {
  const btn = document.getElementById('pref-save-btn');
  const notaire = parseFloat(document.getElementById('pref-notaire')?.value) || 7;
  const duree = parseInt(document.getElementById('pref-duree')?.value) || 20;
  const assurance = parseFloat(document.getElementById('pref-assurance')?.value) || 33;
  const seuil = parseFloat(document.getElementById('pref-seuil')?.value) || 5;
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Enregistrement...'; }
  try {
    const { error } = await db.rpc('update_my_preferences', {
      p_notaire_pct: notaire,
      p_duree_credit_ans: duree,
      p_assurance_mois: assurance,
      p_seuil_rentabilite: seuil
    });
    if(error) throw error;
    // Recharger les préférences en mémoire
    const { data: prefs } = await db.rpc('get_my_preferences');
    if(prefs) userPrefs = prefs;
    showNotif('Préférences enregistrées');
  } catch(e) {
    showNotif('Erreur : '+e.message, true);
  } finally {
    if(btn){ btn.disabled = false; btn.innerHTML = sfAccIcon('check',14)+' Enregistrer'; }
  }
}

// ── Section À PROPOS ──
function paramsAproposHtml() {
  return `
    <div class="params-section-title">${sfIcon('info',20)} À propos</div>
    <div class="params-section-sub">Informations sur l'application.</div>
    <div class="params-card">
      <div class="params-card-title">Stonefolio</div>
      <div class="settings-row">
        <div><div class="settings-label">Version</div><div class="settings-sub">Plateforme d'investissement immobilier locatif</div></div>
        <div style="font-weight:700;color:var(--accent)">v1</div>
      </div>
      <div class="settings-row">
        <div><div class="settings-label">Stockage des fichiers</div><div class="settings-sub">Photos et documents</div></div>
        <div style="font-size:12px;color:var(--c-muted)">Supabase Storage (privé)</div>
      </div>
    </div>
    <div class="params-card">
      <div class="params-card-title">Aide & ressources</div>
      <div class="settings-row">
        <div><div class="settings-label">Tutoriel de première connexion</div><div class="settings-sub">Réactiver le guide d'accueil</div></div>
        <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px" onclick="showNotif('Tutoriel : bientôt disponible')">Relancer</button>
      </div>
      <div style="font-size:11px;color:var(--c-muted);margin-top:10px;line-height:1.5">
        Vos données personnelles (biens, contacts, documents) sont stockées de manière sécurisée et cloisonnée par compte. Mentions légales et politique de confidentialité à venir.
      </div>
    </div>`;
}

function paramsDonneesHtml() {
  return `
    <div class="params-section-title">${sfIcon('data',20)} Données</div>
    <div class="params-section-sub">Gérez vos données de test.</div>
    <div class="params-card">
      <div class="params-card-title">Fiches de test</div>
      <div class="settings-action" onclick="genTestData()">${sfAccIcon('boite',15)} Générer des fiches tests (5)</div>
      <div class="settings-action" onclick="purgeTestData()">${sfAccIcon('poubelle',15)} Supprimer les fiches tests</div>
    </div>
    <div class="params-danger">
      <div class="params-danger-header">${sfAccIcon('alerte',15)} Zone de danger</div>
      <div class="params-danger-body">
        <div class="params-danger-row">
          <div>
            <div class="pdr-label">Supprimer toutes les fiches</div>
            <div class="pdr-sub">Efface définitivement tous vos biens. Action irréversible.</div>
          </div>
          <button class="btn-danger-outline" onclick="purgeAllData()">Supprimer tout</button>
        </div>
      </div>
    </div>`;
}

// ── Section MES SCI ──
function paramsSciHtml() {
  return `
    <div class="params-section-title">${sfIcon('bank',20)} Mes SCI</div>
    <div class="params-section-sub">Vos sociétés civiles immobilières.</div>
    <div class="params-card">
      <div id="sci-list-container">
        <div class="sci-empty" style="padding:12px 0;text-align:left;font-size:12px;color:var(--c-muted)">Chargement…</div>
      </div>
      <button class="sci-add-btn" onclick="openSCIModal(null)">＋ Ajouter une SCI</button>
    </div>`;
}

// ── Section MAINTENANCE (admin) ──
function paramsMaintenanceHtml() {
  return `
    <div class="params-section-title">${sfIcon('wrench',20)} Maintenance</div>
    <div class="params-section-sub">Outils techniques d'administration de la plateforme.</div>
    <div class="params-card">
      <div class="params-card-title">Migration du stockage</div>
      <div style="font-size:12px;color:var(--c-muted);line-height:1.5;margin-bottom:10px">
        Migration des photos et documents depuis l'ancien stockage (base64 en base de données) vers Supabase Storage. Opération sûre et ré-exécutable : les fichiers déjà migrés sont ignorés, et les données d'origine sont conservées.
      </div>
      <button id="ti-migration-btn" class="btn btn-primary" style="width:100%;font-size:13px" onclick="tiMigrateToStorage()">🔄 Lancer la migration base64 → Storage</button>
      <div id="ti-migration-log" style="display:none;margin-top:10px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:10px;font-size:11px;font-family:monospace;max-height:200px;overflow-y:auto;line-height:1.6"></div>
    </div>
    <div class="params-card" style="margin-top:14px;border-color:var(--negative,var(--sf-loss))">
      <div class="params-card-title" style="color:var(--negative,var(--sf-loss))">⚠️ Purge des anciennes données base64</div>
      <div style="font-size:12px;color:var(--c-muted);line-height:1.5;margin-bottom:10px">
        Une fois la migration vers Storage terminée et validée, cette action libère l'espace en base de données
        en vidant les colonnes base64 résiduelles (<code>photos</code>, <code>documents</code>, <code>pdf_data</code>).
        <br><br>
        <strong>Sécurité :</strong> seules les lignes <em>ayant déjà un équivalent Storage</em> sont purgées.
        Aucune donnée non migrée n'est perdue. La structure des colonnes est conservée (porte de sortie).
        L'action est ré-exécutable sans danger (idempotente).
      </div>
      <button id="ti-purge-btn" class="btn" style="width:100%;font-size:13px;background:var(--negative,var(--sf-loss));color:white;border:none" onclick="tiPurgeLegacyB64()">🗑️ Purger les anciennes données base64</button>
      <div id="ti-purge-log" style="display:none;margin-top:10px;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:10px;font-size:11px;font-family:monospace;max-height:200px;overflow-y:auto;line-height:1.6"></div>
    </div>`;
}

// ── Purge des colonnes base64 résiduelles (post-migration Storage) ──
// Appelle la fonction SQL admin_purge_legacy_base64() qui :
//  - vérifie le rôle admin côté serveur (sécurité indépendante de l'UI)
//  - purge UNIQUEMENT les lignes dont l'équivalent Storage est présent
//  - retourne un rapport détaillé (combien purgées par table)
// Idempotente : peut être relancée plusieurs fois sans danger.
async function tiPurgeLegacyB64() {
  const btn = document.getElementById('ti-purge-btn');
  const log = document.getElementById('ti-purge-log');
  if(!btn || !log) return;

  // Double confirmation — opération irréversible
  if(!confirm('Purger définitivement les colonnes base64 résiduelles ?\n\nSeules les lignes ayant déjà un équivalent dans Supabase Storage seront purgées. Aucune donnée non migrée ne sera perdue.\n\nCette action est ré-exécutable mais irréversible pour les données purgées.')) return;

  btn.disabled = true;
  btn.textContent = '⏳ Purge en cours…';
  log.style.display = 'block';
  log.innerHTML = '<div style="color:var(--c-muted)">Lancement de la purge côté serveur…</div>';

  try {
    const { data, error } = await db.rpc('admin_purge_legacy_base64');
    if(error) throw error;
    if(!data || !data.success) throw new Error('Réponse invalide du serveur');

    const lines = [
      `<div style="color:var(--positive,var(--sf-gain));font-weight:700">✓ Purge terminée</div>`,
      `<div style="margin-top:6px">• biens.photos : <strong>${data.biens_photos_purged}</strong> ligne(s) purgée(s)</div>`,
      `<div>• biens.documents : <strong>${data.biens_documents_purged}</strong> ligne(s) purgée(s)</div>`,
      `<div>• visites.photos : <strong>${data.visites_photos_purged}</strong> ligne(s) purgée(s)</div>`,
      `<div>• simulations_credit (pdf_data + pdf_name) : <strong>${data.simulations_purged}</strong> ligne(s) purgée(s)</div>`,
      `<div>• bilans_comptables.pdf_data : <strong>${data.bilans_purged}</strong> ligne(s) purgée(s)</div>`,
      `<div>• locataires.documents : <strong>${data.locataires_purged}</strong> ligne(s) purgée(s)</div>`,
    ];
    if(data.biens_photos_skipped_no_storage > 0){
      lines.push(`<div style="margin-top:6px;color:var(--warning,var(--sf-alert))">⚠️ ${data.biens_photos_skipped_no_storage} ligne(s) biens.photos NON purgée(s) (pas d'équivalent Storage — protégées).</div>`);
    }
    if(data.note){
      lines.push(`<div style="margin-top:6px;color:var(--c-muted);font-style:italic">${data.note}</div>`);
    }
    log.innerHTML = lines.join('');
    showNotif('Purge terminée avec succès', false);
  } catch(e) {
    log.innerHTML = `<div style="color:var(--negative,var(--sf-loss))">✗ Erreur : ${e.message || e}</div>`;
    showNotif('Erreur lors de la purge : ' + (e.message || e), true);
  } finally {
    btn.disabled = false;
    btn.textContent = '🗑️ Purger les anciennes données base64';
  }
}


// ── Menu mobile (sidebar off-canvas) ──
// ═══════════════════════════════════════════════════════════════
//  BANDEAU DE NAVIGATION (phase 4)
// ═══════════════════════════════════════════════════════════════
// Remplace la barre laterale. Les entrees de menu conservent les identifiants
// nav-<page> : navigate() bascule deja leur classe .active, rien de sa logique
// n'a eu besoin d'etre reecrit.

// Quelle section contient quelle page — sert a surligner le bon menu.
const SF_MENU_PAGES = {
  marche:   ['marche-recherche','marche-carte'],
  pipeline: ['accueil','biens','nouveau','bien-detail'],
  gestion:  ['module-financier','administration'],
  outils:   ['simulateur','visites','portails'],
  // Ni « parametres » ni « admin-users » ne figurent ici : ce ne sont plus des
  // menus deroulants mais des icones directes du bandeau, que navigate()
  // surligne deja via #nav-parametres et #nav-admin-users.
};

function sfCloseMenus() {
  document.querySelectorAll('.sf-menu').forEach(m => {
    m.removeAttribute('data-open');
    m.querySelector('.sf-menu__btn')?.setAttribute('aria-expanded', 'false');
  });
}

function sfToggleMenu(cle) {
  const m = document.getElementById('menu-' + cle);
  if(!m) return;
  const ouvert = m.getAttribute('data-open') === '1';
  sfCloseMenus();
  if(!ouvert) {
    m.setAttribute('data-open', '1');
    m.querySelector('.sf-menu__btn')?.setAttribute('aria-expanded', 'true');
  }
}

// Sous 920 px les menus ne tiennent plus : ils s'empilent sous le bandeau.
function sfToggleMobile() {
  const n = document.getElementById('sf-menus');
  const b = document.getElementById('sf-burger');
  if(!n) return;
  const ouvert = n.getAttribute('data-mobile') === '1';
  if(ouvert) { n.removeAttribute('data-mobile'); sfCloseMenus(); }
  else n.setAttribute('data-mobile', '1');
  b?.setAttribute('aria-expanded', ouvert ? 'false' : 'true');
}

// Un clic hors du bandeau, ou Echap, referme tout.
document.addEventListener('click', e => {
  if(!e.target.closest('.sf-topnav')) { sfCloseMenus(); }
});
document.addEventListener('keydown', e => {
  if(e.key === 'Escape') {
    sfCloseMenus();
    const n = document.getElementById('sf-menus');
    if(n?.getAttribute('data-mobile') === '1') sfToggleMobile();
  }
});

// Conservees sous leur ancien nom : navigate() les appelle, et d'autres
// chemins pourraient encore le faire. Elles referment desormais le bandeau.
// `toggleMobileSidebar()` etait l'alias de compatibilite de l'ancienne barre
// laterale, supprimee en phase 4. Plus aucun appelant : retiree.
function closeMobileSidebar() {
  sfCloseMenus();
  const n = document.getElementById('sf-menus');
  if(n?.getAttribute('data-mobile') === '1') {
    n.removeAttribute('data-mobile');
    document.getElementById('sf-burger')?.setAttribute('aria-expanded', 'false');
  }
}

function navigate(page) {
  currentPage = page;
  // Fermer la sidebar mobile à chaque navigation
  closeMobileSidebar();
  // Nettoyer le hash #parametres si on quitte la page Paramètres
  if(page !== 'parametres' && window.location.hash.startsWith('#parametres')) {
    history.replaceState(null, '', window.location.pathname);
  }
  ['accueil','biens','nouveau','simulateur','visites','portails','administration','module-financier','admin-users','marche-recherche','marche-carte','parametres'].forEach(p => {
    document.getElementById('nav-'+p)?.classList.toggle('active', p === page);
    document.getElementById('sub-'+p)?.classList.toggle('active', p === page);
  });
  // La fiche bien n'a pas d'entrée de menu : on garde « Mes biens » surligné
  if(page === 'bien-detail') document.getElementById('nav-biens')?.classList.add('active');
  // Le bandeau surligne aussi la SECTION qui contient la page courante, pour
  // qu'on sache où l'on est même quand le menu est refermé.
  Object.entries(SF_MENU_PAGES).forEach(([cle, pages]) => {
    document.getElementById('menubtn-' + cle)
      ?.classList.toggle('sf-menu__btn--active', pages.includes(page));
  });
  // Le fil d'Ariane du bandeau a ete retire : il repetait la section deja
  // surlignee dans le bandeau et le titre deja affiche par la page. Le retour
  // depuis la fiche bien est assure par son propre bouton « ← Retour ».
  // Les deux sous-navigations de l'ancienne barre haute ont disparu en phase 4 :
  // les menus deroulants du bandeau portent desormais ce second niveau.
  Object.values(charts).forEach(c=>{try{c.destroy();}catch(e){}});
  charts={}; visitPhotos=[]; visitRating=0;
  if(marcheChart){try{marcheChart.destroy();}catch(e){} marcheChart=null;}
  simSelected.clear();
  const bar=document.getElementById('sim-action-bar');
  if(bar) bar.classList.remove('visible');
  const el=document.getElementById('content');
  if(page==='accueil') renderAccueil(el);
  else if(page==='biens') renderBiens(el);
  else if(page==='bien-detail') renderBienDetail(el);
  else if(page==='nouveau') renderNouveau(el,null); // async - pas besoin d'await ici
  else if(page==='simulateur') renderSimulateur(el);
  else if(page==='admin') renderAdmin(el);
  else if(page==='admin-users') renderAdmin(el);
  else if(page==='visites') renderVisites(el);
  else if(page==='portails') renderPortails(el);
  else if(page==='administration') renderAdministration(el);
  else if(page==='module-financier') renderModuleFinancier(el);
  else if(page==='marche-recherche') renderMarcheRecherche(el);
  else if(page==='marche-carte') renderMarcheCarte(el);
  else if(page==='parametres') {
    if(!window.location.hash.startsWith('#parametres')) history.replaceState(null,'','#parametres/'+currentParamsSection);
    renderParametres(el);
  }
}

// ══════════════════════════════════════════════════════
//  MODULE FINANCIER — Page principale (squelette V1)
// ══════════════════════════════════════════════════════

let mfTab = 'performance';

// ─── STATUTS — Code couleur par phase ───────────────────────

const STATUT_PHASE_LABELS = {
  prospection:  'Prospection',
  negociation: 'Négociation',
  accord:      'Accord',
  banque:      'Banque',
  closing:     'Closing',
  abandon:     'Abandon',
};

function getStatutPhase(statut) {
  /* ⚠️ SOURCE UNIQUE : `PHASE_MAP`. Il existait un SECOND mapping,
     `STATUT_PHASES`, avec ses propres phases — `accord`, `closing`, `abandon` —
     dont AUCUNE n'avait de classe CSS. Cinq statuts sur dix-neuf s'affichaient
     donc SANS AUCUN STYLE dans la fiche bien (« Accord trouvé ! »,
     « Administratifs », « Compromis signé », « Acheté », « Abandonné »), alors
     que la vue Tableau, qui lit `PHASE_MAP`, les colorait correctement. Le même
     statut n'avait pas la même tête selon l'écran. Signalé par Thomas le
     15/08/2026 sur « Accord trouvé ! ».
     C'est le motif connu de la maison : une règle écrite deux fois finit par
     diverger. `TI_BIENS.STATUTS` dérivait déjà de `PHASE_MAP` ; la couleur
     aussi, désormais. */
  return PHASE_MAP[statut] || 'generic';
}
let allLoyers = [];          // toutes les lignes loyers_mensuels du user
let allCharges = [];         // toutes les lignes charges_reelles du user
let mfBiensFilter = 'all';   // 'all' | 'occupied' | 'vacant' | 'unpaid'
let mfBiensSort = 'cf-desc'; // 'cf-desc' | 'cf-asc' | 'rendement-desc' | 'titre' | 'ville'
let mfbCharts = {};          // registre des Chart.js instances par bien_id (cleanup)

// ─── Suivi financier : exercice UNIQUE pour tout le module ───
// Arbitrage : « année civile partout, sélecteur d'exercice unique en haut ».
// Avant, la Vue d'ensemble raisonnait sur 12 mois glissants et la Rentabilité
// sur l'année civile, chacune avec son propre navigateur d'année.
let mfExercice = new Date().getFullYear();
// Périmètre de l'onglet Performance : null = tous les biens, sinon un bien_id.
// C'est lui qui préserve l'analyse par bien après la fusion des onglets.
let mfPerfBienId = null;
// Déclarant retenu dans la « Déclaration fiscale » : un `sci.id`, ou 'propre'.
// null = le premier de la liste.
let mfDeclarantId = null;

// ─── Suivi mensuel (étape 4) ───
let mfSuiviYear = new Date().getFullYear();
let mfSuiviBienFilter = null;        // null = tous les biens / 'bien-id' = filtré
let mfSuiviBienHighlight = null;     // 'bien-id' = à highlight (vient de "Voir suivi" depuis Mes biens)
let mfSuiviPreviousBienId = null;    // pour le "← Retour" qui ramène vers Mes biens + highlight
let mfChargesFilter = 'all';         // catégorie active

// ─── Mapping Cerfa 2044 (révisé selon Notice 2044-NOT millésime 2026 + BOI-RFPI) ───
// Source : Cerfa 10334*30 / Notice 50156*30 (impots.gouv.fr)
const CERFA_MAPPING = {
  'Copropriété':          { ligne: '229', label: 'L.229 - Provisions copropriété', deductible: true },
  'Assurance PNO':        { ligne: '223', label: 'L.223 - Primes d\'assurance', deductible: true },
  'Taxe foncière':        { ligne: '227', label: 'L.227 - Taxes (hors TEOM)', deductible: true, attention: 'Exclure la TEOM (récupérable sur locataire, CE 12/03/2021)' },
  'Travaux entretien':    { ligne: '224', label: 'L.224 - Réparation/entretien', deductible: true },
  'Travaux amélioration': { ligne: '224', label: 'L.224 - Amélioration', deductible: true, attention: 'Travaux d\'agrandissement/reconstruction NON déductibles' },
  'Honoraires gestion':   { ligne: '221', label: 'L.221 - Frais d\'administration et de gestion', deductible: true },
  'Honoraires comptable': { ligne: '222', label: 'L.222 - Autres frais', deductible: true },
  'Frais bancaires':      { ligne: '222', label: 'L.222 - Autres frais', deductible: true },
  'CFE':                  { ligne: '227', label: 'L.227 - Taxes (régime LMP)', deductible: true },
  'Intérêts emprunt':     { ligne: '250', label: 'L.250 - Intérêts d\'emprunt', deductible: true, attention: 'Seuls les INTÉRÊTS sont déductibles, pas le capital remboursé' },
  'Autre':                { ligne: '224', label: 'L.224 - Autres charges', deductible: true, attention: 'Justifier précisément la nature de la dépense' },
};

// ─── Helpers prorata loi du 6 juillet 1989 (art. 7-1 et 14) ───
// Formule officielle : loyer_proratisé = loyer_mensuel × (jours_occupés / jours_dans_le_mois)
function mfDaysInMonth(mois, annee) {
  return new Date(annee, mois, 0).getDate();  // jour 0 du mois suivant = dernier jour du mois courant
}

// Calcule le nombre de jours occupés dans un mois donné (mois 1-12, annee)
// dateEntree et dateSortie sont des chaînes ISO 'YYYY-MM-DD' ou null
function mfDaysOccupiedInMonth(mois, annee, dateEntree, dateSortie) {
  const daysInMonth = mfDaysInMonth(mois, annee);
  const firstDay = new Date(annee, mois - 1, 1);
  const lastDay  = new Date(annee, mois - 1, daysInMonth);
  const entry    = dateEntree ? new Date(dateEntree + 'T00:00:00') : null;
  const exit     = dateSortie ? new Date(dateSortie + 'T00:00:00') : null;

  if(entry && entry > lastDay) return 0;
  if(exit && exit < firstDay) return 0;

  const effectiveStart = entry && entry > firstDay ? entry : firstDay;
  const effectiveEnd   = exit && exit < lastDay ? exit : lastDay;

  /* ⚠️ BUG DE PRODUCTION, trouvé en revue le 13/08/2026 — antérieur au Suivi
     financier, il touchait tous les utilisateurs, tous les ans.
     Le calcul se faisait en MILLISECONDES : `Math.floor(diff / 86400000)`.
     Or le dernier dimanche de mars ne dure que 23 heures (passage à l'heure
     d'été). Du 1er au 31 mars il y a donc 30 jours MOINS UNE HEURE ; le
     plancher rendait 29, soit 30 jours au lieu de 31.
     Conséquence mesurée : un loyer de 830 € était généré à **803 €** chaque
     mois de mars — un prorata appliqué à un mois entier — et cette valeur
     partait EN BASE via `mfCreateLoyerLine` et `mfGenerateMissingLoyers`.
     On compare désormais des dates CALENDAIRES via `Date.UTC`, qui ignore les
     décalages horaires par construction. */
  const jourCalendaire = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((jourCalendaire(effectiveEnd) - jourCalendaire(effectiveStart)) / 86400000) + 1;
  return Math.max(0, Math.min(days, daysInMonth));
}

// Calcule le montant prorata pour un mois donné selon la loi 1989
function mfLoyerProrata(loyerMensuel, mois, annee, dateEntree, dateSortie) {
  const daysInMonth = mfDaysInMonth(mois, annee);
  const daysOccupied = mfDaysOccupiedInMonth(mois, annee, dateEntree, dateSortie);
  if(daysOccupied === 0) return { montant: 0, prorata: false, jours: 0, joursMois: daysInMonth };
  if(daysOccupied === daysInMonth) return { montant: loyerMensuel, prorata: false, jours: daysOccupied, joursMois: daysInMonth };
  return {
    montant: Math.round(loyerMensuel * daysOccupied / daysInMonth),
    prorata: true,
    jours: daysOccupied,
    joursMois: daysInMonth
  };
}

const MOIS_LABELS = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
const MOIS_LONGS  = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
let allLocataires = [];
let editingLocataireId = null;
let locataireDocsPending = []; // Pour le modal en cours d'édition
let mfLocataireFilter = 'all'; // 'all' | 'Candidat' | 'Actif' | 'Préavis' | 'Sorti'

// Types de documents locataire (forward-compat: ces clés sont stockées en DB)
const LOC_DOC_TYPES = [
  {key:'dossier_candidature', label:'Dossier candidature', icon:'📋'},
  {key:'bail',                label:'Bail / Contrat',      icon:'✍️'},
  {key:'edl_entree',          label:'État des lieux entrée', icon:'🏠'},
  {key:'edl_sortie',          label:'État des lieux sortie', icon:'🔑'},
  {key:'garant',              label:'Garant / Caution',    icon:'🛡️'},
  {key:'justificatif',        label:'Justificatif',        icon:'💼'},
  {key:'quittance',           label:'Quittance loyer',     icon:'📄'},
  {key:'autre',               label:'Autre',               icon:'📁'},
];

const LOC_STATUTS = ['Candidat','Actif','Préavis','Sorti'];
const LOC_STATUT_ICONS = {'Candidat':'👤','Actif':'✓','Préavis':'⚠','Sorti':'📁'};
const TYPES_BAIL = ['Vide','Meublé','Saisonnier','Bail mobilité'];

// Limite de taille fichier (50 MB pour Free plan Supabase Storage en V2)
const MAX_DOC_SIZE_MB = 25; // V1 base64 - on reste plus conservateur que les 50MB Storage

/* ═══════════════════════════════════════════════════════════════════════════
   SUIVI FINANCIER — bandeau et onglets

   « Module financier » devient « Suivi financier » : « module » est un mot de
   logiciel, pas un mot d'utilisateur, et aucun des écrans déjà migrés ne porte
   de nom de composant.

   QUATRE onglets au lieu de cinq. « Vue d'ensemble » et « Mes biens » portaient
   LES QUATRE MÊMES INDICATEURS : ils fusionnent en « Portefeuille ».
   « Rentabilité » devient « Performance », passe en tête et devient consolidée,
   avec un sélecteur de périmètre qui préserve l'analyse d'un bien.
   ═══════════════════════════════════════════════════════════════════════════ */

// Les exercices proposés : ceux qui portent des données, plus l'année en cours.
// Jamais une liste figée — un utilisateur qui saisit 2024 doit pouvoir y revenir.
function mfExercicesDisponibles() {
  const s = new Set([new Date().getFullYear()]);
  allLoyers.forEach(l => { if (l.annee) s.add(l.annee); });
  allCharges.forEach(c => { const a = new Date(c.date_charge).getFullYear(); if (a) s.add(a); });
  return [...s].sort((a, b) => b - a);
}

// Les bilans servent la « Déclaration fiscale ». `loadAdminData()` les charge
// déjà, mais il est réservé aux administrateurs : le module a besoin des siens.
// Non bloquant — une déclaration se calcule à la lecture, le bilan enregistré
// ne sert qu'à savoir si l'exercice est figé.
async function mfLoadBilans() {
  if (!currentUser || allBilans.length) return;
  try {
    const { data, error } = await db.from('bilans_comptables')
      .select('*,sci(nom_sci)').eq('user_id', currentUser.id);
    if (!error) allBilans = data || [];
  } catch (e) { /* la déclaration reste calculable sans */ }
}

// Le consolidé du bandeau. Passe par mfReelExercice pour chaque bien du
// périmètre — jamais par une somme réécrite ailleurs.
function mfConsolide(annee) {
  const biens = mfBiensExercice(annee);
  const nb = mfMoisEcoules(annee);
  let encaisse = 0, du = 0, charges = 0, mensualites = 0, prev = 0;
  let loues = 0, vacants = 0, mensuVacants = 0;
  for (const b of biens) {
    const r = mfReelExercice(b, annee);
    encaisse += r.loyer_encaisse; du += r.loyer_du;
    charges += r.charges_payees; mensualites += r.mensualites_credit;
    prev += computeCF(b) * nb;
    if (mfLoueSurExercice(b, annee)) loues++;
    else { vacants++; mensuVacants += r.mensualites_credit; }
  }
  const cashflow = encaisse - charges - mensualites;
  return {
    biens, nb, encaisse, du, charges, mensualites, cashflow,
    previsionnel: prev, ecart: cashflow - prev,
    loues, vacants, mensuVacants,
    occupation: biens.length ? (loues / biens.length) * 100 : null,
    rendementNet: mfRendementNet(biens, annee),
  };
}

// Loyers échus et non soldés. ⚠️ L'état vient de `sfLoyerEtat()`, source unique :
// un impayé se déduit de l'ÉCHÉANCE, jamais du libellé du statut — en base, seuls
// « Payé » et « En attente » sont écrits par la saisie courante.
/* ⚠️ ON PART DES ÉCHÉANCES DUES, PAS DES LIGNES EXISTANTES.
   Défaut trouvé en revue : la version précédente itérait `allLoyers`. Un loyer
   DÛ dont la ligne n'a jamais été générée n'existe alors nulle part — et il
   était pourtant peint EN ROUGE dans la grille, qui, elle, part du bail.
   Reproduit : en supprimant la ligne de mars, la grille affichait cinq mois
   échus et les compteurs en annonçaient quatre. Deux endroits du même écran
   qui ne disaient pas la même chose.
   On énumère donc les mois depuis le BAIL, comme la grille. `sfLoyerEtat` rend
   'none' quand la ligne manque et que l'échéance est passée : avec un locataire
   en face, c'est un impayé, pas une absence. */
function mfLoyersNonSoldes(annee, bienId) {
  const out = [];
  for (const bien of allBiens) {
    if (bien.statut !== 'Acheté') continue;
    if (bienId && bien.id !== bienId) continue;
    if (!mfDansLePerimetre(bien, annee)) continue;
    for (let m = 1; m <= 12; m++) {
      const l   = mfFindLoyer(bien.id, m, annee);
      const loc = mfLocataireForBienMonth(bien.id, m, annee)
               || (l ? allLocataires.find(x => x.id === l.locataire_id) : null);
      if (!l && !loc) continue;                       // rien n'était dû ce mois-là
      const etat = sfLoyerEtat(l, m, annee, loc);
      const manquante = etat === 'none' && !!loc;     // échéance due, ligne jamais créée
      if (etat !== 'ko' && etat !== 'part' && !manquante) continue;
      const du = l ? (parseFloat(l.loyer_du) || 0)
                   : mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, m, annee,
                                    loc.date_entree, loc.date_sortie).montant;
      const enc = l ? (parseFloat(l.montant_encaisse) || 0) : 0;
      if (du <= enc) continue;
      out.push({ ligne: l || null, bien, locataire: loc, mois: m,
                 reste: du - enc, etat: manquante ? 'ko' : etat, sansLigne: !l });
    }
  }
  return out.sort((a, b) => (a.mois - b.mois) || String(a.bien.id).localeCompare(String(b.bien.id)));
}

/* Un bien est-il LOUÉ SUR CET EXERCICE ? ⚠️ Défaut trouvé en revue : l'ancien
   calcul lisait `statut === 'Actif'`, c'est-à-dire l'état ACTUEL du locataire.
   Sur un exercice passé dont le locataire est depuis parti, un bien loué toute
   l'année comptait donc comme vacant — occupation 0 %, et le bandeau annonçait
   « trois de vos trois biens sont vacants » pour une année où deux étaient
   loués. `mfLocataireForBienMonth` fait déjà le bon calcul, par chevauchement
   des dates de bail. */
function mfLoueSurExercice(bien, annee) {
  const nb = mfMoisEcoules(annee) || 12;
  for (let m = 1; m <= nb; m++) if (mfLocataireForBienMonth(bien.id, m, annee)) return true;
  return false;
}

async function renderModuleFinancier(el) {
  el.innerHTML = `<div class="mf-page"><div class="mfx-wrap">
    <div class="loading"><div class="spinner"></div>Chargement…</div>
  </div></div>`;

  if(!allBiens.length && currentUser) await loadBiens();
  // allSCI alimente la « Déclaration fiscale » de l'onglet Performance
  await Promise.all([loadLocataires(), loadMfFinancialData(),
                     allSCI.length ? null : loadSCIList(), mfLoadBilans()]);

  mfRenderShell();
}

function mfRenderShell() {
  const el = document.getElementById('content');
  if (!el) return;
  const annees = mfExercicesDisponibles();
  if (!annees.includes(mfExercice)) mfExercice = annees[0];
  const k = mfConsolide(mfExercice);
  const nonSoldes = mfLoyersNonSoldes(mfExercice).length;
  const locActifs = allLocataires.filter(l => l.statut === 'Actif').length;

  // ⚠️ « non disponible » plutôt qu'un zéro trompeur : un rendement incalculable
  // n'est pas un rendement nul. C'est la variante `--none` du composant KPI.
  const rn = k.rendementNet;
  const seuil = parseFloat(userPrefs?.seuil_rentabilite) || 5;

  el.innerHTML = `
  <div class="mf-page"><div class="mfx-wrap">
    <div class="mfx-top">
      <div>
        <h1 class="mfx-h1">Suivi financier</h1>
        <p class="mfx-sub">Ce que vos biens ont réellement rapporté et coûté</p>
      </div>
      <div>
        <span class="mfx-champ-lab">Exercice</span>
        <select id="mf-exercice" aria-label="Exercice comptable" onchange="mfSetExercice(this.value)">
          ${annees.map(a => `<option value="${a}" ${a === mfExercice ? 'selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
    </div>

    ${k.biens.length ? `
    <div class="mfx-kpis">
      <div class="mfx-kpi mfx-kpi--hi">
        <span class="mfx-kpi__l">Cashflow constaté</span>
        <span class="mfx-kpi__v ${k.cashflow >= 0 ? 'mfx-kpi__v--gain' : 'mfx-kpi__v--loss'}">${sfEur(k.cashflow)}</span>
        <span class="mfx-kpi__s">soit ${sfEur(k.nb ? k.cashflow / k.nb : 0)} par mois sur ${k.nb} mois écoulé${k.nb > 1 ? 's' : ''}</span>
      </div>
      <div class="mfx-kpi">
        <span class="mfx-kpi__l">Rendement net</span>
        <span class="mfx-kpi__v ${rn === null ? 'mfx-kpi__v--none' : (rn >= seuil ? 'mfx-kpi__v--gain' : 'mfx-kpi__v--loss')}">${rn === null ? 'non disponible' : sfPctNum(rn)}</span>
        <span class="mfx-kpi__s">${rn === null ? "coût d'acquisition non renseigné" : (rn >= seuil ? `au-dessus de votre seuil de ${sfPctNum(seuil, 0)}` : `en dessous de votre seuil de ${sfPctNum(seuil, 0)}`)}</span>
      </div>
      <div class="mfx-kpi">
        <span class="mfx-kpi__l">Écart réel − prévisionnel</span>
        <span class="mfx-kpi__v ${k.ecart >= 0 ? 'mfx-kpi__v--gain' : 'mfx-kpi__v--loss'}">${sfEur(k.ecart)}</span>
        <span class="mfx-kpi__s">prévu ${k.previsionnel >= 0 ? '+' : ''}${sfEur(k.previsionnel)} · constaté ${sfEur(k.cashflow)}</span>
      </div>
      <div class="mfx-kpi">
        <span class="mfx-kpi__l">Occupation</span>
        <span class="mfx-kpi__v">${sfPctNum(k.occupation, 0)}</span>
        <span class="mfx-kpi__s">${k.loues} bien${k.loues > 1 ? 's' : ''} loué${k.loues > 1 ? 's' : ''} sur ${k.biens.length}</span>
      </div>
    </div>
    ${k.vacants ? `
    <p class="mfx-fait">
      ${sfAccIcon('info', 16)}
      <span><b>${sfNombreEnLettres(k.vacants, true)} de vos ${sfNombreEnLettres(k.biens.length)} biens ${k.vacants === 1 ? 'est vacant' : 'sont vacants'}</b> — ${sfEur(k.mensuVacants)} de crédit sans loyer en face.</span>
    </p>` : ''}
    ` : ''}

    <div class="mfx-tabs" role="tablist">
      ${[
        ['performance', 'Performance',   'graph',     null],
        ['portefeuille','Portefeuille',  'mallette',  k.biens.length || null],
        ['suivi',       'Suivi mensuel', 'agenda',    nonSoldes || null],
        ['locataires',  'Locataires',    'personnes', locActifs || null],
      ].map(([id, lab, ic, n]) => `
        <button class="mfx-tab" role="tab" aria-selected="${mfTab === id}" onclick="switchMfTab('${id}')">
          ${sfAccIcon(ic, 16)} ${lab}${n ? `<span class="mfx-tab__n${id === 'suivi' ? ' mfx-tab__n--alerte' : ''}">${n}</span>` : ''}
        </button>`).join('')}
    </div>

    <div id="mf-content"></div>
  </div></div>`;

  switchMfTab(mfTab);
}

// Changer d'exercice redessine TOUT : le bandeau comme l'onglet. Sans quoi les
// quatre indicateurs resteraient sur l'ancienne année pendant que la grille
// afficherait la nouvelle — deux périmètres sur le même écran.
function mfSetExercice(v) {
  mfExercice = parseInt(v, 10) || new Date().getFullYear();
  mfSuiviYear = mfExercice;   // la grille de saisie suit le sélecteur unique
  mfRenderShell();
}

function switchMfTab(tab) {
  // Cleanup des charts du tab précédent (anti-fuite mémoire)
  if(mfbCharts && Object.keys(mfbCharts).length) {
    Object.values(mfbCharts).forEach(ch => { try{ ch.destroy(); }catch(e){} });
    mfbCharts = {};
  }
  mfTab = tab;
  document.querySelectorAll('.mfx-tab').forEach(b => {
    b.setAttribute('aria-selected', String(b.getAttribute('onclick') === `switchMfTab('${tab}')`));
  });
  const c = document.getElementById('mf-content');
  if(!c) return;
  if(tab === 'performance')      renderMfPerformance(c);
  else if(tab === 'portefeuille') renderMfPortefeuille(c);
  else if(tab === 'suivi')       renderMfSuivi(c);
  else if(tab === 'locataires')  renderMfLocataires(c);
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERFORMANCE — l'onglet consolidé
   Fusion de « Vue d'ensemble » et de « Rentabilité ». Un sélecteur de PÉRIMÈTRE
   y préserve l'analyse d'un bien : c'est lui qui remplace l'ancien onglet
   Rentabilité, et c'est sur lui que pointe désormais `bdGoToRenta`.

   Graphiques en CSS et SVG, comme la maquette validée à l'écran. Chart.js reste
   chargé pour d'autres écrans ; l'introduire ici produirait un rendu que Thomas
   n'a pas vu, et rouvrirait la question du cycle de vie des instances.
   ═══════════════════════════════════════════════════════════════════════════ */

// ⚠️ `MOIS_LABELS` et `MOIS_LONGS` existent déjà (app.js:5695) : j'en avais
// écrit une seconde copie ici, ce qui est exactement le défaut que ce projet a
// déjà payé — une liste écrite deux fois finit par diverger. Supprimée.

// Trace une polyligne SVG à partir d'une série. `min`/`max` communs pour que
// deux courbes superposées partagent la même échelle — sans quoi elles se
// croiseraient sans que le croisement veuille dire quoi que ce soit.
function mfPolyline(serie, min, max, larg = 320, haut = 120) {
  const n = serie.length;
  if (n < 2 || max === min) return '';
  return serie.map((v, i) => {
    const x = (i / (n - 1)) * larg;
    const y = haut - ((v - min) / (max - min)) * haut;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function renderMfPerformance(c) {
  const annee = mfExercice;
  const tous  = mfBiensExercice(annee);

  if (!tous.length) {
    c.innerHTML = `
      <div class="sff-block"><div class="sff-block__b">
        <div class="sff-empty">
          <div class="sff-empty__ic">${sfAccIcon('graph', 34)}</div>
          <div class="sff-empty__t">Aucun bien à suivre sur ${annee}</div>
          <div class="sff-empty__x">La performance consolide les biens passés au statut
            « Acheté ». Un bien vacant y compte : on sait qu'il ne rapporte rien et que son
            crédit court.</div>
          <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="navigate('biens')">Aller à Mes biens</button>
        </div>
      </div></div>`;
    return;
  }

  // Périmètre : tous les biens, ou celui posé par le pont depuis la fiche bien.
  if (mfPerfBienId && !tous.some(b => b.id === mfPerfBienId)) mfPerfBienId = null;
  const perim = mfPerfBienId ? tous.filter(b => b.id === mfPerfBienId) : tous;
  const nb = mfMoisEcoules(annee);

  // ── Séries mensuelles du périmètre ──
  const mensu = perim.reduce((s, b) => s + (parseFloat(b.mensualite_credit) || 0), 0);
  const entrees = [], sorties = [], solde = [];
  for (let m = 1; m <= 12; m++) {
    if (m > nb) { entrees.push(null); sorties.push(null); solde.push(null); continue; }
    const e = perim.reduce((s, b) => s + mfLoyerEncaisseMois(b.id, m, annee), 0);
    const s2 = mensu + perim.reduce((s, b) => s + mfChargesMois(b.id, m, annee), 0);
    entrees.push(e); sorties.push(s2); solde.push(e - s2);
  }
  const soldeVus = solde.filter(v => v !== null);
  const ampli = Math.max(1, ...soldeVus.map(v => Math.abs(v)));

  // ── Cumuls réel et prévisionnel ──
  const prevMois = perim.reduce((s, b) => s + computeCF(b), 0);
  const cumReel = [], cumPrev = [];
  let ar = 0, ap = 0;
  for (let i = 0; i < nb; i++) { ar += solde[i]; ap += prevMois; cumReel.push(ar); cumPrev.push(ap); }
  const bornes = [...cumReel, ...cumPrev, 0];
  const cMin = Math.min(...bornes), cMax = Math.max(...bornes);

  // ── Totaux du périmètre ──
  let encaisse = 0, charges = 0, mensualites = 0;
  for (const b of perim) {
    const r = mfReelExercice(b, annee);
    encaisse += r.loyer_encaisse; charges += r.charges_payees; mensualites += r.mensualites_credit;
  }
  const cashflow = encaisse - charges - mensualites;
  const previsionnel = prevMois * nb;
  const nonSoldes = mfLoyersNonSoldes(annee, mfPerfBienId);
  const resteDu = nonSoldes.reduce((s, x) => s + x.reste, 0);
  const totalDu = perim.reduce((s, b) => s + mfReelExercice(b, annee).loyer_du, 0);
  const vacants = perim.filter(b => !mfLoueSurExercice(b, annee));
  const mensuVacants = vacants.reduce((s, b) => s + (parseFloat(b.mensualite_credit) || 0) * nb, 0);

  c.innerHTML = `
    <div class="mfx-tools">
      <div class="mfx-pick-lg">
        <span class="mfx-champ-lab">Périmètre</span>
        <select aria-label="Périmètre analysé" onchange="mfSetPerfBien(this.value)">
          <option value="">Tous les biens</option>
          ${tous.map(b => `<option value="${b.id}" ${b.id === mfPerfBienId ? 'selected' : ''}>${esc(b.titre || 'Bien')}${b.ville ? ' — ' + esc(b.ville) : ''}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="sff-grid2">
      <div class="sff-block">
        <div class="sff-block__h">
          <p class="sff-block__t">Cashflow consolidé par mois</p>
          <span class="sff-block__n">exercice ${annee}</span>
        </div>
        <div class="sff-block__b">
          <div class="mfx-chart">
            ${solde.map((v, i) => v === null
              ? `<div class="mfx-col"><span class="mfx-col__b mfx-col__b--vide" style="height:6%"></span><span class="mfx-col__l">${MOIS_LABELS[i]}</span></div>`
              : `<div class="mfx-col"><span class="mfx-col__b ${v >= 0 ? 'mfx-col__b--gain' : 'mfx-col__b--loss'}" style="height:${Math.max(2, (Math.abs(v) / ampli) * 100)}%" title="${MOIS_LONGS[i]} : ${sfEur(v)}"></span><span class="mfx-col__l">${MOIS_LABELS[i]}</span></div>`).join('')}
          </div>
          <div class="mfx-legend">
            <span><i class="gain"></i>Mois positif</span>
            <span><i class="loss"></i>Mois négatif</span>
            <span><i class="vide"></i>À venir</span>
          </div>
        </div>
      </div>

      <div class="sff-block">
        <div class="sff-block__h">
          <p class="sff-block__t">Entrées et sorties</p>
          <span class="sff-block__n">exercice ${annee}</span>
        </div>
        <div class="sff-block__b">
          ${(() => {
            const vus = [...entrees.slice(0, nb), ...sorties.slice(0, nb), 0];
            const mn = Math.min(...vus), mx = Math.max(...vus);
            const pe = mfPolyline(entrees.slice(0, nb), mn, mx);
            const ps = mfPolyline(sorties.slice(0, nb), mn, mx);
            if (!pe || !ps) return `<p class="sff-line__l">Pas encore assez de mois écoulés pour tracer une courbe.</p>`;
            return `
            <svg class="mfx-svg" viewBox="0 0 320 120" height="180" preserveAspectRatio="none" aria-label="Loyers encaissés et sorties, mois par mois">
              <polyline fill="none" stroke="var(--sf-loss)" stroke-width="2" points="${ps}"/>
              <polyline fill="none" stroke="var(--sf-gain)" stroke-width="2" points="${pe}"/>
            </svg>
            <div class="mfx-mois">${MOIS_LABELS.map((m, i) => `<span>${i < nb ? m : ''}</span>`).join('')}</div>
            <div class="mfx-legend">
              <span><i class="gain"></i>Loyers encaissés</span>
              <span><i class="loss"></i>Charges et mensualités</span>
            </div>`;
          })()}
        </div>
      </div>
    </div>

    <div class="sff-grid2">
      <div class="sff-block">
        <div class="sff-block__h">
          <p class="sff-block__t">Cumul sur l'exercice</p>
          <span class="sff-block__n">réel contre prévisionnel</span>
        </div>
        <div class="sff-block__b">
          ${cumReel.length > 1 ? `
          <div class="mfx-fill">
            <svg class="mfx-svg" viewBox="0 0 320 120" preserveAspectRatio="none" aria-label="Trajectoire cumulée réelle et prévisionnelle">
              ${cMin < 0 && cMax > 0 ? `<line x1="0" y1="${(120 - ((0 - cMin) / (cMax - cMin)) * 120).toFixed(1)}" x2="320" y2="${(120 - ((0 - cMin) / (cMax - cMin)) * 120).toFixed(1)}" stroke="var(--sf-border-strong)" stroke-width="1"/>` : ''}
              <polyline fill="none" stroke="var(--sf-text-3)" stroke-width="2" stroke-dasharray="5 4" points="${mfPolyline(cumPrev, cMin, cMax)}"/>
              <polyline fill="none" stroke="var(--sf-loss)" stroke-width="2.5" stroke-linejoin="round" points="${mfPolyline(cumReel, cMin, cMax)}"/>
            </svg>
          </div>
          <div class="mfx-mois">${MOIS_LABELS.map((m, i) => `<span>${i < nb ? m : ''}</span>`).join('')}</div>
          <div class="mfx-legend">
            <span><i class="loss"></i>Trajectoire réelle · ${sfEur(cashflow)}</span>
            <span><i class="trait"></i>Trajectoire prévue · ${previsionnel >= 0 ? '+' : ''}${sfEur(previsionnel)}</span>
          </div>` : `<p class="sff-line__l">Pas encore assez de mois écoulés pour tracer une trajectoire.</p>`}
          ${(vacants.length || resteDu > 0) ? `
          <p class="mfx-verdict">
            ${sfAccIcon('alerte', 17)}
            <span>${[
              vacants.length ? `<b>La vacance de ${sfNombreEnLettres(vacants.length)} bien${vacants.length > 1 ? 's' : ''}</b> pèse ${sfEur(mensuVacants)} de crédit sans loyer en face.` : '',
              resteDu > 0 ? `<b>${sfNombreEnLettres(nonSoldes.length)} loyer${nonSoldes.length > 1 ? 's' : ''} non soldé${nonSoldes.length > 1 ? 's' : ''}</b> — ${sfEur(resteDu)} manquants.` : '',
            ].filter(Boolean).join(' Puis, ')}</span>
          </p>` : ''}
        </div>
      </div>

      <div class="sff-block">
        <div class="sff-block__h">
          <p class="sff-block__t">Loyers non soldés</p>
          <span class="sff-block__n">${totalDu > 0 ? sfPctNum((resteDu / totalDu) * 100, 0) + ' du dû' : 'aucun loyer dû'}</span>
        </div>
        <div class="sff-block__b">
          ${nonSoldes.length ? nonSoldes.map(x => `
            <button class="mfx-imp" onclick="mfGoToSuiviMois('${x.bien.id}')" title="Ouvrir le suivi mensuel sur ce bien">
              <span class="mfx-imp__m">${MOIS_LONGS[x.mois - 1]} ${annee}</span>
              <span><span class="mfx-imp__l">${x.locataire ? esc([x.locataire.prenom, x.locataire.nom].filter(Boolean).join(' ')) + ' · ' : ''}${esc(x.bien.titre || 'Bien')}</span></span>
              <span class="sf-pill sf-pill--loss">${x.etat === 'part' ? 'Partiel' : 'Non soldé'}</span>
              <span class="mfx-imp__v sf-loss">${sfEur(-x.reste)}</span>
            </button>`).join('')
          : `<p class="sff-line__l">Aucun loyer échu ne reste à encaisser sur ${annee}.</p>`}
          <p class="sff-sep">Composition du constaté</p>
          <div class="sff-lines">
            <div class="sff-line"><span class="sff-line__l">Loyers encaissés</span><span class="sff-line__v">${sfEur(encaisse)}</span></div>
            <div class="sff-line"><span class="sff-line__l">Charges payées</span><span class="sff-line__v">${sfEur(charges)}</span></div>
            <div class="sff-line"><span class="sff-line__l">Mensualités de crédit <small>· ${perim.length} bien${perim.length > 1 ? 's' : ''} × ${nb} mois</small></span><span class="sff-line__v">${sfEur(mensualites)}</span></div>
          </div>
        </div>
      </div>
    </div>

    ${mfSectionDeclaration(annee)}`;
}

// Le périmètre redessine l'onglet seul : le bandeau reste consolidé, c'est son
// rôle. Deux périmètres coexistent donc à l'écran — mais le sélecteur est juste
// au-dessus des cartes qu'il gouverne, et le bandeau porte ses propres libellés.
function mfSetPerfBien(v) {
  mfPerfBienId = v || null;
  const c = document.getElementById('mf-content');
  if (c) renderMfPerformance(c);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DÉCLARATION FISCALE
   « Bilan comptable » devient « Déclaration fiscale » : une personne physique
   n'a pas de bilan, elle a une déclaration de revenus fonciers ; un vrai bilan
   n'existe que pour une SCI à l'IS. Le titre couvre les deux déclarants.

   ⚠️ SON PÉRIMÈTRE N'EST PAS CELUI DU MODULE, et il ne le sera jamais : une
   déclaration porte sur un DÉCLARANT, le module sur le portefeuille entier.
   Deux périmètres sur le même écran ne se distinguent que si l'un des deux le
   DIT — d'où le sélecteur de déclarant et la liste « Biens déclarés », qui le
   nomme POSITIVEMENT.

   ⚠️ CALCULÉ À LA LECTURE. Le bilan stocké n'est que le cache d'une addition
   sur des données déjà en mémoire : 19 loyers et 1 charge mesurés en base.
   C'est le cache qui périmait, pas la donnée — un exercice en Brouillon est
   donc recalculé à chaque affichage, et l'écriture ne subsiste qu'à la
   VALIDATION, où figer a un sens légal : une déclaration déposée ne doit pas
   bouger si l'on corrige un loyer ensuite.
   ⚠️ En régime IS les dotations aux amortissements sont SAISIES, pas
   dérivables : le calcul en direct couvre les produits et les charges, pas elles.
   ═══════════════════════════════════════════════════════════════════════════ */

// Un déclarant par SCI qui porte au moins un bien, plus « en propre » si au
// moins un bien y est détenu. Jamais une entrée vide : un déclarant sans bien
// n'a rien à déclarer.
function mfDeclarants() {
  const acquis = allBiens.filter(b => b.statut === 'Acheté');
  const out = allSCI
    .map(s => ({ cle: s.id, nom: s.nom_sci, type: 'sci', sci: s,
                 biens: acquis.filter(b => b.sci_id === s.id) }))
    .filter(d => d.biens.length);
  const propre = acquis.filter(b => b.mode_detention === 'propre');
  if (propre.length) {
    out.push({ cle: 'propre', nom: 'En propre — personne physique',
               type: 'propre', sci: null, biens: propre });
  }
  return out;
}

function mfSetDeclarant(v) {
  mfDeclarantId = v || null;
  const c = document.getElementById('mf-content');
  if (c) renderMfPerformance(c);
}

function mfSectionDeclaration(annee) {
  const decls = mfDeclarants();
  const acquis = allBiens.filter(b => b.statut === 'Acheté');
  /* ⚠️ ON LISTE LES BIENS SANS DÉCLARANT, PAS SEULEMENT CEUX SANS MODE.
     Défaut trouvé en revue : un bien marqué `mode_detention = 'sci'` dont la
     SCI a disparu — supprimée, ou simplement pas chargée — n'appartenait à
     AUCUN déclarant et n'était pas non plus signalé, puisqu'il avait un mode.
     Reproduit : avec `allSCI` vide, deux biens acquis devenaient totalement
     invisibles de la déclaration, loyers et charges compris, sans un mot.
     C'est le « périmètre silencieux » que toute cette section combat. */
  const declares = new Set(decls.flatMap(d => d.biens.map(b => b.id)));
  const sansMode = acquis.filter(b => !declares.has(b.id));

  if (!decls.length) {
    return `
    <div class="sff-block">
      <div class="sff-block__h"><p class="sff-block__t">Déclaration fiscale</p></div>
      <div class="sff-block__b"><div class="sff-empty">
        <div class="sff-empty__ic">${sfAccIcon('balance', 34)}</div>
        <div class="sff-empty__t">Aucun déclarant</div>
        <div class="sff-empty__x">Chaque bien acquis se déclare — en votre nom propre ou
          via une SCI. ${sansMode.length
            ? `${sfNombreEnLettres(sansMode.length, true)} bien${sansMode.length > 1 ? 's' : ''} ${sansMode.length > 1 ? 'attendent' : 'attend'} encore ce choix.`
            : 'Créez une SCI ou renseignez le mode de détention de vos biens.'}</div>
        ${sansMode.length ? `<button class="sf-btn sf-btn--primary sf-btn--sm" onclick="bdOpenMiseEnGestion('${sansMode[0].id}')">Renseigner ${esc(sansMode[0].titre || 'ce bien')}</button>` : ''}
      </div></div>
    </div>`;
  }

  if (mfDeclarantId && !decls.some(d => d.cle === mfDeclarantId)) mfDeclarantId = null;
  const d = decls.find(x => x.cle === mfDeclarantId) || decls[0];

  // Le bilan enregistré n'existe que pour une SCI : `bilans_comptables.sci_id`
  // est obligatoire. Une déclaration en propre est donc toujours calculée.
  const bilan  = d.type === 'sci'
    ? allBilans.find(b => b.sci_id === d.cle && b.exercice === annee) : null;
  const regime = bilan?.regime || 'IR';
  const statut = bilan?.statut || 'Brouillon';
  const fige   = statut === 'Validé' || statut === 'Déposé';

  const calc = mfBilanFeedCompute(d.biens, annee);
  const resultatCalcule = calc.loyers - calc.chargesTotal;
  const resultatFige    = bilan ? bilanResultatNet(bilan) : null;
  const resultat = fige ? resultatFige : resultatCalcule;
  const ecartFige = fige && Number.isFinite(resultatFige)
    ? Math.round(resultatCalcule - resultatFige) : 0;

  const lignes = Object.keys(calc.parLigne).sort();

  return `
    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Déclaration fiscale</p>
        <span class="sff-block__n">exercice ${annee}</span>
        ${decls.length > 1 ? `<span class="sff-block__a">
          <select aria-label="Déclarant" onchange="mfSetDeclarant(this.value)">
            ${decls.map(x => `<option value="${x.cle}" ${x.cle === d.cle ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}
          </select>
        </span>` : ''}
      </div>
      <div class="sff-block__b">
        <div class="mfx-bilan__meta">
          ${decls.length > 1 ? '' : `<span class="mfx-badge">${esc(d.nom)}</span>`}
          <span class="mfx-badge">${d.type === 'propre' ? 'Revenus fonciers · déclaration 2044'
            : `Régime ${esc(regime)} · ${regime === 'IR' ? 'déclaration 2044' : 'compte de résultat PCG'}`}</span>
          <span class="mfx-badge">${esc(statut)}</span>
        </div>

        ${sansMode.length ? `
        <div class="mfx-scope">
          ${sfAccIcon('info', 16)}
          ${/* Le motif diffère : sans mode renseigné, ou rattaché à une SCI
                introuvable. Nommer le bon, sinon l'action proposée ne
                correspond pas à ce qu'on lit. */''}
          <span><b>${esc(sansMode[0].titre || 'Un bien')}${sansMode.length > 1 ? ` et ${sfNombreEnLettres(sansMode.length - 1)} autre${sansMode.length > 2 ? 's' : ''}` : ''} ${sansMode.length > 1 ? 'ne sont rattachés' : "n'est rattaché"} à aucun déclarant.</b>
          ${sansMode.every(b => !b.mode_detention)
            ? `Le mode de détention ${sansMode.length > 1 ? 'reste' : 'reste'} à renseigner : ni les loyers ni les charges n'entrent dans une déclaration sans lui.`
            : `Leur SCI est introuvable — supprimée, ou pas encore chargée. Ni les loyers ni les charges n'entrent dans une déclaration en l'état.`}</span>
          <span class="mfx-scope__a">
            <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="bdOpenMiseEnGestion('${sansMode[0].id}')">Renseigner</button>
          </span>
        </div>` : ''}

        <div class="mfx-bilan">
          <div>
            <p class="sff-sep">${regime === 'IR' || d.type === 'propre' ? 'Déclaration 2044' : 'Compte de résultat'}</p>
            <div class="sff-lines">
              <div class="sff-line">
                <span class="sff-line__l">Loyers perçus</span>
                <span class="sff-line__v">${sfEur(calc.loyers)}</span>
              </div>
              ${lignes.length ? lignes.map(l => `
              <div class="sff-line">
                <span class="sff-line__l">L.${l} — ${esc(CERFA_LIGNE_LABELS[l] || 'Autres charges')}</span>
                <span class="sff-line__v">${sfEur(-calc.parLigne[l])}</span>
              </div>`).join('') : `
              <div class="sff-line">
                <span class="sff-line__l">Charges déductibles</span>
                <span class="sff-line__v">${sfEur(0)}</span>
              </div>`}
              <div class="sff-line sff-line--tot">
                <span class="sff-line__l">Résultat foncier</span>
                <span class="sff-line__v ${resultat >= 0 ? 'sf-gain' : 'sf-loss'}">${resultat >= 0 ? '+' : ''}${sfEur(resultat)}</span>
              </div>
            </div>
            ${calc.recuperablesExclues > 0 ? `<p class="mfx-mini__lg" style="margin-top:var(--sf-space-5)"><i style="background:var(--sf-text-3)"></i>${sfEur(calc.recuperablesExclues)} de charges récupérables sur le locataire, exclues</p>` : ''}
          </div>

          <div>
            <p class="sff-sep">Biens déclarés</p>
            <div class="sff-lines">
              ${d.biens.map(b => {
                const r = mfReelExercice(b, annee);
                const loue = mfLoueSurExercice(b, annee);
                return `<div class="sff-line">
                  <span class="sff-line__l">${esc(b.titre || 'Bien')}${loue ? '' : ' <small>· aucun bail en cours</small>'}</span>
                  <span class="sff-line__v">${sfEur(r.loyer_encaisse)}</span>
                </div>`;
              }).join('')}
            </div>
            ${ecartFige ? `
            <p class="mfx-verdict mfx-verdict--alerte">
              ${sfAccIcon('alerte', 17)}
              <span>L'exercice est <b>${esc(statut.toLowerCase())}</b> : les chiffres ci-dessus sont ceux déposés.
              Les données actuelles donneraient <b>${ecartFige >= 0 ? '+' : ''}${sfEur(ecartFige)}</b> d'écart.</span>
            </p>` : ''}
            <div class="mfx-acts">
              ${d.type === 'sci'
                ? `<button class="sf-btn sf-btn--primary sf-btn--sm" onclick="mfOpenBilanFeedModal()">${fige ? "Rouvrir l'exercice" : "Valider l'exercice"}</button>`
                : ''}
              <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="mfExportDeclaration('${d.cle}',${annee},'detail')">Exporter le détail</button>
              <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="mfExportDeclaration('${d.cle}',${annee},'synthese')">Exporter la synthèse</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/* Export de la déclaration — CSV, via la chaîne déjà en place (`tiCsv`,
   RFC 4180, séparateur `;`, BOM UTF-8) qu'Excel FR ouvre en reconnaissant les
   nombres. ⚠️ Ne jamais passer par `fmt()` ici : son séparateur de milliers
   U+202F empêche Excel de lire un nombre.
   Le DÉTAIL donne une ligne par loyer encaissé et par charge, avec sa ligne
   Cerfa — c'est le justificatif qu'un comptable demande. La SYNTHÈSE donne les
   totaux par ligne. */
function mfExportDeclaration(cle, annee, mode) {
  const d = mfDeclarants().find(x => x.cle === cle);
  if (!d) { showNotif('Déclarant introuvable', true); return; }
  const ids = new Set(d.biens.map(b => b.id));
  const nomBien = id => allBiens.find(b => b.id === id)?.titre || '';
  // ⚠️ Décomposer les accents AVANT de filtrer : sans cela « Guénon » devenait
  // « gu-non », le « é » étant simplement supprimé comme un caractère interdit.
  const base = `declaration-${annee}-${d.type === 'propre' ? 'en-propre' : (d.nom || 'sci')}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (mode === 'detail') {
    const entetes = ['Nature', 'Bien', 'Date', 'Mois', 'Catégorie', 'Ligne Cerfa',
                     'Libellé Cerfa', 'Libellé', 'Montant (€)'];
    const lignes = [];
    for (const l of allLoyers) {
      if (l.annee !== annee || !ids.has(l.bien_id)) continue;
      if (l.statut !== 'Payé' && l.statut !== 'Partiel') continue;
      lignes.push(['Loyer encaissé', nomBien(l.bien_id), tiDateFr(l.date_encaissement),
        MOIS_LONGS[l.mois - 1] || l.mois, '', '', '', '',
        parseFloat(l.montant_encaisse) || 0]);
    }
    for (const ch of allCharges) {
      if (!ids.has(ch.bien_id)) continue;
      if (new Date(ch.date_charge).getFullYear() !== annee) continue;
      const cerfa = CERFA_MAPPING[ch.categorie] || CERFA_MAPPING['Autre'];
      lignes.push([
        ch.recuperable_locataire ? 'Charge récupérable (non déductible)' : 'Charge déductible',
        nomBien(ch.bien_id), tiDateFr(ch.date_charge),
        MOIS_LONGS[new Date(ch.date_charge).getMonth()] || '',
        ch.categorie || '', 'L.' + cerfa.ligne, CERFA_LIGNE_LABELS[cerfa.ligne] || '',
        ch.libelle || '', -(parseFloat(ch.montant) || 0)]);
    }
    if (!lignes.length) { showNotif(`Rien à exporter pour ${annee}`, true); return; }
    const nom = tiTelechargerCsv(base + '-detail', tiCsv(entetes, lignes));
    showNotif(`${lignes.length} ligne${lignes.length > 1 ? 's' : ''} exportée${lignes.length > 1 ? 's' : ''} · ${nom}`);
    return;
  }

  const calc = mfBilanFeedCompute(d.biens, annee);
  const entetes = ['Poste', 'Ligne Cerfa', 'Libellé Cerfa', 'Montant (€)'];
  const lignes = [['Loyers perçus', '', '', calc.loyers]];
  Object.keys(calc.parLigne).sort().forEach(l =>
    lignes.push(['Charges déductibles', 'L.' + l, CERFA_LIGNE_LABELS[l] || 'Autres charges',
      -(calc.parLigne[l])]));
  if (calc.recuperablesExclues > 0) {
    lignes.push(['Charges récupérables (exclues)', '', '', -(calc.recuperablesExclues)]);
  }
  lignes.push(['Résultat foncier', '', '', calc.loyers - calc.chargesTotal]);
  const nom = tiTelechargerCsv(base + '-synthese', tiCsv(entetes, lignes));
  showNotif(`Synthèse ${annee} exportée · ${nom}`);
}

// Ouvre le suivi mensuel sur un bien depuis un loyer non soldé — le pont R-19
// du comparatif de non-régression.
function mfGoToSuiviMois(bienId) {
  mfSuiviBienFilter = bienId;
  mfSuiviPreviousBienId = bienId;
  mfSuiviYear = mfExercice;
  switchMfTab('suivi');
}

/* ═══════════════════════════════════════════════════════════════════════════
   PORTEFEUILLE — bien par bien, en cartes
   Fusion de « Vue d'ensemble » et de « Mes biens », qui portaient les quatre
   mêmes indicateurs. Cartes et non table : c'est l'arbitrage de Thomas, et les
   cartes portent chacune leur propre lecture mensuelle.
   ═══════════════════════════════════════════════════════════════════════════ */

// Le mini-graphique mensuel d'un bien. Barres partant de ZÉRO — une sparkline
// mise à l'échelle sur sa série faisait lire une variation de 830 € comme un
// effondrement alors que toute la série était dans le rouge. Problème
// d'honnêteté, pas de lisibilité.
function mfMiniGraphique(bien, annee) {
  const serie = mfCashflowMensuelExercice(bien, annee).filter(m => m.cashflow !== null);
  if (!serie.length) return '';
  const nb = serie.length;
  const ampli = Math.max(1, ...serie.map(m => Math.abs(m.cashflow)));
  const dernier = serie[nb - 1];
  const aDesManques = serie.some(m => m.manque);
  const cols = `grid-template-columns:repeat(${nb},1fr)`;
  return `
    <div class="mfx-card__spark">
      <div class="mfx-spark__h">
        <span>Cashflow mois par mois</span>
        <span class="mfx-spark__d">${MOIS_LONGS[dernier.mois - 1].toLowerCase()} <b>${sfEur(dernier.cashflow)}</b></span>
      </div>
      <div class="mfx-mini" style="${cols}" role="img"
           aria-label="Cashflow mensuel de janvier à ${MOIS_LONGS[dernier.mois - 1].toLowerCase()}">
        ${serie.map(m => {
          // L'ambre signale un loyer DÛ resté impayé. Un bien vacant n'a rien à
          // encaisser : il ne doit donc jamais porter de barre ambre.
          const cls = m.manque ? ' mfx-mini__b--ko' : (m.cashflow >= 0 ? ' mfx-mini__b--gain' : '');
          return `<span class="mfx-mini__b${cls}" style="height:${Math.max(2, (Math.abs(m.cashflow) / ampli) * 100).toFixed(1)}%" title="${MOIS_LONGS[m.mois - 1]} : ${sfEur(m.cashflow)}${m.manque ? ' · loyer non encaissé' : ''}"></span>`;
        }).join('')}
      </div>
      <div class="mfx-mini__x" style="${cols}">
        ${serie.map(m => `<span class="${m.manque ? 'ko' : ''}">${MOIS_LABELS[m.mois - 1]}</span>`).join('')}
      </div>
      ${aDesManques ? `<p class="mfx-mini__lg"><i></i>Mois dont le loyer n'a pas été encaissé</p>` : ''}
    </div>`;
}

function renderMfPortefeuille(c) {
  const annee = mfExercice;
  const tous  = mfBiensExercice(annee);

  if (!tous.length) {
    c.innerHTML = `
      <div class="sff-block"><div class="sff-block__b">
        <div class="sff-empty">
          <div class="sff-empty__ic">${sfAccIcon('mallette', 34)}</div>
          <div class="sff-empty__t">Aucun bien dans votre portefeuille</div>
          <div class="sff-empty__x">Le portefeuille rassemble vos biens passés au statut
            « Acheté », avec ce que chacun a rapporté et coûté sur l'exercice.</div>
          <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="navigate('biens')">Aller à Mes biens</button>
        </div>
      </div></div>`;
    return;
  }

  // ── Filtres : le compteur de chacun vient du même calcul que le filtrage,
  //    jamais d'un comptage réécrit à côté. ──
  const etat = b => mfStatutOccupation(b.id).type;   // 'vacant' | 'occup' | 'impaye'
  const jeux = {
    all:      tous,
    occupied: tous.filter(b => etat(b) !== 'vacant'),
    vacant:   tous.filter(b => etat(b) === 'vacant'),
    unpaid:   tous.filter(b => etat(b) === 'impaye'),
  };
  if (!jeux[mfBiensFilter]) mfBiensFilter = 'all';
  let liste = [...jeux[mfBiensFilter]];

  // ── Tri ──
  const cf = b => mfReelExercice(b, annee).cashflow;
  const tri = {
    'cf-desc':        (a, b) => cf(b) - cf(a),
    'cf-asc':         (a, b) => cf(a) - cf(b),
    'rendement-desc': (a, b) => (mfRendementNet(b, annee) ?? -Infinity) - (mfRendementNet(a, annee) ?? -Infinity),
    'cout-desc':      (a, b) => mfMontantAcquisition(b) - mfMontantAcquisition(a),
    'titre':          (a, b) => (a.titre || '').localeCompare(b.titre || '', 'fr'),
  };
  if (!tri[mfBiensSort]) mfBiensSort = 'cf-desc';
  liste.sort(tri[mfBiensSort]);

  const pastilles = [
    ['all',      'Tous',          jeux.all.length],
    ['occupied', 'Loués',         jeux.occupied.length],
    ['vacant',   'Vacants',       jeux.vacant.length],
    ['unpaid',   'Avec impayés',  jeux.unpaid.length],
  ];
  const tris = [
    ['cf-desc',        'Cashflow décroissant'],
    ['cf-asc',         'Cashflow croissant'],
    ['rendement-desc', 'Rendement décroissant'],
    ['cout-desc',      'Capital engagé'],
    ['titre',          'Nom du bien'],
  ];

  c.innerHTML = `
    <div class="mfx-tools">
      <div class="mfx-pills">
        ${pastilles.map(([k, lab, n]) => `
          <button class="mfx-pill" aria-pressed="${mfBiensFilter === k}" onclick="setMfBiensFilter('${k}')">
            ${lab} <span class="mfx-pill__n">${n}</span>
          </button>`).join('')}
      </div>
      <div class="mfx-tools__fin">
        <div>
          <span class="mfx-champ-lab">Trier par</span>
          <select aria-label="Trier les biens" onchange="setMfBiensSort(this.value)">
            ${tris.map(([k, lab]) => `<option value="${k}" ${mfBiensSort === k ? 'selected' : ''}>${lab}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    ${liste.length ? `<div class="mfx-cards">${liste.map(b => mfCarteBien(b, annee)).join('')}</div>`
    : `<div class="sff-block"><div class="sff-block__b"><div class="sff-empty">
         <div class="sff-empty__ic">${sfAccIcon('loupe', 34)}</div>
         <div class="sff-empty__t">Aucun bien avec ce filtre</div>
         <div class="sff-empty__x">Aucun de vos ${tous.length} biens ne correspond à « ${pastilles.find(p => p[0] === mfBiensFilter)[1]} ».</div>
         <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="setMfBiensFilter('all')">Voir tous les biens</button>
       </div></div></div>`}`;
}

function mfCarteBien(b, annee) {
  const r    = mfReelExercice(b, annee);
  const occ  = mfStatutOccupation(b.id);
  const loc  = occ.locataire;
  const rn   = mfRendementNet(b, annee);
  const seuil = parseFloat(userPrefs?.seuil_rentabilite) || 5;
  const prev = computeCF(b) * r.mois;
  const nbCharges = allCharges.filter(x => x.bien_id === b.id
    && new Date(x.date_charge).getFullYear() === annee
    && (new Date(x.date_charge).getMonth() + 1) <= r.mois).length;

  const pastille = occ.type === 'vacant'
    ? `<span class="sf-pill sf-pill--alert"><span class="sf-dot"></span>Vacant</span>`
    : occ.type === 'impaye'
      ? `<span class="sf-pill sf-pill--loss"><span class="sf-dot"></span>Impayés</span>`
      : `<span class="sf-pill sf-pill--gain"><span class="sf-dot"></span>Loué</span>`;

  const entree = loc?.date_entree
    ? new Date(loc.date_entree).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : null;

  return `
  <article class="mfx-card" onclick="mfGoToSuiviMois('${b.id}')">
    <div class="mfx-card__h">
      <div class="mfx-card__ph">${sfAccIcon('image', 22)}</div>
      <div class="mfx-card__id">
        <div class="mfx-card__t" title="${esc(b.titre || 'Bien')}">${esc(b.titre || 'Bien')}</div>
        <div class="mfx-card__v">${[esc(b.ville || ''), esc(b.code_postal || ''), sfEur(mfMontantAcquisition(b)) + ' engagés'].filter(Boolean).join(' · ')}</div>
      </div>
      ${pastille}
    </div>

    <div class="mfx-card__loc" onclick="event.stopPropagation()">
      ${sfAccIcon('user', 15)}
      ${loc ? `${esc([loc.prenom, loc.nom].filter(Boolean).join(' ') || 'Locataire')}${entree ? ` <em>· depuis ${entree}</em>` : ''}
               <button class="mfx-card__lien" onclick="openDetail('${b.id}')">Voir la fiche</button>`
            : `<em>Aucun bail en cours</em>
               <button class="mfx-card__lien" onclick="bdOpenMiseEnGestion('${b.id}')">Rattacher un locataire</button>`}
    </div>

    <p class="mfx-card__per">Depuis janvier ${annee}</p>
    <div class="mfx-card__stats">
      <div class="mfx-stat">
        <div class="mfx-stat__l">Loyers encaissés</div>
        <div class="mfx-stat__v ${r.loyer_encaisse > 0 ? 'sf-gain' : ''}">${sfEur(r.loyer_encaisse)}</div>
        <div class="mfx-stat__s">${r.loyer_du > 0 ? `sur ${sfEur(r.loyer_du)} dus` : "aucun bail sur l'exercice"}</div>
      </div>
      <div class="mfx-stat">
        <div class="mfx-stat__l">Charges payées</div>
        <div class="mfx-stat__v">${sfEur(r.charges_payees)}</div>
        <div class="mfx-stat__s">${nbCharges ? `${nbCharges} charge${nbCharges > 1 ? 's' : ''} enregistrée${nbCharges > 1 ? 's' : ''}` : 'aucune charge enregistrée'}</div>
      </div>
      <div class="mfx-stat">
        <div class="mfx-stat__l">Cashflow constaté</div>
        <div class="mfx-stat__v ${r.cashflow >= 0 ? 'sf-gain' : 'sf-loss'}">${sfEur(r.cashflow)}</div>
        <div class="mfx-stat__s">prévu ${prev >= 0 ? '+' : ''}${sfEur(prev)}</div>
      </div>
      <div class="mfx-stat">
        <div class="mfx-stat__l">Rendement net</div>
        <div class="mfx-stat__v">${sfPctNum(rn)}</div>
        <div class="mfx-stat__s">${rn === null ? "coût d'acquisition non renseigné"
          : (r.loyer_du === 0 ? 'le bien ne produit rien' : `seuil ${sfPctNum(seuil, 0)}`)}</div>
      </div>
    </div>

    ${mfMiniGraphique(b, annee)}

    <div class="mfx-card__cta">
      <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="event.stopPropagation();mfGoToSuiviMois('${b.id}')">Voir le suivi mensuel</button>
    </div>
  </article>`;
}

// L'écart réel/prévisionnel doit s'afficher en EUROS. Le pourcentage n'a de sens
// que si la base ne frôle pas zéro : constaté le 01/08/2026 en prod, un
// prévisionnel de +2 328 € sur 12 mois face à un réel de −87 930 € donnait
// « −3877,1 % » — exact, mais inexploitable, et un utilisateur y lit une panne.
// Au-delà de 500 % on cesse d'afficher un ratio et on en nomme la cause.
// Même principe que l'onglet Rentabilité, qui montrait déjà l'écart en euros.
/* « Vue d'ensemble » et « Mes biens » ont fusionne dans « Portefeuille » : renderMfOverview, renderMfBiens et ecartPrevSousTitre sont supprimes avec eux plutot que de rester en code mort — c'est ce qui avait rendu le nuancier THEMES si difficile a debusquer. */
function setMfBiensFilter(f) {
  mfBiensFilter = f;
  // Cleanup charts existants avant re-render
  Object.values(mfbCharts).forEach(ch => { try{ ch.destroy(); }catch(e){} });
  mfbCharts = {};
  const c = document.getElementById('mf-content');
  if(c) renderMfPortefeuille(c);
}
function setMfBiensSort(s) {
  mfBiensSort = s;
  Object.values(mfbCharts).forEach(ch => { try{ ch.destroy(); }catch(e){} });
  mfbCharts = {};
  const c = document.getElementById('mf-content');
  if(c) renderMfPortefeuille(c);
}

// ── Naviguer vers l'onglet "Suivi mensuel" pré-sélectionné sur un bien ──

// ── Helpers Suivi mensuel ──
function mfFindLoyer(bienId, mois, annee) {
  return allLoyers.find(l => l.bien_id === bienId && l.mois === mois && l.annee === annee);
}

function mfChargesForBienMonth(bienId, mois, annee) {
  return allCharges.filter(c => {
    if(c.bien_id !== bienId) return false;
    const d = new Date(c.date_charge);
    return d.getMonth() + 1 === mois && d.getFullYear() === annee;
  });
}

function mfSumChargesMonth(bienId, mois, annee) {
  return mfChargesForBienMonth(bienId, mois, annee).reduce((s, c) => s + (parseFloat(c.montant) || 0), 0);
}

// Locataire actif pour un bien à un mois donné
function mfLocataireForBienMonth(bienId, mois, annee) {
  const firstDay = new Date(annee, mois - 1, 1);
  const lastDay = new Date(annee, mois - 1, mfDaysInMonth(mois, annee));
  return allLocataires.find(l => {
    if(l.bien_id !== bienId) return false;
    if(!l.date_entree) return false;
    const entry = new Date(l.date_entree + 'T00:00:00');
    if(entry > lastDay) return false;
    if(l.date_sortie) {
      const exit = new Date(l.date_sortie + 'T00:00:00');
      if(exit < firstDay) return false;
    }
    return true;
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SUIVI MENSUEL — la saisie
   C'est un POSTE DE TRAVAIL, pas un écran de lecture : sa densité est sa
   fonction. L'itération 1 de la maquette l'avait remplacé par une liste, et
   l'on ne pouvait plus enregistrer une charge sur le mois où elle est tombée.

   ⚠️ LE PÉRIMÈTRE DE CET ONGLET N'EST PAS CELUI DU BANDEAU, et c'est voulu.
   La grille montre TOUS les biens « Acheté », y compris un bien loué dont les
   loyers ne sont pas encore saisis — que `mfDansLePerimetre` écarte des
   consolidés. C'est ici qu'on les saisit : l'écarter de la grille rendrait la
   correction impossible. La règle de périmètre gouverne les CHIFFRES
   CONSOLIDÉS, pas la SURFACE DE SAISIE.
   ═══════════════════════════════════════════════════════════════════════════ */

function renderMfSuivi(c) {
  const annee = mfExercice;
  mfSuiviYear = annee;
  const acquis = allBiens.filter(b => b.statut === 'Acheté');

  if (!acquis.length) {
    c.innerHTML = `
      <div class="sff-block"><div class="sff-block__b">
        <div class="sff-empty">
          <div class="sff-empty__ic">${sfAccIcon('agenda', 34)}</div>
          <div class="sff-empty__t">Aucun suivi mensuel disponible</div>
          <div class="sff-empty__x">Le suivi apparaîtra dès qu'un bien aura le statut
            « Acheté ». Vous pourrez alors pointer ses loyers et enregistrer ses charges,
            mois par mois.</div>
          <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="navigate('biens')">Aller à Mes biens</button>
        </div>
      </div></div>`;
    return;
  }

  // Le filtre vient de la fiche bien (« Voir le suivi mensuel ») ou d'un loyer
  // non soldé cliqué dans Performance.
  const bienFiltre = mfSuiviBienFilter ? acquis.find(b => b.id === mfSuiviBienFilter) : null;
  if (mfSuiviBienFilter && !bienFiltre) mfSuiviBienFilter = null;
  const liste = bienFiltre ? [bienFiltre] : acquis;

  // ── Charges de l'exercice, dans le périmètre affiché ──
  const chargesAn = allCharges.filter(x => {
    if (bienFiltre && x.bien_id !== bienFiltre.id) return false;
    return new Date(x.date_charge).getFullYear() === annee;
  });
  const categories = [...new Set(chargesAn.map(x => x.categorie))].sort();
  if (mfChargesFilter !== 'all' && !categories.includes(mfChargesFilter)) mfChargesFilter = 'all';
  const chargesVues = mfChargesFilter === 'all'
    ? chargesAn : chargesAn.filter(x => x.categorie === mfChargesFilter);

  // ── Totaux : ils couvrent EXACTEMENT ce que la grille montre ──
  // ⚠️ Ils affichaient le portefeuille entier sur un écran filtré sur un bien :
  // « 3 biens × 8 mois · 58 000 € » et un cashflow de −54 735 € alors que la
  // carte du même bien dans Portefeuille annonçait −19 135 €. Les deux
  // premières lignes coïncidaient, ce qui rendait la bascule de périmètre
  // invisible. L'en-tête nomme désormais le périmètre.
  const nb = mfMoisEcoules(annee);
  let encaisse = 0, chargesPayees = 0, mensualites = 0;
  for (const b of liste) {
    const r = mfReelExercice(b, annee);
    encaisse += r.loyer_encaisse; chargesPayees += r.charges_payees;
    mensualites += r.mensualites_credit;
  }
  const cashflow = encaisse - chargesPayees - mensualites;

  /* ⚠️ « Reste à encaisser » passe par `mfLoyersNonSoldes()`, la MÊME source
     que le badge de l'onglet et que « Loyers non soldés » dans Performance.
     Ce bloc refaisait le calcul à côté et n'y comptait que les lignes
     EXISTANTES : un loyer dû sans ligne générée apparaissait en rouge dans la
     grille au-dessus sans être compté juste en dessous. Une règle écrite deux
     fois finit par diverger — ici elle avait déjà divergé. */
  const nonSoldes = mfLoyersNonSoldes(annee, bienFiltre ? bienFiltre.id : null);
  const echusReste = nonSoldes.reduce((s, x) => s + x.reste, 0);
  const echusNb = nonSoldes.length;
  let avenirDu = 0, avenirNb = 0;
  for (const b of liste) {
    for (let m = 1; m <= 12; m++) {
      const l = mfFindLoyer(b.id, m, annee);
      const loc = mfLocataireForBienMonth(b.id, m, annee);
      if (!l && !loc) continue;
      if (sfLoyerEtat(l, m, annee, loc) !== 'avenir') continue;
      const du = l ? (parseFloat(l.loyer_du) || 0)
                   : mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, m, annee,
                                    loc.date_entree, loc.date_sortie).montant;
      if (du > 0) { avenirDu += du; avenirNb++; }
    }
  }

  c.innerHTML = `
    ${bienFiltre ? `
    <div class="mfx-filtre">
      ${sfAccIcon('loupe', 16)}
      <span>Suivi filtré sur <b>${esc(bienFiltre.titre || 'Bien')}</b></span>
      <div class="actions">
        <button class="sf-btn sf-btn--ghost sf-btn--sm" onclick="mfSuiviClearFilter()">Voir tous les biens</button>
        <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="mfSuiviReturnToBiens()">Retour au portefeuille</button>
      </div>
    </div>` : ''}

    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Loyers et charges, mois par mois</p>
        <div class="sff-block__a">
          <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="mfGenerateMissingLoyers(${annee})"
            title="Crée les lignes de loyer manquantes pour ${annee}, prorata loi 1989 compris">Générer les loyers ${annee}</button>
          <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="exportLoyersCSV(${annee})"
            title="Exporte les lignes de loyer ${annee} au format CSV">${sfAccIcon('doc', 15)} Loyers</button>
          <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="exportChargesCSV(${annee})"
            title="Exporte les charges réelles ${annee} au format CSV">${sfAccIcon('doc', 15)} Charges</button>
          <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="mfOpenChargeModal(null)">${sfAccIcon('plus', 15)} Ajouter une charge</button>
        </div>
      </div>
      <div class="sff-block__b sff-block__b--flush">
        <div class="mfx-tw">
          <table class="mfx-grille">
            <thead><tr>
              <th>Bien</th>
              ${MOIS_LABELS.map((m, i) => `<th class="${(annee === new Date().getFullYear() && i + 1 === nb) ? 'encours' : ''}" title="${MOIS_LONGS[i]} ${annee}">${m}</th>`).join('')}
              <th class="tot">Total</th>
            </tr></thead>
            <tbody>${liste.map(b => mfSuiviLignesBien(b, annee)).join('')}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Charges détaillées</p>
        <span class="sff-block__n">${chargesAn.length ? `${chargesAn.length} charge${chargesAn.length > 1 ? 's' : ''} · ${sfEur(chargesAn.reduce((s, x) => s + (parseFloat(x.montant) || 0), 0))}` : 'aucune charge'}</span>
      </div>
      <div class="sff-block__b">
        ${categories.length ? `
        <div class="mfx-pills" style="margin-bottom:var(--sf-space-6)">
          <button class="mfx-pill" aria-pressed="${mfChargesFilter === 'all'}" onclick="mfSetChargesFilter('all')">Toutes <span class="mfx-pill__n">${chargesAn.length}</span></button>
          ${categories.map(cat => `<button class="mfx-pill" aria-pressed="${mfChargesFilter === cat}" onclick="mfSetChargesFilter(${JSON.stringify(cat).replace(/"/g, '&quot;')})">${esc(cat)} <span class="mfx-pill__n">${chargesAn.filter(x => x.categorie === cat).length}</span></button>`).join('')}
        </div>` : ''}
        ${chargesVues.length
          ? chargesVues.slice().sort((a, b) => new Date(b.date_charge) - new Date(a.date_charge)).map(mfSuiviCharge).join('')
          : `<div class="sff-empty">
               <div class="sff-empty__ic">${sfAccIcon('doc', 30)}</div>
               <div class="sff-empty__t">Aucune charge enregistrée</div>
               <div class="sff-empty__x">Rien n'est saisi pour ${annee}${mfChargesFilter !== 'all' ? ` dans la catégorie « ${esc(mfChargesFilter)} »` : ''}. Un « + » dans la grille enregistre une charge sur le mois où elle est tombée.</div>
               <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="mfOpenChargeModal(null)">Ajouter une charge</button>
             </div>`}
      </div>
    </div>

    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Totaux de l'exercice</p>
        <span class="sff-block__n">${bienFiltre ? esc(bienFiltre.titre || 'Bien') : `${liste.length} bien${liste.length > 1 ? 's' : ''}`}</span>
      </div>
      <div class="sff-block__b">
        <div class="sff-lines">
          <div class="sff-line"><span class="sff-line__l">Loyers encaissés</span><span class="sff-line__v sf-gain">${sfEur(encaisse)}</span></div>
          <div class="sff-line"><span class="sff-line__l">Charges payées</span><span class="sff-line__v">${sfEur(chargesPayees)}</span></div>
          <div class="sff-line"><span class="sff-line__l">Mensualités de crédit <small>· ${nb} mois écoulé${nb > 1 ? 's' : ''}</small></span><span class="sff-line__v">${sfEur(mensualites)}</span></div>
          <div class="sff-line sff-line--tot"><span class="sff-line__l">Cashflow constaté</span><span class="sff-line__v ${cashflow >= 0 ? 'sf-gain' : 'sf-loss'}">${sfEur(cashflow)}</span></div>
        </div>
        ${(echusNb || avenirNb) ? `
        <p class="sff-sep">Reste à encaisser</p>
        <div class="sff-lines">
          ${echusNb ? `<div class="sff-line"><span class="sff-line__l">Loyers échus non soldés <small>· ${echusNb} mois</small></span><span class="sff-line__v sf-loss">${sfEur(echusReste)}</span></div>` : ''}
          ${avenirNb ? `<div class="sff-line"><span class="sff-line__l">Loyers à venir <small>· ${avenirNb} mois</small></span><span class="sff-line__v">${sfEur(avenirDu)}</span></div>` : ''}
        </div>` : ''}
        <div class="mfx-legend">
          <span><i class="gain"></i>Encaissé</span>
          <span><i class="alerte"></i>Partiel</span>
          <span><i class="loss"></i>Échu, non soldé</span>
          <span><i class="vide"></i>À venir</span>
        </div>
      </div>
    </div>`;

  // Mise en évidence du bien d'où l'on vient (« Voir le suivi mensuel »).
  if (mfSuiviBienHighlight) {
    const id = mfSuiviBienHighlight;
    mfSuiviBienHighlight = null;
    setTimeout(() => {
      const row = c.querySelector(`tr[data-bien-id="${id}"]`);
      if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }
}

// Les deux lignes d'un bien : les loyers, puis les charges.
function mfSuiviLignesBien(b, annee) {
  let totalLoyer = 0, totalCharges = 0;
  for (let m = 1; m <= 12; m++) {
    totalLoyer   += mfLoyerEncaisseMois(b.id, m, annee);
    totalCharges += mfSumChargesMonth(b.id, m, annee);
  }
  const occ = mfStatutOccupation(b.id);
  const pastille = occ.type === 'vacant'
    ? `<span class="sf-pill sf-pill--alert"><span class="sf-dot"></span>Vacant</span>`
    : occ.type === 'impaye'
      ? `<span class="sf-pill sf-pill--loss"><span class="sf-dot"></span>Impayés</span>`
      : `<span class="sf-pill sf-pill--gain"><span class="sf-dot"></span>Loué</span>`;

  return `
    <tr data-bien-id="${b.id}">
      <td class="mfx-bien-cell" rowspan="2">
        <div class="mfx-bien-cell__n">${esc(b.titre || 'Bien')}</div>
        <div class="mfx-bien-cell__s">${[esc(b.ville || ''), esc(b.code_postal || '')].filter(Boolean).join(' · ')}</div>
        <div style="margin-top:6px">${pastille}</div>
      </td>
      ${MOIS_LABELS.map((_, i) => mfSuiviCelluleLoyer(b, i + 1, annee)).join('')}
      <td class="mfx-tot ${totalLoyer > 0 ? 'sf-gain' : ''}">${sfEur(totalLoyer)}</td>
    </tr>
    <tr data-bien-id="${b.id}">
      ${MOIS_LABELS.map((_, i) => mfSuiviCelluleCharge(b, i + 1, annee)).join('')}
      <td class="mfx-tot">${sfEur(totalCharges)}</td>
    </tr>`;
}

/* Une cellule de loyer. ⚠️ L'état vient de `sfLoyerEtat()`, SOURCE UNIQUE :
   un impayé se déduit de l'ÉCHÉANCE, jamais du libellé du statut — en base,
   la saisie courante n'écrit que « Payé » et « En attente ». L'ancien rendu
   lisait le libellé et affichait « Occupé » alors que la matrice, juste à
   côté, montrait un mois échu en rouge. */
function mfSuiviCelluleLoyer(b, mois, annee) {
  const l   = mfFindLoyer(b.id, mois, annee);
  const loc = mfLocataireForBienMonth(b.id, mois, annee);
  const titreMois = `${MOIS_LONGS[mois - 1]} ${annee}`;

  // Ni ligne ni locataire : rien n'était dû ce mois-là. Ce n'est pas un trou de
  // saisie, c'est une absence de bail — on ne propose donc aucune action.
  if (!l && !loc) {
    return `<td class="mfx-cell mfx-cell--none" title="Aucun bail en ${titreMois}">—</td>`;
  }

  // Locataire sans ligne : la ligne reste à générer, au prorata loi 1989.
  if (!l && loc) {
    const p = mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, mois, annee, loc.date_entree, loc.date_sortie);
    const etat = sfLoyerEtat(null, mois, annee, loc);
    return `<td class="mfx-cell ${etat === 'avenir' ? 'mfx-cell--avenir' : 'mfx-cell--ko'}"
      onclick="mfCreateLoyerLine('${b.id}','${loc.id}',${mois},${annee})"
      title="${titreMois} : ligne à générer${p.prorata ? ` · prorata ${p.jours}/${p.joursMois} jours` : ''}">${fmt(p.montant)}<span class="mfx-cell__more" onclick="event.stopPropagation();mfOpenEncaissementPopup(event,'${b.id}',${mois},${annee})" title="Encaissement détaillé">•••</span></td>`;
  }

  const etat = sfLoyerEtat(l, mois, annee, loc);
  const cls = { ok: 'mfx-cell--ok', part: 'mfx-cell--part', ko: 'mfx-cell--ko',
                avenir: 'mfx-cell--avenir', none: 'mfx-cell--none' }[etat] || 'mfx-cell--avenir';
  const montant = (etat === 'ok' || etat === 'part')
    ? (parseFloat(l.montant_encaisse) || 0) : (parseFloat(l.loyer_du) || 0);
  const libelle = { ok: 'encaissé', part: 'partiellement encaissé', ko: 'échu, non soldé',
                    avenir: 'à venir', none: 'sans échéance' }[etat] || '';

  return `<td class="mfx-cell ${cls}" data-loyer-id="${l.id}"
    onclick="mfQuickToggleLoyer(this,'${l.id}')"
    oncontextmenu="event.preventDefault();mfOpenEncaissementPopup(event,'${b.id}',${mois},${annee});"
    title="${titreMois} : ${libelle} — clic pour ${etat === 'ok' ? 'annuler le pointage' : 'marquer payé'}">${etat === 'ok' ? `<span class="mfx-cell__ic">${sfAccIcon('check', 11)}</span>` : ''}${fmt(montant)}<span class="mfx-cell__more" onclick="event.stopPropagation();mfOpenEncaissementPopup(event,'${b.id}',${mois},${annee})" title="Encaissement détaillé">•••</span></td>`;
}

/* Une cellule de charge. ⚠️ Le « + » est un VRAI BOUTON, visible au repos.
   Il était à `opacity:0` et ne se révélait qu'au survol de la ligne, alors que
   c'est l'action principale de l'onglet — et un `<td>` nu n'est atteignable ni
   au clavier ni au doigt. */
function mfSuiviCelluleCharge(b, mois, annee) {
  const total = mfSumChargesMonth(b.id, mois, annee);
  const n = mfChargesForBienMonth(b.id, mois, annee).length;
  const titreMois = `${MOIS_LONGS[mois - 1]} ${annee}`;
  if (!n) {
    return `<td class="mfx-cell mfx-cell--charge"><button class="plus"
      onclick="mfOpenChargeModal({bien_id:'${b.id}', mois:${mois}, annee:${annee}})"
      title="Enregistrer une charge en ${titreMois}">+</button></td>`;
  }
  return `<td class="mfx-cell mfx-cell--charge pleine"
    onclick="mfOpenChargesDetail('${b.id}',${mois},${annee})"
    title="${titreMois} : ${n} charge${n > 1 ? 's' : ''} — cliquer pour le détail">${fmt(total)}</td>`;
}

/* Une charge dans la liste détaillée.
   ⚠️ La ligne Cerfa 2044 est le FIL entre cet écran de saisie et la
   « Déclaration fiscale », qui est bâtie sur ces numéros. La maquette l'avait
   perdue ; l'écran en ligne la portait. */
function mfSuiviCharge(ch) {
  const bien  = allBiens.find(b => b.id === ch.bien_id);
  const cerfa = CERFA_MAPPING[ch.categorie] || CERFA_MAPPING['Autre'];
  const date  = ch.date_charge
    ? new Date(ch.date_charge + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const marques = [
    ch.lissable ? 'lissée sur 12 mois' : '',
    ch.recuperable_locataire ? 'récupérable' : '',
    (ch.document && (ch.document.data || ch.document.storage_path)) ? 'justificatif joint' : '',
  ].filter(Boolean);

  return `
    <div class="mfx-charge">
      <span class="mfx-charge__d">${date}</span>
      <span class="mfx-charge__x">
        <span class="mfx-charge__c">${esc(ch.categorie)}</span><span class="mfx-charge__cerfa" title="${esc(cerfa.label)}">L.${cerfa.ligne}</span>
        <span class="mfx-charge__l">${esc(ch.libelle || ch.categorie)}${bien ? ' · ' + esc(bien.titre || 'Bien') : ''}${marques.length ? ' · ' + marques.join(' · ') : ''}</span>
      </span>
      <span class="mfx-charge__tag">${esc(ch.frequence || 'Ponctuelle')}</span>
      <span class="mfx-charge__v">${sfEur(ch.montant)}</span>
      <span class="mfx-charge__a">
        <button class="mfx-ic-btn" title="Modifier cette charge" aria-label="Modifier"
          onclick="mfOpenChargeModal(allCharges.find(x=>x.id==='${ch.id}'))">${sfAccIcon('crayon', 13)}</button>
        <button class="mfx-ic-btn mfx-ic-btn--danger" title="Supprimer cette charge" aria-label="Supprimer"
          onclick="mfDeleteCharge('${ch.id}')">${sfAccIcon('poubelle', 13)}</button>
      </span>
    </div>`;
}

/* Rafraîchit les compteurs d'onglet SANS redessiner la page.
   Pointer un loyer change le nombre de loyers non soldés, donc le badge ambre
   de « Suivi mensuel ». Redessiner tout le bandeau le mettrait à jour mais
   ferait perdre le défilement — sur un écran de saisie où l'on pointe douze
   mois à la suite, c'est inutilisable. */
function mfMajBadges() {
  const n = mfLoyersNonSoldes(mfExercice).length;
  const tab = [...document.querySelectorAll('.mfx-tab')]
    .find(b => (b.getAttribute('onclick') || '').includes("'suivi'"));
  if (!tab) return;
  let badge = tab.querySelector('.mfx-tab__n');
  if (!n) { badge?.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'mfx-tab__n mfx-tab__n--alerte';
    tab.appendChild(badge);
  }
  badge.textContent = n;
}

// ── Actions navigation année / filtre charges ──
function mfSuiviChangeYear(delta) {
  mfSuiviYear += delta;
  const c = document.getElementById('mf-content');
  if(c) renderMfSuivi(c);
    mfMajBadges();
}
function mfSuiviClearFilter() {
  mfSuiviBienFilter = null;
  mfSuiviBienHighlight = null;
  const c = document.getElementById('mf-content');
  if(c) renderMfSuivi(c);
    mfMajBadges();
}
function mfSuiviReturnToBiens() {
  const bienId = mfSuiviPreviousBienId;
  mfSuiviBienFilter = null;
  mfSuiviPreviousBienId = null;
  switchMfTab('portefeuille');
  // Highlight la carte du bien dans Mes biens
  if(bienId) {
    setTimeout(() => {
      // Simple flash : on cible la carte par data-attr (à ajouter dans renderMfBienCard)
      const cards = document.querySelectorAll('.mfb-card');
      cards.forEach(card => {
        if(card.dataset.bienId === bienId) {
          card.scrollIntoView({behavior:'smooth', block:'center'});
          card.style.boxShadow = '0 0 0 3px var(--accent)';
          setTimeout(() => { card.style.boxShadow = ''; }, 1800);
        }
      });
    }, 100);
  }
}
function mfSetChargesFilter(f) {
  mfChargesFilter = f;
  const c = document.getElementById('mf-content');
  if(c) renderMfSuivi(c);
    mfMajBadges();
}

// ── Clic simple sur cellule loyer : toggle rapide Payé/En attente ──
async function mfQuickToggleLoyer(cellEl, loyerId) {
  const l = allLoyers.find(x => x.id === loyerId);
  if(!l) return;

  let newPatch;
  if(l.statut === 'Payé') {
    // Annule : remet en attente
    newPatch = { statut: 'En attente', montant_encaisse: null, date_encaissement: null };
  } else if(l.statut === 'En attente') {
    // Marque payé intégralement (montant prévu)
    const today = new Date().toISOString().slice(0,10);
    newPatch = { statut: 'Payé', montant_encaisse: l.loyer_du, date_encaissement: today };
  } else {
    // Partiel/Impayé/En retard : ouvre le popup pour gestion fine (pas de toggle direct)
    mfOpenEncaissementPopup({clientX: 0, clientY: 0, target: cellEl}, l.bien_id, l.mois, l.annee);
    return;
  }

  try {
    const { data, error } = await db.from('loyers_mensuels')
      .update(newPatch).eq('id', loyerId).eq('user_id', currentUser.id).select().maybeSingle();
    if(error) throw error;
    if(data) {
      Object.assign(l, data);
      cellEl.classList.add('pulse');
      setTimeout(() => cellEl.classList.remove('pulse'), 450);
    }
    const c = document.getElementById('mf-content');
    if(c) renderMfSuivi(c);
    mfMajBadges();
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Génération automatique d'une ligne loyer manquante (clic sur cellule "à générer") ──
async function mfCreateLoyerLine(bienId, locataireId, mois, annee) {
  const loc = allLocataires.find(l => l.id === locataireId);
  if(!loc) return;
  const prorata = mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, mois, annee, loc.date_entree, loc.date_sortie);
  if(prorata.montant === 0) {
    showNotif('Pas d\'occupation ce mois', true);
    return;
  }
  try {
    const { data, error } = await db.from('loyers_mensuels').upsert({
      user_id: currentUser.id,
      bien_id: bienId,
      locataire_id: locataireId,
      mois, annee,
      loyer_du: prorata.montant,
      charges_dues: parseFloat(loc.charges_bail) || 0,
      statut: 'En attente',
      notes: prorata.prorata ? `Prorata loi 1989 : ${prorata.jours}/${prorata.joursMois} jours` : null
    }, { onConflict: 'user_id,bien_id,mois,annee' })
      .select().maybeSingle();
    if(error) throw error;
    if(data) {
      const existing = allLoyers.findIndex(l => l.id === data.id);
      if(existing >= 0) allLoyers[existing] = data; else allLoyers.push(data);
    }
    showNotif('Ligne loyer générée');
    const c = document.getElementById('mf-content');
    if(c) renderMfSuivi(c);
    mfMajBadges();
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Génération massive des loyers manquants pour une année ──
async function mfGenerateMissingLoyers(annee) {
  if(!confirm(`Générer toutes les lignes loyer manquantes pour ${annee} ?\n\n` +
    `Le prorata loi 1989 sera appliqué automatiquement pour les mois d'entrée et de sortie.`)) return;

  let created = 0, skipped = 0;
  const biens = allBiens.filter(b => b.statut === 'Acheté');
  for(const b of biens) {
    for(let m = 1; m <= 12; m++) {
      const loc = mfLocataireForBienMonth(b.id, m, annee);
      if(!loc) { skipped++; continue; }
      const existing = mfFindLoyer(b.id, m, annee);
      if(existing) { skipped++; continue; }

      const prorata = mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, m, annee, loc.date_entree, loc.date_sortie);
      if(prorata.montant === 0) { skipped++; continue; }

      try {
        const { data, error } = await db.from('loyers_mensuels').insert({
          user_id: currentUser.id,
          bien_id: b.id,
          locataire_id: loc.id,
          mois: m, annee,
          loyer_du: prorata.montant,
          charges_dues: parseFloat(loc.charges_bail) || 0,
          statut: 'En attente',
          notes: prorata.prorata ? `Prorata loi 1989 : ${prorata.jours}/${prorata.joursMois} jours` : null
        }).select().maybeSingle();
        if(error) throw error;
        if(data) { allLoyers.push(data); created++; }
      } catch(e) {
        console.error('[mfGenerateMissingLoyers]', b.id, m, e);
      }
    }
  }
  showNotif(`${created} ligne(s) créée(s), ${skipped} déjà présente(s) ou sans locataire`);
  const c = document.getElementById('mf-content');
  if(c) renderMfSuivi(c);
    mfMajBadges();
}

// ── Popup encaissement (clic sur ••• d'une cellule loyer) ──
function mfOpenEncaissementPopup(event, bienId, mois, annee) {
  const l = mfFindLoyer(bienId, mois, annee);
  const loc = mfLocataireForBienMonth(bienId, mois, annee);
  const bien = allBiens.find(b => b.id === bienId);

  // Si pas de ligne loyer, on en crée une virtuelle (montant prorata)
  const prorata = loc ? mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, mois, annee, loc.date_entree, loc.date_sortie) : { montant: 0 };
  const montantDu = l ? parseFloat(l.loyer_du) : prorata.montant;
  const statutActuel = l?.statut || 'En attente';
  const today = new Date().toISOString().slice(0,10);
  const dateEnc = l?.date_encaissement || today;
  const montantEnc = l?.montant_encaisse != null ? l.montant_encaisse : montantDu;
  const notesActuel = l?.notes || '';

  // Backdrop + popup
  let backdrop = document.getElementById('mfs-popup-backdrop');
  if(!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'mfs-popup-backdrop';
    backdrop.className = 'mfs-popup-backdrop';
    backdrop.onclick = () => mfCloseEncaissementPopup();
    document.body.appendChild(backdrop);
  }

  let popup = document.getElementById('mfs-popup');
  if(popup) popup.remove();
  popup = document.createElement('div');
  popup.id = 'mfs-popup';
  popup.className = 'mfs-popup';
  popup.dataset.bienId = bienId;
  popup.dataset.mois = mois;
  popup.dataset.annee = annee;
  popup.dataset.loyerId = l?.id || '';

  // ⚠️ Les identifiants (`enc-montant`, `enc-date`, `enc-notes`,
  // `enc-montant-row`, `enc-date-row`), le nom de groupe `enc-statut` et la
  // classe `.opt` sont le CONTRAT de `mfPopupStatutChange` et de
  // `mfPopupConfirm`. Le style change, le contrat ne bouge pas.
  const opts = [
    ['Payé',      `Payé intégralement — ${sfEur(montantDu)}`],
    ['Partiel',   'Partiel — saisir le montant'],
    ['En retard', 'En retard — toujours dû'],
    ['Impayé',    'Impayé définitif'],
  ];
  popup.classList.add('mfx-popup');
  popup.innerHTML = `
    <div class="mfx-popup__h">
      <span class="mfx-popup__t">Encaissement · ${MOIS_LONGS[mois-1].toLowerCase()} ${annee}</span>
      <button class="mfx-popup__x" onclick="mfCloseEncaissementPopup()" aria-label="Fermer">${sfAccIcon('croix', 15)}</button>
    </div>
    <div class="mfx-popup__b">
      <p class="mfx-prorata">
        ${sfAccIcon('balance', 15)}
        <span>${esc(bien?.titre || 'Bien')} · loyer dû <b>${sfEur(montantDu)}</b>${
          prorata?.prorata ? `. Prorata loi 1989 : ${prorata.jours} jours sur ${prorata.joursMois}.` : '.'}</span>
      </p>
      ${opts.map(([v, lab]) => `
        <label class="mfx-opt opt${statutActuel === v ? ' selected' : ''}">
          <input type="radio" name="enc-statut" value="${v}" ${statutActuel === v ? 'checked' : ''} onchange="mfPopupStatutChange(this)">
          <span class="mfx-opt__r"></span>${lab}
        </label>`).join('')}
      <div class="mfx-champ" id="enc-montant-row" style="${statutActuel === 'Partiel' ? '' : 'display:none'}">
        <label for="enc-montant">Montant encaissé</label>
        <input type="number" id="enc-montant" value="${esc(montantEnc)}" min="0" max="${esc(montantDu)}" step="1" inputmode="numeric">
      </div>
      <div class="mfx-champ" id="enc-date-row" style="${(statutActuel === 'Payé' || statutActuel === 'Partiel') ? '' : 'display:none'}">
        <label for="enc-date">Date d'encaissement</label>
        <input type="date" id="enc-date" value="${esc(dateEnc)}">
      </div>
      <div class="mfx-champ">
        <label for="enc-notes">Notes</label>
        <textarea id="enc-notes" rows="2">${esc(notesActuel || '')}</textarea>
      </div>
      <div class="mfx-popup__a">
        <button class="sf-btn sf-btn--ghost sf-btn--sm" onclick="mfCloseEncaissementPopup()">Annuler</button>
        <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="mfPopupConfirm()">Confirmer</button>
      </div>
    </div>`;
  document.body.appendChild(popup);

  // Positionnement près du clic, borné à la fenêtre.
  // ⚠️ Les dimensions étaient FIGÉES à 380 × 380. Une fenêtre plus large ou plus
  // haute que cette supposition débordait le bas de l'écran sans que personne
  // ne s'en aperçoive — et la mienne fait 420 de large. On MESURE, la mesure ne
  // peut pas se désynchroniser du style.
  const x = event?.clientX || window.innerWidth / 2;
  const y = event?.clientY || window.innerHeight / 2;
  const r = popup.getBoundingClientRect();
  const marge = 10;
  const pw = r.width  || 420;
  const ph = r.height || 380;
  popup.style.left = Math.max(marge, Math.min(x - pw / 2, window.innerWidth  - pw - marge)) + 'px';
  // Sous le clic si la place existe, au-dessus sinon — comme le panneau de
  // `.sf-pick`, qui résout déjà le même problème.
  const dessous = window.innerHeight - y - marge;
  popup.style.top = (dessous < ph && y - ph - marge > 0 ? y - ph - marge : Math.max(marge, Math.min(y + marge, window.innerHeight - ph - marge))) + 'px';

  requestAnimationFrame(() => {
    backdrop.classList.add('open');
    popup.classList.add('open');
  });
}

function mfPopupStatutChange(input) {
  // Met à jour visuel des labels + affiche/cache les bons champs
  const popup = document.getElementById('mfs-popup');
  if(!popup) return;
  popup.querySelectorAll('.opt').forEach(opt => opt.classList.remove('selected'));
  input.closest('.opt').classList.add('selected');

  const statut = input.value;
  const montantRow = document.getElementById('enc-montant-row');
  const dateRow = document.getElementById('enc-date-row');
  montantRow.style.display = statut === 'Partiel' ? '' : 'none';
  dateRow.style.display = (statut === 'Payé' || statut === 'Partiel') ? '' : 'none';
}

function mfCloseEncaissementPopup() {
  const backdrop = document.getElementById('mfs-popup-backdrop');
  const popup = document.getElementById('mfs-popup');
  if(backdrop) backdrop.classList.remove('open');
  if(popup) popup.classList.remove('open');
  setTimeout(() => {
    if(backdrop) backdrop.remove();
    if(popup) popup.remove();
  }, 150);
}

async function mfPopupConfirm() {
  const popup = document.getElementById('mfs-popup');
  if(!popup) return;
  const bienId = popup.dataset.bienId;
  const mois = parseInt(popup.dataset.mois);
  const annee = parseInt(popup.dataset.annee);
  const loyerId = popup.dataset.loyerId;
  const statut = popup.querySelector('input[name="enc-statut"]:checked')?.value;
  if(!statut) { showNotif('Sélectionnez un statut', true); return; }
  const notes = document.getElementById('enc-notes')?.value || null;
  const dateEnc = (statut === 'Payé' || statut === 'Partiel')
    ? (document.getElementById('enc-date')?.value || null)
    : null;

  // Locataire pour récupérer le loyer_du
  const loc = mfLocataireForBienMonth(bienId, mois, annee);
  const prorata = loc ? mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, mois, annee, loc.date_entree, loc.date_sortie) : { montant: 0 };
  let loyerDu = prorata.montant;
  if(loyerId) {
    const l = allLoyers.find(x => x.id === loyerId);
    if(l) loyerDu = parseFloat(l.loyer_du) || 0;
  }

  let montantEnc = null;
  if(statut === 'Payé') montantEnc = loyerDu;
  else if(statut === 'Partiel') {
    const v = parseFloat(document.getElementById('enc-montant')?.value);
    if(!Number.isFinite(v) || v <= 0) { showNotif('Saisir un montant partiel valide', true); return; }
    if(v >= loyerDu) { showNotif('Pour ce montant, utilisez "Payé intégralement"', true); return; }
    montantEnc = v;
  }

  try {
    const payload = {
      user_id: currentUser.id,
      bien_id: bienId,
      locataire_id: loc?.id || null,
      mois, annee,
      loyer_du: loyerDu,
      charges_dues: parseFloat(loc?.charges_bail) || 0,
      statut,
      montant_encaisse: montantEnc,
      date_encaissement: dateEnc,
      notes,
    };
    const { data, error } = await db.from('loyers_mensuels')
      .upsert(payload, { onConflict: 'user_id,bien_id,mois,annee' })
      .select().maybeSingle();
    if(error) throw error;
    if(data) {
      const idx = allLoyers.findIndex(l => l.id === data.id);
      if(idx >= 0) allLoyers[idx] = data; else allLoyers.push(data);
    }
    showNotif('Encaissement enregistré');
    mfCloseEncaissementPopup();
    const c = document.getElementById('mf-content');
    if(c) renderMfSuivi(c);
    mfMajBadges();
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

// ── Modal "Détail charges du mois" (clic sur cellule charges avec montant) ──
function mfOpenChargesDetail(bienId, mois, annee) {
  const bien = allBiens.find(b => b.id === bienId);
  const charges = mfChargesForBienMonth(bienId, mois, annee);
  if(charges.length === 0) return;
  const bienName = (bien?.titre || 'Bien').replace(/</g,'&lt;');
  const titreMois = `${MOIS_LONGS[mois-1]} ${annee}`;

  const html = `
    <div style="padding:12px 16px 8px">
      <div style="font-size:13px;color:var(--c-dim);margin-bottom:14px">
        ${bienName} · ${charges.length} charge${charges.length>1?'s':''} en ${titreMois}
      </div>
      <div>
        ${charges.map(mfSuiviCharge).join('')}
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border)">
        <button class="sf-btn sf-btn--secondary" onclick="closeModal('modal-detail')">Fermer</button>
        <button class="sf-btn sf-btn--primary" onclick="closeModal('modal-detail');mfOpenChargeModal({bien_id:'${bienId}', mois:${mois}, annee:${annee}})">＋ Ajouter une charge</button>
      </div>
    </div>
  `;
  // Pas d'emoji dans les titres de fenetre — voir bdRenderMiseEnGestion.
  document.getElementById('detail-titre').textContent = `Charges – ${titreMois}`;
  document.getElementById('detail-content').innerHTML = html;
  openModal('modal-detail');
}

// ── Modal Ajout/Édition Charge ──
function mfOpenChargeModal(preset) {
  const isEdit = preset && preset.id;
  // Préset depuis "+" sur une cellule mois : juste bien_id + date au 15 du mois
  let initial = {};
  if(preset && !preset.id) {
    initial.bien_id = preset.bien_id || '';
    if(preset.mois && preset.annee) {
      initial.date_charge = `${preset.annee}-${String(preset.mois).padStart(2,'0')}-15`;
    }
  } else if(isEdit) {
    initial = preset;
  }

  const biens = allBiens.filter(b => b.statut === 'Acheté' || b.statut === 'Compromis signé');
  const today = initial.date_charge || new Date().toISOString().slice(0,10);

  const html = `
    <div style="padding:14px 16px">
      <div class="mfs-charge-modal-grid">
        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Bien associé *</label>
          <select class="form-select" id="charge-bien" required>
            <option value="">— Sélectionnez —</option>
            ${biens.map(b => `<option value="${b.id}" ${(initial.bien_id===b.id)?'selected':''}>${(b.titre||'').replace(/</g,'&lt;')} — ${b.ville||''}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Catégorie *</label>
          <select class="form-select" id="charge-categorie" required onchange="mfUpdateCerfaInfo()">
            <option value="">— Sélectionnez —</option>
            ${Object.keys(CERFA_MAPPING).map(cat => `<option value="${cat}" ${(initial.categorie===cat)?'selected':''}>${cat}</option>`).join('')}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Date de paiement *</label>
          <input type="date" class="form-input" id="charge-date" value="${today}" required>
        </div>

        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Libellé / Description</label>
          <input type="text" class="form-input" id="charge-libelle" value="${(initial.libelle||'').replace(/"/g,'&quot;')}" placeholder="Ex : Provision charges T1 2026">
        </div>

        <div class="form-group">
          <label class="form-label">Montant (€) *</label>
          <input type="number" class="form-input" id="charge-montant" value="${esc(initial.montant || '')}" min="0" step="0.01" required>
        </div>

        <div class="form-group">
          <label class="form-label">Fréquence</label>
          <select class="form-select" id="charge-frequence">
            <option value="Ponctuelle"    ${(initial.frequence==='Ponctuelle'||!initial.frequence)?'selected':''}>Ponctuelle</option>
            <option value="Mensuelle"     ${initial.frequence==='Mensuelle'?'selected':''}>Mensuelle</option>
            <option value="Trimestrielle" ${initial.frequence==='Trimestrielle'?'selected':''}>Trimestrielle</option>
            <option value="Annuelle"      ${initial.frequence==='Annuelle'?'selected':''}>Annuelle</option>
          </select>
        </div>

        <div class="form-group" style="grid-column:1/-1">
          <div class="mfs-toggle-row">
            <div>
              <label for="charge-lissable">📊 Lisser sur 12 mois (pour cashflow réel)</label>
              <div class="sub">Recommandé pour taxe foncière, assurance annuelle (charge divisée sur l'année dans les KPI)</div>
            </div>
            <input type="checkbox" id="charge-lissable" ${initial.lissable?'checked':''}>
          </div>
        </div>

        <div class="form-group" style="grid-column:1/-1">
          <div class="mfs-toggle-row">
            <div>
              <label for="charge-recuperable">↪️ Récupérable sur le locataire</label>
              <div class="sub">Cette dépense est refacturée au locataire (ex : TEOM, certaines charges copro)</div>
            </div>
            <input type="checkbox" id="charge-recuperable" ${initial.recuperable_locataire?'checked':''}>
          </div>
        </div>

        <div class="form-group" style="grid-column:1/-1">
          <label class="form-label">Notes (optionnel)</label>
          <textarea class="form-input" id="charge-notes" rows="2" style="resize:vertical;font-family:inherit">${esc(initial.notes||'')}</textarea>
        </div>

        <div id="charge-cerfa-info" style="grid-column:1/-1"></div>
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:18px;padding-top:14px;border-top:1px solid var(--c-border);gap:10px;flex-wrap:wrap">
        <div style="font-size:11px;color:var(--c-muted);font-style:italic">💡 Les charges sont mappées automatiquement à la déclaration fiscale Cerfa 2044 (régime réel locations nues)</div>
        <div style="display:flex;gap:6px">
          <button class="sf-btn sf-btn--secondary" onclick="closeModal('modal-detail')">Annuler</button>
          <button class="sf-btn sf-btn--primary" onclick="mfSaveCharge('${isEdit ? initial.id : ''}')">${isEdit?sfAccIcon('check',14)+' Enregistrer':'＋ Ajouter la charge'}</button>
        </div>
      </div>
    </div>
  `;
  document.getElementById('detail-titre').textContent = isEdit ? 'Modifier la charge' : 'Ajouter une charge réelle';
  document.getElementById('detail-content').innerHTML = html;
  openModal('modal-detail');
  setTimeout(() => mfUpdateCerfaInfo(), 50);
}

function mfUpdateCerfaInfo() {
  const sel = document.getElementById('charge-categorie');
  const info = document.getElementById('charge-cerfa-info');
  if(!sel || !info) return;
  const cat = sel.value;
  if(!cat || !CERFA_MAPPING[cat]) { info.innerHTML = ''; return; }
  const m = CERFA_MAPPING[cat];
  info.innerHTML = `
    <div class="mfs-cerfa-info">
      <span class="ico">📋</span>
      <span>
        <strong>${m.label}</strong> — déclaration fiscale Cerfa 2044 (régime réel)
        ${m.attention ? `<br><strong>⚠️ Attention :</strong> ${m.attention}` : ''}
      </span>
    </div>
  `;
}

async function mfSaveCharge(chargeId) {
  const bienId = document.getElementById('charge-bien')?.value;
  const cat = document.getElementById('charge-categorie')?.value;
  const date = document.getElementById('charge-date')?.value;
  const libelle = document.getElementById('charge-libelle')?.value?.trim() || null;
  const montant = parseFloat(document.getElementById('charge-montant')?.value);
  const frequence = document.getElementById('charge-frequence')?.value || 'Ponctuelle';
  const lissable = document.getElementById('charge-lissable')?.checked || false;
  const recuperable = document.getElementById('charge-recuperable')?.checked || false;
  const notes = document.getElementById('charge-notes')?.value?.trim() || null;

  if(!bienId)   { showNotif('Sélectionnez un bien', true); return; }
  if(!cat)      { showNotif('Sélectionnez une catégorie', true); return; }
  if(!date)     { showNotif('Sélectionnez une date', true); return; }
  if(!Number.isFinite(montant) || montant <= 0) { showNotif('Saisir un montant valide', true); return; }

  const payload = {
    user_id: currentUser.id,
    bien_id: bienId,
    categorie: cat,
    libelle, date_charge: date, montant,
    frequence, lissable,
    recuperable_locataire: recuperable,
    notes,
  };

  try {
    let res;
    if(chargeId) {
      res = await db.from('charges_reelles').update(payload).eq('id', chargeId).eq('user_id', currentUser.id).select().maybeSingle();
    } else {
      res = await db.from('charges_reelles').insert(payload).select().maybeSingle();
    }
    if(res.error) throw res.error;
    if(res.data) {
      const idx = allCharges.findIndex(c => c.id === res.data.id);
      if(idx >= 0) allCharges[idx] = res.data; else allCharges.push(res.data);
    }
    showNotif(chargeId ? '✅ Charge mise à jour' : '✅ Charge ajoutée');
    closeModal('modal-detail');
    const c = document.getElementById('mf-content');
    if(c) renderMfSuivi(c);
    mfMajBadges();
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

async function mfDeleteCharge(chargeId) {
  if(!confirm('Supprimer cette charge ?')) return;
  try {
    const { error } = await db.from('charges_reelles').delete().eq('id', chargeId).eq('user_id', currentUser.id);
    if(error) throw error;
    allCharges = allCharges.filter(c => c.id !== chargeId);
    showNotif('Charge supprimée');
    const c = document.getElementById('mf-content');
    if(c) renderMfSuivi(c);
    mfMajBadges();
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}
/* ═══════════════════════════════════════════════════════════════════════════
   LOCATAIRES — annuaire, à réclamer, prochaines échéances
   ⚠️ Les QUATRE indicateurs (Locataires · Actifs · Candidats · Loyer mensuel
   actif) et les FILTRES PAR STATUT AVEC LEUR COMPTEUR sont des régressions
   relevées au comparatif (R-16 et R-08) : ils sont préservés. Les indicateurs
   ne reprennent pas la forme du bandeau — quatre grandes cartes de plus sous
   quatre grandes cartes seraient illisibles ; ils tiennent dans l'en-tête de
   l'annuaire, là où ils qualifient ce qu'on regarde.
   ═══════════════════════════════════════════════════════════════════════════ */

function renderMfLocataires(c) {
  const annee = mfExercice;
  const cnt = { all: allLocataires.length };
  LOC_STATUTS.forEach(s => cnt[s] = allLocataires.filter(l => l.statut === s).length);
  if (mfLocataireFilter !== 'all' && !LOC_STATUTS.includes(mfLocataireFilter)) mfLocataireFilter = 'all';
  const liste = mfLocataireFilter === 'all'
    ? allLocataires : allLocataires.filter(l => l.statut === mfLocataireFilter);

  const loyerActif = allLocataires.filter(l => l.statut === 'Actif')
    .reduce((s, l) => s + (parseFloat(l.loyer_bail_hc) || 0) + (parseFloat(l.charges_bail) || 0), 0);

  // ── À réclamer : les loyers échus non soldés, regroupés par locataire ──
  const impayes = mfLoyersNonSoldes(annee);
  const parLoc = new Map();
  for (const x of impayes) {
    const cle = x.locataire?.id || 'sans';
    const e = parLoc.get(cle) || { loc: x.locataire, bien: x.bien, mois: [], total: 0 };
    e.mois.push(x.mois); e.total += x.reste;
    parLoc.set(cle, e);
  }
  const aReclamer = [...parLoc.values()].sort((a, b) => b.total - a.total);

  // ── Prochaines échéances : les loyers à venir des trois prochains mois ──
  const auj = new Date(); auj.setHours(0, 0, 0, 0);
  const horizon = new Date(auj.getFullYear(), auj.getMonth() + 3, auj.getDate());
  const echeances = [];
  for (const l of allLoyers) {
    if (l.annee !== annee) continue;
    const loc = allLocataires.find(x => x.id === l.locataire_id);
    if (sfLoyerEtat(l, l.mois, annee, loc) !== 'avenir') continue;
    const jour = Math.min(Math.max(parseInt(loc?.jour_paiement, 10) || 5, 1), 28);
    const d = new Date(annee, l.mois - 1, jour);
    if (d < auj || d > horizon) continue;
    echeances.push({ d, loc, bien: allBiens.find(b => b.id === l.bien_id),
                     montant: (parseFloat(l.loyer_du) || 0) + (parseFloat(l.charges_dues) || 0) });
  }
  echeances.sort((a, b) => a.d - b.d);

  c.innerHTML = `
    ${aReclamer.length ? `
    <div class="mfx-relance">
      ${sfAccIcon('alerte', 18)}
      <div>
        <div class="mfx-relance__t"><b>${sfNombreEnLettres(impayes.length, true)} loyer${impayes.length > 1 ? 's' : ''} échu${impayes.length > 1 ? 's' : ''} ${impayes.length > 1 ? 'restent' : 'reste'} à encaisser</b> — ${sfEur(aReclamer.reduce((s, x) => s + x.total, 0))}</div>
        <div class="mfx-relance__s">${aReclamer.map(x => `${esc([x.loc?.prenom, x.loc?.nom].filter(Boolean).join(' ') || 'Locataire inconnu')} · ${x.mois.map(m => MOIS_LONGS[m - 1].toLowerCase()).join(', ')}`).join(' — ')}</div>
      </div>
      <span style="margin-left:auto">
        <button class="sf-btn sf-btn--secondary sf-btn--sm" onclick="switchMfTab('suivi')">Ouvrir le suivi mensuel</button>
      </span>
    </div>` : ''}

    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Annuaire</p>
        <span class="sff-block__n">${cnt.all} locataire${cnt.all > 1 ? 's' : ''} · ${cnt['Actif']} actif${cnt['Actif'] > 1 ? 's' : ''} · ${cnt['Candidat']} candidat${cnt['Candidat'] > 1 ? 's' : ''} · ${sfEur(loyerActif)} de loyer mensuel actif</span>
        <span class="sff-block__a">
          <button class="sf-btn sf-btn--primary sf-btn--sm" onclick="openLocataireModal(null)">${sfAccIcon('plus', 15)} Nouveau locataire</button>
        </span>
      </div>
      <div class="sff-block__b">
        <div class="mfx-pills" style="margin-bottom:var(--sf-space-6)">
          <button class="mfx-pill" aria-pressed="${mfLocataireFilter === 'all'}" onclick="setMfLocFilter('all')">Tous <span class="mfx-pill__n">${cnt.all}</span></button>
          ${/* ⚠️ « Préavis » finit déjà par un s : un pluriel aveugle écrivait
                « Préaviss ». Le libellé vient de LOC_STATUTS, jamais réécrit. */''}
          ${LOC_STATUTS.map(s => `<button class="mfx-pill" aria-pressed="${mfLocataireFilter === s}" onclick="setMfLocFilter('${s}')">${esc(s)}${s.endsWith('s') ? '' : 's'} <span class="mfx-pill__n">${cnt[s] || 0}</span></button>`).join('')}
        </div>
        ${liste.length ? `<div class="mfx-loccards">${liste.map(mfCarteLocataire).join('')}</div>` : `
        <div class="sff-empty">
          <div class="sff-empty__ic">${sfAccIcon('gens', 34)}</div>
          <div class="sff-empty__t">${allLocataires.length ? 'Aucun locataire avec ce filtre' : 'Aucun locataire'}</div>
          <div class="sff-empty__x">${allLocataires.length
            ? `Aucun de vos ${allLocataires.length} locataires n'est au statut « ${esc(mfLocataireFilter)} ».`
            : "Un locataire porte le bail : loyer hors charges, date d'entrée et jour de paiement. C'est de lui que découlent les loyers du suivi mensuel."}</div>
          <button class="sf-btn sf-btn--${allLocataires.length ? 'secondary' : 'primary'} sf-btn--sm" onclick="${allLocataires.length ? "setMfLocFilter('all')" : 'openLocataireModal(null)'}">${allLocataires.length ? 'Voir tous les locataires' : 'Créer un locataire'}</button>
        </div>`}
      </div>
    </div>

    ${echeances.length ? `
    <div class="sff-block">
      <div class="sff-block__h">
        <p class="sff-block__t">Prochaines échéances</p>
        <span class="sff-block__n">trois mois à venir</span>
      </div>
      <div class="sff-block__b">
        ${echeances.map(e => `
          <div class="mfx-ech">
            <span class="mfx-ech__d">${e.d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}</span>
            <span class="mfx-ech__l">${esc([e.loc?.prenom, e.loc?.nom].filter(Boolean).join(' ') || 'Locataire')}${e.bien ? ` <em>· ${esc(e.bien.titre || 'Bien')}</em>` : ''}</span>
            <span class="mfx-ech__v">${sfEur(e.montant)}</span>
          </div>`).join('')}
      </div>
    </div>` : ''}`;
}

function mfCarteLocataire(l) {
  const initiales = ((l.prenom?.[0] || '') + (l.nom?.[0] || '') || (l.nom || '??').substring(0, 2)).toUpperCase();
  const nom  = [l.prenom, l.nom].filter(Boolean).join(' ') || 'Sans nom';
  const bien = l.bien_id ? allBiens.find(b => b.id === l.bien_id) : null;
  const entree = l.date_entree ? new Date(l.date_entree).toLocaleDateString('fr-FR') : null;
  const sortie = l.date_sortie ? new Date(l.date_sortie).toLocaleDateString('fr-FR') : null;
  const docs = (l.documents || []).length;
  // ⚠️ `.sf-pill` nu = la variante neutre. Les seules déclarées dans
  // components.css sont --alert, --brand, --gain, --info et --loss : inventer
  // un `--muted` aurait donné une pastille sans style, donc invisible.
  const pill = { 'Actif': 'sf-pill--gain', 'Candidat': 'sf-pill--brand',
                 'Préavis': 'sf-pill--alert', 'Sorti': '' }[l.statut] ?? '';

  return `
    <article class="mfx-loccard" onclick="openLocataireModal('${l.id}')">
      <span class="mfx-loccard__st"><span class="sf-pill ${pill}">${esc(l.statut || 'Candidat')}</span></span>
      <div class="mfx-loccard__h">
        <div class="mfx-loccard__av">${esc(initiales)}</div>
        <div style="min-width:0">
          <div class="mfx-loccard__n">${esc(nom)}</div>
          <div class="mfx-loccard__c">${esc(l.email || l.telephone || 'Aucun contact')}</div>
        </div>
      </div>
      <div class="mfx-li">${sfAccIcon('maison', 15)}${bien
        ? `${esc(bien.titre || 'Bien')}${bien.ville ? ` <em>· ${esc(bien.ville)}</em>` : ''}`
        : '<em>Aucun bien rattaché</em>'}</div>
      ${(parseFloat(l.loyer_bail_hc) || 0) > 0 ? `
      <div class="mfx-li">${sfAccIcon('euro', 15)}${sfEur(l.loyer_bail_hc)} <em>par mois hors charges${(parseFloat(l.depot_garantie) || 0) > 0 ? ` · dépôt ${sfEur(l.depot_garantie)}` : ''}</em></div>` : ''}
      <div class="mfx-li">${sfAccIcon('agenda', 15)}${entree || '—'}${sortie ? ` <em>→ ${sortie}</em>` : (l.statut === 'Actif' ? ' <em>· en cours</em>' : '')}</div>
      ${docs ? `<div class="mfx-li">${sfAccIcon('trombone', 15)}${docs} <em>document${docs > 1 ? 's' : ''}</em></div>` : ''}
    </article>`;
}
function setMfLocFilter(f) {
  mfLocataireFilter = f;
  const c = document.getElementById('mf-content');
  if(c) renderMfLocataires(c);
}
// ═════════════════════════════════════════════════════
//  RENTABILITÉ — analyse par bien, année civile (Étape 6)
// ═════════════════════════════════════════════════════

/* « Rentabilite » a fusionne dans « Performance » : renderMfRenta, mfRentaRefresh, mfRentaSetBien et mfRentaChangeYear sont supprimes. Leur seul appelant vivant, mfBilanFeedSaveBiens, redessine desormais l'onglet courant. */

function initMfRentaCharts(serieReel, cfPrevMensuel, serieCumulReel, serieCumulPrev) {
  if(typeof Chart === 'undefined') return;
  const euroTip = {
    backgroundColor: 'rgba(15,23,42,0.95)', titleFont: { size: 11 },
    bodyFont: { size: 12, weight: 'bold' }, padding: 8, cornerRadius: 6,
    callbacks: { label: (ctx) => (ctx.dataset.label ? ctx.dataset.label + ' : ' : '')
      + (ctx.parsed.y >= 0 ? '+' : '') + Math.round(ctx.parsed.y).toLocaleString('fr-FR') + ' €' }
  };
  const euroAxis = { ticks: { font: { size: 10 }, callback: v => Math.round(v).toLocaleString('fr-FR') + ' €' },
    grid: { color: sfToken('--sf-chart-grid','rgba(234,240,236,.07)') } };

  const cvM = document.getElementById('mfr-chart-mensuel');
  if(cvM) {
    try {
      mfbCharts['renta-mensuel'] = new Chart(cvM, {
        type: 'bar',
        data: { labels: MOIS_LABELS, datasets: [
          { label: 'Réel', data: serieReel,
            backgroundColor: serieReel.map(v => (v ?? 0) >= 0 ? 'rgba(22,163,74,0.75)' : 'rgba(220,38,38,0.75)'),
            borderRadius: 4, maxBarThickness: 24, order: 2 },
          { label: 'Prévisionnel', type: 'line', data: Array(12).fill(Math.round(cfPrevMensuel)),
            borderColor: sfToken('--accent','#17A06B'), borderWidth: 2, borderDash: [6, 4],
            pointRadius: 0, pointHoverRadius: 3, fill: false, order: 1 },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: euroTip },
          scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: euroAxis }
        }
      });
    } catch(e) { console.warn('[mfr] Erreur chart mensuel', e); }
  }

  const cvC = document.getElementById('mfr-chart-cumul');
  if(cvC) {
    // Couleur de base = signe du dernier cumul connu, pour que la pastille de
    // légende corresponde à la couleur réellement affichée en fin de trajectoire
    const dernierCumul = [...serieCumulReel].reverse().find(v => v != null) ?? 0;
    const couleurCumul = dernierCumul < 0 ? sfToken('--sf-loss','#FF7A6B') : sfToken('--sf-gain','#4ADE80');
    try {
      mfbCharts['renta-cumul'] = new Chart(cvC, {
        type: 'line',
        data: { labels: MOIS_LABELS, datasets: [
          // Le cumul change de couleur selon son signe : vert au-dessus de zéro,
          // rouge en dessous (sinon une trajectoire déficitaire s'affiche en vert)
          { label: 'Cumul réel', data: serieCumulReel,
            borderColor: couleurCumul,
            segment: { borderColor: ctx => ((ctx.p0.parsed.y < 0 || ctx.p1.parsed.y < 0) ? sfToken('--sf-loss','#FF7A6B') : sfToken('--sf-gain','#4ADE80')) },
            fill: { target: 'origin', above: 'rgba(22,163,74,0.10)', below: 'rgba(220,38,38,0.08)' },
            borderWidth: 2.5, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
          { label: 'Cumul prévisionnel', data: serieCumulPrev,
            borderColor: sfToken('--accent','#17A06B'), borderWidth: 2, borderDash: [6, 4],
            fill: false, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
        ]},
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { intersect: false, mode: 'index' },
          plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } }, tooltip: euroTip },
          scales: { x: { grid: { display: false }, ticks: { font: { size: 10 } } }, y: euroAxis }
        }
      });
    } catch(e) { console.warn('[mfr] Erreur chart cumul', e); }
  }
}

// ═════════════════════════════════════════════════════
//  ALIMENTATION DU BILAN SCI (IR + IS) — depuis les données réelles
// ═════════════════════════════════════════════════════
// Libellés des lignes Cerfa 2044 utilisées par CERFA_MAPPING
const CERFA_LIGNE_LABELS = {
  '221': 'Frais d\'administration et de gestion',
  '222': 'Autres frais de gestion',
  '223': 'Primes d\'assurance',
  '224': 'Réparation, entretien, amélioration',
  '227': 'Taxes foncières et annexes',
  '229': 'Provisions pour charges de copropriété',
  '250': 'Intérêts d\'emprunt',
};

let bilanFeedCtx = null;

async function mfOpenBilanFeedModal(focusAttach) {
  // L'exercice vient du sélecteur UNIQUE du module, plus d'un compteur d'année
  // propre à l'ancien onglet Rentabilité. Le bien présélectionné vient du
  // périmètre de Performance, qui a remplacé ce même onglet.
  const annee = mfExercice;
  const bienSel = allBiens.find(b => b.id === mfPerfBienId);
  document.getElementById('detail-titre').textContent = `Alimenter le bilan SCI — Exercice ${annee}`;
  document.getElementById('detail-content').innerHTML = '<div class="loading" style="padding:30px"><div class="spinner"></div>Chargement…</div>';
  openModal('modal-detail');
  try {
    const [scisRes, bilansRes] = await Promise.all([
      db.from('sci').select('id,nom_sci').eq('user_id', currentUser.id).order('nom_sci'),
      db.from('bilans_comptables').select('*').eq('user_id', currentUser.id).eq('exercice', annee),
    ]);
    if(scisRes.error) throw scisRes.error;
    if(bilansRes.error) throw bilansRes.error;
    const scis = scisRes.data || [];
    if(!scis.length) {
      document.getElementById('detail-content').innerHTML = `
        <div style="padding:24px;text-align:center">
          <div style="font-size:40px;margin-bottom:10px">🏛️</div>
          <div style="font-size:15px;font-weight:700;margin-bottom:6px">Aucune SCI créée</div>
          <div style="font-size:13px;color:var(--c-muted)">Créez d'abord votre SCI dans <strong>Administration › SCI</strong>, puis associez-lui vos biens.</div>
        </div>`;
      return;
    }
    const defaultSci = scis.find(s => s.id === bienSel?.sci_id)?.id || scis[0].id;
    bilanFeedCtx = { annee, scis, bilans: bilansRes.data || [], sciId: defaultSci, regime: null, showAttach: !!focusAttach };
    mfBilanFeedRender();
  } catch(e) {
    document.getElementById('detail-content').innerHTML =
      `<div style="padding:24px;color:var(--negative);font-size:13px">Erreur de chargement : ${esc(e.message || 'inconnue')}</div>`;
  }
}

// Agrégats de l'exercice pour les biens d'une SCI (comptabilité de trésorerie :
// loyers ENCAISSÉS, charges PAYÉES dans l'année, montants réels non lissés,
// charges récupérables sur le locataire exclues)
function mfBilanFeedCompute(biens, annee) {
  const ids = new Set(biens.map(b => b.id));
  let loyers = 0;
  for(const l of allLoyers) {
    if(l.annee === annee && ids.has(l.bien_id) && (l.statut === 'Payé' || l.statut === 'Partiel'))
      loyers += parseFloat(l.montant_encaisse) || 0;
  }
  const parLigne = {}, parPcg = {};
  let chargesTotal = 0, recuperablesExclues = 0;
  for(const ch of allCharges) {
    if(!ids.has(ch.bien_id)) continue;
    if(new Date(ch.date_charge).getFullYear() !== annee) continue;
    const m = parseFloat(ch.montant) || 0;
    if(ch.recuperable_locataire) { recuperablesExclues += m; continue; }
    chargesTotal += m;
    const ligne = (CERFA_MAPPING[ch.categorie] || CERFA_MAPPING['Autre']).ligne;
    parLigne[ligne] = (parLigne[ligne] || 0) + m;
    const pcg = CAT_TO_PCG[ch.categorie] || 'autres';
    parPcg[pcg] = (parPcg[pcg] || 0) + m;
  }
  return { loyers, chargesTotal, recuperablesExclues, parLigne, parPcg, bienIds: [...ids] };
}

function mfBilanFeedRender() {
  const ctx = bilanFeedCtx;
  const { annee, scis } = ctx;
  const bilan = ctx.bilans.find(b => b.sci_id === ctx.sciId) || null;
  const regime = bilan ? bilan.regime : (ctx.regime || 'IR');
  ctx.regime = regime;
  const biensSci = allBiens.filter(b => b.statut === 'Acheté' && b.sci_id === ctx.sciId);
  const d = mfBilanFeedCompute(biensSci, annee);
  ctx.computed = d;
  const dotations = bilan ? bilanDotations(bilan) : { immeuble: 0, travaux: 0, mobilier: 0 };

  const sciSelect = `
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">SCI</label>
      <select class="form-select" onchange="bilanFeedCtx.sciId=this.value;bilanFeedCtx.regime=null;mfBilanFeedRender()">
        ${scis.map(s => `<option value="${s.id}" ${s.id === ctx.sciId ? 'selected' : ''}>${esc(s.nom_sci)}</option>`).join('')}
      </select>
    </div>`;

  // ── Rattachement rapide bien ↔ SCI (évite de passer par l'édition complète du bien) ──
  const biensAcquis = allBiens.filter(b => b.statut === 'Acheté');
  const attachOpen = ctx.showAttach || biensSci.length === 0;
  const attachHtml = `
    <div class="bf-attach">
      <button class="bf-attach-toggle" onclick="bilanFeedCtx.showAttach=${attachOpen ? 'false' : 'true'};mfBilanFeedRender()">
        <span>🏛️ Biens rattachés à cette SCI · <strong>${biensSci.length}</strong></span>
        <span class="chev">${attachOpen ? '▲' : '▼'}</span>
      </button>
      ${attachOpen ? `
        <div class="bf-attach-body">
          ${biensAcquis.length === 0
            ? `<div class="bf-attach-empty">Aucun bien au statut « Acheté » à rattacher.</div>`
            : biensAcquis.map(b => {
                const autre = (b.sci_id && b.sci_id !== ctx.sciId) ? scis.find(s => s.id === b.sci_id) : null;
                return `
                <label class="bf-bien-row">
                  <input type="checkbox" class="bf-bien-check" data-bien-id="${b.id}" ${b.sci_id === ctx.sciId ? 'checked' : ''}>
                  <span class="bf-bien-name">${esc(b.titre || 'Sans titre')}${b.ville ? `<span class="ville">${esc(b.ville)}</span>` : ''}</span>
                  ${autre ? `<span class="bf-bien-tag">rattaché à ${esc(autre.nom_sci)}</span>` : ''}
                </label>`;
              }).join('')}
          ${biensAcquis.length ? `<button class="sf-btn sf-btn--secondary sf-btn--sm" style="margin-top:10px" onclick="mfBilanFeedSaveBiens()">💾 Enregistrer les rattachements</button>` : ''}
        </div>` : ''}
    </div>`;

  const regimeHtml = bilan ? `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;font-size:12.5px">
      <span>Bilan ${annee} existant :</span>
      <span class="bilan-badge ${regime.toLowerCase()}">${regime}</span>
      <span style="color:var(--c-muted)">· statut ${esc(bilan.statut || 'Brouillon')}</span>
    </div>
    ${bilanEstAlimente(bilan) ? `<div class="bilanfeed-warn">⚠️ Ce bilan contient déjà des données : l'écriture les remplacera.</div>` : ''}` : `
    <div class="form-group" style="margin-bottom:12px">
      <label class="form-label">Régime fiscal (le bilan ${annee} sera créé en Brouillon)</label>
      <div style="display:flex;gap:14px;font-size:13px;margin-top:4px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="bf-regime" value="IR" ${regime === 'IR' ? 'checked' : ''} onchange="bilanFeedCtx.regime='IR';mfBilanFeedRender()"> <span class="bilan-badge ir">IR</span> Déclaration 2044</label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer"><input type="radio" name="bf-regime" value="IS" ${regime === 'IS' ? 'checked' : ''} onchange="bilanFeedCtx.regime='IS';mfBilanFeedRender()"> <span class="bilan-badge is">IS</span> Compte de résultat PCG</label>
      </div>
    </div>`;

  let apercuHtml;
  if(!biensSci.length) {
    apercuHtml = `
      <div class="bilanfeed-warn" style="margin-top:4px">
        🏷️ Aucun bien acquis n'est rattaché à cette SCI.<br>
        <span style="font-weight:400">Cochez les biens concernés ci-dessus, puis enregistrez : l'aperçu se calculera aussitôt.</span>
      </div>`;
  } else if(regime === 'IR') {
    const lignesTriees = Object.keys(d.parLigne).sort();
    apercuHtml = `
      <div class="bilanfeed-src">📦 Sources : ${biensSci.length} bien${biensSci.length > 1 ? 's' : ''} · loyers encaissés et charges payées en ${annee}${d.recuperablesExclues > 0 ? ` · ${fmt(d.recuperablesExclues)} € de charges récupérables exclues` : ''}</div>
      <div class="bilan-resume-row"><span>Loyers perçus (encaissés)</span><span>${fmt(d.loyers)} €</span></div>
      ${lignesTriees.map(l => `<div class="bilan-resume-row sub"><span>L.${l} — ${CERFA_LIGNE_LABELS[l] || 'Autres'}</span><span>−${fmt(d.parLigne[l])} €</span></div>`).join('')}
      ${lignesTriees.length === 0 ? `<div class="bilan-resume-row sub"><span>Charges déductibles</span><span>0 €</span></div>` : ''}
      <div class="bilan-resume-row total"><span>Résultat foncier estimé</span><span id="bf-resultat" style="color:${(d.loyers - d.chargesTotal) >= 0 ? 'var(--positive)' : 'var(--negative)'}">${(d.loyers - d.chargesTotal) >= 0 ? '+' : ''}${fmt(d.loyers - d.chargesTotal)} €</span></div>`;
  } else {
    const pcgTries = Object.keys(d.parPcg).sort((a, b) => (PCG_CR_LABELS.charges[a] || '').localeCompare(PCG_CR_LABELS.charges[b] || ''));
    apercuHtml = `
      <div class="bilanfeed-src">📦 Sources : ${biensSci.length} bien${biensSci.length > 1 ? 's' : ''} · trésorerie ${annee}${d.recuperablesExclues > 0 ? ` · ${fmt(d.recuperablesExclues)} € de charges récupérables exclues` : ''}</div>
      <div class="bilan-resume-row"><span>${PCG_CR_LABELS.produits.loyers}</span><span>${fmt(d.loyers)} €</span></div>
      ${pcgTries.map(k => `<div class="bilan-resume-row sub"><span>${PCG_CR_LABELS.charges[k] || k}</span><span>−${fmt(d.parPcg[k])} €</span></div>`).join('')}
      <div style="font-size:11px;font-weight:700;color:var(--c-muted);margin:10px 0 4px">DOTATIONS AUX AMORTISSEMENTS (6811) — à saisir</div>
      <div class="bilanfeed-dot-grid">
        <div><label>Immeuble</label><input type="number" class="form-input" id="bf-am-imm" value="${esc(dotations.immeuble || '')}" min="0" step="0.01" placeholder="0" oninput="mfBilanFeedResultat()"></div>
        <div><label>Travaux</label><input type="number" class="form-input" id="bf-am-trav" value="${esc(dotations.travaux || '')}" min="0" step="0.01" placeholder="0" oninput="mfBilanFeedResultat()"></div>
        <div><label>Mobilier</label><input type="number" class="form-input" id="bf-am-mob" value="${esc(dotations.mobilier || '')}" min="0" step="0.01" placeholder="0" oninput="mfBilanFeedResultat()"></div>
      </div>
      <div class="bilan-resume-row total"><span>Résultat net estimé</span><span id="bf-resultat"></span></div>`;
  }

  document.getElementById('detail-content').innerHTML = `
    <div style="padding:12px 16px 8px">
      ${sciSelect}
      ${attachHtml}
      ${regimeHtml}
      ${apercuHtml}
      <div style="font-size:11px;color:var(--c-dim);margin-top:12px;line-height:1.5">
        ⚖️ Comptabilité de trésorerie : loyers effectivement encaissés et charges payées sur l'exercice, montants non lissés.
        Faites valider par un expert-comptable avant tout dépôt officiel.
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;padding-top:14px;border-top:1px solid var(--c-border)">
        <button class="sf-btn sf-btn--secondary" onclick="closeModal('modal-detail')">Annuler</button>
        <button class="sf-btn sf-btn--primary" id="bf-write" onclick="mfBilanFeedWrite()" ${!biensSci.length ? 'disabled' : ''}>✍️ Écrire dans le bilan ${annee}</button>
      </div>
    </div>`;

  if(regime === 'IS' && biensSci.length) mfBilanFeedResultat();
}

// Résultat net estimé IS, recalculé quand les dotations changent
function mfBilanFeedResultat() {
  const el = document.getElementById('bf-resultat');
  const d = bilanFeedCtx?.computed;
  if(!el || !d) return;
  const dot = (parseFloat(document.getElementById('bf-am-imm')?.value) || 0)
            + (parseFloat(document.getElementById('bf-am-trav')?.value) || 0)
            + (parseFloat(document.getElementById('bf-am-mob')?.value) || 0);
  const r = d.loyers - d.chargesTotal - dot;
  el.textContent = (r >= 0 ? '+' : '') + fmt(r) + ' €';
  el.style.color = r >= 0 ? 'var(--positive)' : 'var(--negative)';
}

// Enregistre les cases cochées : rattache / détache les biens de la SCI courante
async function mfBilanFeedSaveBiens() {
  const ctx = bilanFeedCtx;
  if(!ctx) return;
  const updates = [];
  document.querySelectorAll('.bf-bien-check').forEach(cb => {
    const bien = allBiens.find(b => b.id === cb.dataset.bienId);
    if(!bien) return;
    const rattacheIci = bien.sci_id === ctx.sciId;
    if(cb.checked && !rattacheIci)       updates.push({ bien, sci_id: ctx.sciId });
    else if(!cb.checked && rattacheIci)  updates.push({ bien, sci_id: null });
  });
  if(!updates.length) { showNotif('Aucun changement de rattachement'); return; }
  try {
    /* ⚠️ LES DEUX CHAMPS S'ÉCRIVENT ENSEMBLE, DANS LE MÊME `update`.
       C'est ce chemin — et `saveBien()` — qui écrivaient `sci_id` SEUL et qui
       empêchaient de poser l'invariant `biens_mode_detention_coherent`
       (partie B de MIGRATION-MODE-DETENTION.sql).
       ⚠️ Détacher NE VEUT PAS DIRE « en propre » : cela rouvre la question. On
       remet donc `null` et l'écran redemande, plutôt que de deviner une donnée
       à portée fiscale. */
    const res = await Promise.all(updates.map(u =>
      db.from('biens')
        .update({ sci_id: u.sci_id, mode_detention: u.sci_id ? 'sci' : null })
        .eq('id', u.bien.id)));
    const err = res.find(r => r.error);
    if(err) throw err.error;
    updates.forEach(u => { u.bien.sci_id = u.sci_id; u.bien.mode_detention = u.sci_id ? 'sci' : null; });
    const nb = updates.filter(u => u.sci_id).length, nd = updates.length - nb;
    showNotif(`${[nb ? nb + ' bien(s) rattaché(s)' : '', nd ? nd + ' détaché(s)' : ''].filter(Boolean).join(' · ')}`);
    ctx.showAttach = false;
    mfBilanFeedRender();
    // Le rattachement change le périmètre de la « Déclaration fiscale » :
    // c'est l'onglet courant qu'il faut redessiner, plus l'ancienne Rentabilité.
    const mc = document.getElementById('mf-content');
    if(mc && mfTab === 'performance') renderMfPerformance(mc);
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
  }
}

async function mfBilanFeedWrite() {
  const ctx = bilanFeedCtx;
  if(!ctx?.computed) return;
  const { annee } = ctx;
  const bilan = ctx.bilans.find(b => b.sci_id === ctx.sciId) || null;
  const regime = bilan ? bilan.regime : ctx.regime;
  const d = ctx.computed;

  if(bilan && bilanEstAlimente(bilan)) {
    if(!confirm(`Le bilan ${annee} de cette SCI contient déjà des données. Les remplacer par les valeurs calculées ?`)) return;
  }

  const payload = { source_bien_ids: d.bienIds };
  if(regime === 'IR') {
    payload.ir_loyers_percus = d.loyers;
    payload.ir_charges_deductibles = d.parLigne;
  } else {
    payload.is_compte_resultat = {
      produits:  { loyers: d.loyers, charges_recuperees: 0, autres: 0 },
      charges:   d.parPcg,
      dotations: {
        immeuble: parseFloat(document.getElementById('bf-am-imm')?.value) || 0,
        travaux:  parseFloat(document.getElementById('bf-am-trav')?.value) || 0,
        mobilier: parseFloat(document.getElementById('bf-am-mob')?.value) || 0,
      },
    };
  }

  // FND-015 : les colonnes plates sont dépréciées, `is_compte_resultat` fait
  // foi. La mise à null était À L'INTÉRIEUR de la branche IS — un bilan au
  // régime IR les laissait donc telles quelles, et le seul bilan en base
  // (exercice 2026, régime IR) porte à la fois la structure canonique et des
  // colonnes plates non nulles. En IR l'amortissement n'existe même pas.
  payload.amortissement_immeuble = null;
  payload.amortissement_travaux  = null;
  payload.amortissement_mobilier = null;

  const btn = document.getElementById('bf-write');
  if(btn) { btn.disabled = true; btn.textContent = 'Écriture…'; }
  try {
    let res;
    if(bilan) {
      res = await db.from('bilans_comptables').update(payload).eq('id', bilan.id);
    } else {
      res = await db.from('bilans_comptables').insert({
        ...payload, sci_id: ctx.sciId, exercice: annee, regime,
        statut: 'Brouillon', user_id: currentUser.id,
      });
    }
    if(res.error) throw res.error;
    showNotif(`Bilan ${annee} alimenté (régime ${regime})`);
    closeModal('modal-detail');
  } catch(e) {
    showNotif('Erreur : ' + e.message, true);
    if(btn) { btn.disabled = false; btn.textContent = `✍️ Écrire dans le bilan ${annee}`; }
  }
}

// ═════════════════════════════════════════════════════
//  LOCATAIRES — Étape 2
// ═════════════════════════════════════════════════════

async function loadLocataires() {
  if(!currentUser) return;
  const { data, error } = await db.from('locataires')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false });
  if (error) { showNotif('Erreur chargement locataires : '+error.message, true); return; }
  allLocataires = data || [];
}

// ─── Chargement loyers + charges du user (pour Module Financier) ───
async function loadMfFinancialData() {
  if(!currentUser) return;
  // Parallèle pour gagner du temps
  const [loyersRes, chargesRes] = await Promise.all([
    db.from('loyers_mensuels')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('annee', { ascending: false })
      .order('mois', { ascending: false }),
    db.from('charges_reelles')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('date_charge', { ascending: false })
  ]);
  if(loyersRes.error)  showNotif('Erreur loyers : '+loyersRes.error.message, true);
  if(chargesRes.error) showNotif('Erreur charges : '+chargesRes.error.message, true);
  allLoyers  = loyersRes.data  || [];
  allCharges = chargesRes.data || [];
}

// ─── Helpers calculs financiers Module Financier ───
// Formule : sur les 12 derniers mois calendaires (hors mois courant exclu pour avoir des données complètes)
// Lissage taxe foncière annuelle : si charge.lissable=true, on divise sur 12 mois.

function mfMontantAcquisition(b) {
  return (parseFloat(b.prix_affiche)||0)
       + (parseFloat(b.frais_notaire)||0)
       + (parseFloat(b.travaux)||0)
       + (parseFloat(b.frais_agence)||0)
       + (parseFloat(b.creation_sci)||0);
}

// Retourne les 12 derniers mois (mois courant inclus) sous forme [{mois, annee, label}]
function mf12LastMonths() {
  const now = new Date();
  const out = [];
  for(let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      mois:  d.getMonth() + 1,
      annee: d.getFullYear(),
      label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.','')
    });
  }
  return out;
}

// Calcule loyer encaissé sur un mois pour un bien (statut Payé ou Partiel)
function mfLoyerEncaisseMois(bienId, mois, annee) {
  const ligne = allLoyers.find(l =>
    l.bien_id === bienId && l.mois === mois && l.annee === annee
  );
  if(!ligne) return 0;
  if(ligne.statut === 'Payé' || ligne.statut === 'Partiel') {
    return parseFloat(ligne.montant_encaisse) || 0;
  }
  return 0;
}

// Calcule charges payées sur un mois pour un bien (avec lissage)
function mfChargesMois(bienId, mois, annee) {
  let total = 0;
  for(const c of allCharges) {
    if(c.bien_id !== bienId) continue;
    const dC = new Date(c.date_charge);
    if(c.lissable) {
      // Lissage : on divise par 12 et on l'applique sur les 12 mois autour
      // Stratégie : si la charge a été payée dans l'année donnée, on lisse sur les 12 mois de cette année
      if(dC.getFullYear() === annee) {
        total += (parseFloat(c.montant)||0) / 12;
      }
    } else {
      // Charge ponctuelle : compte sur le mois exact où elle a été payée
      if(dC.getMonth() + 1 === mois && dC.getFullYear() === annee) {
        total += parseFloat(c.montant)||0;
      }
    }
  }
  return total;
}

// Calcul cashflow réel sur 12 derniers mois pour un bien
function mfCashflowReel12M(bien) {
  const months = mf12LastMonths();
  let loyer = 0, charges = 0;
  for(const m of months) {
    loyer  += mfLoyerEncaisseMois(bien.id, m.mois, m.annee);
    charges += mfChargesMois(bien.id, m.mois, m.annee);
  }
  const mensualites = (parseFloat(bien.mensualite_credit)||0) * 12;
  return {
    loyer_encaisse: loyer,
    charges_payees: charges,
    mensualites_credit: mensualites,
    cashflow: loyer - charges - mensualites,
  };
}

// Cashflow par mois (12 valeurs) pour le sparkline

// Cashflow prévisionnel mensuel — P2 : délègue à computeCF, la formule unique.
// (Avant, la formule était dupliquée ici mot pour mot : divergence garantie.)
function mfCashflowPrevisionnel(bien) { return computeCF(bien); }

/* ═══════════════════════════════════════════════════════════════════════════
   SUIVI FINANCIER — LE CALCUL DU RÉEL, SOURCE UNIQUE DU MODULE
   Arbitrage du 10/08/2026 : le module raisonne en ANNÉE CIVILE (exercice), et
   non plus en 12 mois glissants. Un seul sélecteur d'exercice en haut.

   ⚠️ POURQUOI CES FONCTIONS EXISTENT. Deux définitions du « réel » cohabitaient :
   `mfCashflowReel12M` imputait DOUZE mois de mensualités quoi qu'il arrive,
   tandis que l'ancien onglet Rentabilité bornait aux mois écoulés. Un bien avec
   huit mois de loyers était donc confronté à douze mois de crédit — visible en
   production : « MENSUALITÉS CRÉDIT 43 800 € » pour 3 650 €/mois alors que huit
   mois seulement étaient écoulés.

   `mfCashflowReel12M` est CONSERVÉ tel quel : il sert `cfDisplayData()`, donc
   « Mes biens » et l'accueil, sur une fenêtre GLISSANTE de 12 mois. Fenêtre
   glissante et exercice comptable sont deux questions différentes, pas deux
   réponses à la même — les confondre serait recréer le défaut à l'envers.
   ═══════════════════════════════════════════════════════════════════════════ */

// Mois écoulés d'un exercice : 12 pour une année révolue, le mois courant pour
// l'année en cours, 0 pour une année à venir.
function mfMoisEcoules(annee) {
  const now = new Date();
  if (annee < now.getFullYear()) return 12;
  if (annee > now.getFullYear()) return 0;
  return now.getMonth() + 1;
}

// Loyer DÛ d'un mois — la base, pas le loyer théorique de la fiche : c'est la
// ligne de `loyers_mensuels` qui fait foi, prorata loi 1989 compris.
function mfLoyerDuMois(bienId, mois, annee) {
  const l = allLoyers.find(x => x.bien_id === bienId && x.mois === mois && x.annee === annee);
  return l ? (parseFloat(l.loyer_du) || 0) : 0;
}

// Le réel d'un bien sur un exercice, borné aux mois ÉCOULÉS.
function mfReelExercice(bien, annee) {
  const nb = mfMoisEcoules(annee);
  let loyer = 0, charges = 0, du = 0;
  for (let m = 1; m <= nb; m++) {
    loyer   += mfLoyerEncaisseMois(bien.id, m, annee);
    charges += mfChargesMois(bien.id, m, annee);
    du      += mfLoyerDuMois(bien.id, m, annee);
  }
  const mensualites = (parseFloat(bien.mensualite_credit) || 0) * nb;
  return {
    mois: nb,
    loyer_encaisse: loyer,
    loyer_du: du,
    charges_payees: charges,
    mensualites_credit: mensualites,
    cashflow: loyer - charges - mensualites,
  };
}

// Cashflow mois par mois sur l'exercice — alimente le mini-graphique des cartes
// et le graphique consolidé. `null` au-delà des mois écoulés : un mois à venir
// n'a pas de cashflow, et le tracer à zéro le ferait lire comme un équilibre.
function mfCashflowMensuelExercice(bien, annee) {
  const nb = mfMoisEcoules(annee);
  const mensu = parseFloat(bien.mensualite_credit) || 0;
  const out = [];
  for (let m = 1; m <= 12; m++) {
    if (m > nb) { out.push({ mois: m, cashflow: null, encaisse: false }); continue; }
    const l = mfLoyerEncaisseMois(bien.id, m, annee);
    const du = mfLoyerDuMois(bien.id, m, annee);
    out.push({
      mois: m,
      cashflow: l - mfChargesMois(bien.id, m, annee) - mensu,
      // « non encaissé » ne se déduit QUE d'un loyer dû resté impayé — un bien
      // vacant ne doit pas être signalé comme tel, il n'a rien à encaisser.
      encaisse: du > 0 && l >= du,
      manque: du > 0 && l < du,
    });
  }
  return out;
}

/* ⚠️ « RENDEMENT NET » — REDÉFINI, l'ancien n'en était pas un.
   Il calculait `(loyers − charges − mensualités) / coût total` : il retranchait
   le remboursement du crédit — dont la part de capital est de l'ÉPARGNE, pas
   une perte — et divisait par le coût au lieu de l'apport. D'où les « −4,14 % »
   affichés en production.
   Nouvelle définition, arbitrée par Thomas : HORS CRÉDIT, sur le loyer DÛ,
   annualisé, rapporté au coût d'acquisition. Le loyer dû et non encaissé :
   l'impayé est un problème de recouvrement, pas de rendement du bien — il est
   dit ailleurs, par le taux d'impayés et les loyers non soldés.
   Retourne `null` quand le rendement n'est pas calculable, jamais 0 : un coût
   d'acquisition absent n'est pas un rendement nul. */
function mfRendementNet(biens, annee) {
  const liste = Array.isArray(biens) ? biens : [biens];
  const nb = mfMoisEcoules(annee);
  if (!nb) return null;
  let net = 0, cout = 0;
  for (const b of liste) {
    const r = mfReelExercice(b, annee);
    net  += r.loyer_du - r.charges_payees;
    cout += mfMontantAcquisition(b);
  }
  if (cout <= 0) return null;
  return ((net * (12 / nb)) / cout) * 100;
}

/* ⚠️ RÈGLE DE PÉRIMÈTRE — elle gouverne tous les chiffres du module.
   Ma première règle (« écarter les biens sans donnée ») confondait deux cas
   opposés. Un bien VACANT n'est PAS une donnée manquante : on sait qu'il ne
   rapporte rien et que son crédit court, son cashflow est calculable et vrai →
   il est COMPTÉ. Seul un bien LOUÉ dont aucun loyer n'est saisi sur l'exercice
   est écarté — là on ignore vraiment ce qui s'est passé.
   Mesuré à l'arbitrage : le consolidé passe de −19 135 € à −54 735 €, dont
   35 600 € de crédit sur les biens vides. La vacance cesse d'être invisible. */
function mfDansLePerimetre(bien, annee) {
  if (bien.statut !== 'Acheté') return false;
  // ⚠️ « Loué » s'entend SUR L'EXERCICE, pas aujourd'hui : sur une année passée
  // dont le locataire est depuis parti, lire son statut actuel faisait passer
  // le bien pour vacant.
  if (!mfLoueSurExercice(bien, annee)) return true;
  return allLoyers.some(l => l.bien_id === bien.id && l.annee === annee);
}

// Les biens du module pour un exercice, dans l'ordre d'affichage par défaut.
function mfBiensExercice(annee) {
  return allBiens.filter(b => mfDansLePerimetre(b, annee));
}

// Statut occupation d'un bien
function mfStatutOccupation(bienId) {
  const locataireActif = allLocataires.find(l =>
    l.bien_id === bienId && l.statut === 'Actif'
  );
  if(!locataireActif) return { type: 'vacant', label: 'Vacant', locataire: null };

  // Impayés sur les 3 derniers mois.
  //
  // ⚠️ FND-002 : ce test cherchait les statuts 'Impayé' et 'En retard'. Or
  // l'application ne les écrit JAMAIS d'elle-même — `bdGenererLoyers` et le
  // pointage créent toutes leurs lignes en 'En attente', et ces deux libellés
  // ne sont posables qu'à la main par la fenêtre d'encaissement. Le badge
  // affichait donc « Occupé » alors que la matrice, juste à côté sur le même
  // écran, montrait un mois échu en rouge.
  // L'impayé se déduit de l'ÉCHÉANCE, pas du libellé : `sfLoyerEtat` applique
  // la règle de l'agenda (un loyer dû le 5 n'est en retard que le 6).
  const months = mf12LastMonths().slice(-3);
  const hasImpaye = allLoyers.some(l =>
    l.bien_id === bienId && l.locataire_id === locataireActif.id
    && months.some(m => m.mois === l.mois && m.annee === l.annee)
    && sfLoyerEtat(l, l.mois, l.annee, locataireActif) === 'ko'
  );
  if(hasImpaye) return { type: 'impaye', label: 'Impayé en cours', locataire: locataireActif };

  return { type: 'occup', label: 'Occupé', locataire: locataireActif };
}

// ─── Helpers documents (forward-compatible Storage) ───
// Format jsonb : {name, type, mime, size, uploaded_at, data?, storage_path?}
// V1 : on lit `data` (base64). V2 (Storage) : on lira `storage_path` et générera signed URL.

function mfDocLabel(typeKey) {
  return LOC_DOC_TYPES.find(t => t.key === typeKey)?.label || 'Document';
}
function mfDocIcon(typeKey) {
  return LOC_DOC_TYPES.find(t => t.key === typeKey)?.icon || '📄';
}
function mfDocFromFile(file, typeKey) {
  return new Promise((resolve, reject) => {
    if(file.size > MAX_DOC_SIZE_MB * 1024 * 1024) {
      reject(new Error(`Fichier trop lourd (max ${MAX_DOC_SIZE_MB} MB)`));
      return;
    }
    const r = new FileReader();
    r.onload = ev => resolve({
      name: file.name,
      type: typeKey,
      mime: file.type || 'application/octet-stream',
      size: file.size,
      uploaded_at: new Date().toISOString(),
      data: ev.target.result, // V1
      storage_path: null,      // V2 (futur)
    });
    r.onerror = () => reject(new Error('Lecture du fichier impossible'));
    r.readAsDataURL(file);
  });
}
async function mfDocViewer(doc) {
  let src = null;
  if(doc?.storage_path){
    src = await TI_STORAGE.signedUrl('locataires-documents', doc.storage_path);
  } else {
    src = doc?.data || null; // fallback legacy base64
  }
  if(!src) { showNotif('Document non disponible', true); return; }
  if((doc.mime||'').startsWith('image/')) {
    openLightbox(src);
  } else {
    openDoc(src); // PDF ou autre
  }
}
function mfFmtSize(bytes) {
  if(!bytes) return '—';
  if(bytes < 1024) return bytes + ' B';
  if(bytes < 1024*1024) return Math.round(bytes/1024) + ' KB';
  return (bytes/1024/1024).toFixed(1) + ' MB';
}

// ─── Modal Locataire ───
function openLocataireModal(id, presetBienId) {
  editingLocataireId = id;
  const l = id ? allLocataires.find(x => x.id === id) : null;
  locataireDocsPending = l ? JSON.parse(JSON.stringify(l.documents || [])) : [];

  // Biens "Acheté" uniquement (périmètre Module Financier)
  const biensAchetes = allBiens.filter(b => b.statut === 'Acheté');

  document.getElementById('adm-modal-title').textContent = id ? 'Modifier le locataire' : '＋ Nouveau locataire';
  document.getElementById('adm-modal-del').style.display = id ? 'flex' : 'none';
  document.getElementById('adm-modal-save').onclick = saveLocataire;
  document.getElementById('adm-modal-del').onclick = deleteLocataire;

  document.getElementById('adm-modal-body').innerHTML = `
    <!-- Identité -->
    <div class="mf-section-title">👤 Identité</div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Prénom</label>
        <input class="sci-form-input" id="loc-prenom" value="${esc(l?.prenom||'')}" placeholder="Jean"></div>
      <div class="sci-form-group"><label class="sci-form-label">Nom <span style="color:var(--sf-loss)">*</span></label>
        <input class="sci-form-input" id="loc-nom" value="${esc(l?.nom||'')}" placeholder="Dupont"></div>
    </div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Email</label>
        <input class="sci-form-input" id="loc-email" type="email" value="${esc(l?.email||'')}" placeholder="email@exemple.com"></div>
      <div class="sci-form-group"><label class="sci-form-label">Téléphone</label>
        <input class="sci-form-input" id="loc-tel" value="${esc(l?.telephone||'')}" placeholder="06 xx xx xx xx"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Date de naissance</label>
      <input class="sci-form-input" id="loc-naissance" type="date" value="${esc(l?.date_naissance||'')}"></div>

    <!-- Profession & revenus -->
    <div class="mf-section-title">💼 Profession & revenus</div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Profession</label>
        <input class="sci-form-input" id="loc-profession" value="${esc(l?.profession||'')}" placeholder="Ingénieur"></div>
      <div class="sci-form-group"><label class="sci-form-label">Employeur</label>
        <input class="sci-form-input" id="loc-employeur" value="${esc(l?.employeur||'')}" placeholder="Entreprise XYZ"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Revenus nets mensuels (€)</label>
      <input class="sci-form-input" id="loc-revenus" type="number" min="0" step="100" value="${esc(l?.revenus_mensuels||'')}" placeholder="2 500"></div>

    <!-- Garant -->
    <div class="mf-section-title">🛡️ Garant / Caution</div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Nom du garant</label>
        <input class="sci-form-input" id="loc-garant-nom" value="${esc(l?.garant_nom||'')}" placeholder="Marie Dupont"></div>
      <div class="sci-form-group"><label class="sci-form-label">Lien</label>
        <select class="sci-form-input" id="loc-garant-lien">
          <option value="">— Préciser —</option>
          ${['Parent','Conjoint','Employeur','Garantie Visale','Caution bancaire','Autre'].map(x=>`<option value="${x}" ${l?.garant_lien===x?'selected':''}>${x}</option>`).join('')}
        </select></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Revenus du garant (€/mois)</label>
      <input class="sci-form-input" id="loc-garant-revenus" type="number" min="0" step="100" value="${esc(l?.garant_revenus||'')}" placeholder="3 000"></div>

    <!-- Bail -->
    <div class="mf-section-title">🏠 Bail</div>
    <div class="sci-form-group"><label class="sci-form-label">Bien rattaché ${biensAchetes.length===0?'<span style="font-size:11px;color:var(--c-muted)">(aucun bien acheté pour l\'instant)</span>':''}</label>
      <select class="sci-form-input" id="loc-bien">
        <option value="">— Aucun bien rattaché —</option>
        ${biensAchetes.map(b => `<option value="${b.id}" ${(l?.bien_id||presetBienId)===b.id?'selected':''}>${esc(b.titre)} — ${esc(b.ville||'')}</option>`).join('')}
      </select></div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Type de bail</label>
        <select class="sci-form-input" id="loc-type-bail">
          <option value="">— Préciser —</option>
          ${TYPES_BAIL.map(t=>`<option value="${t}" ${l?.type_bail===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div class="sci-form-group"><label class="sci-form-label">Jour de paiement (1-31)</label>
        <input class="sci-form-input" id="loc-jour-paiement" type="number" min="1" max="31" value="${esc(l?.jour_paiement||5)}"></div>
    </div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Date d'entrée <span style="color:var(--sf-loss)">*</span></label>
        <input class="sci-form-input" id="loc-date-entree" type="date" value="${esc(l?.date_entree||'')}">
        <div class="sci-form-hint">Requise dès qu'un locataire actif est rattaché à un bien : c'est elle qui détermine les loyers générés.</div></div>
      <div class="sci-form-group"><label class="sci-form-label">Date de sortie</label>
        <input class="sci-form-input" id="loc-date-sortie" type="date" value="${esc(l?.date_sortie||'')}"></div>
    </div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Loyer HC (€/mois)</label>
        <input class="sci-form-input" id="loc-loyer" type="number" min="0" step="10" value="${esc(l?.loyer_bail_hc||'')}" placeholder="850"></div>
      <div class="sci-form-group"><label class="sci-form-label">Charges (€/mois)</label>
        <input class="sci-form-input" id="loc-charges" type="number" min="0" step="5" value="${esc(l?.charges_bail||'')}" placeholder="50"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Dépôt de garantie (€)</label>
      <input class="sci-form-input" id="loc-depot" type="number" min="0" step="50" value="${esc(l?.depot_garantie||'')}" placeholder="850"></div>

    <!-- Statut -->
    <div class="mf-section-title">🏷️ Statut</div>
    <div class="mf-statut-radio" id="loc-statut-radio">
      ${LOC_STATUTS.map(s => {
        const checked = (l?.statut || 'Candidat') === s;
        return `
          <label class="mf-statut-opt ${checked?'active':''}" onclick="document.querySelectorAll('#loc-statut-radio .mf-statut-opt').forEach(o=>o.classList.remove('active'));this.classList.add('active');">
            <input type="radio" name="loc-statut" value="${s}" ${checked?'checked':''}>
            <span class="ic">${LOC_STATUT_ICONS[s]}</span>
            <span class="lbl">${s}</span>
          </label>`;
      }).join('')}
    </div>

    <!-- Documents -->
    <div class="mf-section-title">📎 Documents</div>
    <div class="mf-doc-upload">
      <select id="loc-doc-type">
        ${LOC_DOC_TYPES.map(t => `<option value="${t.key}">${t.icon} ${t.label}</option>`).join('')}
      </select>
      <button class="mf-doc-upload-btn" onclick="document.getElementById('loc-doc-input').click()">📎 Ajouter</button>
      <input type="file" id="loc-doc-input" accept="application/pdf,image/*" multiple style="display:none" onchange="handleLocDocUpload(event)">
    </div>
    <div class="mf-doc-list" id="loc-docs-list"></div>

    <!-- Notes -->
    <div class="mf-section-title">📝 Notes</div>
    <div class="sci-form-group">
      <textarea class="sci-form-input" id="loc-notes" rows="3" style="resize:vertical" placeholder="Observations, points d'attention…">${esc(l?.notes||'')}</textarea>
    </div>`;

  refreshLocDocsView();
  document.getElementById('adm-modal-overlay').classList.add('open');
}

function refreshLocDocsView() {
  const c = document.getElementById('loc-docs-list');
  if(!c) return;
  if(!locataireDocsPending.length) {
    c.innerHTML = '<div style="font-size:11px;color:var(--c-muted);text-align:center;padding:8px 0">Aucun document</div>';
    return;
  }
  c.innerHTML = locataireDocsPending.map((d,i) => `
    <div class="mf-doc-item">
      <span class="icon">${mfDocIcon(d.type)}</span>
      <div class="body">
        <div class="name">${d.name}<span class="mf-doc-type-badge">${mfDocLabel(d.type)}</span></div>
        <div class="meta">${mfFmtSize(d.size)} · ${d.uploaded_at ? new Date(d.uploaded_at).toLocaleDateString('fr-FR') : ''}</div>
      </div>
      <div class="actions">
        <button class="act-btn" onclick="mfDocViewer(locataireDocsPending[${i}])" title="Voir">👁</button>
        <button class="act-btn del" onclick="removeLocDoc(${i})" title="Supprimer">✕</button>
      </div>
    </div>`).join('');
}

async function handleLocDocUpload(event) {
  const files = Array.from(event.target.files || []);
  const typeKey = document.getElementById('loc-doc-type').value;
  if(!files.length) return;
  for(const f of files) {
    try {
      const doc = await mfDocFromFile(f, typeKey);
      locataireDocsPending.push(doc);
    } catch(e) {
      showNotif(`${f.name} : ${e.message}`, true);
    }
  }
  // Reset input
  event.target.value = '';
  refreshLocDocsView();
}

function removeLocDoc(i) {
  locataireDocsPending.splice(i, 1);
  refreshLocDocsView();
}

function getLocataireFormData() {
  const v = id => { const e = document.getElementById(id); return e?.value?.trim() || null; };
  const num = id => { const x = parseFloat(document.getElementById(id)?.value); return isNaN(x) ? null : x; };
  const statutEl = document.querySelector('input[name="loc-statut"]:checked');
  return {
    nom:            v('loc-nom'),
    prenom:         v('loc-prenom'),
    email:          v('loc-email'),
    telephone:      v('loc-tel'),
    date_naissance: v('loc-naissance') || null,
    profession:     v('loc-profession'),
    employeur:      v('loc-employeur'),
    revenus_mensuels: num('loc-revenus') ?? 0,
    garant_nom:     v('loc-garant-nom'),
    garant_lien:    v('loc-garant-lien'),
    garant_revenus: num('loc-garant-revenus') ?? 0,
    bien_id:        v('loc-bien') || null,
    type_bail:      v('loc-type-bail'),
    date_entree:    v('loc-date-entree') || null,
    date_sortie:    v('loc-date-sortie') || null,
    loyer_bail_hc:  num('loc-loyer') ?? 0,
    charges_bail:   num('loc-charges') ?? 0,
    depot_garantie: num('loc-depot') ?? 0,
    jour_paiement:  parseInt(document.getElementById('loc-jour-paiement')?.value)||null,
    statut:         statutEl?.value || 'Candidat',
    documents:      locataireDocsPending,
    notes:          v('loc-notes'),
    user_id:        currentUser?.id,
  };
}

async function saveLocataire() {
  const data = getLocataireFormData();
  if(!data.nom) { showNotif('Le nom est obligatoire', true); return; }

  // Un locataire actif rattache a un bien SANS date d'entree est un piege :
  // autoGenerateLoyers sort en return 0 sans rien dire, aucun loyer n'est cree,
  // et tout le pan "reel" du Module Financier (cashflow 12M, Rentabilite, Suivi
  // mensuel, bilan SCI) reste vide sans que rien ne le signale. Constate le
  // 01/08/2026 : 1 locataire actif a 830 EUR/mois, 0 ligne dans loyers_mensuels.
  // bdGenererLoyers (voir plus haut) controlait deja cette date ; ce chemin-ci
  // ne le faisait pas. On aligne les deux.
  if(data.statut === 'Actif' && data.bien_id && !data.date_entree) {
    showNotif("Renseignez la date d'entrée : elle détermine les loyers à générer", true);
    document.getElementById('loc-date-entree')?.focus();
    return;
  }

  // Vérification : un seul "Actif" par bien à la fois
  if(data.statut === 'Actif' && data.bien_id) {
    const conflit = allLocataires.find(l =>
      l.id !== editingLocataireId &&
      l.bien_id === data.bien_id &&
      l.statut === 'Actif'
    );
    if(conflit) {
      const fullName = [conflit.prenom, conflit.nom].filter(Boolean).join(' ') || conflit.nom;
      const ok = confirm(`Le bien sélectionné a déjà un locataire actif (${fullName}).\n\nVoulez-vous le marquer comme "Sorti" (date de sortie = aujourd'hui) pour pouvoir activer ce nouveau locataire ?`);
      if(!ok) return;
      const today = new Date().toISOString().split('T')[0];
      const upd = await db.from('locataires').update({statut:'Sorti', date_sortie:today}).eq('id', conflit.id);
      if(upd.error) { showNotif('Erreur clôture du locataire actuel : '+upd.error.message, true); return; }
    }
  }

  const btn = document.getElementById('adm-modal-save');
  btn.disabled = true; btn.innerHTML = '<span class="sci-spinner"></span>Enregistrement…';

  let res, savedId;
  try {
    if(editingLocataireId) {
      res = await db.from('locataires').update(data).eq('id', editingLocataireId).select().single();
      savedId = editingLocataireId;
    } else {
      res = await db.from('locataires').insert(data).select().single();
      savedId = res.data?.id;
    }
    if(res.error) throw res.error;

    // Upload des nouveaux documents (data base64 sans storage_path) vers Storage
    if(savedId && Array.isArray(locataireDocsPending) && locataireDocsPending.length){
      let needUpdate = false;
      const migratedDocs = [];
      const echecsUpload = [];
      for(const doc of locataireDocsPending){
        if(doc.storage_path){
          migratedDocs.push(doc); // déjà sur Storage
        } else if(doc.data && doc.data.startsWith('data:')){
          try {
            const up = await TI_STORAGE.uploadDataURL('locataires-documents', savedId, doc.data, doc.name);
            // On garde les métadonnées, on remplace data par storage_path
            migratedDocs.push({ name:doc.name, type:doc.type, mime:doc.mime, size:doc.size, uploaded_at:doc.uploaded_at, storage_path:up.path, data:null });
            needUpdate = true;
          } catch(e){
            // Repli : le document est conservé dans la fiche plutôt que perdu,
            // mais il alourdit la ligne en base — l'utilisateur doit le savoir
            // au lieu de croire son fichier rangé sur Storage.
            migratedDocs.push(doc);
            echecsUpload.push(doc.name || 'document');
            console.warn('[locataires] upload Storage échoué, repli base64 :', doc.name, e?.message);
          }
        } else {
          migratedDocs.push(doc);
        }
      }
      if(echecsUpload.length){
        showNotif(`${echecsUpload.length} document${echecsUpload.length>1?'s':''} n'${echecsUpload.length>1?'ont':'a'} pas pu être envoyé${echecsUpload.length>1?'s':''} (${echecsUpload.slice(0,2).join(', ')}${echecsUpload.length>2?'…':''}) — conservé${echecsUpload.length>1?'s':''} dans la fiche, à réimporter`, true);
      }
      if(needUpdate){
        await db.from('locataires').update({ documents: migratedDocs }).eq('id', savedId);
      }
    }
    let loyersGenes = 0;
    if(data.statut === 'Actif' && data.bien_id && data.date_entree && savedId) {
      loyersGenes = await autoGenerateLoyers({
        ...data,
        id: savedId,
      });
    }

    // Le cas "actif sur un bien mais aucun loyer genere" reste possible apres
    // la validation ci-dessus : autoGenerateLoyers ne genere rien pour une
    // entree prevue l'annee prochaine, et rien de neuf si les lignes existent
    // deja. On le dit, au lieu de laisser croire que des loyers ont ete crees.
    const attenduDesLoyers = data.statut === 'Actif' && data.bien_id;
    const suffixe = loyersGenes
      ? ` · ${loyersGenes} loyer${loyersGenes>1?'s':''} généré${loyersGenes>1?'s':''}`
      : (attenduDesLoyers ? ' · aucun nouveau loyer à générer' : '');
    showNotif(`Locataire ${editingLocataireId ? 'mis à jour' : 'créé'}${suffixe}`);
    closeAdmModal();
    await loadLocataires();
    const c = document.getElementById('mf-content');
    if(c && mfTab === 'locataires') renderMfLocataires(c);
    // Créé depuis la fiche d'un bien : recharger loyers générés puis rafraîchir
    if(currentPage === 'bien-detail') { await loadMfFinancialData(); bdRefresh(); }
  } catch(e) {
    showNotif('Erreur : '+e.message, true);
  } finally {
    btn.disabled = false; btn.innerHTML = sfAccIcon("check",14)+' Enregistrer';
  }
}

async function deleteLocataire() {
  if(!editingLocataireId) return;
  if(!confirm('Supprimer définitivement ce locataire ? Les loyers mensuels rattachés conserveront la trace mais perdront le lien locataire.')) return;
  // Nettoyer les documents Storage rattachés (best-effort)
  const loc = allLocataires.find(x=>x.id===editingLocataireId);
  if(loc && Array.isArray(loc.documents)){
    const paths = loc.documents.map(d=>d.storage_path).filter(Boolean);
    if(paths.length) await TI_STORAGE.remove('locataires-documents', paths);
  }
  const { error } = await db.from('locataires').delete().eq('id', editingLocataireId);
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  showNotif('Locataire supprimé');
  closeAdmModal();
  await loadLocataires();
  const c = document.getElementById('mf-content');
  if(c && mfTab === 'locataires') renderMfLocataires(c);
}

// ─── Auto-génération des loyers mensuels ───
// À la création/passage en "Actif", on génère 1 ligne par mois entre date_entree
// et la fin de l'année courante. Idempotent grâce à la contrainte unique
// (user_id, bien_id, mois, annee) → onConflict: ne rien faire.
async function autoGenerateLoyers(loc) {
  if(!loc.bien_id || !loc.date_entree || !loc.id) return 0;
  const dEntree = new Date(loc.date_entree);
  if(isNaN(dEntree)) return 0;
  const today = new Date();
  const annee = today.getFullYear();

  // Période : du max(janvier, mois entrée si même année) à décembre
  let moisDebut;
  if(dEntree.getFullYear() === annee) moisDebut = dEntree.getMonth() + 1;
  else if(dEntree.getFullYear() < annee) moisDebut = 1;
  else return 0; // entrée future année prochaine, on ne génère pas encore

  /* ⚠️ DIVERGENCE TROUVÉE EN REVUE — deux générateurs, deux règles.
     Ce chemin écrivait `loyer_du = loc.loyer_bail_hc` SANS PRORATA, alors que
     `mfGenerateMissingLoyers` et `mfCreateLoyerLine` appliquent le prorata de
     la loi 1989. Même libellé de bouton (« Générer les loyers »), deux
     résultats différents selon l'écran d'où l'on clique : le mois d'entrée
     était facturé plein depuis la fiche bien, au prorata depuis le suivi
     mensuel.
     Visible dans les données de Thomas : juin 2025 y vaut 553 € (prorata de
     20 jours sur 30) et non 830 € — les deux chemins ont donc bien été
     utilisés, et ils ne s'accordaient pas.
     → `mfLoyerProrata` devient la source unique. Un mois complet retourne le
     loyer plein, la fonction ne change donc rien hors mois d'entrée et de
     sortie. */
  const rows = [];
  for(let m = moisDebut; m <= 12; m++) {
    const p = mfLoyerProrata(parseFloat(loc.loyer_bail_hc) || 0, m, annee,
                             loc.date_entree, loc.date_sortie);
    if(p.montant === 0) continue;   // mois hors période d'occupation
    rows.push({
      user_id:       currentUser.id,
      bien_id:       loc.bien_id,
      locataire_id:  loc.id,
      mois:          m,
      annee:         annee,
      loyer_du:      p.montant,
      charges_dues:  loc.charges_bail || 0,
      statut:        'En attente',
      notes:         p.prorata ? `Prorata loi 1989 : ${p.jours}/${p.joursMois} jours` : null,
    });
  }
  if(!rows.length) return 0;

  // Insert avec onConflict: ne rien faire (les loyers déjà existants sont préservés)
  const { error } = await db.from('loyers_mensuels').upsert(rows, {
    onConflict: 'user_id,bien_id,mois,annee',
    ignoreDuplicates: true,
  });
  if(error) {
    console.error('autoGenerateLoyers', error);
    showNotif('Loyers : '+error.message, true);
    return 0;
  }
  return rows.length;
}

// ══════════════════════════════════════════════════════
//  MODULE ADMINISTRATION — Page principale
// ══════════════════════════════════════════════════════

let adminTab = 'sci'; // onglet actif : sci | annuaire | echeances | bilans
let allContacts = [], allEcheances = [], allBilans = [];
let editingContactId = null, editingEcheanceId = null, editingBilanId = null;

async function renderAdministration(el) {
  el.innerHTML = `
  <div class="admin-page">
    <!-- Hero -->
    <div class="adm-hero">
      <div>
        <div class="adm-hero-label">Gestion administrative</div>
        <div class="adm-hero-title">Administration</div>
        <div class="adm-hero-sub">Pilotez vos SCI, vos contacts et vos obligations comptables</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:12px;">
        <div class="adm-hero-kpis" id="adm-kpis">
          <div class="adm-kpi"><div class="adm-kpi-val" id="adm-k-sci">—</div><div class="adm-kpi-lab">SCI</div></div>
          <div class="adm-kpi"><div class="adm-kpi-val" id="adm-k-contacts">—</div><div class="adm-kpi-lab">Contacts</div></div>
          <div class="adm-kpi"><div class="adm-kpi-val" id="adm-k-ech">—</div><div class="adm-kpi-lab">Échéances</div></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;">
          <button onclick="genAdminTestData()" style="background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);color:white;border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;">🧪 Générer tests</button>
          <button onclick="purgeAdminTestData()" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.75);border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;">🧹 Supprimer tests</button>
          <button onclick="purgeAllAdminData()" style="background:rgba(220,38,38,0.3);border:1px solid rgba(220,38,38,0.5);color:var(--sf-loss);border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;">🗑 Tout supprimer</button>
        </div>
      </div>
    </div>

    <!-- Tabs -->
    <div class="adm-tabs">
      <button class="adm-tab active" id="adm-tab-sci"      onclick="switchAdminTab('sci')">🏛️ Mes SCI</button>
      <button class="adm-tab"        id="adm-tab-annuaire" onclick="switchAdminTab('annuaire')">👥 Annuaire</button>
      <button class="adm-tab"        id="adm-tab-echeances"onclick="switchAdminTab('echeances')">📅 Échéances</button>
      <button class="adm-tab"        id="adm-tab-bilans"   onclick="switchAdminTab('bilans')">📊 Bilans comptables</button>
    </div>

    <!-- Contenu onglets -->
    <div id="adm-content" class="adm-tab-content"></div>
  </div>`;

  await loadAdminData();
  switchAdminTab(adminTab);
}

async function loadAdminData() {
  try {
    // S'assurer que allBiens est chargé (nécessaire pour le cashflow SCI)
    if (!allBiens.length && currentUser) await loadBiens();
    const [sci, contacts, echeances, bilans] = await Promise.all([
      db.from('sci').select('*').order('created_at'),
      db.from('contacts').select('*').order('nom'),
      db.from('sci_echeances').select('*').order('date_echeance'),
      db.from('bilans_comptables').select('*,sci(nom_sci)').order('exercice', {ascending:false}),
    ]);
    allSCI       = sci.data || [];
    allContacts  = contacts.data || [];
    allEcheances = echeances.data || [];
    allBilans    = bilans.data || [];
    // KPIs hero
    const urg = allEcheances.filter(e => {
      if(e.est_faite) return false;
      const j = Math.ceil((new Date(e.date_echeance)-new Date())/(1000*86400));
      return j <= 30;
    }).length;
    const kSci = document.getElementById('adm-k-sci');
    const kCon = document.getElementById('adm-k-contacts');
    const kEch = document.getElementById('adm-k-ech');
    if(kSci) kSci.textContent = allSCI.length;
    if(kCon) kCon.textContent = allContacts.length;
    if(kEch) kEch.textContent = urg ? `${urg} ⚠️` : allEcheances.length;
    // Mettre à jour aussi la liste dans Paramètres
    renderSCIList();
  } catch(e) { console.error('loadAdminData', e); }
}

function switchAdminTab(tab) {
  adminTab = tab;
  ['sci','annuaire','echeances','bilans'].forEach(t => {
    document.getElementById('adm-tab-'+t)?.classList.toggle('active', t === tab);
  });
  const c = document.getElementById('adm-content');
  if(!c) return;
  if(tab === 'sci')       renderAdmSCI(c);
  else if(tab === 'annuaire')  renderAdmAnnuaire(c);
  else if(tab === 'echeances') renderAdmEcheances(c);
  else if(tab === 'bilans')    renderAdmBilans(c);
}

// ─────────────────────────────────────────────
// ONGLET 1 — MES SCI
// ─────────────────────────────────────────────
function renderAdmSCI(c) {
  if(!allSCI.length) {
    c.innerHTML = `
      <div class="adm-empty">
        <div style="font-size:40px;margin-bottom:12px">🏛️</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Aucune SCI créée</div>
        <div style="font-size:13px;color:var(--c-muted);margin-bottom:18px">Créez votre première structure pour commencer</div>
        <button class="btn btn-primary" onclick="openSCIModal(null)">＋ Créer une SCI</button>
      </div>`;
    return;
  }

  c.innerHTML = `
    <div class="adm-toolbar">
      <div style="font-size:13px;color:var(--c-muted)">${allSCI.length} SCI enregistrée${allSCI.length>1?'s':''}</div>
      <button class="btn btn-primary btn-sm" onclick="openSCIModal(null)">＋ Nouvelle SCI</button>
    </div>
    <div class="sci-grid">
      ${allSCI.map(s => {
        const initials = (s.nom_sci||'SC').substring(0,2).toUpperCase();
        const nbAssoc = (s.associes||[]).length;
        const biensSCI = allBiens.filter(b => b.sci_id === s.id);
        // ⚠️ FND-001 : cette somme passait par `computeCF()` seul — du
        // prévisionnel pur. C'est le défaut corrigé sur « Mes biens » le
        // 03/08/2026, resté ici. Un bien acquis dont les loyers sont encaissés
        // était compté en prévisionnel alors que tout le reste de la
        // plateforme affiche son réel, et une fiche sans loyer estimé faisait
        // retrancher ses charges d'un loyer nul.
        // RÈGLE : toute agrégation passe par `cfDisplayData()`, jamais
        // `computeCF()` seul. Les fiches non chiffrables sont écartées, pas
        // comptées pour zéro — leur nombre est dit à côté.
        const cfSCI    = biensSCI.map(b => cfDisplayData(b).value).filter(v => v != null);
        const cashflow = cfSCI.reduce((sum, v) => sum + v, 0);
        const ecartes  = biensSCI.length - cfSCI.length;
        const cfColor = cashflow >= 0 ? 'var(--positive)' : 'var(--negative)';
        return `
        <div class="sci-card" onclick="openSCIDetail('${s.id}')">
          <div class="sci-card-head">
            <div class="sci-card-avatar">${initials}</div>
            <div>
              <div class="sci-card-name">${esc(s.nom_sci)}</div>
              <div class="sci-card-sub">${s.siret ? `SIRET : ${esc(s.siret)}` : 'SIRET non renseigné'}</div>
            </div>
            <button class="sci-card-edit" onclick="event.stopPropagation();openSCIModal('${s.id}')" title="Modifier">✏️</button>
          </div>
          <div class="sci-card-stats">
            <div class="sci-stat"><div class="sci-stat-val">${s.capital_social ? fmt(s.capital_social)+' €' : '—'}</div><div class="sci-stat-lab">Capital</div></div>
            <div class="sci-stat"><div class="sci-stat-val">${nbAssoc}</div><div class="sci-stat-lab">Associé${nbAssoc>1?'s':''}</div></div>
            <div class="sci-stat"><div class="sci-stat-val">${biensSCI.length}</div><div class="sci-stat-lab">Bien${biensSCI.length>1?'s':''}</div></div>
            <div class="sci-stat"><div class="sci-stat-val" style="color:${cfSCI.length?cfColor:'var(--c-dim)'}">${cfSCI.length ? (cashflow>=0?'+':'−')+sfEur(Math.abs(cashflow)) : '—'}</div><div class="sci-stat-lab">Cashflow/mois${ecartes ? ` · ${ecartes} à compléter` : ''}</div></div>
          </div>
          ${(s.associes||[]).length ? `
          <div class="sci-card-assocs">
            ${s.associes.map(a=>`<span class="assoc-chip">${esc(a.prenom||'')} ${esc(a.nom||'')} ${a.parts_pct?'('+a.parts_pct+'%)'  :''}</span>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
}

function openSCIDetail(id) {
  // Ouvre la modal d'édition pour l'instant — vue détail à enrichir plus tard
  openSCIModal(id);
}

// ─────────────────────────────────────────────
// ONGLET 2 — ANNUAIRE
// ─────────────────────────────────────────────
function renderAdmAnnuaire(c) {
  const roleIcons = {
    'Notaire':'⚖️','Avocat':'👨‍⚖️','Expert-comptable':'📒','Banquier':'🏦',
    'Agent immobilier':'🏠','Gestionnaire locatif':'🔑','Artisan':'🔨','Syndic':'🏢','Autre':'👤'
  };
  // Neuf teintes categorielles, remontees en luminosite pour le fond sombre.
  // Elles restent ecrites en HEXADECIMAL SIX CHIFFRES et non en var(--...) :
  // la pastille en construit son fond par `${couleur}22`, c'est-a-dire en
  // ajoutant deux chiffres d'opacite a la fin du code. Une variable CSS ne
  // supporte pas cette concatenation — `var(--x)22` n'est pas une couleur.
  const roleColors = {
    'Notaire':'#BCA0F5','Avocat':'#9DAEF7','Expert-comptable':'#6BD5D0','Banquier':'#5BD08A',
    'Agent immobilier':'#F0B429','Gestionnaire locatif':'#FFA36B','Artisan':'#9BAEA4','Syndic':'#8CC0F0','Autre':'#9BAEA4'
  };

  // Grouper par rôle
  const grouped = {};
  allContacts.forEach(ct => {
    if(!grouped[ct.role]) grouped[ct.role] = [];
    grouped[ct.role].push(ct);
  });

  c.innerHTML = `
    <div class="adm-toolbar">
      <div style="font-size:13px;color:var(--c-muted)">${allContacts.length} contact${allContacts.length>1?'s':''}</div>
      <button class="btn btn-primary btn-sm" onclick="openContactModal(null)">＋ Ajouter un contact</button>
    </div>
    ${!allContacts.length ? `
      <div class="adm-empty">
        <div style="font-size:40px;margin-bottom:12px">👥</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Aucun contact</div>
        <div style="font-size:13px;color:var(--c-muted);margin-bottom:18px">Ajoutez vos notaires, banquiers, avocats…</div>
        <button class="btn btn-primary" onclick="openContactModal(null)">＋ Ajouter un contact</button>
      </div>` :
    Object.entries(grouped).map(([role, cts]) => `
      <div class="adm-group">
        <div class="adm-group-title">
          <span>${roleIcons[role]||'👤'} ${role}</span>
          <span class="adm-group-count">${cts.length}</span>
        </div>
        <div class="contact-grid">
          ${cts.map(ct => `
            <div class="contact-card" onclick="openContactModal('${ct.id}')">
              <div class="contact-avatar" style="background:${roleColors[ct.role]||'#9BAEA4'}22;color:${roleColors[ct.role]||'#9BAEA4'}">
                ${(ct.prenom||ct.nom||'?').charAt(0).toUpperCase()}
              </div>
              <div class="contact-info">
                <div class="contact-name">${ct.prenom||''} ${ct.nom}</div>
                ${ct.societe ? `<div class="contact-sub">${ct.societe}</div>` : ''}
                ${ct.telephone ? `<div class="contact-sub">📞 ${ct.telephone}</div>` : ''}
                ${ct.email ? `<div class="contact-sub">✉️ ${ct.email}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>`).join('')
    }`;
}

// ─────────────────────────────────────────────
// ONGLET 3 — ÉCHÉANCES
// ─────────────────────────────────────────────
function renderAdmEcheances(c) {
  const now = new Date();
  const withDays = allEcheances.map(e => ({
    ...e,
    joursRestants: Math.ceil((new Date(e.date_echeance) - now) / (1000*86400))
  })).sort((a,b) => a.joursRestants - b.joursRestants);

  const typeIcons = {
    'Assurance':'🛡️','Dépôt bilan':'📋','Renouvellement':'🔄',
    'Fiscal':'💰','Administratif':'📁','Autre':'📌'
  };

  c.innerHTML = `
    <div class="adm-toolbar">
      <div style="font-size:13px;color:var(--c-muted)">${allEcheances.length} échéance${allEcheances.length>1?'s':''}</div>
      <button class="btn btn-primary btn-sm" onclick="openEcheanceModal(null)">＋ Ajouter</button>
    </div>
    ${!withDays.length ? `
      <div class="adm-empty">
        <div style="font-size:40px;margin-bottom:12px">📅</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Aucune échéance</div>
        <div style="font-size:13px;color:var(--c-muted);margin-bottom:18px">Ajoutez vos rappels d'assurance, dépôts de bilan…</div>
        <button class="btn btn-primary" onclick="openEcheanceModal(null)">＋ Ajouter une échéance</button>
      </div>` :
    `<div class="ech-list">
      ${withDays.map(e => {
        const sciName = allSCI.find(s=>s.id===e.sci_id)?.nom_sci || 'Global';
        let badge='', badgeCls='';
        if(e.est_faite){ badge='✓ Faite'; badgeCls='ech-done'; }
        else if(e.joursRestants < 0){ badge=`${Math.abs(e.joursRestants)}j de retard`; badgeCls='ech-late'; }
        else if(e.joursRestants <= 30){ badge=`J−${e.joursRestants}`; badgeCls='ech-urgent'; }
        else { badge=`J−${e.joursRestants}`; badgeCls='ech-ok'; }
        const dateStr = new Date(e.date_echeance).toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'});
        return `
        <div class="ech-item ${e.est_faite?'ech-item-done':''}" onclick="openEcheanceModal('${e.id}')">
          <div class="ech-icon">${typeIcons[e.type_echeance]||'📌'}</div>
          <div class="ech-body">
            <div class="ech-title">${e.titre}</div>
            <div class="ech-meta">${sciName} · ${dateStr} ${e.recurrence&&e.recurrence!=='Aucune'?'· 🔄 '+e.recurrence:''}</div>
          </div>
          <div class="ech-badge ${badgeCls}">${badge}</div>
          <button class="ech-check ${e.est_faite?'checked':''}" onclick="event.stopPropagation();toggleEcheance('${e.id}',${!e.est_faite})" title="${esc(e.est_faite?'Marquer non faite':'Marquer faite')}">
            ${e.est_faite?'✓':'○'}
          </button>
        </div>`; }).join('')}
    </div>`}`;
}

// ─────────────────────────────────────────────
// ONGLET 4 — BILANS COMPTABLES
// ─────────────────────────────────────────────
// ─── FND-015 : modèle canonique du compte de résultat IS (PCG) ───
// is_compte_resultat (jsonb) = {
//   produits:  { loyers, charges_recuperees, autres },
//   charges:   { copro, assurances, taxes, entretien, honoraires, frais_bancaires, interets, autres },
//   dotations: { immeuble, travaux, mobilier }   // 6811 — les amortissements vivent ICI
// }
// Les colonnes plates amortissement_* de bilans_comptables sont dépréciées : lues en
// fallback legacy, remises à null à la prochaine alimentation du bilan.
const PCG_CR_LABELS = {
  produits: { loyers:'706 · Loyers encaissés', charges_recuperees:'708 · Charges récupérées', autres:'75 · Autres produits' },
  charges:  { copro:'614 · Charges de copropriété', entretien:'615 · Entretien et réparations',
              assurances:'616 · Primes d\'assurance', honoraires:'622 · Honoraires',
              frais_bancaires:'627 · Services bancaires', autres:'628 · Autres charges externes',
              taxes:'635 · Impôts et taxes', interets:'661 · Intérêts d\'emprunt' },
  dotations:{ immeuble:'6811 · Amortissement immeuble', travaux:'6811 · Amortissement travaux', mobilier:'6811 · Amortissement mobilier' },
};

// Catégorie de charge réelle (Module Financier) → poste PCG du compte de résultat
const CAT_TO_PCG = {
  'Copropriété':'copro', 'Assurance PNO':'assurances', 'Taxe foncière':'taxes', 'CFE':'taxes',
  'Travaux entretien':'entretien', 'Travaux amélioration':'entretien',
  'Honoraires gestion':'honoraires', 'Honoraires comptable':'honoraires',
  'Frais bancaires':'frais_bancaires', 'Intérêts emprunt':'interets', 'Autre':'autres',
};

function bilanSumObj(o) { return Object.values(o || {}).reduce((s, v) => s + (parseFloat(v) || 0), 0); }

// Dotations : is_compte_resultat prioritaire, fallback colonnes plates legacy
function bilanDotations(b) {
  const d = b.is_compte_resultat?.dotations;
  if(d && bilanSumObj(d) > 0) return d;
  return {
    immeuble: parseFloat(b.amortissement_immeuble) || 0,
    travaux:  parseFloat(b.amortissement_travaux)  || 0,
    mobilier: parseFloat(b.amortissement_mobilier) || 0,
  };
}

function bilanEstAlimente(b) {
  if(b.regime === 'IR') return b.ir_loyers_percus != null || bilanSumObj(b.ir_charges_deductibles) > 0;
  const cr = b.is_compte_resultat || {};
  return bilanSumObj(cr.produits) > 0 || bilanSumObj(cr.charges) > 0 || bilanSumObj(bilanDotations(b)) > 0;
}

// Résultat net d'un bilan, sur le VRAI schéma (fix : l'ancien code lisait des
// colonnes plates inexistantes → NaN dès qu'un bilan avait des données)
function bilanResultatNet(b) {
  if(b.regime === 'IR') return (parseFloat(b.ir_loyers_percus) || 0) - bilanSumObj(b.ir_charges_deductibles);
  const cr = b.is_compte_resultat || {};
  return bilanSumObj(cr.produits) - bilanSumObj(cr.charges) - bilanSumObj(bilanDotations(b));
}

function renderAdmBilans(c) {
  c.innerHTML = `
    <div class="adm-toolbar">
      <div style="font-size:13px;color:var(--c-muted)">${allBilans.length} bilan${allBilans.length>1?'s':''}</div>
      <button class="btn btn-primary btn-sm" onclick="openBilanModal(null)">＋ Nouveau bilan</button>
    </div>

    ${!allSCI.length ? `
      <div class="adm-empty">
        <div style="font-size:40px;margin-bottom:12px">🏛️</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Aucune SCI créée</div>
        <div style="font-size:13px;color:var(--c-muted)">Créez d'abord une SCI pour générer un bilan</div>
      </div>` :

    !allBilans.length ? `
      <div class="adm-empty">
        <div style="font-size:40px;margin-bottom:12px">📊</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px">Aucun bilan créé</div>
        <div style="font-size:13px;color:var(--c-muted);margin-bottom:8px">La structure IR et IS est prête. Les données seront alimentées automatiquement par le module financier.</div>
        <div class="bilan-info-box">
          <div class="bilan-regime"><span class="bilan-badge ir">IR</span><div><strong>Régime IR</strong> — Déclaration 2044, comptabilité de trésorerie. Adapté aux petites SCI (CA &lt; 700k€).</div></div>
          <div class="bilan-regime"><span class="bilan-badge is">IS</span><div><strong>Régime IS</strong> — Bilan PCG complet (actif/passif), amortissements, dépôt au greffe. Permet de déduire l'amortissement du bien.</div></div>
        </div>
        <button class="btn btn-primary" style="margin-top:16px" onclick="openBilanModal(null)">＋ Créer un bilan</button>
      </div>` :

    `<div class="bilan-list">
      ${allBilans.map(b => {
        const alimente = bilanEstAlimente(b);
        const resultat = bilanResultatNet(b);
        const statutColor = {Brouillon:'var(--c-muted)',Validé:'var(--positive)',Déposé:'var(--accent)'}[b.statut]||'var(--c-muted)';
        return `
        <div class="bilan-card" onclick="openBilanModal('${b.id}')">
          <div class="bilan-card-head">
            <div>
              <div class="bilan-card-title">Bilan ${b.exercice} — ${b.sci?.nom_sci||'—'}</div>
              <div class="bilan-card-sub">Régime <span class="bilan-badge ${b.regime.toLowerCase()}">${b.regime}</span></div>
            </div>
            <div style="text-align:right">
              <div style="font-size:11px;color:${statutColor};font-weight:600">${esc(b.statut)}</div>
              ${alimente ? `
              <div style="font-size:18px;font-weight:800;color:${resultat>=0?'var(--positive)':'var(--negative)'};margin-top:2px">${resultat>=0?'+':''}${fmt(resultat)} €</div>
              <div style="font-size:10px;color:var(--c-muted)">Résultat net</div>` : `
              <div style="font-size:13px;font-weight:600;color:var(--c-muted);margin-top:4px">Non alimenté</div>
              <div style="font-size:10px;color:var(--c-dim)">via Suivi financier › Performance</div>`}
            </div>
          </div>
          <div class="bilan-card-footer">
            <span>📋 ${b.regime==='IR'?'Déclaration 2044':'Bilan PCG simplifié'}</span>
            ${/* ⚠️ Cette ligne promettait « Export PDF · Excel · FEC » alors
                  qu'AUCUNE fonction ne produit ni PDF ni FEC — et « Excel »
                  désignait le CSV. Trois promesses affichées à l'utilisateur,
                  aucune tenue. Le FEC n'est d'ailleurs pas générable en
                  l'état : il exige des écritures en partie double, Stonefolio
                  stocke des totaux annuels.
                  L'export CSV, lui, existe : « Suivi financier › Performance ›
                  Déclaration fiscale », en détail et en synthèse. */''}
            <span>Export CSV — détail et synthèse</span>
          </div>
        </div>`;}).join('')}
    </div>`}`;
}

// ═══════════════════════════════════════════
// MODALS — Contacts
// ═══════════════════════════════════════════
// Rattachements SCI du contact en cours d'edition. Charges a l'ouverture de la
// fenetre, compares a la fermeture : c'est cette liste qui dit ce qui a change.
let ctSciInitial = [];

async function openContactModal(id) {
  editingContactId = id;
  const ct = id ? allContacts.find(c=>c.id===id) : null;
  const roles = ['Notaire','Avocat','Expert-comptable','Banquier','Agent immobilier','Gestionnaire locatif','Artisan','Syndic','Associé','Autre'];

  // Les cases « SCI rattachée(s) » s'affichaient TOUJOURS decochees et n'etaient
  // jamais relues a l'enregistrement : le controle donnait le change sans avoir
  // le moindre effet, ni en lecture ni en ecriture. On charge donc l'existant.
  ctSciInitial = [];
  if(id) {
    try {
      const { data, error } = await db.from('sci_contacts')
        .select('sci_id').eq('contact_id', id).eq('user_id', currentUser.id);
      if(error) throw error;
      ctSciInitial = (data || []).map(r => r.sci_id);
    } catch(e) {
      // On prefere ne pas ouvrir plutot que d'afficher des cases fausses :
      // l'utilisateur enregistrerait un rattachement vide sans le voir.
      showNotif('Rattachements SCI illisibles : ' + e.message, true);
      return;
    }
  }

  const m = document.getElementById('adm-modal-overlay');
  document.getElementById('adm-modal-title').textContent = id ? 'Modifier le contact' : '＋ Nouveau contact';
  document.getElementById('adm-modal-del').style.display = id ? 'flex' : 'none';
  document.getElementById('adm-modal-save').onclick = saveContact;
  document.getElementById('adm-modal-del').onclick = deleteContact;
  document.getElementById('adm-modal-body').innerHTML = `
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Prénom</label>
        <input class="sci-form-input" id="ct-prenom" value="${esc(ct?.prenom||'')}" placeholder="Prénom"></div>
      <div class="sci-form-group"><label class="sci-form-label">Nom <span style="color:var(--sf-loss)">*</span></label>
        <input class="sci-form-input" id="ct-nom" value="${esc(ct?.nom||'')}" placeholder="Nom de famille"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Rôle <span style="color:var(--sf-loss)">*</span></label>
      <select class="sci-form-input" id="ct-role" onchange="document.getElementById('ct-role-detail-row').style.display=this.value==='Autre'?'block':'none'">
        ${roles.map(r=>`<option value="${r}" ${ct?.role===r?'selected':''}>${r}</option>`).join('')}
      </select></div>
    <div class="sci-form-group" id="ct-role-detail-row" style="display:${ct?.role==='Autre'?'block':'none'}">
      <label class="sci-form-label">Précisez le rôle</label>
      <input class="sci-form-input" id="ct-role-detail" value="${esc(ct?.role_detail||'')}" placeholder="Ex : Courtier, Architecte…"></div>
    <div class="sci-form-group"><label class="sci-form-label">Entreprise / Cabinet</label>
      <input class="sci-form-input" id="ct-societe" value="${esc(ct?.societe||'')}" placeholder="Cabinet Martin…"></div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Téléphone</label>
        <input class="sci-form-input" id="ct-tel" value="${esc(ct?.telephone||'')}" placeholder="06 xx xx xx xx"></div>
      <div class="sci-form-group"><label class="sci-form-label">Email</label>
        <input class="sci-form-input" id="ct-email" value="${esc(ct?.email||'')}" placeholder="email@exemple.com"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Adresse</label>
      <input class="sci-form-input" id="ct-adresse" value="${esc(ct?.adresse||'')}" placeholder="Adresse professionnelle"></div>
    <div class="sci-form-group"><label class="sci-form-label">SCI(s) rattachée(s)</label>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px" id="ct-sci-chips">
        ${allSCI.length ? allSCI.map(s=>`
          <label style="display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer">
            <input type="checkbox" class="ct-sci-case" data-sci="${esc(s.id)}" ${ctSciInitial.includes(s.id)?'checked':''}>
            ${esc(s.nom_sci)}
          </label>`).join('')
        : '<span class="sci-form-hint">Aucune SCI enregistrée pour l\'instant.</span>'}
      </div></div>
    <div class="sci-form-group"><label class="sci-form-label">Notes</label>
      <textarea class="sci-form-input" id="ct-notes" rows="2" style="resize:vertical">${esc(ct?.notes||'')}</textarea></div>`;

  m.classList.add('open');
}

async function saveContact() {
  const nom = document.getElementById('ct-nom').value.trim();
  if(!nom) { showNotif('Le nom est obligatoire.', true); return; }
  const btn = document.getElementById('adm-modal-save');
  btn.disabled = true; btn.innerHTML = '<span class="sci-spinner"></span>Enregistrement…';
  const payload = {
    nom, prenom: document.getElementById('ct-prenom').value.trim()||null,
    role: document.getElementById('ct-role').value,
    role_detail: document.getElementById('ct-role-detail')?.value.trim()||null,
    societe: document.getElementById('ct-societe').value.trim()||null,
    telephone: document.getElementById('ct-tel').value.trim()||null,
    email: document.getElementById('ct-email').value.trim()||null,
    adresse: document.getElementById('ct-adresse').value.trim()||null,
    notes: document.getElementById('ct-notes').value.trim()||null,
    user_id: currentUser.id
  };
  try {
    let res;
    if(editingContactId) res = await db.from('contacts').update(payload).eq('id',editingContactId).select().maybeSingle();
    else res = await db.from('contacts').insert(payload).select().maybeSingle();
    if(res.error) throw res.error;

    // Synchronisation des rattachements SCI. On n'ecrit QUE l'ecart : rien ne
    // sert de tout supprimer puis tout reinserer, et une suppression suivie
    // d'une insertion qui echoue perdrait des liens existants.
    const contactId = editingContactId || res.data?.id;
    if(contactId) {
      const coches = [...document.querySelectorAll('.ct-sci-case')]
        .filter(c => c.checked).map(c => c.dataset.sci);
      const aAjouter = coches.filter(s => !ctSciInitial.includes(s));
      const aRetirer = ctSciInitial.filter(s => !coches.includes(s));
      if(aAjouter.length) {
        const { error } = await db.from('sci_contacts').insert(
          aAjouter.map(sci_id => ({ sci_id, contact_id: contactId, user_id: currentUser.id })));
        if(error) throw error;
      }
      if(aRetirer.length) {
        const { error } = await db.from('sci_contacts').delete()
          .eq('contact_id', contactId).eq('user_id', currentUser.id).in('sci_id', aRetirer);
        if(error) throw error;
      }
    }

    showNotif(editingContactId?'Contact mis à jour ✓':'Contact ajouté ✓');
    closeAdmModal(); await loadAdminData(); switchAdminTab('annuaire');
  } catch(e) { showNotif('Erreur : '+e.message, true); }
  finally { btn.disabled=false; btn.innerHTML=sfAccIcon("check",14)+' Enregistrer'; }
}

async function deleteContact() {
  if(!editingContactId || !confirm('Supprimer ce contact ?')) return;
  const {error} = await db.from('contacts').delete().eq('id',editingContactId);
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  showNotif('Contact supprimé');
  closeAdmModal(); await loadAdminData(); switchAdminTab('annuaire');
}

// ═══════════════════════════════════════════
// MODALS — Échéances
// ═══════════════════════════════════════════
function openEcheanceModal(id) {
  editingEcheanceId = id;
  const e = id ? allEcheances.find(x=>x.id===id) : null;
  const types = ['Assurance','Dépôt bilan','Renouvellement','Fiscal','Administratif','Autre'];
  const recs  = ['Aucune','Annuelle','Semestrielle','Trimestrielle','Mensuelle'];

  document.getElementById('adm-modal-title').textContent = id ? 'Modifier l\'échéance' : '＋ Nouvelle échéance';
  document.getElementById('adm-modal-del').style.display = id ? 'flex' : 'none';
  document.getElementById('adm-modal-save').onclick = saveEcheance;
  document.getElementById('adm-modal-del').onclick = deleteEcheance;
  document.getElementById('adm-modal-body').innerHTML = `
    <div class="sci-form-group"><label class="sci-form-label">Titre <span style="color:var(--sf-loss)">*</span></label>
      <input class="sci-form-input" id="ech-titre" value="${esc(e?.titre||'')}" placeholder="Ex : Renouvellement assurance PNO"></div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Type</label>
        <select class="sci-form-input" id="ech-type">
          ${types.map(t=>`<option value="${t}" ${e?.type_echeance===t?'selected':''}>${t}</option>`).join('')}
        </select></div>
      <div class="sci-form-group"><label class="sci-form-label">SCI concernée</label>
        <select class="sci-form-input" id="ech-sci">
          <option value="">Toutes mes SCI</option>
          ${allSCI.map(s=>`<option value="${s.id}" ${e?.sci_id===s.id?'selected':''}>${esc(s.nom_sci)}</option>`).join('')}
        </select></div>
    </div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">Date d'échéance <span style="color:var(--sf-loss)">*</span></label>
        <input class="sci-form-input" id="ech-date" type="date" value="${esc(e?.date_echeance||'')}"></div>
      <div class="sci-form-group"><label class="sci-form-label">Rappel (jours avant)</label>
        <input class="sci-form-input" id="ech-rappel" type="number" value="${e?.rappel_j_avant??30}" min="0" max="365"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Récurrence</label>
      <select class="sci-form-input" id="ech-rec">
        ${recs.map(r=>`<option value="${r}" ${e?.recurrence===r?'selected':''}>${r}</option>`).join('')}
      </select></div>
    <div class="sci-form-group"><label class="sci-form-label">Notes</label>
      <textarea class="sci-form-input" id="ech-notes" rows="2" style="resize:vertical">${esc(e?.notes||'')}</textarea></div>`;

  document.getElementById('adm-modal-overlay').classList.add('open');
}

async function saveEcheance() {
  const titre = document.getElementById('ech-titre').value.trim();
  const date  = document.getElementById('ech-date').value;
  if(!titre || !date) { showNotif('Titre et date sont obligatoires.', true); return; }
  const btn = document.getElementById('adm-modal-save');
  btn.disabled=true; btn.innerHTML='<span class="sci-spinner"></span>Enregistrement…';
  const sciVal = document.getElementById('ech-sci').value;
  const payload = {
    titre, date_echeance: date,
    type_echeance: document.getElementById('ech-type').value,
    sci_id: sciVal || null,
    rappel_j_avant: parseInt(document.getElementById('ech-rappel').value)||30,
    recurrence: document.getElementById('ech-rec').value,
    est_faite: false,
    notes: document.getElementById('ech-notes').value.trim()||null,
    user_id: currentUser.id
  };
  try {
    let res;
    if(editingEcheanceId) res = await db.from('sci_echeances').update(payload).eq('id',editingEcheanceId);
    else res = await db.from('sci_echeances').insert(payload);
    if(res.error) throw res.error;
    showNotif(editingEcheanceId?'Échéance mise à jour ✓':'Échéance ajoutée ✓');
    closeAdmModal(); await loadAdminData(); switchAdminTab('echeances');
  } catch(e) { showNotif('Erreur : '+e.message, true); }
  finally { btn.disabled=false; btn.innerHTML=sfAccIcon("check",14)+' Enregistrer'; }
}

async function deleteEcheance() {
  if(!editingEcheanceId || !confirm('Supprimer cette échéance ?')) return;
  const {error} = await db.from('sci_echeances').delete().eq('id',editingEcheanceId);
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  showNotif('Échéance supprimée');
  closeAdmModal(); await loadAdminData(); switchAdminTab('echeances');
}

async function toggleEcheance(id, val) {
  await db.from('sci_echeances').update({est_faite:val}).eq('id',id);
  await loadAdminData(); switchAdminTab('echeances');
}

// ═══════════════════════════════════════════
// MODAL — Bilans (structure, sans saisie pour l'instant)
// ═══════════════════════════════════════════
function openBilanModal(id) {
  editingBilanId = id || null;
  const b = id ? allBilans.find(x=>x.id===id) : null;
  document.getElementById('adm-modal-title').textContent = id ? `Bilan ${b?.exercice}` : '＋ Nouveau bilan';
  document.getElementById('adm-modal-del').style.display = id ? 'flex' : 'none';
  document.getElementById('adm-modal-save').onclick = saveBilan;
  document.getElementById('adm-modal-del').onclick = deleteBilan;
  const anneeActuelle = new Date().getFullYear();
  // Résumé lecture seule des données alimentées (FND-015 : lecture sur le vrai schéma)
  let resumeHtml = '';
  if(b && bilanEstAlimente(b)) {
    const resultat = bilanResultatNet(b);
    let lignes = '';
    if(b.regime === 'IR') {
      lignes = `
        <div class="bilan-resume-row"><span>Loyers perçus</span><span>${fmt(parseFloat(b.ir_loyers_percus)||0)} €</span></div>
        <div class="bilan-resume-row"><span>Charges déductibles (2044)</span><span>−${fmt(bilanSumObj(b.ir_charges_deductibles))} €</span></div>`;
    } else {
      const cr = b.is_compte_resultat || {};
      lignes = `
        <div class="bilan-resume-row"><span>Produits</span><span>${fmt(bilanSumObj(cr.produits))} €</span></div>
        <div class="bilan-resume-row"><span>Charges</span><span>−${fmt(bilanSumObj(cr.charges))} €</span></div>
        <div class="bilan-resume-row"><span>Dotations amortissements (6811)</span><span>−${fmt(bilanSumObj(bilanDotations(b)))} €</span></div>`;
    }
    resumeHtml = `
      <div class="bilan-info-box" style="margin-bottom:16px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--c-muted);margin-bottom:8px">📊 Données de l'exercice</div>
        ${lignes}
        <div class="bilan-resume-row total"><span>Résultat net</span><span style="color:${resultat>=0?'var(--positive)':'var(--negative)'}">${resultat>=0?'+':''}${fmt(resultat)} €</span></div>
      </div>`;
  }
  document.getElementById('adm-modal-body').innerHTML = `
    ${resumeHtml}
    <div class="bilan-info-box" style="margin-bottom:16px">
      <div style="font-size:12px;color:var(--c-muted);line-height:1.6">
        💡 Les données comptables s'alimentent depuis <strong>Suivi financier › Performance</strong>
        (bouton « Alimenter le bilan SCI »), à partir des loyers encaissés et charges réelles de l'exercice.
      </div>
    </div>
    <div class="sci-form-row">
      <div class="sci-form-group"><label class="sci-form-label">SCI <span style="color:var(--sf-loss)">*</span></label>
        <select class="sci-form-input" id="bil-sci">
          <option value="">Sélectionner une SCI</option>
          ${allSCI.map(s=>`<option value="${s.id}" ${b?.sci_id===s.id?'selected':''}>${esc(s.nom_sci)}</option>`).join('')}
        </select></div>
      <div class="sci-form-group"><label class="sci-form-label">Exercice <span style="color:var(--sf-loss)">*</span></label>
        <input class="sci-form-input" id="bil-annee" type="number" value="${esc(b?.exercice||anneeActuelle)}" min="2020" max="2050"></div>
    </div>
    <div class="sci-form-group"><label class="sci-form-label">Régime fiscal <span style="color:var(--sf-loss)">*</span></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px">
        <label class="regime-option ${!b||b.regime==='IR'?'active':''}">
          <input type="radio" name="bil-regime" value="IR" ${!b||b.regime==='IR'?'checked':''} onchange="this.closest('.sci-form-group').querySelectorAll('.regime-option').forEach(o=>o.classList.toggle('active',o.querySelector('input').checked))">
          <span class="bilan-badge ir">IR</span>
          <div><strong>Impôt sur le Revenu</strong><br><span style="font-size:11px;color:var(--c-muted)">Déclaration 2044 · Comptabilité de trésorerie</span></div>
        </label>
        <label class="regime-option ${b?.regime==='IS'?'active':''}">
          <input type="radio" name="bil-regime" value="IS" ${b?.regime==='IS'?'checked':''} onchange="this.closest('.sci-form-group').querySelectorAll('.regime-option').forEach(o=>o.classList.toggle('active',o.querySelector('input').checked))">
          <span class="bilan-badge is">IS</span>
          <div><strong>Impôt sur les Sociétés</strong><br><span style="font-size:11px;color:var(--c-muted)">Bilan PCG · Amortissements · Dépôt greffe</span></div>
        </label>
      </div></div>
    <div class="sci-form-group"><label class="sci-form-label">Statut</label>
      <select class="sci-form-input" id="bil-statut">
        ${['Brouillon','Validé','Déposé'].map(s=>`<option ${b?.statut===s?'selected':''}>${s}</option>`).join('')}
      </select></div>
    <div class="sci-form-group"><label class="sci-form-label">Notes</label>
      <textarea class="sci-form-input" id="bil-notes" rows="2" style="resize:vertical">${esc(b?.notes||'')}</textarea></div>
    <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:12px;font-size:12px;color:var(--c-muted)">
      ⚖️ <em>Il est recommandé de faire valider ce bilan par un expert-comptable avant tout dépôt officiel.</em>
    </div>`;
  document.getElementById('adm-modal-overlay').classList.add('open');
}

async function saveBilan() {
  const sciId = document.getElementById('bil-sci').value;
  const annee = parseInt(document.getElementById('bil-annee').value);
  const regime = document.querySelector('input[name="bil-regime"]:checked')?.value;
  if(!sciId || !annee || !regime) { showNotif('SCI, exercice et régime sont obligatoires.', true); return; }
  const btn = document.getElementById('adm-modal-save');
  btn.disabled=true; btn.innerHTML='<span class="sci-spinner"></span>Enregistrement…';
  const bId = editingBilanId || null;
  const payload = { sci_id:sciId, exercice:annee, regime:regime,
    statut:document.getElementById('bil-statut').value,
    notes:document.getElementById('bil-notes').value.trim()||null, user_id:currentUser.id };
  try {
    let res;
    if(bId) res = await db.from('bilans_comptables').update(payload).eq('id',bId);
    else res = await db.from('bilans_comptables').insert(payload);
    if(res.error) throw res.error;
    showNotif(bId?'Bilan mis à jour ✓':'Bilan créé ✓');
    closeAdmModal(); await loadAdminData(); switchAdminTab('bilans');
  } catch(e) { showNotif('Erreur : '+(e.message.includes('unique')?'Un bilan existe déjà pour cette SCI et cet exercice.':e.message), true); }
  finally { btn.disabled=false; btn.innerHTML=sfAccIcon("check",14)+' Enregistrer'; }
}

async function deleteBilan() {
  if(!editingBilanId || !confirm('Supprimer ce bilan ?')) return;
  const {error} = await db.from('bilans_comptables').delete().eq('id', editingBilanId);
  if(error) { showNotif('Erreur : ' + error.message, true); return; }
  showNotif('Bilan supprimé');
  closeAdmModal(); await loadAdminData(); switchAdminTab('bilans');
}

function closeAdmModal() {
  document.getElementById('adm-modal-overlay').classList.remove('open');
}


// ══════════════════════════════════════════════════════════════
//  SECTION MARCHÉ — Recherche par ville
// ══════════════════════════════════════════════════════════════

let marcheChart = null;
let marcheTimer = null;

// ── Extraction code département depuis code INSEE ────────────

// ── Page Recherche par ville — rendu HTML ────────────────────
function renderMarcheRecherche(el) {
  // Vider proprement le contenu précédent
  el.innerHTML = `
  <div class="marche-page">
    <div class="marche-hero">
      <div class="marche-hero-left">
        <div class="marche-hero-tag">${sfAccIcon('colonne',14)} Données officielles · DGFiP / data.gouv.fr</div>
        <div class="marche-hero-title">Marché immobilier</div>
        <div class="marche-hero-sub">Prix au m², évolution, volumes de ventes — données DVF officielles par commune</div>
      </div>
      <div class="marche-hero-badge">
        <div class="marche-hero-badge-val">2010 → 2022</div>
        <div class="marche-hero-badge-lab">Données INSEE · RP 2022 · Filosophi 2021</div>
      </div>
    </div>

    <div class="marche-search-wrap">
      <div class="marche-search-row">
        <div class="marche-search-field marche-suggest-box" style="flex:2">
          <div class="marche-search-label">Commune ou code postal</div>
          <input class="marche-search-input" id="marche-ville-input"
            placeholder="Ex : Poitiers, Châtellerault, Bordeaux…"
            autocomplete="off"
            oninput="marcheSuggest(this.value)"
            onkeydown="if(event.key==='Enter')marcheSearch()">
          <div class="marche-suggest-list" id="marche-suggest-list" style="display:none"></div>
        </div>
        <div class="marche-search-field" style="flex:1;max-width:180px">
          <div class="marche-search-label">Type de bien</div>
          <select class="marche-search-select" id="marche-type-bien">
            <option value="">Tous types</option>
            <option value="appartement">Appartements</option>
            <option value="maison">Maisons</option>
          </select>
        </div>
        <div>
          <div class="marche-search-label" style="visibility:hidden">.</div>
          <button class="marche-search-btn" id="marche-search-btn" onclick="marcheSearch()">
            🔍 Analyser
          </button>
        </div>
      </div>
    </div>

    <div id="marche-results">
      <div class="marche-empty">
        <div style="font-size:48px;margin-bottom:12px">🔍</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:6px;color:var(--c-text)">Recherchez une commune</div>
        <div style="font-size:13px">Tapez le nom d'une ville pour afficher les données du marché immobilier local</div>
      </div>
    </div>

    <div class="marche-source">
      <span>📊 Source :</span>
      <a href="https://www.data.gouv.fr/datasets/demandes-de-valeurs-foncieres-geolocalisees" target="_blank">
        Indicateurs DV3F (Cerema · open data) · Demandes de Valeurs Foncières — DGFiP / data.gouv.fr
      </a>
      <span>· Licence Ouverte v2.0</span>
    </div>
  </div>`;
}




// ── P5 : ponts entre le Marché et le Pipeline ────────────────
let nouveauPrefill = null;   // {ville, code_postal} consommé par renderNouveau

// Marché → formulaire « Ajouter un bien » pré-rempli
function marcheCreerBien(ville, cp) {
  nouveauPrefill = { ville, code_postal: cp || '' };
  navigate('nouveau');
}

// Fiche bien → analyse de marché de sa commune, recherche lancée d'office
function bdVoirMarche(ville) {
  navigate('marche-recherche');
  setTimeout(() => {
    const input = document.getElementById('marche-ville-input');
    if(input) { input.value = ville; marcheSearch(); }
  }, 80);
}

async function marcheSuggest(val) {
  clearTimeout(marcheTimer);
  const box = document.getElementById('marche-suggest-list');
  if (!val || val.length < 2) { if(box) box.style.display='none'; return; }
  marcheTimer = setTimeout(async () => {
    try {
      const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(val)}&fields=nom,code,codeDepartement,codesPostaux,departement&boost=population&limit=8`;
      const res = await fetch(url);
      const communes = await res.json();
      if (!box) return;
      if (!communes.length) { box.style.display='none'; return; }
      box.innerHTML = communes.map(c => {
        const cp = (c.codesPostaux||[])[0] || c.code;
        const depNom = c.departement?.nom || '';
        return `<div class="marche-suggest-item" onclick="marcheSelectCommune('${c.nom.replace(/'/g,"\\'")}','${c.code}','${depNom.replace(/'/g,"\\'")}','${cp}')">
          ${esc(c.nom)} <span class="suggest-dep">${esc(depNom)} · ${esc(cp)}</span>
        </div>`;
      }).join('');
      box.style.display = 'block';
    } catch(e) { console.warn('Suggest error:', e); }
  }, 280);
}

function marcheSelectCommune(nom, codeInsee, dep, cp) {
  const input = document.getElementById('marche-ville-input');
  if (input) {
    input.value = nom;
    input.dataset.codeInsee = codeInsee;
    input.dataset.dep = dep;
    input.dataset.cp = cp;
  }
  const box = document.getElementById('marche-suggest-list');
  if (box) box.style.display = 'none';
  marcheSearch();
}

// ── Recherche principale : CSV DVF par commune ───────────────
// ─────────────────────────────────────────────────────────────
//  MARCHÉ — Fonctions principales
// ─────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════
//  MODULE MARCHÉ — Recherche par ville
//  Sources : INSEE Melodi · geo.api.gouv.fr · ADEME DPE · GNews
// ═══════════════════════════════════════════════════════════════

// ── Fetch générique avec timeout ─────────────────────────────
async function apiFetch(url, label, opts = {}) {
  try {
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), opts.timeout || 9000);
    const r = await fetch(url, { signal: ctrl.signal, ...opts.fetchOpts });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[API] ${label} → HTTP ${r.status}:`, t.substring(0, 100));
      return null;
    }
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? await r.json() : await r.text();
  } catch(e) {
    if (e.name !== 'AbortError') console.warn(`[API] ${label} exception:`, e.message);
    return null;
  }
}

// ── Parser Melodi JSON ────────────────────────────────────────
function parseMelodiJSON(raw, label) {
  try {
    const j = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (Array.isArray(j?.observations)) {
      const rows = j.observations.map(obs => {
        const row = { ...(obs.dimensions || {}) };
        const m = obs.measures;
        if (m) {
          const v = m.OBS_VALUE_NIVEAU || m.OBS_VALUE || Object.values(m)[0];
          row.OBS_VALUE = (v != null && typeof v === 'object') ? parseFloat(v.value) : parseFloat(v);
        }
        return row;
      }).filter(r => r.OBS_VALUE != null && !isNaN(r.OBS_VALUE));
      return rows;
    }
    const arr = j?.data || j?.results;
    if (Array.isArray(arr)) return arr.filter(r => r.OBS_VALUE != null);
    console.warn(`[Melodi] ${label} — format inconnu:`, Object.keys(j || {}));
    return [];
  } catch(e) {
    console.warn(`[Melodi] ${label} parse error:`, e.message);
    return [];
  }
}

// ── Fetch Melodi ──────────────────────────────────────────────
async function mFetch(url, label) {
  const raw = await apiFetch(url, label);
  if (raw == null) return [];
  return parseMelodiJSON(raw, label);
}

// ═══════════════════════════════════════════════════════════════
//  MARCHESERACH — orchestration principale
// ═══════════════════════════════════════════════════════════════
async function marcheSearch() {
  const input    = document.getElementById('marche-ville-input');
  const typeBien = document.getElementById('marche-type-bien')?.value || '';
  const box      = document.getElementById('marche-suggest-list');
  if (box) box.style.display = 'none';

  const query = input?.value?.trim();
  if (!query) { showNotif("Entrez le nom d'une commune", true); return; }

  const resultsEl = document.getElementById('marche-results');
  if (!resultsEl) return;

  resultsEl.innerHTML = '<div class="marche-loading"><div class="marche-spinner"></div>Résolution de la commune…</div>';
  const btn = document.getElementById('marche-search-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Chargement…'; }

  try {
    // ── 1. Géolocalisation INSEE ──────────────────────────────
    const geoData = await apiFetch(
      `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(query)}&fields=nom,code,codeDepartement,codesPostaux,departement,population,surface&boost=population&limit=1`,
      'geo.api'
    );
    if (!geoData?.length) throw new Error(`Commune "${query}" introuvable.`);

    const codeInsee  = geoData[0].code;
    const communeNom = geoData[0].nom;
    const deptNom    = geoData[0].departement?.nom || '';
    const cp         = (geoData[0].codesPostaux || [])[0] || '';
    const popGeo     = geoData[0].population || null;
    const surfGeo    = geoData[0].surface    || null;

    input.dataset.codeInsee = codeInsee;
    input.dataset.dep = deptNom;
    input.dataset.cp  = cp;

    // ── 2. Lancer tous les fetches en parallèle ───────────────
    resultsEl.innerHTML = '<div class="marche-loading"><div class="marche-spinner"></div>Chargement des données (INSEE · ADEME · Actualités)…</div>';

    const GEO  = `COM-${codeInsee}`;
    const BASE = 'https://api.insee.fr/melodi';

    // Plafonds larges : un jeu tronqué produit des statistiques fausses en
    // silence (audit 25/07/2026 — logements et créations d'entreprises étaient
    // calculés sur un sous-ensemble arbitraire).
    const [
      popRows, revRows, logRows, menRows,
      actRows,
      diplRows, entRows,
      bpeRows,
      ademeData, newsData
    ] = await Promise.all([
      mFetch(`${BASE}/data/DS_RP_POPULATION_PRINC?GEO=${GEO}&RP_MEASURE=POP&maxResult=1000`, 'Population'),
      // DS_FILOSOFI_MEN_TP_NIVVIE n'existe plus : il renvoyait 0 observation pour
      // toutes les communes, donc le KPI revenus ne s'affichait jamais (FND-005).
      mFetch(`${BASE}/data/DS_FILOSOFI_CC?GEO=${GEO}&maxResult=500`, 'Revenus'),
      mFetch(`${BASE}/data/DS_RP_LOGEMENT_PRINC?GEO=${GEO}&maxResult=1000`, 'Logements'),
      mFetch(`${BASE}/data/DS_RP_MENAGES_PRINC?GEO=${GEO}&maxResult=1000`, 'Menages'),
      // Chômage : DS_RP_ACTIVITE_PRINC ne contient QUE les actifs occupés
      // (EMPSTA_ENQ=1), jamais les chômeurs — d'où le 0 % affiché jusqu'ici.
      // DS_RP_TD_ACTIVITE_AGED_PRINC porte 1 (occupés), 2 (chômeurs) et 1T2 (total actifs).
      mFetch(`${BASE}/data/DS_RP_TD_ACTIVITE_AGED_PRINC?GEO=${GEO}&AGE=Y_GE15&SEX=_T&maxResult=100`, 'Activité'),
      mFetch(`${BASE}/data/DS_RP_DIPLOMES_PRINC?GEO=${GEO}&maxResult=1000`, 'Diplomes'),
      mFetch(`${BASE}/data/DS_SIDE_CREA_ENT_COM?GEO=${GEO}&maxResult=2000`, 'Entreprises'),
      mFetch(`${BASE}/data/DS_BPE?GEO=${GEO}&maxResult=2000`, 'BPE'),
      fetchAdeme(codeInsee),
      fetchNews(communeNom)
    ]);

    // ── 3. Agréger les données ────────────────────────────────
    const melodi = buildMelodiResult(
      popGeo, surfGeo, codeInsee,
      popRows, revRows, logRows, menRows, actRows, diplRows, entRows, bpeRows
    );

    // ── 4. Rendu ──────────────────────────────────────────────
    renderMarcheResults(resultsEl, communeNom, deptNom, codeInsee, cp, melodi, ademeData, newsData);

  } catch(e) {
    resultsEl.innerHTML = `
      <div class="marche-error">
        <strong>❌ ${e.message}</strong>
        <div style="margin-top:8px;font-size:12px;color:var(--c-muted)">Vérifiez le nom ou essayez une autre commune.</div>
      </div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Analyser'; }
  }
}

// ═══════════════════════════════════════════════════════════════
//  AGRÉGATION — transformer les rows Melodi en objet structuré
// ═══════════════════════════════════════════════════════════════
function buildMelodiResult(popGeo, surfGeo, codeInsee,
    popRows, revRows, logRows, menRows, actRows, diplRows, entRows, bpeRows) {

  const r = { population: popGeo, surface: surfGeo };

  // ── Population ──────────────────────────────────────────────
  if (popRows.length) {
    r.popRows = popRows;
    const yr = popRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    r.annee_population = yr || null;
    // Sommer M+F par tranche, éviter double-comptage avec _T
    const byAge = {};
    popRows.forEach(x => {
      if (!x.TIME_PERIOD || !x.OBS_VALUE) return;
      if (parseInt(x.TIME_PERIOD) !== yr) return; // année la plus récente seulement
      const age = x.AGE || '_T';
      const sex = x.SEX || '_T';
      if (!byAge[age]) byAge[age] = {};
      byAge[age][sex] = (byAge[age][sex] || 0) + x.OBS_VALUE;
    });
    // Chercher ligne total
    const totRow = popRows.find(x =>
      parseInt(x.TIME_PERIOD) === yr &&
      (x.AGE === '_T' || !x.AGE) &&
      (x.SEX === '_T' || !x.SEX)
    );
    if (totRow) {
      r.population = Math.round(totRow.OBS_VALUE);
    } else {
      let tot = 0;
      Object.keys(byAge).filter(a => a !== '_T').forEach(a => {
        tot += (byAge[a]['M'] || 0) + (byAge[a]['F'] || 0);
      });
      if (tot > 0) r.population = Math.round(tot);
    }
    // Évolution par année (grouper toutes années)
    const popEvo = {};
    popRows.forEach(x => {
      if (!x.TIME_PERIOD || !x.OBS_VALUE || x.SEX === '_T' || x.AGE !== '_T') return;
      // pas de filtre strict ici — on prend ce qu'on peut
    });
    // Alternative plus simple : grouper SEX=M+F avec toute tranche d'âge disponible
    const evoMap = {};
    popRows.forEach(x => {
      if (!x.TIME_PERIOD || !x.OBS_VALUE) return;
      const yr2 = x.TIME_PERIOD;
      if (!evoMap[yr2]) evoMap[yr2] = { M: 0, F: 0, T: 0, hasMF: false };
      if (x.SEX === 'M' && x.AGE && x.AGE !== '_T') { evoMap[yr2].M += x.OBS_VALUE; evoMap[yr2].hasMF = true; }
      if (x.SEX === 'F' && x.AGE && x.AGE !== '_T') { evoMap[yr2].F += x.OBS_VALUE; evoMap[yr2].hasMF = true; }
      if ((x.SEX === '_T' || !x.SEX) && (x.AGE === '_T' || !x.AGE)) evoMap[yr2].T = x.OBS_VALUE;
    });
    r.popEvo = Object.entries(evoMap)
      .sort(([a],[b]) => a.localeCompare(b))
      .map(([yr2, d]) => ({ annee: yr2, val: Math.round(d.T || (d.M + d.F)) }))
      .filter(x => x.val > 0);
  }

  // ── Revenus (Filosofi) ──────────────────────────────────────
  // MED_SL  = niveau de vie médian, en euros par an et par unité de consommation
  // PR_MD60 = taux de pauvreté (part sous 60 % du niveau de vie médian national)
  // Sur les petites communes, l'INSEE masque certaines valeurs pour raison de
  // confidentialité : parseMelodiJSON les écarte, on n'affiche alors rien.
  if (revRows.length) {
    const yr = revRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    const yRows = revRows.filter(x => parseInt(x.TIME_PERIOD) === yr);
    const mesure = code => yRows.find(x => x.FILOSOFI_MEASURE === code)?.OBS_VALUE;
    const med = mesure('MED_SL');
    const pau = mesure('PR_MD60');
    if (med != null || pau != null) r.annee_revenus = yr || null;
    if (med != null) r.niveau_vie_median = Math.round(med);
    if (pau != null) r.taux_pauvrete = Math.round(pau * 10) / 10;
  }

  // ── Logements ───────────────────────────────────────────────
  if (logRows.length) {
    r.logRows = logRows;
    const yr = logRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    r.annee_logements = yr || null;
    const yRows = logRows.filter(x => parseInt(x.TIME_PERIOD) === yr);
    // Locataires/propriétaires via TDW
    const propRows = yRows.filter(x => x.TDW === '1' || x.TSH === '1');
    const locRowsF = yRows.filter(x => x.TDW === '2' || x.TDW === '3T6' || x.TSH === '2');
    if (propRows.length) r.nb_proprietaires = Math.round(propRows.reduce((s,x) => s+x.OBS_VALUE, 0));
    if (locRowsF.length) r.nb_locataires = Math.round(locRowsF.reduce((s,x) => s+x.OBS_VALUE, 0));
    if (r.nb_locataires && r.nb_proprietaires && (r.nb_locataires + r.nb_proprietaires) > 0) {
      r.pct_locataires = Math.round(r.nb_locataires / (r.nb_locataires + r.nb_proprietaires) * 100);
    }
  }

  // ── Ménages ─────────────────────────────────────────────────
  if (menRows.length) {
    r.menRows = menRows;
    const scoreTot = x => Object.values(x).filter(v => v === '_T' || v === 'T').length;
    const best = [...menRows].sort((a,b) => scoreTot(b) - scoreTot(a))[0];
    if (best?.OBS_VALUE > 0) {
      const pop = r.population || 0;
      const val = best.OBS_VALUE;
      if (!pop || (val > pop/10 && val < pop/1.5)) r.nb_menages = Math.round(val);
    }
    const rawTail = (r.population && r.nb_menages > 0) ? r.population / r.nb_menages : null;
    if (rawTail && rawTail >= 1 && rawTail <= 5) r.tail_menage = rawTail.toFixed(1);
  }

  // ── Activité / Chômage ──────────────────────────────────────
  // Codes EMPSTA_ENQ : 1 = actifs occupés, 2 = chômeurs, 1T2 = total actifs.
  // Le taux n'est calculé que si les trois grandeurs sont cohérentes entre
  // elles : mieux vaut ne rien afficher qu'un chiffre inventé.
  if (actRows.length) {
    const yr = actRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    const yRows = actRows.filter(x => parseInt(x.TIME_PERIOD) === yr);
    const somme = code => yRows.filter(x => x.EMPSTA_ENQ === code)
                               .reduce((s, x) => s + (x.OBS_VALUE || 0), 0);
    const occupes  = somme('1');
    const chomeurs = somme('2');
    const actifs   = somme('1T2') || (occupes + chomeurs);
    if (actifs > 0 && chomeurs > 0) {
      r.annee_activite = yr || null;
      r.taux_chomage   = Math.round(chomeurs / actifs * 100 * 10) / 10;
      r.actifs_total   = Math.round(actifs);
      r.chomeurs_total = Math.round(chomeurs);
    }
  }

  // ── Diplômes ────────────────────────────────────────────────
  if (diplRows.length) {
    r.diplRows = diplRows;
    const firstDipl = diplRows[0] || {};
    const diplKeys = Object.keys(firstDipl).filter(k => k !== 'OBS_VALUE' && k !== 'TIME_PERIOD' && k !== 'GEO' && k !== 'SEX');

    const yr = diplRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    const yRows = diplRows.filter(x => parseInt(x.TIME_PERIOD) === yr);
    r.annee_diplomes = yr || null;

    // Trouver la dimension diplôme : chercher dans toutes les clés
    // Codes INSEE RP DIPL_GEN : 0=sans, 1=brevet, 2=CAP/BEP, 3=Bac, 4=Bac+2, 5=Bac+3/4, 6=Bac+5+
    // Ou: _T=total, et valeurs numériques 0-6 (avec ou sans underscore)
    const getDiplCode = (x) =>
      x.DIPL_GEN || x.DIPLOME || x.DIPL || x.NIVEAU_DIPL || x.DIPL_NIVEAU ||
      x.NIVEAU || x.DIPLOME_GEN || x.CODE_DIPL || x.SCOLARITE ||
      // Chercher dynamiquement la clé qui ressemble à un code diplôme
      diplKeys.map(k => x[k]).find(v => v != null && v !== '_T' && String(v).match(/^[_]?\d$|^(BAC|CAP|BEP|BEPC|SUP|MASTER|DOC|AUCUN|SANS)/i)) || '';

    const isSuperieur = (code) => {
      const d = String(code).toUpperCase().replace('_','');
      // Codes numériques : 4 (Bac+2), 5 (Bac+3/4), 6 (Bac+5+)
      return d === '4' || d === '5' || d === '6' || d === '7' ||
             // Codes textuels
             d.startsWith('BAC+') || d.startsWith('BAC 2') ||
             d.includes('SUP') || d.includes('MASTER') || d.includes('DOC') ||
             d.includes('DEUG') || d.includes('LICENCE') || d.includes('BTS') || d.includes('DUT');
    };

    const isTotal = (code) => {
      const d = String(code).toUpperCase();
      return d === '_T' || d === 'T' || d === 'TOTAL' || d === 'ENS';
    };

    // Total = toutes lignes non-total
    const nonTotRows = yRows.filter(x => !isTotal(getDiplCode(x)));
    const totDipl = nonTotRows.reduce((s, x) => s + (x.OBS_VALUE || 0), 0);
    const supRows = nonTotRows.filter(x => isSuperieur(getDiplCode(x)));
    const supPop  = supRows.reduce((s, x) => s + (x.OBS_VALUE || 0), 0);

    if (totDipl > 0 && supPop > 0) r.pct_bac_plus = Math.round(supPop / totDipl * 100);
    else if (totDipl > 0) {
    }
  }

  // ── Créations d'entreprises ──────────────────────────────────
  if (entRows.length) {
    r.entRows = entRows;
    const yr = entRows.reduce((mx, x) => Math.max(mx, parseInt(x.TIME_PERIOD||0)), 0);
    r.annee_entreprises = yr || null;
    // Sommer toutes les créations de l'année la plus récente
    const totEnt = entRows
      .filter(x => parseInt(x.TIME_PERIOD) === yr)
      .reduce((s, x) => s + (x.OBS_VALUE || 0), 0);
    if (totEnt > 0) r.nb_creations_ent = Math.round(totEnt);
    // Évolution
    const entEvo = {};
    entRows.forEach(x => {
      if (!x.TIME_PERIOD || !x.OBS_VALUE) return;
      entEvo[x.TIME_PERIOD] = (entEvo[x.TIME_PERIOD] || 0) + x.OBS_VALUE;
    });
    r.entEvo = Object.entries(entEvo).sort(([a],[b]) => a.localeCompare(b))
      .map(([annee, val]) => ({ annee, val: Math.round(val) }));
  }

  // ── Équipements BPE ─────────────────────────────────────────
  // Le jeu DS_BPE mélange lignes de détail et lignes d'agrégat. Le total d'un
  // domaine est porté par la ligne FACILITY_SDOM='_T' ET FACILITY_TYPE='_T' :
  // additionner toutes les lignes comptait chaque équipement deux à trois fois.
  // Domaines BPE : A services aux particuliers · B commerces · C enseignement
  //                D santé · E transports · F sport/loisirs/culture · G tourisme
  if (bpeRows.length) {
    const totaux = bpeRows.filter(x => x.FACILITY_SDOM === '_T' && x.FACILITY_TYPE === '_T');
    const parDom = {};
    let annee = null;
    totaux.forEach(x => {
      parDom[x.FACILITY_DOM] = Math.round(x.OBS_VALUE || 0);
      const a = parseInt(x.TIME_PERIOD || 0);
      if (a && (!annee || a > annee)) annee = a;
    });
    const cat = {
      services:   parDom.A || 0,
      commerces:  parDom.B || 0,
      education:  parDom.C || 0,
      sante:      parDom.D || 0,
      transports: parDom.E || 0,
      sport:      parDom.F || 0,
      tourisme:   parDom.G || 0,
      total:      parDom._T || 0,
    };
    if (Object.values(cat).some(v => v > 0)) { r.bpe = cat; r.annee_bpe = annee; }
  }

  return r;
}

// ═══════════════════════════════════════════════════════════════
//  FETCH ADEME DPE
// ═══════════════════════════════════════════════════════════════
async function fetchAdeme(codeInsee) {
  try {
    // API Data Fair ADEME — CORS OK
    const url = `https://data.ademe.fr/data-fair/api/v1/datasets/dpe-v2-logements-existants/lines`
      + `?size=2000&select=Etiquette_DPE,Etiquette_GES,Annee_construction_DPE`
      + `&qs=Code_INSEE_commune_actualise:${codeInsee}`;
    const data = await apiFetch(url, 'ADEME DPE', { timeout: 12000 });
    if (!data?.results?.length) return null;
    // Agréger les étiquettes DPE
    const dpeCount = { A:0,B:0,C:0,D:0,E:0,F:0,G:0 };
    data.results.forEach(x => {
      const label = (x.Etiquette_DPE||'').toUpperCase().trim();
      if (dpeCount[label] !== undefined) dpeCount[label]++;
    });
    const total = Object.values(dpeCount).reduce((s,v) => s+v, 0);
    const dominant = Object.entries(dpeCount).sort(([,a],[,b]) => b-a)[0]?.[0];
    // Part de logements énergivores (F+G)
    const pctFG = total > 0 ? Math.round((dpeCount.F + dpeCount.G) / total * 100) : null;
    return { dpeCount, total, dominant, pctFG };
  } catch(e) {
    console.warn('[ADEME] error:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  FETCH NEWS (NewsAPI via l'Edge Function news-proxy)
//  Plan Developer : 100 req/jour, articles du dernier mois seulement.
//  Repli : liens de recherche si aucun article pertinent.
// ═══════════════════════════════════════════════════════════════

// Normalisation pour recherche plein texte : minuscules, accents retirés,
// toute ponctuation ramenée à une espace. Permet de tester l'appartenance
// d'un nom de commune à un titre avec de vraies frontières de mots
// (« Poitiers, » et « à Poitiers. » matchent, « Barentin » ne matche pas « Bar »).
const tiNormTexte = s => (s || '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// NewsAPI cherche dans le titre ET le corps de l'article. Un long papier qui
// cite la commune au détour d'un paragraphe et « économie » ailleurs remonte
// donc alors qu'il ne traite pas du tout de la commune (constaté sur Poitiers
// le 01/08/2026 : un article d'histoire sur une rescapée d'Auschwitz).
// On ne garde que les articles dont le titre ou le chapô nomme la commune.
function newsArticlesPertinents(articles, communeNom) {
  const cible = tiNormTexte(communeNom);
  if (!cible) return [];
  return (articles || []).filter(a =>
    ` ${tiNormTexte(`${a.title || ''} ${a.description || ''}`)} `.includes(` ${cible} `));
}

async function fetchNews(communeNom) {
  // FND-001 : la clé NewsAPI vit côté serveur (Edge Function news-proxy).
  // Le client n'appelle plus newsapi.org directement, ni de proxies CORS tiers.
  // La commune reste obligatoire (AND), les thèmes deviennent alternatifs (OR).
  // L'ancienne forme cumulait 4 termes implicitement liés — « Poitiers économie
  // emploi entreprise » ne matchait quasiment jamais, ce qui rendait le repli sur
  // les liens permanent alors même que la clé NewsAPI était valide.
  // Les parenthèses supposent news-proxy en version >= 4 (regex élargi).
  const queryEco = `${communeNom} AND (économie OR emploi OR entreprise)`;
  const queryImmo = `${communeNom} AND (immobilier OR logement)`;

  // pageSize au plafond serveur (20) : le tri de pertinence écarte une bonne
  // part des résultats, il faut de la matière. Ne coûte aucun appel de quota
  // supplémentaire, celui-ci se compte en requêtes et non en articles.
  try {
    // 1. Tentative : actualités économie locale
    const { data: ecoData, error: ecoErr } = await db.functions.invoke('news-proxy', {
      body: { q: queryEco, pageSize: 20 }
    });
    if (!ecoErr) {
      const pertinents = newsArticlesPertinents(ecoData?.articles, communeNom);
      if (pertinents.length) return { source: 'newsapi', articles: pertinents.slice(0, 6) };
    }

    // 2. Fallback : actualités immobilier
    const { data: immoData, error: immoErr } = await db.functions.invoke('news-proxy', {
      body: { q: queryImmo, pageSize: 20 }
    });
    if (!immoErr) {
      const pertinents = newsArticlesPertinents(immoData?.articles, communeNom);
      if (pertinents.length) return { source: 'newsapi', articles: pertinents.slice(0, 6) };
    }
  } catch (e) {
    console.warn('news-proxy indisponible:', e?.message);
  }
  return { source: 'links', commune: communeNom };
}

// ═══════════════════════════════════════════════════════════════
//  RENDER — Page résultats complète (6 sections)
// ═══════════════════════════════════════════════════════════════
function renderMarcheResults(el, commune, dept, codeInsee, cp, m, ademe, news) {

  // ── Helpers ──────────────────────────────────────────────────
  const fmtN = v => (v != null) ? Number(v).toLocaleString('fr-FR') : '—';
  const fmtE = v => (v != null) ? Number(v).toLocaleString('fr-FR') + ' €' : '—';
  const yr   = v => v ? `<div class="kpi-year">données ${v}</div>` : '';

  // `icone` est une CLE du jeu SF_ACC_ICONS, plus un emoji : le dessin ne
  // depend plus du systeme d'exploitation et suit la couleur du texte.
  const kpi = (icone, val, lab, annee='', cls='') => `
    <div class="marche-kpi">
      <div class="marche-kpi-icon">${sfAccIcon(icone, 20)}</div>
      <div class="marche-kpi-val ${cls}">${val}</div>
      <div class="marche-kpi-lab">${lab}</div>
      ${yr(annee)}
    </div>`;

  // ── En-tête commune ──────────────────────────────────────────
  const header = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <div style="width:48px;height:48px;border-radius:50%;background:var(--accent-g);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🏙️</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:22px;font-weight:800;color:var(--c-text)">${commune}</div>
        <div style="font-size:12px;color:var(--c-muted)">${dept}${cp?' · '+cp:''} · Code INSEE : ${codeInsee}</div>
      </div>
      <button onclick="navigator.clipboard.writeText('${codeInsee}').then(()=>showNotif('Code INSEE copié'))"
        style="background:none;border:1px solid var(--c-border);border-radius:6px;padding:6px 12px;font-size:12px;color:var(--c-dim);cursor:pointer;flex-shrink:0">
        📋 Copier INSEE
      </button>
    </div>`;

  // ── SECTION 1 : KPIs démographiques ──────────────────────────
  const pop  = m.population;
  const dens = (pop && m.surface) ? Math.round(pop / (m.surface / 100)) : null;
  const rawTail = (pop && m.nb_menages > 0) ? pop / m.nb_menages : null;
  const tailMen = (rawTail && rawTail >= 1 && rawTail <= 5) ? rawTail.toFixed(1) : null;

  const kpis1 = [
    pop                   ? kpi('gens', fmtN(pop),                  'Population',          m.annee_population, 'teal') : '',
    dens                  ? kpi('pin', fmtN(dens),                 'Hab/km²',             m.annee_population) : '',
    m.surface             ? kpi('graph', Math.round(m.surface/100)+' km²', 'Superficie') : '',
    m.niveau_vie_median   ? kpi('euro', fmtE(m.niveau_vie_median),   'Niveau de vie médian',m.annee_revenus, 'green') : '',
    m.taux_pauvrete!=null ? kpi('graph', m.taux_pauvrete.toString().replace('.',',')+' %', 'Taux de pauvreté', m.annee_revenus, m.taux_pauvrete > 20 ? 'orange' : 'green') : '',
    m.pct_locataires!=null? kpi('cle', m.pct_locataires+' %',       'Taux de locataires',  m.annee_logements) : '',
    tailMen               ? kpi('maison', tailMen,                     'Pers. par ménage',    m.annee_population) : '',
    m.pct_bac_plus!=null  ? kpi('carnet', m.pct_bac_plus+' %',         'Part Bac+',           m.annee_diplomes) : '',
  ].filter(Boolean);

  const sec1 = `
    <div class="marche-chart-card">
      <div class="marche-chart-title">${sfAccIcon('graph',18)} Démographie & Revenus — ${commune}</div>
      <div class="marche-chart-sub">Source : INSEE Melodi · Recensement · Filosophi · geo.api.gouv.fr</div>
      <div class="marche-kpis" style="margin-top:14px;margin-bottom:0">
        ${kpis1.join('') || '<div style="font-size:12px;color:var(--c-muted);padding:8px">Données en cours de chargement…</div>'}
      </div>
    </div>`;

  // ── SECTION 2 : Marché du travail ────────────────────────────
  // Le taux national sert de repère : 17,8 % ne parle pas sans point de comparaison
  const kpis2 = [
    m.taux_chomage!=null      ? kpi('graph', m.taux_chomage.toString().replace('.',',')+' %', 'Taux de chômage', m.annee_activite, m.taux_chomage > 12 ? 'orange' : 'green') : '',
    m.nb_creations_ent!=null  ? kpi('ville', fmtN(m.nb_creations_ent),'Créations d\'ent.',   m.annee_entreprises, 'teal') : '',
  ].filter(Boolean);

  const sec2 = kpis2.length ? `
    <div class="marche-chart-card">
      <div class="marche-chart-title">${sfAccIcon('ville',18)} Marché du travail & Économie — ${commune}</div>
      <div class="marche-chart-sub">Source : INSEE Melodi · Recensement de la Population · SIDE</div>
      <div class="marche-kpis" style="margin-top:14px;margin-bottom:${m.entEvo?.length >= 2 ? '16px' : '0'}">
        ${kpis2.join('')}
      </div>
      ${m.taux_chomage != null ? `
        <div style="font-size:11.5px;color:var(--c-muted);margin-top:2px">
          ${fmtN(m.chomeurs_total)} chômeurs sur ${fmtN(m.actifs_total)} actifs de 15 ans ou plus (recensement ${m.annee_activite}).
          Le dossier complet INSEE ne publie ce taux que pour l'année la plus récente : pas d'historique disponible.
        </div>` : ''}
      ${m.entEvo?.length >= 2 ? `
        <div style="margin-top:16px">
          <div style="font-size:12px;font-weight:600;color:var(--c-dim);margin-bottom:8px">Évolution des créations d'entreprises</div>
          <canvas id="chart-ent" height="70"></canvas>
        </div>` : ''}
    </div>` : '';

  // ── SECTION 3 : Équipements BPE ──────────────────────────────
  const bpe = m.bpe;
  const sec3 = bpe ? `
    <div class="marche-chart-card">
      <div class="marche-chart-title">🏗️ Équipements de proximité — ${commune}</div>
      <div class="marche-chart-sub">Source : INSEE · Base Permanente des Équipements${m.annee_bpe ? ' · '+m.annee_bpe : ''}${bpe.total ? ' · '+fmtN(bpe.total)+' équipements au total' : ''}</div>
      <div class="bpe-grid" style="margin-top:14px">
        ${bpe.commerces > 0  ? `<div class="bpe-card"><div class="bpe-icon">🛒</div><div class="bpe-val">${fmtN(bpe.commerces)}</div><div class="bpe-lab">Commerces</div></div>` : ''}
        ${bpe.sante > 0      ? `<div class="bpe-card"><div class="bpe-icon">🏥</div><div class="bpe-val">${fmtN(bpe.sante)}</div><div class="bpe-lab">Santé</div></div>` : ''}
        ${bpe.education > 0  ? `<div class="bpe-card"><div class="bpe-icon">🏫</div><div class="bpe-val">${fmtN(bpe.education)}</div><div class="bpe-lab">Établissements scolaires</div></div>` : ''}
        ${bpe.services > 0   ? `<div class="bpe-card"><div class="bpe-icon">🏛️</div><div class="bpe-val">${fmtN(bpe.services)}</div><div class="bpe-lab">Services au public</div></div>` : ''}
        ${bpe.sport > 0      ? `<div class="bpe-card"><div class="bpe-icon">⚽</div><div class="bpe-val">${fmtN(bpe.sport)}</div><div class="bpe-lab">Sport & culture</div></div>` : ''}
        ${bpe.transports > 0 ? `<div class="bpe-card"><div class="bpe-icon">🚌</div><div class="bpe-val">${fmtN(bpe.transports)}</div><div class="bpe-lab">Transports</div></div>` : ''}
        ${bpe.tourisme > 0   ? `<div class="bpe-card"><div class="bpe-icon">🧳</div><div class="bpe-val">${fmtN(bpe.tourisme)}</div><div class="bpe-lab">Tourisme</div></div>` : ''}
      </div>
      <div style="font-size:11px;color:var(--c-muted);margin-top:10px">
        ℹ️ Nombre d'équipements distincts recensés dans la commune, par domaine BPE
      </div>
    </div>` : '';

  // ── SECTION 4 : DPE ADEME ────────────────────────────────────
  const dpeColors = { A:'#2d8a4e',B:'#5ab253',C:'#a8c929',D:'#f4d03f',E:'#f5a623',F:'#e05928',G:'#c0392b' };
  const dpeLabels = ['A','B','C','D','E','F','G'];
  const sec4 = ademe ? `
    <div class="marche-chart-card">
      <div class="marche-chart-title">⚡ Performance énergétique (DPE) — ${commune}</div>
      <div class="marche-chart-sub">Source : ADEME · DPE v2 · ${ademe.total.toLocaleString('fr-FR')} diagnostics analysés</div>
      <div style="display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap;margin-top:14px">
        <div style="flex:1;min-width:200px">
          <div style="display:flex;flex-direction:column;gap:4px">
            ${dpeLabels.map(l => {
              const pct = ademe.total > 0 ? Math.round(ademe.dpeCount[l] / ademe.total * 100) : 0;
              return pct > 0 ? `
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="width:28px;height:22px;background:${dpeColors[l]};border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:white;flex-shrink:0">${l}</div>
                  <div style="flex:1;background:var(--c-bg);border-radius:3px;height:14px;overflow:hidden">
                    <div style="width:${pct}%;height:100%;background:${dpeColors[l]};opacity:.85;border-radius:3px"></div>
                  </div>
                  <div style="font-size:12px;font-weight:600;color:var(--c-dim);width:36px;text-align:right">${pct}%</div>
                </div>` : '';
            }).join('')}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:10px;flex-shrink:0">
          <div class="marche-kpi" style="min-width:140px">
            <div class="marche-kpi-icon">${sfAccIcon('ok', 20)}</div>
            <div class="marche-kpi-val" style="color:${dpeColors[ademe.dominant]||'var(--c-text)'}">${ademe.dominant || '—'}</div>
            <div class="marche-kpi-lab">Classe DPE dominante</div>
          </div>
          ${ademe.pctFG != null ? `<div class="marche-kpi" style="min-width:140px">
            <div class="marche-kpi-icon">${sfAccIcon('alerte', 20)}</div>
            <div class="marche-kpi-val ${ademe.pctFG > 20 ? 'orange' : 'green'}">${ademe.pctFG} %</div>
            <div class="marche-kpi-lab">Logements F/G (énergivores)</div>
          </div>` : ''}
        </div>
      </div>
    </div>` : '';

  // ── SECTION 5 : Graphiques évolution ─────────────────────────
  // Pas de courbe de revenus : Filosofi ne publie qu'un millésime par commune.
  const hasPopEvo = (m.popEvo?.length || 0) >= 2;

  const sec5 = hasPopEvo ? `
    <div class="marche-chart-card">
      <div class="marche-chart-title">📈 Évolution de la population — ${commune}</div>
      <div class="marche-chart-sub">Source : INSEE · Recensement · ${m.popEvo[0].annee}–${m.popEvo[m.popEvo.length-1].annee}</div>
      <canvas id="chart-pop" height="80"></canvas>
    </div>` : '';

  // ── SECTION 6 : Actualités ────────────────────────────────────
  let sec6 = '';
  // Chaque lien doit aboutir a des resultats reellement filtres sur la commune
  // ET reellement cliquables. Trois moteurs de presse ont ete retires le
  // 01/08/2026 apres verification en navigation reelle :
  //  - Les Echos : URL conforme a leur propre JSON-LD, mais moteur de resultats
  //    qui ne s'alimente pas.
  //  - SeLoger : page d'actualites nationale, la commune n'etait jamais transmise.
  //  - La Tribune : la recherche fonctionne (parametre lt_prod_CONTENT[query]),
  //    mais leur page de resultats emet des href relatifs SANS barre oblique
  //    initiale ("article/economie/...") qui se resolvent depuis /recherche/ en
  //    /recherche/article/... — soit un 404 sur chaque resultat. Bug de leur
  //    cote, irreparable depuis Stonefolio.
  // Ne restent que les liens verifies comme aboutissant a du contenu lisible.
  const newsLinks = [
    { label: '📰 Google News', url: `https://news.google.com/search?q=${encodeURIComponent(commune+' économie emploi')}&hl=fr&gl=FR`, desc: 'Actu économique locale' },
    { label: '🔍 Google Immo', url: `https://news.google.com/search?q=${encodeURIComponent(commune+' immobilier logement')}&hl=fr&gl=FR`, desc: 'Actu immobilier local' },
  ];

  if (news?.source === 'newsapi' && news.articles?.length) {
    sec6 = `
      <div class="marche-chart-card">
        <div class="marche-chart-title">📰 Actualités économiques — ${commune}</div>
        <div class="marche-chart-sub">Source : NewsAPI · Presse nationale et locale · Économie · Emploi · Immobilier</div>
        <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
          ${news.articles.map(a => `
            <a href="${safeUrl(a.url)}" target="_blank" rel="noopener" style="display:flex;gap:10px;text-decoration:none;background:var(--c-bg);border-radius:8px;padding:12px;transition:opacity .15s;align-items:flex-start" onmouseover="this.style.opacity='.8'" onmouseout="this.style.opacity='1'">
              ${a.urlToImage ? `<img src="${a.urlToImage}" style="width:60px;height:45px;object-fit:cover;border-radius:4px;flex-shrink:0" onerror="this.style.display='none'">` : '<div style="width:60px;height:45px;background:var(--c-border);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:20px">📰</div>'}
              <div style="min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--c-text);margin-bottom:3px;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${(a.title||'').replace(/<[^>]+>/g,'')}</div>
                <div style="font-size:11px;color:var(--c-muted)">${a.source?.name||''} · ${(a.publishedAt||'').substring(0,10)}</div>
              </div>
            </a>`).join('')}
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--c-border);display:flex;gap:8px;flex-wrap:wrap">
          ${newsLinks.map(l => `<a href="${safeUrl(l.url)}" target="_blank" rel="noopener" style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:6px;padding:5px 10px;font-size:11px;color:var(--c-dim);text-decoration:none;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--c-border)'">${l.label}</a>`).join('')}
        </div>
      </div>`;
  } else {
    sec6 = `
      <div class="marche-chart-card">
        <div class="marche-chart-title">📰 Actualités économiques — ${commune}</div>
        <div class="marche-chart-sub">Économie locale · Emploi · Entreprises · Immobilier</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px;margin-top:14px">
          ${newsLinks.map(l => `
            <a href="${safeUrl(l.url)}" target="_blank" rel="noopener" style="display:block;text-decoration:none;background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:14px;transition:border-color .15s" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--c-border)'">
              <div style="font-size:13px;font-weight:700;color:var(--c-text);margin-bottom:4px">${l.label}</div>
              <div style="font-size:11px;color:var(--c-muted)">${l.desc}</div>
            </a>`).join('')}
        </div>
        <div style="font-size:11px;color:var(--c-muted);margin-top:12px;padding-top:10px;border-top:1px solid var(--c-border)">
          💡 Le fil d'actualités locales est momentanément indisponible. En attendant, ces liens ouvrent
          une recherche ciblée sur ${commune}.
        </div>
      </div>`;
  }

  // ── DVF note ─────────────────────────────────────────────────
  const dvfNote = `
    <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:8px;padding:12px 16px;font-size:12px;color:var(--c-muted)">
      ℹ️ Données DVF (prix/m²) indisponibles depuis le navigateur (CORS).
      Consultez <a href="https://dataviz.cerema.fr/dynmark/" target="_blank" style="color:var(--sf-info)">Dynmark (Cerema)</a> pour les prix au m².
    </div>`;

  // ── P5 : ponts Marché → Pipeline ─────────────────────────────
  // L'analyse ne doit plus être une impasse : on montre les biens déjà
  // suivis dans cette commune et on peut créer une fiche pré-remplie.
  const normVille = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[-\s']+/g,' ').trim();
  const biensIci = allBiens.filter(x =>
    normVille(x.ville) === normVille(commune) || (cp && x.code_postal && x.code_postal === cp));
  const ponts = `
    <div class="marche-ponts">
      <div class="marche-ponts-head">
        <div class="marche-ponts-title">${sfAccIcon('maison',18)} Votre pipeline à ${esc(commune)}</div>
        <button class="bd-link" onclick="marcheCreerBien('${commune.replace(/'/g,"\\'")}','${cp||''}')">➕ Créer une fiche bien ici</button>
      </div>
      ${biensIci.length ? `
      <div class="marche-ponts-list">
        ${biensIci.map(x => {
          const d = cfDisplayData(x);
          return `
          <div class="marche-pont-bien" onclick="openDetail('${x.id}')">
            <span class="t">${esc(x.titre || 'Sans titre')}</span>
            <span class="st">${esc(x.statut || '—')}</span>
            <span class="cf ${d.value==null?'':d.value>=0?'pos':'neg'}">${d.value!=null?(d.value>0?'+':'')+fmt(d.value)+' €/m':'—'}</span>
          </div>`;
        }).join('')}
      </div>` : `
      <div class="marche-ponts-empty">Aucun bien suivi dans cette commune pour l'instant — si l'analyse vous convainc, la fiche se crée en un clic, ville et code postal déjà remplis.</div>`}
    </div>`;

  // ── Assemblage final ──────────────────────────────────────────
  el.innerHTML = header + ponts + sec1 + sec2 + sec3 + sec4 + sec5 + sec6 + dvfNote;

  // ── Dessiner les graphiques ───────────────────────────────────
  setTimeout(() => {
    if (marcheChart) { try{marcheChart.destroy();}catch(e){} marcheChart=null; }
    if (typeof Chart === 'undefined') return;

    const mkLine = (id, labels, vals, color, label, fmtTip) => {
      const ctx = document.getElementById(id);
      if (!ctx) return null;
      return new Chart(ctx.getContext('2d'), {
        type:'line',
        data:{ labels, datasets:[{ label, data:vals,
          borderColor:color, backgroundColor:color.replace(')',',0.08)').replace('rgb','rgba'),
          borderWidth:2.5, fill:true, tension:0.3, pointRadius:4, pointHoverRadius:6 }]},
        options:{ responsive:true,
          plugins:{ legend:{display:false}, tooltip:{callbacks:{label:c=>` ${fmtTip(c.parsed.y)}`}} },
          scales:{
            y:{ticks:{callback:v=>fmtTip(v),font:{size:11}},grid:{color:sfToken('--sf-chart-grid','rgba(234,240,236,.07)')}},
            x:{ticks:{font:{size:11}},grid:{display:false}}
          }
        }
      });
    };

    if (m.popEvo?.length >= 2) {
      marcheChart = mkLine('chart-pop',
        m.popEvo.map(x=>x.annee), m.popEvo.map(x=>x.val),
        'rgb(107,184,224)', 'Population', v => v?.toLocaleString('fr-FR')+' hab.');
    }
    // Pas de graphique du chômage : le dossier complet INSEE ne publie ce taux
    // que pour l'année la plus récente (aucune série temporelle disponible).
    if (m.entEvo?.length >= 2) {
      mkLine('chart-ent',
        m.entEvo.map(x=>x.annee), m.entEvo.map(x=>x.val),
        'rgb(23,160,107)', "Créations d'entreprises", v => v?.toLocaleString('fr-FR'));
    }
  }, 80);
}



// ── Page Carte ───────────────────────────────────────────────
function renderMarcheCarte(el) {
  el.innerHTML = `
    <div class="marche-page">
      <div class="marche-hero">
        <div class="marche-hero-left">
          <div class="marche-hero-tag">🗺️ Bientôt disponible</div>
          <div class="marche-hero-title">Carte de France</div>
          <div class="marche-hero-sub">Heatmap des prix au m² et rendements locatifs par commune — Leaflet.js + DVF</div>
        </div>
      </div>
      <div class="marche-carte-placeholder">
        <div style="font-size:64px;margin-bottom:16px">🗺️</div>
        <div style="font-size:18px;font-weight:700;margin-bottom:8px;color:var(--c-text)">Carte interactive — Bientôt</div>
        <div style="font-size:13px;color:var(--c-muted);max-width:400px;margin:0 auto;line-height:1.7">
          La carte de France avec heatmap des prix au m² par département et commune sera disponible prochainement.
        </div>
        <div style="margin-top:24px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap">
          <div style="background:var(--c-bg);border-radius:8px;padding:12px 18px;font-size:12px;color:var(--c-dim)">🌡️ Heatmap prix/m²</div>
          <div style="background:var(--c-bg);border-radius:8px;padding:12px 18px;font-size:12px;color:var(--c-dim)">📊 Rendement locatif estimé</div>
          <div style="background:var(--c-bg);border-radius:8px;padding:12px 18px;font-size:12px;color:var(--c-dim)">🏙️ +35 000 communes</div>
          <div style="background:var(--c-bg);border-radius:8px;padding:12px 18px;font-size:12px;color:var(--c-dim)">📈 Évolution 10 ans</div>
        </div>
      </div>
    </div>`;
}


// ══════════════════════════════════════════════════════════════
let sciDocsPending = []; // docs à sauvegarder avec la SCI

function handleSCIDoc(e) {
  const files = Array.from(e.target.files);
  files.forEach(file => {
    const reader = new FileReader();
    reader.onload = ev => {
      sciDocsPending.push({ nom: file.name, type: file.type, data: ev.target.result, type_doc: 'Autre' });
      renderSCIDocsList();
    };
    reader.readAsDataURL(file);
  });
  e.target.value = '';
}

function renderSCIDocsList() {
  const c = document.getElementById('sci-docs-list');
  if (!c) return;
  if (!sciDocsPending.length) { c.innerHTML = ''; return; }
  const TYPES_DOC = ['Statuts','Kbis','PV','Contrat','Assurance','Autre'];
  c.innerHTML = sciDocsPending.map((d, i) => `
    <div class="sci-doc-item">
      <span>${d.type.includes('pdf') ? '📄' : '🖼️'}</span>
      <span class="sci-doc-name">${esc(d.nom)}</span>
      <select onchange="sciDocsPending[${i}].type_doc=this.value" style="font-size:11px;padding:3px 6px;border:1px solid var(--c-border);border-radius:5px;background:var(--c-card);color:var(--c-text)" title="Type de document">
        ${TYPES_DOC.map(t => `<option value="${t}" ${(d.type_doc||'Autre')===t?'selected':''}>${t}</option>`).join('')}
      </select>
      <button class="sci-doc-remove" onclick="sciDocsPending.splice(${i},1);renderSCIDocsList()">✕</button>
    </div>`).join('');
}

// ── Documents SCI existants : lecture, ouverture, suppression (FLX-001) ──
async function loadSCIExistingDocs(sciId) {
  const c = document.getElementById('sci-docs-existing');
  if (!c) return;
  c.innerHTML = '';
  if (!sciId) return;
  const { data, error } = await db.from('sci_documents')
    .select('id, nom, type_doc, pdf_path')
    .eq('sci_id', sciId).eq('user_id', currentUser.id)
    .order('created_at', { ascending: true });
  if (error || !data?.length) return;
  c.innerHTML = data.map(d => `
    <div class="sci-doc-item">
      <span>📄</span>
      <span class="sci-doc-name" style="cursor:pointer" onclick="openSciDocument('${d.pdf_path || ''}')" title="Cliquer pour ouvrir">${esc(d.nom || 'Document')}</span>
      ${d.type_doc ? `<span style="font-size:10px;font-weight:700;letter-spacing:.4px;color:var(--accent);background:color-mix(in srgb, var(--accent) 12%, transparent);padding:2px 8px;border-radius:10px">${esc(d.type_doc)}</span>` : ''}
      <button class="sci-doc-remove" onclick="deleteSciDocument('${d.id}','${d.pdf_path || ''}')" title="Supprimer">✕</button>
    </div>`).join('');
}
async function openSciDocument(path) {
  if (!path) return;
  const url = await TI_STORAGE.signedUrl('sci-documents', path);
  if (url) openDoc(url); else showNotif('Document introuvable.', true);
}
async function deleteSciDocument(docId, path) {
  if (!confirm('Supprimer ce document ?')) return;
  await TI_STORAGE.remove('sci-documents', path);
  const { error } = await db.from('sci_documents').delete().eq('id', docId).eq('user_id', currentUser.id);
  if (error) { showNotif('Erreur : ' + error.message, true); return; }
  showNotif('Document supprimé');
  loadSCIExistingDocs(currentSCIId);
}

// ══════════════════════════════════════════════════════════════
// DONNÉES TESTS — MODULE ADMINISTRATION
// ══════════════════════════════════════════════════════════════
async function genAdminTestData() {
  if (!currentUser) return;
  try {
    // 1 SCI test
    const { data: sciData, error: sciErr } = await db.from('sci').insert({
      nom_sci: 'SCI TEST Guénon', siret: '12345678900019',
      adresse: '12 rue de la Paix, 75001 Paris', capital_social: 1000,
      associes: [{ prenom: 'Thomas', nom: 'Guénon', telephone: '06 12 34 56 78', email: 'thomas@test.fr', parts_pct: 100 }],
      notes: 'SCI de test — à supprimer', user_id: currentUser.id
    }).select().single();
    if (sciErr) throw sciErr;

    // 1 contact test
    await db.from('contacts').insert({
      nom: 'Martin', prenom: 'Jean', role: 'Notaire', societe: 'Cabinet Martin & Associés',
      telephone: '05 49 12 34 56', email: 'jean.martin@notaires.fr',
      notes: 'Contact test', user_id: currentUser.id
    });

    // 1 échéance test
    const dateEch = new Date(); dateEch.setDate(dateEch.getDate() + 25);
    await db.from('sci_echeances').insert({
      sci_id: sciData.id, titre: 'Renouvellement assurance PNO TEST',
      type_echeance: 'Assurance', date_echeance: dateEch.toISOString().split('T')[0],
      rappel_j_avant: 30, recurrence: 'Annuelle', est_faite: false,
      notes: 'Échéance test', user_id: currentUser.id
    });

    // 1 bilan test
    await db.from('bilans_comptables').insert({
      sci_id: sciData.id, exercice: 2025, regime: 'IR',
      statut: 'Brouillon', notes: 'Bilan test', user_id: currentUser.id
    });

    showNotif('Données tests créées (SCI, contact, échéance, bilan)');
    await loadAdminData(); switchAdminTab(adminTab);
  } catch(e) { showNotif('Erreur : ' + e.message, true); }
}

async function purgeAdminTestData() {
  if (!currentUser || !confirm('Supprimer les données de test du module Administration ?')) return;
  try {
    /* Les biens de ces SCI d'abord — voir `sciDetacherBiens`. On relit les SCI
       visées avec EXACTEMENT la condition de la suppression, plutôt que de se
       fier à `allSCI` : si la cache était en retard, on supprimerait une SCI
       dont les biens n'auraient pas été détachés, et la base refuserait. */
    const { data: sciTest, error: eLect } = await db.from('sci')
      .select('id').eq('user_id', currentUser.id).ilike('nom_sci', '%TEST%');
    if (eLect) throw eLect;
    await sciDetacherBiens((sciTest || []).map(s => s.id));
    await db.from('sci').delete().eq('user_id', currentUser.id).ilike('nom_sci', '%TEST%');
    await db.from('contacts').delete().eq('user_id', currentUser.id).eq('notes', 'Contact test');
    await db.from('sci_echeances').delete().eq('user_id', currentUser.id).ilike('notes', '%test%');
    showNotif('Données tests supprimées');
    await loadAdminData(); switchAdminTab(adminTab);
  } catch(e) { showNotif('Erreur : ' + e.message, true); }
}

async function purgeAllAdminData() {
  if (!currentUser || !confirm('⚠️ Supprimer TOUTES les données d\'administration (SCI, contacts, échéances, bilans) ? Cette action est irréversible.')) return;
  try {
    await Promise.all([
      db.from('bilans_comptables').delete().eq('user_id', currentUser.id),
      db.from('sci_echeances').delete().eq('user_id', currentUser.id),
      db.from('sci_contacts').delete().eq('user_id', currentUser.id),
      db.from('contacts').delete().eq('user_id', currentUser.id),
      db.from('sci_documents').delete().eq('user_id', currentUser.id),
    ]);
    // Idem : aucun bien ne doit rester rattaché quand les SCI partent.
    const { data: sciTout, error: eLect } = await db.from('sci')
      .select('id').eq('user_id', currentUser.id);
    if (eLect) throw eLect;
    await sciDetacherBiens((sciTout || []).map(s => s.id));
    await db.from('sci').delete().eq('user_id', currentUser.id);
    showNotif('Toutes les données d\'administration supprimées');
    await loadAdminData(); switchAdminTab(adminTab);
  } catch(e) { showNotif('Erreur : ' + e.message, true); }
}

// ── PORTAILS ──
function renderPortails(el) {
  const groupes = [
    {
      label:'🔍 Recherche & Annonces',
      desc:'Les principaux portails pour trouver des biens à acheter ou à investir',
      items:[
        {name:'SeLoger',url:'https://www.seloger.com',desc:'Le plus grand portail d\'annonces immobilières en France.',tag:'general',icon:'seloger.com'},
        {name:'Leboncoin',url:'https://www.leboncoin.fr/recherche?category=9',desc:'Fort volume de particuliers. Bon rapport qualité/prix.',tag:'part',icon:'leboncoin.fr'},
        {name:'PAP',url:'https://www.pap.fr',desc:'Particulier à Particulier. Zéro frais d\'agence.',tag:'part',icon:'pap.fr'},
        {name:'Logic-Immo',url:'https://www.logic-immo.com',desc:'Généraliste avec beaucoup d\'offres d\'agences.',tag:'general',icon:'logic-immo.com'},
      ]
    },
    {
      label:'⚡ Agrégateurs & Alertes',
      desc:'Outils qui regroupent plusieurs sources et envoient des alertes',
      items:[
        {name:"Bien'ici",url:'https://www.bienici.com',desc:'Multi-sources avec carte interactive et filtres puissants.',tag:'aggr',icon:'bienici.com'},
        {name:'Jinka',url:'https://www.jinka.fr',desc:'Alertes en temps réel sur toutes les plateformes.',tag:'aggr',icon:'jinka.fr'},
      ]
    },
    {
      label:'🛠️ Outils & Estimation',
      desc:'Pour évaluer, simuler et affiner votre stratégie d\'investissement',
      items:[
        {name:'MeilleurTaux',url:'https://www.meilleurtaux.com/credit-immobilier/simulation-de-pret-immobilier/calcul-des-mensualites.html',desc:'Simulateur de mensualités et comparateur de crédits.',tag:'general',icon:'meilleurtaux.com'},
        {name:'Meilleurs Agents',url:'https://www.meilleursagents.com',desc:'Estimation de valeur de marché par adresse.',tag:'general',icon:'meilleursagents.com'},
        {name:'Belles Demeures',url:'https://www.bellesdemeures.com',desc:'Spécialiste du luxe et de l\'immobilier de prestige.',tag:'luxe',icon:'bellesdemeures.com'},
      ]
    }
  ];
  const tagLabels = {general:'Généraliste',aggr:'Agrégateur',luxe:'Luxe',part:'Particuliers'};
  el.innerHTML = `
    <div>
      <div class="page-title">Portails immobiliers</div>
      <div class="page-sub">Accédez directement aux principaux sites de recherche et d\'analyse</div>
    </div>
    ${groupes.map(g=>`
      <div>
        <div class="section-header" style="margin-bottom:6px">
          <div>
            <div class="section-title">${g.label}</div>
            <div style="font-size:11px;color:var(--c-muted);margin-top:1px">${g.desc}</div>
          </div>
        </div>
        <div class="portails-grid" style="margin-bottom:8px">
          ${g.items.map(p=>`
            <a class="portail-card" href="${safeUrl(p.url)}" target="_blank" rel="noopener">
              <img class="portail-favicon" src="https://www.google.com/s2/favicons?domain=${p.icon}&sz=64" alt="${p.name}" onerror="this.style.display='none'">
              <div>
                <div class="portail-name">${p.name}</div>
                <div class="portail-desc">${p.desc}</div>
              </div>
              <span class="portail-tag ${p.tag}">${tagLabels[p.tag]}</span>
            </a>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

// ── VISITES ──
async function renderVisites(el) {
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement des visites...</div>`;
  const {data:visites,error} = await db.from('visites').select('*, biens(titre, ville)').order('date_visite',{ascending:false});
  if(error){el.innerHTML='<p style="color:var(--negative)">Erreur chargement</p>';return;}

  // Grouper par bien
  const groups = {};
  (visites||[]).forEach(v => {
    const key = v.bien_id || '__general__';
    const label = v.biens?.titre ? `${v.biens.titre}${v.biens.ville?' — '+v.biens.ville:''}` : '📁 Visites générales';
    if(!groups[key]) groups[key] = {label, visites:[]};
    groups[key].visites.push(v);
  });

  // Mettre les visites générales en dernier
  const sortedKeys = Object.keys(groups).sort(a => a === '__general__' ? 1 : -1);

  // Stats rapides
  const nbAchat = (visites||[]).filter(v=>v.type_visite==='achat').length;
  const nbLoc = (visites||[]).filter(v=>v.type_visite==='locataire').length;
  const avgNote = visites?.length ? ((visites||[]).reduce((a,v)=>a+(v.note_sur_5||0),0)/visites.length).toFixed(1) : null;

  el.innerHTML = `
    <!-- Hero section -->
    <div style="background:var(--accent-g);border-radius:var(--r);padding:24px 28px;margin-bottom:20px;color:white;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.7;margin-bottom:4px">Vos visites</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px">${visites?.length||0} compte${(visites?.length||0)>1?'s':''} rendu${(visites?.length||0)>1?'s':''}</div>
        <div style="font-size:13px;opacity:0.75;margin-top:4px">Notes de visites achat et locataires</div>
      </div>
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        ${nbAchat?`<div style="text-align:center"><div style="font-size:20px;font-weight:800">${nbAchat}</div><div style="font-size:10px;opacity:0.7;margin-top:2px">🏠 Achat</div></div>`:''}
        ${nbLoc?`<div style="text-align:center"><div style="font-size:20px;font-weight:800">${nbLoc}</div><div style="font-size:10px;opacity:0.7;margin-top:2px">👤 Locataire</div></div>`:''}
        ${avgNote?`<div style="text-align:center"><div style="font-size:20px;font-weight:800">${avgNote} ⭐</div><div style="font-size:10px;opacity:0.7;margin-top:2px">Note moyenne</div></div>`:''}
        <button class="btn" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3)" onclick="openNouvelleVisite()">＋ Nouvelle visite</button>
      </div>
    </div>

    ${!visites?.length ? '<div class="empty-state"><h3>Aucune visite</h3><p>Ajoutez votre premier compte rendu de visite.</p></div>' :
      sortedKeys.map((key,idx) => {
        const g = groups[key];
        const isGeneral = key === '__general__';
        const groupId = `vgroup-${idx}`;
        return `
          <div style="margin-bottom:24px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:0;cursor:pointer;padding:10px 14px;background:var(--c-card);border:1px solid var(--c-border);border-radius:var(--r);box-shadow:var(--c-shadow);user-select:none"
              onclick="toggleVisiteGroup('${groupId}',this)">
              <span id="${groupId}-arrow" style="font-size:13px;transition:transform 0.2s;display:inline-block">▼</span>
              <div style="font-size:14px;font-weight:700;color:var(--c-text);flex:1">${g.label}</div>
              <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:999px;padding:2px 10px;font-size:11px;color:var(--c-dim)">${g.visites.length} visite${g.visites.length>1?'s':''}</div>
              ${isGeneral ? '<div style="font-size:11px;color:var(--c-muted);font-style:italic">Non rattachées</div>' : ''}
            </div>
            <div id="${groupId}" style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
              ${g.visites.map(v => renderVisiteCard(v)).join('')}
            </div>
          </div>
        `;
      }).join('')}
  `;
  // Charger les miniatures Storage (placeholders data-thumb-path) en arrière-plan
  tiFillThumbs(el);
}

function renderVisiteCard(v) {
  const note = v.note_sur_5||0;
  const stars = Array.from({length:5},(_,i)=>`<span style="opacity:${i<note?1:0.2};font-size:12px">⭐</span>`).join('');
  const photosCount = (Array.isArray(v.photos_paths) && v.photos_paths.length) ? v.photos_paths.length : (Array.isArray(v.photos) ? v.photos.length : 0);
  const truncNotes = v.notes ? (v.notes.length>100?v.notes.substring(0,100)+'…':v.notes) : '';
  const dateStr = v.date_visite ? new Date(v.date_visite).toLocaleDateString('fr-FR',{day:'numeric',month:'short',year:'numeric'}) : '—';
  const wdStr = v.date_visite ? new Date(v.date_visite).toLocaleDateString('fr-FR',{weekday:'long'}) : '';
  const wordCount = v.notes ? v.notes.split(/\s+/).filter(Boolean).length : 0;
  const scoreCls = note>=4?'score-high':note>=3?'score-mid':note>0?'score-low':'';
  return `<div class="visite-card" onclick="openReadVisite('${v.id}')">
    <div class="visite-card-inner">
      <!-- Colonne gauche : infos principales -->
      <div class="visite-card-left">
        <div class="visite-header">
          <div style="min-width:0">
            <div class="visite-date">📅 ${wdStr ? wdStr.charAt(0).toUpperCase()+wdStr.slice(1)+' ' : ''}${dateStr}</div>
            <div class="visite-adresse" style="margin-top:4px">${v.adresse || v.biens?.titre || '—'}</div>
            ${v.biens?.titre && v.adresse ? `<div class="visite-bien">🏠 ${v.biens.titre}</div>` : ''}
          </div>
          <span class="visite-type ${v.type_visite}" style="margin-top:2px">${v.type_visite==='achat'?'Achat':'Locataire'}</span>
        </div>
        ${truncNotes?`<div style="font-size:12px;color:var(--c-dim);line-height:1.55;margin-bottom:8px">${truncNotes}</div>`:'<div style="font-size:11px;color:var(--c-muted);font-style:italic;margin-bottom:8px">Aucune note rédigée</div>'}
        <div class="visite-footer">
          <div class="stars">${stars}</div>
          ${wordCount>0?`<div class="visite-note-count">📝 ${wordCount} mot${wordCount>1?'s':''}</div>`:''}
          ${photosCount>0?`<div class="visite-photo-count">📸 ${photosCount}</div>`:''}
        </div>
      </div>
      <!-- Colonne droite : score + méta -->
      <div class="visite-card-right">
        <div class="visite-score-circle ${scoreCls}">
          ${note>0?note:'—'}
          ${note>0?`<div style="font-size:8px;opacity:0.6">/5</div>`:''}
        </div>
        <div class="visite-score-label">Note</div>
        ${(() => {
          // Miniatures : base64 legacy (data URL directe) ou Storage (placeholder rempli par tiFillThumbs)
          const storagePhotos = Array.isArray(v.photos_paths) ? v.photos_paths : [];
          const b64Photos = Array.isArray(v.photos) ? v.photos : [];
          const totalThumbs = storagePhotos.length || b64Photos.length;
          if (totalThumbs === 0) {
            return '<div class="visite-right-meta" style="color:var(--c-muted)">Pas de<br>photos</div>';
          }
          let thumbs = '';
          if (storagePhotos.length) {
            // Storage : placeholders remplis en arrière-plan par tiFillThumbs()
            thumbs = storagePhotos.slice(0,2).map(p =>
              `<div data-thumb-bucket="visites-photos" data-thumb-path="${p.path}" style="width:38px;height:38px;border-radius:6px;border:1px solid var(--c-border);background-size:cover;background-position:center;background-color:var(--c-border)"></div>`
            ).join('');
          } else {
            // Base64 legacy : data URLs directes
            thumbs = b64Photos.slice(0,2).map(p =>
              `<img src="${p}" style="width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--c-border)">`
            ).join('');
          }
          const extra = totalThumbs>2 ? `<div style="width:38px;height:38px;border-radius:6px;background:var(--c-border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--c-dim)">+${totalThumbs-2}</div>` : '';
          return `<div style="display:flex;gap:3px;flex-wrap:wrap;justify-content:center;max-width:120px">${thumbs}${extra}</div>`;
        })()}
      </div>
    </div>
  </div>`;
}

function openNouvelleVisite(bienId) {
  visitPhotos=[]; visitRating=0;
  document.getElementById('detail-titre').textContent = 'Nouvelle visite';
  document.getElementById('detail-content').innerHTML = visiteForm(null);
  // Pré-sélection quand on arrive depuis la fiche d'un bien
  if(bienId) { const s = document.getElementById('v-bien'); if(s) s.value = bienId; }
  refreshPhotosPreview();
  openModal('modal-detail');
}

async function openReadVisite(id) {
  const {data:v, error} = await db.from('visites').select('*, biens(titre,ville)').eq('id',id).maybeSingle();
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  if(!v) { showNotif('Cette visite n\'existe plus', true); return; }
  const stars = Array.from({length:5},(_,i)=>`<span style="font-size:20px;opacity:${i<(v.note_sur_5||0)?1:0.2}">⭐</span>`).join('');
  const photoItems = await tiResolveMedia(v.photos_paths, v.photos, 'visites-photos');
  const photos = photoItems.map(x=>x.url);
  const dateStr = v.date_visite ? new Date(v.date_visite+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',year:'numeric',month:'long',day:'numeric'}) : '—';
  const typeLabel = v.type_visite==='achat'?'🏠 Visite achat':'👤 Visite locataire';

  document.getElementById('detail-titre').textContent = v.adresse || v.biens?.titre || 'Visite';
  document.getElementById('detail-content').innerHTML = `
    <!-- Méta -->
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">
      <span style="background:${v.type_visite==='achat'?'rgba(23,160,107,0.1)':'rgba(22,163,74,0.1)'};color:${v.type_visite==='achat'?'var(--accent)':'var(--positive-c)'};padding:4px 12px;border-radius:6px;font-size:12px;font-weight:600">${typeLabel}</span>
      <span style="font-size:12px;color:var(--c-dim)">📅 ${dateStr}</span>
      ${v.biens?.titre?`<span style="font-size:12px;color:var(--c-dim)">🏘️ ${v.biens.titre}${v.biens.ville?' — '+v.biens.ville:''}</span>`:''}
    </div>

    <!-- Note -->
    <div style="margin-bottom:18px">${stars}</div>

    <!-- Notes texte -->
    ${v.notes ? `
    <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r);padding:16px;margin-bottom:18px;font-size:14px;color:var(--c-text);line-height:1.7;white-space:pre-wrap">${esc(v.notes)}</div>
    ` : `<div style="color:var(--c-muted);font-size:13px;margin-bottom:18px;font-style:italic">Aucune note rédigée.</div>`}

    <!-- Photos -->
    ${photos.length ? `
    <div style="margin-bottom:18px">
      <div style="font-size:11px;font-weight:600;color:var(--c-muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📸 Photos (${photos.length})</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${photos.map(p=>`<img src="${p}" style="width:120px;height:90px;object-fit:cover;border-radius:8px;border:1px solid var(--c-border);cursor:pointer" onclick="openLightbox('${p}')">`).join('')}
      </div>
    </div>` : ''}

    <div class="modal-actions" style="margin-top:8px">
      <button class="btn btn-secondary" onclick="closeModal('modal-detail')">Fermer</button>
      <button class="btn btn-primary" onclick="openDetailVisite('${v.id}')">✏️ Modifier</button>
    </div>
  `;
  openModal('modal-detail');
}

async function openDetailVisite(id) {
  const {data:v, error} = await db.from('visites').select('*, biens(titre)').eq('id',id).maybeSingle();
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  if(!v) { showNotif('Cette visite n\'existe plus', true); return; }
  visitPhotos = tiNormalizePhotos(v.photos_paths, v.photos, 'visites-photos'); visitRating = v.note_sur_5||0;
  document.getElementById('detail-titre').textContent = 'Modifier la visite';
  document.getElementById('detail-content').innerHTML = visiteForm(v);
  refreshPhotosPreview();
  // don't call openModal again if already open
  const overlay = document.getElementById('modal-detail');
  if(!overlay.classList.contains('open')) openModal('modal-detail');
}

function visiteForm(v) {
  const bienOptions = allBiens.map(b=>`<option value="${b.id}" ${v?.bien_id===b.id?'selected':''}>${esc(b.titre)} — ${esc(b.ville||'')}</option>`).join('');
  // visitPhotos est déjà normalisé (objets hybrides) par openDetailVisite
  return `
    <div class="form-grid" style="margin-bottom:14px">
      <div class="form-group"><label>Date de la visite *</label><input type="date" id="v-date" value="${esc(v?.date_visite||new Date().toISOString().split('T')[0])}"></div>
      <div class="form-group"><label>Type de visite</label>
        <select id="v-type">
          <option value="achat" ${v?.type_visite==='achat'?'selected':''}>Visite achat</option>
          <option value="locataire" ${v?.type_visite==='locataire'?'selected':''}>Visite locataire</option>
        </select>
      </div>
      <div class="form-group form-full"><label>Adresse (libre)</label><input type="text" id="v-adresse" value="${esc(v?.adresse||'')}" placeholder="ex: 12 rue de la Paix, Paris 75001"></div>
      <div class="form-group form-full"><label>Rattacher à un bien (optionnel)</label>
        <select id="v-bien"><option value="">— Aucun bien rattaché —</option>${bienOptions}</select>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:14px">
      <label>Note globale</label>
      <div class="rating-input" id="rating-input">
        ${[1,2,3,4,5].map(i=>`<button class="star-btn ${(v?.note_sur_5||0)>=i?'active':''}" onclick="setRating(${i})">⭐</button>`).join('')}
      </div>
    </div>
    <div class="form-group" style="margin-bottom:14px">
      <label>Notes & observations</label>
      <textarea id="v-notes" style="min-height:140px" placeholder="Points positifs, négatifs, travaux à prévoir, impression générale...">${esc(v?.notes||'')}</textarea>
    </div>
    <div class="form-group" style="margin-bottom:14px">
      <label>Photos</label>
      <div class="photo-upload-area" onclick="document.getElementById('photo-input').click()">
        📸 Cliquez pour ajouter des photos
        <div style="font-size:11px;color:var(--c-muted);margin-top:4px">JPG, PNG — plusieurs fichiers acceptés</div>
      </div>
      <input type="file" id="photo-input" accept="image/*" multiple style="display:none" onchange="handlePhotos(event)">
      <div class="photos-preview-grid" id="photos-preview"></div>
    </div>
    <div class="modal-actions">
      ${v?`<button class="btn btn-danger" onclick="deleteVisite('${v.id}')">${sfAccIcon('poubelle',14)} Supprimer</button>`:''}
      <button class="btn btn-secondary" onclick="closeModal('modal-detail')">Annuler</button>
      <button class="btn btn-primary" onclick="saveVisite(${v?`'${v.id}'`:'null'})">${v?sfAccIcon('check',14)+' Enregistrer':'＋ Créer la visite'}</button>
    </div>
  `;
}

function setRating(n) {
  visitRating = n;
  document.querySelectorAll('.star-btn').forEach((b,i)=>b.classList.toggle('active',i<n));
}

function handlePhotos(e) {
  const files = Array.from(e.target.files);
  files.forEach(f=>{
    if(!f.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = ev => {
      visitPhotos.push({kind:'b64', data:ev.target.result, name:f.name, _file:f});
      refreshPhotosPreview();
    };
    reader.readAsDataURL(f);
  });
}

function removePhoto(i) { visitPhotos.splice(i,1); refreshPhotosPreview(); }

async function refreshPhotosPreview() {
  const el = document.getElementById('photos-preview');
  if(!el) return;
  const items = await Promise.all(visitPhotos.map(async (p,i)=>{
    let src = p.kind==='b64' ? p.data : await TI_STORAGE.signedUrl(p.bucket||'visites-photos', p.path);
    return `<div class="preview-thumb-wrap"><img class="preview-thumb" src="${src||''}"><button class="preview-remove" onclick="removePhoto(${i})">✕</button></div>`;
  }));
  el.innerHTML = items.join('');
}

async function saveVisite(id) {
  const date = document.getElementById('v-date')?.value;
  const type = document.getElementById('v-type')?.value;
  const adresse = document.getElementById('v-adresse')?.value||null;
  const bienId = document.getElementById('v-bien')?.value||null;
  const notes = document.getElementById('v-notes')?.value||null;
  if(!date){showNotif('La date est requise',true);return;}
  try {
    // 1. Insert/update sans les photos → récupérer l'id
    const payload = {date_visite:date,type_visite:type,adresse,bien_id:bienId||null,note_sur_5:visitRating||null,notes,user_id:currentUser?.id};
    let visiteId = id;
    if(id){
      const {error} = await db.from('visites').update(payload).eq('id',id);
      if(error) throw error;
    } else {
      const {data:inserted, error} = await db.from('visites').insert(payload).select('id').single();
      if(error) throw error;
      visiteId = inserted.id;
    }
    // 2. Upload des nouvelles photos b64 vers Storage
    const photosPaths = [];
    for(const p of visitPhotos){
      if(p.kind==='storage'){ photosPaths.push({path:p.path, name:p.name}); }
      else if(p.kind==='b64'){
        const up = await TI_STORAGE.upload('visites-photos', visiteId, p._file || TI_STORAGE._dataURLtoBlob(p.data), p.name);
        photosPaths.push({path:up.path, name:up.name});
      }
    }
    // 3. Update paths + vider legacy
    const {error:upErr} = await db.from('visites').update({photos_paths:photosPaths, photos:[]}).eq('id',visiteId);
    if(upErr) throw upErr;
    showNotif(id?'✓ Visite mise à jour':'✓ Visite enregistrée');
    closeModal('modal-detail');
    renderVisites(document.getElementById('content'));
  } catch(error) {
    showNotif('Erreur : '+error.message,true);
  }
}

async function deleteVisite(id) {
  if(!confirm('Supprimer ce compte rendu ?'))return;
  // Nettoyer les photos Storage rattachées (best-effort)
  const {data:v} = await db.from('visites').select('photos_paths').eq('id',id).maybeSingle();
  if(v){
    const ph = (Array.isArray(v.photos_paths)?v.photos_paths:[]).map(p=>p.path).filter(Boolean);
    if(ph.length) await TI_STORAGE.remove('visites-photos', ph);
  }
  const{error}=await db.from('visites').delete().eq('id',id);
  if(error){showNotif('Erreur',true);return;}
  showNotif('Visite supprimée');closeModal('modal-detail');
  renderVisites(document.getElementById('content'));
}

// ── SIMULATEUR CRÉDIT ──
async function renderSimulateur(el) {
  // Réinitialiser la sélection à chaque rechargement
  simSelected.clear();
  const bar = document.getElementById('sim-action-bar');
  if(bar) bar.classList.remove('visible');
  el.innerHTML = `<div class="loading"><div class="spinner"></div>Chargement...</div>`;
  // Chargement résilient : on tente la jointure biens(titre), et si elle échoue
  // (relation PostgREST, RLS croisé, etc.) on retombe sur une requête simple.
  // Sans ça, une erreur de jointure renvoyait sims=null → "0 simulation" alors
  // que les données existent bien en base.
  let sims = null;
  {
    const { data, error } = await db.from('simulations_credit')
      .select('*, biens(titre)')
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('Jointure biens(titre) échouée, fallback sans jointure:', error.message);
      const { data: data2, error: error2 } = await db.from('simulations_credit')
        .select('*')
        .order('created_at', { ascending: false });
      if (error2) {
        el.innerHTML = `<div class="empty-state"><h3>Erreur de chargement</h3><p>${error2.message}</p></div>`;
        return;
      }
      sims = data2 || [];
    } else {
      sims = data || [];
    }
  }

  const bienOptions = allBiens.map(b=>`<option value="${b.id}">${esc(b.titre)} — ${esc(b.ville||'')}</option>`).join('');

  // Compute stats
  const bestRate = sims?.length ? Math.min(...sims.map(s=>s.taux_interet||99)).toFixed(2) : null;
  const avgMens = sims?.length ? Math.round(sims.reduce((a,s)=>a+(s.mensualite_calculee||0),0)/sims.length) : null;
  const withPdf = sims?.filter(s=>s.pdf_data||s.pdf_path).length || 0;

  el.innerHTML = `
    <!-- Hero section -->
    <div style="background:var(--accent-g);border-radius:var(--r);padding:24px 28px;margin-bottom:20px;color:white;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px">
      <div>
        <div style="font-size:10px;letter-spacing:2px;text-transform:uppercase;opacity:0.7;margin-bottom:4px">Vos simulations</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.5px">${sims?.length||0} simulation${(sims?.length||0)>1?'s':''} de crédit</div>
        <div style="font-size:13px;opacity:0.75;margin-top:4px">Comparez vos offres de prêt immobilier</div>
      </div>
      <div style="display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        ${bestRate && bestRate < 99 ? `<div style="text-align:center"><div style="font-size:20px;font-weight:800">${bestRate}%</div><div style="font-size:10px;opacity:0.7;margin-top:2px">Meilleur taux</div></div>` : ''}
        ${avgMens ? `<div style="text-align:center"><div style="font-size:20px;font-weight:800">${fmt(avgMens)} €</div><div style="font-size:10px;opacity:0.7;margin-top:2px">Mensualité moy.</div></div>` : ''}
        ${withPdf ? `<div style="text-align:center"><div style="font-size:20px;font-weight:800">${withPdf}</div><div style="font-size:10px;opacity:0.7;margin-top:2px">📄 PDF importé${withPdf>1?'s':''}</div></div>` : ''}
        <button class="btn" style="background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.3)" onclick="openNouvelleSimulation()">＋ Nouvelle simulation</button>
      </div>
    </div>

    ${sims?.length ? `
    <div>
      <div class="section-header"><div class="section-title">Simulations sauvegardées</div><span class="count-pill">${sims.length}</span></div>
      <div class="sim-list" id="sim-list">
        ${sims.map(s=>renderSimCard(s)).join('')}
      </div>
    </div>` : `<div class="empty-state"><h3>Aucune simulation</h3><p>Créez votre première simulation de crédit.</p><button class="btn btn-primary" style="margin-top:12px" onclick="openNouvelleSimulation()">＋ Commencer</button></div>`}
  `;
}

let simSelected = new Set();

function toggleSimSelect(id, evt) {
  evt.stopPropagation();
  if(simSelected.has(id)) simSelected.delete(id);
  else simSelected.add(id);
  // Mettre à jour la checkbox
  const cb = document.querySelector(`.sim-checkbox[data-id="${id}"]`);
  const card = document.querySelector(`.sim-list-item[data-id="${id}"]`);
  if(cb) { cb.classList.toggle('checked',simSelected.has(id)); cb.textContent=simSelected.has(id)?'✓':''; }
  if(card) card.classList.toggle('selected',simSelected.has(id));
  updateSimActionBar();
}

function updateSimActionBar() {
  const bar = document.getElementById('sim-action-bar');
  if(!bar) return;
  const n = simSelected.size;
  bar.classList.toggle('visible', n>0);
  const cnt = bar.querySelector('.sim-action-count');
  if(cnt) cnt.textContent = n + ' sélectionnée'+(n>1?'s':'');
}

async function simActionDelete() {
  if(!simSelected.size) return;
  const n = simSelected.size;
  if(!confirm(`Supprimer ${n} simulation${n>1?'s':''} ? Cette action est irréversible.`)) return;
  const ids = [...simSelected];
  // Nettoyer les PDF Storage rattachés (best-effort)
  const {data:simsToDel} = await db.from('simulations_credit').select('pdf_path').in('id', ids);
  const pdfPaths = (simsToDel||[]).map(s=>s.pdf_path).filter(Boolean);
  if(pdfPaths.length) await TI_STORAGE.remove('simulations-pdf', pdfPaths);
  const {error} = await db.from('simulations_credit').delete().in('id', ids);
  if(error) { showNotif('Erreur suppression : '+error.message, true); return; }
  simSelected.clear();
  showNotif(`${n} simulation${n>1?'s':''} supprimée${n>1?'s':''}`);
  renderSimulateur(document.getElementById('content'));
}

async function simActionAttribuer() {
  if(!simSelected.size) return;
  const biens = allBiens.filter(b=>!b.is_test);
  if(!biens.length) { showNotif('Aucun bien disponible à attribuer', true); return; }
  const opts = biens.map(b=>`<option value="${b.id}">${esc(b.titre)}${b.ville?' — '+esc(b.ville):''}</option>`).join('');
  // Afficher une modal de sélection propre
  document.getElementById('detail-titre').textContent = 'Attribuer à un bien';
  document.getElementById('detail-content').innerHTML = `
    <div style="margin-bottom:16px;font-size:13px;color:var(--c-dim)">
      Choisissez le bien à associer aux <strong>${simSelected.size} simulation${simSelected.size>1?'s':''}</strong> sélectionnée${simSelected.size>1?'s':''}.
    </div>
    <div class="form-group">
      <label class="form-label">Bien immobilier</label>
      <select class="form-select" id="attrib-bien-id" style="width:100%">
        <option value="">— Sélectionner un bien —</option>
        <option value="null">🗂 Aucun (détacher)</option>
        ${opts}
      </select>
    </div>
    <div class="modal-actions" style="margin-top:20px">
      <button class="btn btn-secondary" onclick="closeModal('modal-detail');simDeselectAll()">Annuler</button>
      <button class="btn btn-primary" onclick="confirmAttribuer()">✅ Confirmer</button>
    </div>
  `;
  openModal('modal-detail');
}

async function confirmAttribuer() {
  const sel = document.getElementById('attrib-bien-id');
  if(!sel || !sel.value) { showNotif('Sélectionnez un bien', true); return; }
  const bienId = sel.value === 'null' ? null : sel.value;
  const ids = [...simSelected];
  const { error } = await db.from('simulations_credit')
    .update({ bien_id: bienId })
    .in('id', ids);
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  closeModal('modal-detail');
  simSelected.clear();
  showNotif(`${ids.length} simulation${ids.length>1?'s':''} attribuée${ids.length>1?'s':''}`);

  // FLX-002 : une seule source de vérité pour la mensualité — si la simulation
  // attribuée diffère de la mensualité saisie sur le bien, proposer la synchro.
  if (bienId && ids.length === 1) {
    try {
      const [simRes, bienRes] = await Promise.all([
        db.from('simulations_credit').select('mensualite_calculee,duree_ans').eq('id', ids[0]).single(),
        db.from('biens').select('id,titre,mensualite_credit').eq('id', bienId).single()
      ]);
      const m = Math.round(parseFloat(simRes.data?.mensualite_calculee) || 0);
      const bm = Math.round(parseFloat(bienRes.data?.mensualite_credit) || 0);
      if (m > 0 && m !== bm) {
        const msg = `La mensualité de la simulation (${fmt(m)} €) diffère de celle du bien « ${bienRes.data?.titre || ''} » (${bm ? fmt(bm) + ' €' : 'non renseignée'}).\n\nMettre à jour la fiche du bien avec la mensualité de la simulation ?`;
        if (confirm(msg)) {
          const patch = { mensualite_credit: m };
          if (simRes.data?.duree_ans) patch.duree_credit_ans = simRes.data.duree_ans;
          await db.from('biens').update(patch).eq('id', bienId).eq('user_id', currentUser.id);
          showNotif('Mensualité du bien synchronisée ✓');
        }
      }
    } catch(e) { console.warn('sync mensualité:', e.message); }
  }
  renderSimulateur(document.getElementById('content'));
}

async function simActionDupliquer() {
  if(!simSelected.size) return;
  const ids = [...simSelected];
  for(const id of ids) {
    const {data:s} = await db.from('simulations_credit').select('*').eq('id',id).maybeSingle();
    if(!s) continue;
    const {pdf_data, pdf_name, pdf_path, id:_, created_at, updated_at, ...rest} = s;
    await db.from('simulations_credit').insert({...rest, nom_simulation: s.nom_simulation+' (copie)', user_id: currentUser.id});
  }
  simSelected.clear();
  showNotif('Simulation(s) dupliquée(s)');
  renderSimulateur(document.getElementById('content'));
}

function simDeselectAll() {
  simSelected.clear();
  document.querySelectorAll('.sim-list-item').forEach(el=>el.classList.remove('selected'));
  document.querySelectorAll('.sim-checkbox').forEach(cb=>{cb.classList.remove('checked');cb.textContent='';});
  updateSimActionBar();
}

function renderSimCard(s) {
  const m = s.mensualite_calculee||0;
  const te = s.taux_endettement;
  return `<div class="sim-list-item" data-id="${s.id}" onclick="openReadSimulation('${s.id}')">
    <div class="sim-checkbox" data-id="${s.id}" onclick="toggleSimSelect('${s.id}',event)" title="Sélectionner"></div>
    <div class="sim-list-content">
      <div class="sim-item-name">${esc(s.nom_simulation)}${s.date_document?' <span style="font-size:10px;color:var(--c-muted);font-weight:400">· '+new Date(s.date_document+'T12:00:00').toLocaleDateString('fr-FR')+'</span>':''}</div>
      <div class="sim-item-detail">${s.biens?.titre?'🏠 '+s.biens.titre+' · ':''} ${fmt(s.montant_emprunte||0)} € sur ${s.duree_ans||20} ans · ${(s.taux_interet||0).toFixed(2)}%</div>
    </div>
    ${(s.pdf_data||s.pdf_path)?`<button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" onclick="event.stopPropagation();openPdfSim('${s.id}')">📄 PDF</button>`:''}
    ${te?`<span class="sim-taux-badge">Endettement : ${te.toFixed(1)}%</span>`:''}
    <div class="sim-mensualite">${fmt(m)} €/mois</div>
  </div>`;
}

function calcMensualite(montant, tauxAnnuel, dureeAns) {
  if(!montant||!tauxAnnuel||!dureeAns) return 0;
  const tm = tauxAnnuel/100/12;
  const n = dureeAns*12;
  if(tm===0) return montant/n;
  return montant*tm/(1-Math.pow(1+tm,-n));
}

function openNouvelleSimulation() {
  simEditId = null;
  showSimModal(null);
}

async function openReadSimulation(id) {
  const { data: s, error } = await db.from('simulations_credit').select('*, biens(titre,ville)').eq('id', id).maybeSingle();
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  if(!s) { showNotif('Cette simulation n\'existe plus', true); return; }
  const m = s.mensualite_calculee||0;
  const te = s.taux_endettement;
  const teColor = !te?'rgba(255,255,255,0.5)':te<=33?'#bbf7d0':te<=40?'#fef08a':'#fecdd3';
  const dateStr = s.date_document ? new Date(s.date_document+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'}) : null;

  document.getElementById('detail-titre').textContent = s.nom_simulation;
  document.getElementById('detail-content').innerHTML = `
    <!-- Hero -->
    <div style="background:var(--accent-g);border-radius:var(--r);padding:22px 24px;margin-bottom:18px;color:white">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;opacity:0.7;margin-bottom:4px">Mensualité calculée</div>
      <div style="font-size:36px;font-weight:800;letter-spacing:-1px">${fmt(m)} <span style="font-size:16px;opacity:0.7">€/mois</span></div>
      <div style="display:flex;gap:20px;margin-top:16px;flex-wrap:wrap">
        <div><div style="font-size:18px;font-weight:700">${fmt(s.montant_emprunte||0)} €</div><div style="font-size:10px;opacity:0.65;margin-top:2px">Montant emprunté</div></div>
        <div><div style="font-size:18px;font-weight:700">${(s.taux_interet||0).toFixed(2)}%</div><div style="font-size:10px;opacity:0.65;margin-top:2px">Taux annuel</div></div>
        <div><div style="font-size:18px;font-weight:700">${s.duree_ans||20} ans</div><div style="font-size:10px;opacity:0.65;margin-top:2px">Durée</div></div>
        ${te?`<div><div style="font-size:18px;font-weight:700;color:${teColor}">${te.toFixed(1)}%</div><div style="font-size:10px;opacity:0.65;margin-top:2px">Taux d'endettement</div></div>`:''}
      </div>
    </div>

    <!-- Infos complémentaires -->
    <div class="detail-grid" style="margin-bottom:16px">
      ${dateStr?`<div class="detail-item"><div class="detail-label">Date d'émission</div><div class="detail-value">${dateStr}</div></div>`:''}
      ${s.biens?.titre?`<div class="detail-item"><div class="detail-label">Bien rattaché</div><div class="detail-value">🏠 ${s.biens.titre}${s.biens.ville?' — '+s.biens.ville:''}</div></div>`:''}
      ${s.loyer_exige_banque?`<div class="detail-item"><div class="detail-label">Loyer exigé banque</div><div class="detail-value">${fmt(s.loyer_exige_banque)} €/mois</div></div>`:''}
      ${s.revenus_mensuels?`<div class="detail-item"><div class="detail-label">Revenus mensuels</div><div class="detail-value">${fmt(s.revenus_mensuels)} €/mois</div></div>`:''}
      <div class="detail-item"><div class="detail-label">Coût total du crédit</div><div class="detail-value">${fmt(Math.round((m*s.duree_ans*12)-(s.montant_emprunte||0)))} €</div></div>
    </div>

    ${s.notes?`<div class="notes-box" style="margin-bottom:16px">${esc(s.notes)}</div>`:''}

    <!-- PDF viewer -->
    ${(s.pdf_data||s.pdf_path)?`
    <div style="margin-bottom:16px">
      <div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--c-muted);margin-bottom:8px">📄 Document importé</div>
      <div style="background:var(--c-bg);border:1px solid var(--c-border);border-radius:var(--r-sm);padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="openPdfSim('${s.id}')">
        <div style="width:40px;height:40px;background:rgba(23,160,107,0.1);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0">📄</div>
        <div>
          <div style="font-size:13px;font-weight:600;color:var(--c-text)">${s.pdf_name||'Document PDF'}</div>
          <div style="font-size:11px;color:var(--accent);margin-top:2px">Cliquer pour ouvrir le document →</div>
        </div>
      </div>
    </div>`:
    '<div style="padding:12px;background:var(--c-bg);border-radius:var(--r-sm);font-size:12px;color:var(--c-muted);margin-bottom:16px;text-align:center">Aucun PDF importé pour cette simulation</div>'}

    <div class="modal-actions">
      <button class="btn btn-secondary" onclick="closeModal('modal-detail')">Fermer</button>
      <button class="btn btn-primary" onclick="openEditSimulation('${s.id}')">✏️ Modifier</button>
    </div>
  `;
  openModal('modal-detail');
}

async function openEditSimulation(id) {
  simEditId = id;
  const {data:s, error} = await db.from('simulations_credit').select('*').eq('id',id).maybeSingle();
  if(error) { showNotif('Erreur : '+error.message, true); return; }
  if(!s) { showNotif('Cette simulation n\'existe plus', true); return; }
  showSimModal(s);
}

function showSimModal(s) {
  // Reset state PDF en mémoire (évite de ré-uploader un PDF d'une session précédente)
  window._currentPdfName = null;
  window._currentPdfData = null;
  const bienOptions = allBiens.map(b=>`<option value="${b.id}" ${s?.bien_id===b.id?'selected':''}>${esc(b.titre)} — ${esc(b.ville||'')}</option>`).join('');
  document.getElementById('detail-titre').textContent = s?'Modifier la simulation':'Nouvelle simulation';
  document.getElementById('detail-content').innerHTML = `
    <!-- Import PDF -->
    <div class="pdf-zone" id="pdf-zone" onclick="document.getElementById('pdf-input').click()">
      <div class="pdf-zone-icon">📄</div>
      <div class="pdf-zone-text">Importer une offre de prêt (PDF)</div>
      <div class="pdf-zone-sub">Claude extraira automatiquement les données de votre document bancaire</div>
    </div>
    <input type="file" id="pdf-input" accept="application/pdf" style="display:none" onchange="extractPDF(event)">
    <div id="pdf-status"></div>

    <div class="form-grid" style="margin-bottom:14px">
      <div class="form-group form-full"><label>Nom de la simulation *</label><input type="text" id="s-nom" value="${esc(s?.nom_simulation||'')}" placeholder="ex: Offre Crédit Agricole 20 ans"></div>
      <div class="form-group"><label>Date d'émission du document</label><input type="date" id="s-date-doc" value="${esc(s?.date_document||'')}"></div>
      <div class="form-group"><label>Rattacher à un bien</label>
        <select id="s-bien"><option value="">— Non rattaché —</option>${bienOptions}</select>
      </div>
      <div class="form-group"><label>Montant emprunté (€)</label><input type="number" id="s-montant" value="${esc(s?.montant_emprunte||'')}" oninput="recalcSim()"></div>
      <div class="form-group"><label>Taux d'intérêt annuel (%)</label><input type="number" id="s-taux" step="0.01" value="${esc(s?.taux_interet||'')}" oninput="recalcSim()"></div>
      <div class="form-group"><label>Durée (ans)</label><input type="number" id="s-duree" value="${esc(s?.duree_ans||20)}" oninput="recalcSim()"></div>
      <div class="form-group"><label>Mensualité calculée</label>
        <div class="calc-field" id="s-mensualite-display">
          <span class="calc-field-badge">🔒 Auto</span>
          <span id="s-mensualite-val">${s?.mensualite_calculee?fmt(s.mensualite_calculee)+' €/mois':'—'}</span>
        </div>
      </div>
      <div class="form-group"><label>Loyer min. exigé par la banque (€/mois)</label><input type="number" id="s-loyer-banque" value="${esc(s?.loyer_exige_banque||'')}" oninput="recalcSim()" placeholder="ex: 1 200"></div>
      <div class="form-group"><label>Vos revenus mensuels (€/mois)</label><input type="number" id="s-revenus" value="${esc(s?.revenus_mensuels||'')}" oninput="recalcSim()" placeholder="ex: 4 000"></div>
    </div>

    <!-- Résultats en temps réel -->
    <div id="sim-preview" style="margin-bottom:14px"></div>

    <div style="clear:both;margin-top:16px" class="form-group">
      <label>Notes</label>
      <textarea id="s-notes" placeholder="Conditions de l'offre, points à négocier...">${esc(s?.notes||'')}</textarea>
    </div>
    <div class="modal-actions">
      ${s?`<button class="btn btn-danger" onclick="deleteSim('${s.id}')">${sfAccIcon('poubelle',14)} Supprimer</button>`:''}
      <button class="btn btn-secondary" onclick="closeModal('modal-detail')">Annuler</button>
      <button class="btn btn-primary" onclick="saveSim()">${s?sfAccIcon('check',14)+' Enregistrer':'＋ Sauvegarder'}</button>
    </div>
  `;
  openModal('modal-detail');
  if(s) recalcSim();
}

function recalcSim() {
  const montant = parseFloat(document.getElementById('s-montant')?.value)||0;
  const taux = parseFloat(document.getElementById('s-taux')?.value)||0;
  const duree = parseFloat(document.getElementById('s-duree')?.value)||20;
  const loyerBanque = parseFloat(document.getElementById('s-loyer-banque')?.value)||0;
  const revenus = parseFloat(document.getElementById('s-revenus')?.value)||0;

  const mensualite = calcMensualite(montant, taux, duree);
  const mensEl = document.getElementById('s-mensualite-val');
  if(mensEl) mensEl.textContent = mensualite>0 ? fmt(mensualite)+' €/mois' : '—';

  // Taux d'endettement : mensualité / (revenus + loyer*0.7) * 100
  const prevEl = document.getElementById('sim-preview');
  if(!prevEl) return;
  if(!montant && !mensualite) { prevEl.innerHTML=''; return; }

  let endettHTML = '';
  if(revenus > 0) {
    const revenusEffectifs = revenus + loyerBanque * 0.7;
    const te = (mensualite / revenusEffectifs) * 100;
    const teClass = te<=33?'ok':te<=40?'warn':'danger';
    const teLabel = te<=33?'✅ Excellent':te<=40?'⚠️ Limite':'🔴 Trop élevé';
    endettHTML = `
      <div class="sim-endettement">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:11px;color:rgba(255,255,255,0.7)">Taux d'endettement</div>
          <div style="font-size:11px;font-weight:700">${teLabel}</div>
        </div>
        <div style="font-size:26px;font-weight:800;margin:4px 0">${te.toFixed(1)}%</div>
        <div class="sim-bar-bg"><div class="sim-bar-fill ${teClass}" style="width:${Math.min(te/50*100,100)}%"></div></div>
        <div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:6px">Revenus pris en compte : ${fmt(revenusEffectifs)} € (revenus + 70% du loyer)</div>
      </div>`;
  }

  prevEl.innerHTML = `
    <div class="sim-result-card" style="position:relative">
      <div class="sim-result-label">Mensualité calculée</div>
      <div class="sim-result-value">${mensualite>0?fmt(mensualite)+' €':'—'}<span style="font-size:14px;opacity:0.6">/mois</span></div>
      <div class="sim-detail-row"><span class="sim-detail-label">Montant emprunté</span><span class="sim-detail-value">${fmt(montant)} €</span></div>
      <div class="sim-detail-row"><span class="sim-detail-label">Taux annuel</span><span class="sim-detail-value">${taux.toFixed(2)} %</span></div>
      <div class="sim-detail-row"><span class="sim-detail-label">Durée</span><span class="sim-detail-value">${duree} ans</span></div>
      <div class="sim-detail-row"><span class="sim-detail-label">Coût total du crédit</span><span class="sim-detail-value">${fmt(mensualite*duree*12-montant)} €</span></div>
      ${loyerBanque?`<div class="sim-detail-row"><span class="sim-detail-label">Loyer min. banque</span><span class="sim-detail-value">${fmt(loyerBanque)} €/mois</span></div>`:''}
      ${endettHTML}
    </div>
  `;
}

async function extractPDF(e) {
  const file = e.target.files[0];
  if(!file) return;
  const zone = document.getElementById('pdf-zone');
  const status = document.getElementById('pdf-status');
  zone.classList.add('loading');
  zone.innerHTML = `<div class="pdf-zone-icon">⏳</div><div class="pdf-zone-text">Lecture du document PDF...</div><div class="pdf-zone-sub">Extraction des données en cours</div>`;

  try {
    // Configure PDF.js worker
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;

    // Extract all text from all pages
    let fullText = '';
    for(let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      fullText += content.items.map(item => item.str).join(' ') + '\n';
    }

    // --- Extraction précise pour documents bancaires français ---
    const extracted = {};

    // ── MONTANT EMPRUNTÉ ──
    const montantPatterns = [
      /total des prêts[^\n]{0,60}([\d\s]{5,}[\d,]+)\s*€?/i,
      /total du financement[^\n]{0,60}([\d\s]{5,}[\d,]+)\s*€/i,
      /montant[^\n]{0,10}emprunté[^\d€]{0,30}([\d\s]{5,}[\d,]+)\s*€/i,
    ];
    for(const p of montantPatterns) {
      const m = fullText.match(p);
      if(m) {
        const val = parseFloat(m[1].replace(/\s/g,'').replace(',','.'));
        if(val > 10000 && val < 10000000) { extracted.montant_emprunte = val; break; }
      }
    }

    // ── TAUX D'INTÉRÊT — doit être réaliste (0.5% à 15%), pas les taux d'invalidité (66%) ──
    const tauxPatterns = [
      /PTH[^\n]{0,80}(\d+[,\.]\d+)\s*%/i,
      /taux[^\n]{0,20}nominal[^\n]{0,30}(\d+[,\.]\d+)\s*%/i,
      /taux[^\n]{0,15}intérêt[^\n]{0,20}(\d+[,\.]\d+)\s*%/i,
    ];
    for(const p of tauxPatterns) {
      const m = fullText.match(p);
      if(m) {
        const val = parseFloat(m[1].replace(',','.'));
        if(val >= 0.5 && val <= 15) { extracted.taux_interet = val; break; }
      }
    }

    // ── DURÉE ──
    const dureeMoisMatch = fullText.match(/PTH[^\n]{0,80}(\d{3})\s*(?:mois|$)/i)
      || fullText.match(/durée[^\n]{0,30}(\d{2,3})\s*mois/i)
      || fullText.match(/duration.*?(\d{3})\s*mois/i);
    const dureeAnsMatch = fullText.match(/(\d{2})\s*ans/i);
    if(dureeMoisMatch) {
      const mois = parseInt(dureeMoisMatch[1]);
      if(mois >= 12 && mois <= 360) extracted.duree_ans = Math.round(mois/12);
    } else if(dureeAnsMatch) {
      const ans = parseInt(dureeAnsMatch[1]);
      if(ans >= 1 && ans <= 30) extracted.duree_ans = ans;
    }

    // ── MENSUALITÉ HORS ASSURANCE ──
    const mensPatterns = [
      /mensualité\s+hors\s+assurance[^€\d]{0,20}([\d\s]+[\d,]+)\s*€/i,
      /(?:1er|1°)\s*à\s*240[^€\d]{0,30}([\d\s]+[\d,]+)\s*€/i,
      /échéance mensuelle[^€\d]{0,30}([\d\s]+[\d,]+)\s*€/i,
    ];
    for(const p of mensPatterns) {
      const m = fullText.match(p);
      if(m) {
        const val = parseFloat(m[1].replace(/\s/g,'').replace(',','.'));
        if(val >= 100 && val <= 20000) { extracted.mensualite = val; break; }
      }
    }

    // ── LOYER SIMULÉ ──
    const loyerMatch = fullText.match(/loyer[^\n]{0,20}mensuel[^€\d]{0,20}([\d\s]+[\d,]+)\s*€/i)
      || fullText.match(/montant mensuel[^€\d]{0,20}([\d\s]+[\d,]+)\s*€/i);
    if(loyerMatch) {
      const val = parseFloat(loyerMatch[1].replace(/\s/g,'').replace(',','.'));
      if(val >= 100 && val <= 20000) extracted.loyer_exige = val;
    }

    // ── REVENUS MENSUELS (priorité absolue sur les mensuels, sinon annuels / 12) ──
    const revenusMatch = fullText.match(/revenus\s+mensuels?[^\d€]{0,20}([\d\s]+[\d,]+)\s*€/i);
    if(revenusMatch) {
      const val = parseFloat(revenusMatch[1].replace(/\s/g,'').replace(',','.'));
      if(val >= 500 && val <= 50000) extracted.revenus = val;
    }
    // Fallback : revenus annuels / 12
    if(!extracted.revenus) {
      const revenusAnnuelsMatch = fullText.match(/revenus?\s+annuels?[^\d€]{0,20}([\d\s]+[\d,]+)\s*€/i);
      if(revenusAnnuelsMatch) {
        const annuel = parseFloat(revenusAnnuelsMatch[1].replace(/\s/g,'').replace(',','.'));
        if(annuel >= 6000 && annuel <= 600000) extracted.revenus = Math.round(annuel/12);
      }
    }

    // ── DATE DU DOCUMENT ──
    const datePatterns = [
      /valable à compter du\s+(\d{2})\/(\d{2})\/(\d{4})/i,
      /fiche remise le\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i,
      /simulation[^\n]{0,60}_(\d{2})(\d{2})(\d{4})\d*/i,
    ];
    for(const p of datePatterns) {
      const m = fullText.match(p);
      if(m && m[3]) {
        extracted.date_document = `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
        break;
      }
    }

    // Pré-remplir les champs
    if(extracted.montant_emprunte) { const el=document.getElementById('s-montant'); if(el)el.value=extracted.montant_emprunte; }
    if(extracted.taux_interet) { const el=document.getElementById('s-taux'); if(el)el.value=extracted.taux_interet; }
    if(extracted.duree_ans) { const el=document.getElementById('s-duree'); if(el)el.value=extracted.duree_ans; }
    if(extracted.loyer_exige) { const el=document.getElementById('s-loyer-banque'); if(el)el.value=extracted.loyer_exige; }
    if(extracted.revenus) { const el=document.getElementById('s-revenus'); if(el)el.value=extracted.revenus; }
    if(extracted.date_document) { const el=document.getElementById('s-date-doc'); if(el)el.value=extracted.date_document; }
    recalcSim();

    const fieldsFound = Object.values(extracted).filter(v=>v!=null&&!isNaN(v)).length;
    zone.classList.remove('loading');
    zone.innerHTML = `<div class="pdf-zone-icon">✅</div><div class="pdf-zone-text">${file.name}</div>`;
    // Store PDF for later saving
    window._currentPdfName = file.name;
    window._currentPdfData = await new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.readAsDataURL(file);});

    if(fieldsFound > 0) {
      const details = [
        extracted.montant_emprunte?`Montant: ${fmt(extracted.montant_emprunte)} €`:'',
        extracted.taux_interet?`Taux: ${extracted.taux_interet}%`:'',
        extracted.duree_ans?`Durée: ${extracted.duree_ans} ans`:'',
        extracted.mensualite?`Mensualité: ${fmt(extracted.mensualite)} €`:'',
      ].filter(Boolean).join(' · ');
      status.innerHTML = `<div class="pdf-extracted-badge">✅ ${fieldsFound} champ${fieldsFound>1?'s':''} extrait${fieldsFound>1?'s':''}</div><div style="font-size:11px;color:var(--c-dim);margin-top:6px">${details}</div>`;
    } else {
      status.innerHTML = `<div style="color:var(--warning);font-size:12px;padding:8px">⚠️ Aucune donnée reconnue automatiquement. Veuillez remplir les champs manuellement.</div>`;
    }

  } catch(err) {
    zone.classList.remove('loading');
    zone.innerHTML = `<div class="pdf-zone-icon">📄</div><div class="pdf-zone-text">Importer une offre de prêt (PDF)</div><div class="pdf-zone-sub">Claude extraira automatiquement les données</div>`;
    status.innerHTML = `<div style="color:var(--negative);font-size:12px">Erreur lecture PDF : ${err.message}</div>`;
    console.error(err);
  }
}

function openPdfSim(id) {
  // Find sim in rendered list - reload from DB
  db.from('simulations_credit').select('pdf_data,pdf_name,pdf_path').eq('id',id).maybeSingle().then(async ({data, error})=>{
    if(error) {showNotif('Erreur : '+error.message, true); return;}
    let src = null;
    if(data?.pdf_path){
      src = await TI_STORAGE.signedUrl('simulations-pdf', data.pdf_path);
    } else if(data?.pdf_data){
      src = data.pdf_data; // fallback legacy base64
    }
    if(!src){showNotif('PDF non disponible',true);return;}
    const w=window.open('');
    if(w){w.document.write(`<iframe src="${src}" style="width:100%;height:100vh;border:none"></iframe>`);w.document.close();}
  });
}

async function saveSim() {
  const nom = document.getElementById('s-nom')?.value;
  if(!nom){showNotif('Le nom est requis',true);return;}
  const montant = parseFloat(document.getElementById('s-montant')?.value)||0;
  const taux = parseFloat(document.getElementById('s-taux')?.value)||0;
  const duree = parseInt(document.getElementById('s-duree')?.value)||20;
  const loyerBanque = parseFloat(document.getElementById('s-loyer-banque')?.value)||0;
  const revenus = parseFloat(document.getElementById('s-revenus')?.value)||0;
  const mensualite = calcMensualite(montant,taux,duree);
  const revenusEff = revenus + loyerBanque*0.7;
  const te = revenus>0 ? (mensualite/revenusEff)*100 : null;
  const bienId = document.getElementById('s-bien')?.value||null;
  const notes = document.getElementById('s-notes')?.value||null;
  const dateDoc = document.getElementById('s-date-doc')?.value||null;
  const pdfName = window._currentPdfName||null; const pdfData = window._currentPdfData||null;
  try {
    // 1. Insert/update des champs (sans nouveau PDF) → récupérer l'id
    const payload = {nom_simulation:nom,bien_id:bienId||null,montant_emprunte:montant,taux_interet:taux,duree_ans:duree,mensualite_calculee:mensualite,loyer_exige_banque:loyerBanque,revenus_mensuels:revenus,taux_endettement:te,notes,date_document:dateDoc||null,user_id:currentUser?.id};
    if(pdfName) payload.pdf_name = pdfName;
    let simId = simEditId;
    if(simEditId){
      const {error} = await db.from('simulations_credit').update(payload).eq('id',simEditId);
      if(error) throw error;
    } else {
      const {data:inserted, error} = await db.from('simulations_credit').insert(payload).select('id').single();
      if(error) throw error;
      simId = inserted.id;
    }
    // 2. Si un NOUVEAU PDF a été importé (base64 dataURL en mémoire), l'uploader
    if(pdfData && pdfData.startsWith('data:')){
      const up = await TI_STORAGE.uploadDataURL('simulations-pdf', simId, pdfData, pdfName || 'simulation.pdf');
      const {error:upErr} = await db.from('simulations_credit').update({pdf_path:up.path, pdf_data:null}).eq('id',simId);
      if(upErr) throw upErr;
    }
    showNotif(simEditId?'✓ Simulation mise à jour':'✓ Simulation sauvegardée');
    closeModal('modal-detail');
    renderSimulateur(document.getElementById('content'));
  } catch(error) {
    showNotif('Erreur : '+error.message,true);
  }
}

async function deleteSim(id) {
  if(!confirm('Supprimer cette simulation ?'))return;
  const{error}=await db.from('simulations_credit').delete().eq('id',id);
  if(error){showNotif('Erreur',true);return;}
  showNotif('Simulation supprimée');closeModal('modal-detail');
  renderSimulateur(document.getElementById('content'));
}

function toggleVisiteGroup(groupId, header) {
  const content = document.getElementById(groupId);
  const arrow = document.getElementById(groupId+'-arrow');
  if(!content) return;
  const isOpen = content.style.display !== 'none';
  content.style.display = isOpen ? 'none' : 'flex';
  if(arrow) arrow.style.transform = isOpen ? 'rotate(-90deg)' : 'rotate(0deg)';
}

function openModal(id){document.getElementById(id).classList.add('open');}
function closeModal(id){document.getElementById(id).classList.remove('open');}
// L'icone est portee par le COMPOSANT, plus par chacun des messages. Une
// quarantaine d'appels commencaient par « ✓ », « ✅ », « 🚫 »… : autant
// d'endroits ou l'icone pouvait manquer ou differer. Ici elle decoule du seul
// parametre qui la determine vraiment — succes ou erreur.
//
// `textContent` est remplace par `innerHTML`, donc le message est ECHAPPE :
// il contient parfois un titre de bien saisi par l'utilisateur.
function showNotif(msg,isError=false){
  const el=document.getElementById('notif');
  el.innerHTML = `<span class="notif__ic">${sfAccIcon(isError?'alerte':'ok',16)}</span>`
               + `<span class="notif__txt">${esc(msg)}</span>`;
  el.className='notif show'+(isError?' error':'');
  setTimeout(()=>el.classList.remove('show'),3000);
}
/* Un clic sur le fond referme la fenêtre — SAUF si elle est verrouillée.
   Le workflow d'acquisition pose `data-verrou` : on n'en sort que par
   « Annuler » ou « Confirmer », jamais par un clic à côté (voir
   `bdAcqVerrouiller`). */
document.querySelectorAll('.modal-overlay').forEach(o=>o.addEventListener('click',e=>{
  if(e.target===o && !o.dataset.verrou) o.classList.remove('open');
}));
// FND-006 : purge de l'ancienne clé NewsAPI stockée en localStorage. La clé vit désormais
// uniquement dans le secret Supabase NEWSAPI_KEY, lu par l'Edge Function news-proxy.
localStorage.removeItem('sf_newsapi_key');
localStorage.removeItem('ti_newsapi_key');   // ancien nom, purge egalement

// Renommage TrackImmo -> Stonefolio : les preferences locales passent de ti_*
// a sf_*. Migration une seule fois, sinon l'utilisateur retrouverait son theme
// et ses reglages de tableau de bord remis a zero sans comprendre pourquoi.
// La base reste la source de verite (applyAppearanceFromPrefs) ; ce cache
// local ne sert qu'a eviter un clignotement au chargement.
(function migrerClesLocales(){
  const paires = [['ti_theme','sf_theme'], ['ti_accent','sf_accent'],
                  ['ti_dash_cf','sf_dash_cf'], ['ti_dash_st','sf_dash_st'],
                  ['ti_dash_kpi','sf_dash_kpi']];
  try {
    for(const [ancien, nouveau] of paires) {
      const v = localStorage.getItem(ancien);
      if(v !== null && localStorage.getItem(nouveau) === null) localStorage.setItem(nouveau, v);
      if(v !== null) localStorage.removeItem(ancien);
    }
  } catch(e) { /* stockage indisponible : les defauts s'appliquent */ }
})();
document.addEventListener('DOMContentLoaded', init);

// ═══════════════════════════════════════════════════════════
//   SETTINGS PANEL
// ═══════════════════════════════════════════════════════════

// `THEMES` vivait ici : cinq nuanciers (indigo, blue, emerald, rose, amber)
// qui portaient a eux seuls QUINZE couleurs de l'ancienne charte TrackImmo.
// Ils ne peignaient plus rien depuis l'arbitrage « DA unique » du 01/08/2026 —
// du code mort qui gardait la vieille palette en vie dans le depot.

// Visibilité des blocs du tableau de bord (cf = graphique cashflow, st = donut statuts, kpi = bandeau KPIs)
const dashVisibility = { cf: true, st: true, kpi: true };
// Couleur d'accent : la colonne existe encore en base et `persistAppearance()`
// l'ecrit, mais plus rien ne la lit pour peindre. Elle vaut desormais le vert
// d'identite plutot qu'un indigo qui n'a plus cours.
let currentAccent = { color: '#17A06B', colorDark: '#127A44' };

function closeSettings() {
  // No-op : l'ancien panneau slide-in n'existe plus, conservé pour compat des appels existants
}

// `applyTheme()` vivait ici. Elle ne peignait plus rien depuis l'arbitrage
// « DA unique », et aucun `.theme-swatch` n'existe plus dans l'interface : elle
// ne faisait qu'ecrire une entree de localStorage que personne ne lisait pour
// autre chose qu'elle-meme. Supprimee avec `THEMES` et `currentTheme`.


// L'ACCENT N'EST PLUS CONFIGURABLE — arbitrage « DA unique » du 01/08/2026.
//
// Cette fonction ecrivait --accent et ses derives en style EN LIGNE sur
// <html>. Un style en ligne l'emporte sur toute regle de feuille : tant
// qu'elle s'executait, la couleur enregistree en base (bleu #3b82f6 pour le
// compte de Thomas) repeignait la charte verte a chaque chargement, et aucune
// correction dans styles.css n'aurait pu tenir. C'etait la cause reelle
// derriere « le fond est toujours blanc », pas seulement les variables.
//
// Elle est conservee en fonction vide plutot que supprimee : deux appelants
// (loadPreferences, applyAppearanceFromPrefs) l'invoquent encore, et les
// colonnes accent_color / accent_color2 existent toujours en base.
// La charte vient desormais uniquement de tokens.css.
//
// `setAccent`, seule fonction qui ecrivait un nouvel accent, est supprimee
// avec le nuancier qui l'appelait.
function applyAccentVars() { /* volontairement sans effet */ }

// `savePrefs()` vivait ici. Elle etait le gestionnaire des trois interrupteurs
// de graphiques du tableau de bord, retires en phase 5 avec les graphiques
// qu'ils pilotaient : plus aucun appelant depuis. Les colonnes dash_show_*
// restent en base — inoffensives, et reutilisables si l'on reintroduit un jour
// des blocs optionnels.

// Enregistre l'apparence courante (couleur + toggles) en base de données.
// Source de vérité = DB ; le localStorage n'est qu'un cache anti-flash.
async function persistAppearance() {
  const isHex = (c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c);
  const accent  = isHex(currentAccent.color)     ? currentAccent.color     : null;
  const accent2 = isHex(currentAccent.colorDark) ? currentAccent.colorDark : null;
  try {
    const { error } = await db.rpc('update_my_appearance', {
      p_accent_color:  accent,
      p_accent_color2: accent2,
      p_dash_cf:  dashVisibility.cf  !== false,
      p_dash_st:  dashVisibility.st  !== false,
      p_dash_kpi: dashVisibility.kpi !== false
    });
    if(error) throw error;
    // Refléter dans userPrefs en mémoire
    if(userPrefs){
      userPrefs.accent_color  = accent;
      userPrefs.accent_color2 = accent2;
      userPrefs.dash_show_cf  = dashVisibility.cf  !== false;
      userPrefs.dash_show_st  = dashVisibility.st  !== false;
      userPrefs.dash_show_kpi = dashVisibility.kpi !== false;
    }
  } catch(e){ console.warn('persistAppearance:', e.message); }
}

function loadPreferences() {
  // La restauration du thème est retirée avec le nuancier : il n'y a plus
  // qu'une seule charte, il n'y a donc plus rien à restaurer. La clé
  // localStorage `sf_theme` d'un ancien utilisateur est simplement ignorée.
  try {
    const savedAccent = JSON.parse(localStorage.getItem('sf_accent')||'null');
    if(savedAccent?.color) {
      applyAccentVars(savedAccent.color, savedAccent.colorDark);
      currentAccent = { color: savedAccent.color, colorDark: savedAccent.colorDark };
    }
  } catch(e){}
  ['cf','st','kpi'].forEach(key => {
    const saved = localStorage.getItem('sf_dash_'+key);
    if(saved === '0') dashVisibility[key] = false;
  });
}

// Applique l'apparence depuis la DB (userPrefs), chargée après loadProfile().
// La DB fait autorité. Si la DB n'a jamais reçu d'apparence (accent_color null),
// on migre l'état localStorage courant vers la DB (une seule fois).
async function applyAppearanceFromPrefs() {
  if(!userPrefs) return;
  const dbAccent = userPrefs.accent_color;
  if(dbAccent) {
    // La DB a une apparence enregistrée → elle fait autorité
    const color = userPrefs.accent_color;
    const colorDark = userPrefs.accent_color2 || color;
    applyAccentVars(color, colorDark);
    currentAccent = { color, colorDark };
    localStorage.setItem('sf_accent', JSON.stringify({color, colorDark}));
    // Toggles dashboard depuis la DB
    dashVisibility.cf  = userPrefs.dash_show_cf  !== false;
    dashVisibility.st  = userPrefs.dash_show_st  !== false;
    dashVisibility.kpi = userPrefs.dash_show_kpi !== false;
    ['cf','st','kpi'].forEach(k => localStorage.setItem('sf_dash_'+k, dashVisibility[k] ? '1' : '0'));
  } else {
    // La DB n'a jamais reçu d'apparence → migration du localStorage (déjà appliqué
    // par loadPreferences) vers la DB, une seule fois.
    await persistAppearance();
  }
}


// Also remove "Données" button from topbar (now in settings)

/* ═══════════════════════════════════════
   MODULE SCI — Fonctions JS
═══════════════════════════════════════ */

let allSCI = [];
let currentSCIId = null; // null = création, uuid = édition
let sciAssocies = [];    // tableau des associés en cours d'édition

// ── Chargement liste SCI ──────────────────────
async function loadSCIList() {
  if (!currentUser) return;
  try {
    const { data, error } = await db
      .from('sci')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    allSCI = data || [];
    renderSCIList();
  } catch(e) {
    console.error('loadSCIList:', e);
    const c = document.getElementById('sci-list-container');
    if(c) c.innerHTML = '<div style="font-size:12px;color:var(--sf-loss);padding:4px 0">Erreur — <a href="#" onclick="closeSettings();navigate(\'administration\')" style="color:var(--accent)">Gérer mes SCI</a></div>';
  }
}

// ── Rendu liste SCI dans le panneau Paramètres ──
function renderSCIList() {
  const c = document.getElementById('sci-list-container');
  if (!c) return;
  if (!allSCI.length) {
    c.innerHTML = '<div class="sci-empty" style="padding:8px 0;text-align:left;font-size:12px;color:var(--c-muted)">Aucune SCI. <a href="#" onclick="closeSettings();navigate(\'administration\')" style="color:var(--accent)">Créer →</a></div>';
    return;
  }
  c.innerHTML = allSCI.map(s => {
    const initials = (s.nom_sci || 'SC').substring(0, 2).toUpperCase();
    const nbAssoc = (s.associes || []).length;
    const sub = [
      nbAssoc ? `${nbAssoc} associé${nbAssoc > 1 ? 's' : ''}` : 'Associés à définir',
      s.capital_social ? `Capital : ${fmt(s.capital_social)} €` : ''
    ].filter(Boolean).join(' · ');
    return `
      <div class="sci-list-item" onclick="openSCIModal('${s.id}')">
        <div class="sci-list-avatar">${initials}</div>
        <div>
          <div class="sci-list-name">${esc(s.nom_sci)}</div>
          <div class="sci-list-sub">${sub}</div>
        </div>
        <div class="sci-list-arrow">›</div>
      </div>`;
  }).join('') + '<div style="padding:6px 0 2px;font-size:11px;text-align:center"><a href="#" onclick="closeSettings();navigate(\'administration\')" style="color:var(--accent)">Gérer mes SCI →</a></div>';
}

// ── Ouvrir modal SCI (null = nouvelle, id = édition) ──
function openSCIModal(id) {
  closeSettings();
  currentSCIId = id;
  sciAssocies = [];
  sciDocsPending = [];

  const modal = document.getElementById('sci-modal-overlay');
  const title = document.getElementById('sci-modal-title');
  const btnDel = document.getElementById('sci-btn-delete');

  if (id) {
    const sci = allSCI.find(s => s.id === id);
    if (!sci) return;
    title.textContent = '✏️ Modifier la SCI';
    btnDel.style.display = 'flex';
    // Remplir les champs
    document.getElementById('sci-nom').value = sci.nom_sci || '';
    document.getElementById('sci-siret').value = sci.siret || '';
    document.getElementById('sci-adresse').value = sci.adresse || '';
    document.getElementById('sci-capital').value = sci.capital_social || '';
    document.getElementById('sci-notes').value = sci.notes || '';
    sciAssocies = JSON.parse(JSON.stringify(sci.associes || []));
    loadSCIExistingDocs(id);
  } else {
    title.textContent = '＋ Nouvelle SCI';
    btnDel.style.display = 'none';
    const exd = document.getElementById('sci-docs-existing'); if (exd) exd.innerHTML = '';
    document.getElementById('sci-nom').value = '';
    document.getElementById('sci-siret').value = '';
    document.getElementById('sci-adresse').value = '';
    document.getElementById('sci-capital').value = '';
    document.getElementById('sci-notes').value = '';
    sciAssocies = [];
  }

  renderAssociesList();
  modal.classList.add('open');
}

function closeSCIModal() {
  document.getElementById('sci-modal-overlay').classList.remove('open');
  currentSCIId = null;
  sciAssocies = [];
}

// ── Rendu liste associés dans la modal ──
function renderAssociesList() {
  const c = document.getElementById('assoc-list');
  if (!c) return;
  if (!sciAssocies.length) {
    c.innerHTML = '<div class="sci-empty" style="padding:4px 0;font-size:12px">Aucun associé. Ajoutez-en un ci-dessous.</div>';
    return;
  }
  c.innerHTML = sciAssocies.map((a, i) => `
    <div class="assoc-card" id="assoc-card-${i}">
      <div class="assoc-card-header">
        <div class="assoc-num">${i + 1}</div>
        <div class="assoc-label">Associé ${i + 1}</div>
        <button type="button" onclick="fillAssocieFromProfile(${i})" title="Reprendre mes informations du profil (évite les divergences d'orthographe)" style="background:none;border:1px solid var(--c-border);border-radius:6px;cursor:pointer;font-size:10.5px;color:var(--accent);padding:3px 8px;margin-right:6px">⤵ Mon profil</button>
        <button class="assoc-remove" onclick="removeAssocie(${i})" title="Supprimer">✕</button>
      </div>
      <div class="assoc-grid" style="margin-bottom:8px">
        <div>
          <label class="sci-form-label">Prénom</label>
          <input class="sci-form-input" value="${esc(a.prenom||'')}" oninput="updateAssocie(${i},'prenom',this.value)" placeholder="Prénom">
        </div>
        <div>
          <label class="sci-form-label">Nom</label>
          <input class="sci-form-input" value="${esc(a.nom||'')}" oninput="updateAssocie(${i},'nom',this.value)" placeholder="Nom">
        </div>
      </div>
      <div class="assoc-grid-3">
        <div>
          <label class="sci-form-label">Téléphone</label>
          <input class="sci-form-input" value="${esc(a.telephone||'')}" oninput="updateAssocie(${i},'telephone',this.value)" placeholder="06 xx xx xx xx">
        </div>
        <div>
          <label class="sci-form-label">Email</label>
          <input class="sci-form-input" value="${esc(a.email||'')}" oninput="updateAssocie(${i},'email',this.value)" placeholder="email@exemple.com">
        </div>
        <div>
          <label class="sci-form-label">Parts %</label>
          <input class="sci-form-input" type="number" min="0" max="100" value="${esc(a.parts_pct||'')}" oninput="updateAssocie(${i},'parts_pct',parseFloat(this.value)||0)" placeholder="50">
        </div>
      </div>
      <div class="assoc-sub">Situation professionnelle <span>(facultatif — utilisé dans le dossier bancaire)</span></div>
      <div class="assoc-grid" style="margin-bottom:8px">
        <div>
          <label class="sci-form-label">Profession</label>
          <input class="sci-form-input" value="${esc(a.profession||'')}" oninput="updateAssocie(${i},'profession',this.value)" placeholder="Ex : Ingénieur logiciel">
        </div>
        <div>
          <label class="sci-form-label">Employeur / Entreprise</label>
          <input class="sci-form-input" value="${esc(a.employeur||'')}" oninput="updateAssocie(${i},'employeur',this.value)" placeholder="Ex : TechCorp SAS">
        </div>
      </div>
      <div class="assoc-grid">
        <div>
          <label class="sci-form-label">Type de contrat</label>
          <select class="sci-form-input" onchange="updateAssocie(${i},'type_contrat',this.value)">
            ${['','CDI','CDD','Indépendant / Libéral','Fonctionnaire','Chef d\'entreprise','Retraité','Autre'].map(t=>`<option value="${t}" ${(a.type_contrat||'')===t?'selected':''}>${t||'—'}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="sci-form-label">Revenus mensuels nets (€)</label>
          <input class="sci-form-input" type="number" min="0" step="50" value="${esc(a.revenus_mensuels??'')}" oninput="updateAssocie(${i},'revenus_mensuels',this.value===''?null:(parseFloat(this.value)||0))" placeholder="Ex : 2800">
        </div>
      </div>
    </div>`).join('');
}

// FLX-006 : une seule source d'identité — reprend prénom/nom/tél/email depuis le profil
function fillAssocieFromProfile(i) {
  if (!sciAssocies[i]) return;
  const p = currentProfile || {};
  sciAssocies[i].prenom = p.first_name || sciAssocies[i].prenom;
  sciAssocies[i].nom = p.last_name || sciAssocies[i].nom;
  sciAssocies[i].telephone = p.phone || sciAssocies[i].telephone;
  sciAssocies[i].email = p.email || currentUser?.email || sciAssocies[i].email;
  renderAssociesList();
  showNotif('Informations reprises depuis votre profil');
}

function addAssocie() {
  sciAssocies.push({ prenom:'', nom:'', telephone:'', email:'', parts_pct:0, profession:'', employeur:'', type_contrat:'', revenus_mensuels:null });
  renderAssociesList();
  // Scroll vers le bas de la liste
  setTimeout(() => {
    const last = document.getElementById(`assoc-card-${sciAssocies.length - 1}`);
    if(last) last.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }, 50);
}

function removeAssocie(idx) {
  sciAssocies.splice(idx, 1);
  renderAssociesList();
}

function updateAssocie(idx, field, val) {
  if (sciAssocies[idx]) sciAssocies[idx][field] = val;
}

// ── Sauvegarde SCI ──
async function saveSCI() {
  const nom = document.getElementById('sci-nom').value.trim();
  if (!nom) { showNotif('Le nom de la SCI est obligatoire.', true); return; }

  const btn = document.getElementById('sci-btn-save');
  btn.disabled = true;
  btn.innerHTML = '<span class="sci-spinner"></span>Enregistrement…';

  const payload = {
    nom_sci:        nom,
    siret:          document.getElementById('sci-siret').value.trim() || null,
    adresse:        document.getElementById('sci-adresse').value.trim() || null,
    capital_social: parseFloat(document.getElementById('sci-capital').value) || 0,
    notes:          document.getElementById('sci-notes').value.trim() || null,
    associes:       sciAssocies,
    user_id:        currentUser.id
  };

  try {
    let error, sciId = currentSCIId;
    if (currentSCIId) {
      ({ error } = await db.from('sci').update(payload).eq('id', currentSCIId));
    } else {
      const res = await db.from('sci').insert(payload).select('id').single();
      error = res.error; sciId = res.data?.id || null;
    }
    if (error) throw error;

    // FLX-001 : persistance des documents joints (Storage privé + table sci_documents).
    // Avant ce fix, sciDocsPending était affiché puis silencieusement perdu au save.
    if (sciId && sciDocsPending.length) {
      btn.innerHTML = '<span class="sci-spinner"></span>Envoi des documents…';
      for (const d of sciDocsPending) {
        const up = await TI_STORAGE.uploadDataURL('sci-documents', sciId, d.data, d.nom);
        const { error: docErr } = await db.from('sci_documents').insert({
          sci_id: sciId, nom: d.nom, type_doc: d.type_doc || 'Autre',
          pdf_path: up.path, user_id: currentUser.id
        });
        if (docErr) {
          // Rollback compensatoire : ne pas laisser de fichier orphelin dans Storage
          await TI_STORAGE.remove('sci-documents', up.path);
          throw docErr;
        }
      }
      sciDocsPending = [];
    }
    showNotif(currentSCIId ? 'SCI mise à jour ✓' : 'SCI créée ✓');
    closeSCIModal();
    await loadAdminData();
    switchAdminTab('sci');
  } catch(e) {
    console.error('saveSCI:', e);
    showNotif('Erreur : ' + e.message, true);
  } finally {
    btn.disabled = false;
    btn.innerHTML = sfAccIcon("check",14)+' Enregistrer';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   DÉTACHER LES BIENS D'UNE SCI — source unique, appelée par les TROIS chemins
   qui suppriment une SCI (fiche SCI, purge des tests, purge totale).

   ⚠️ POURQUOI ELLE EXISTE. `biens_sci_id_fkey` est en ON DELETE SET NULL : en
   supprimant une SCI, LA BASE écrit elle-même `sci_id = null` sur ses biens,
   sans toucher au mode. Sur un bien marqué 'sci', cela produit
   (mode='sci', sci_id=null) — l'invariant `biens_mode_detention_coherent` est
   violé et LA SUPPRESSION DE LA SCI ÉCHOUE, avec un message Postgres brut.
   On prend donc les devants : les deux champs partent ensemble, avant.

   ⚠️ ON REPASSE À NULL, PAS À 'propre'. La SCI disparaît, la question de la
   détention se ROUVRE — elle ne se répond pas toute seule. Deviner « en
   propre » écrirait une donnée à portée fiscale à la place de l'utilisateur ;
   c'est précisément ce que la règle du 12/08/2026 interdit. L'écran redemande.

   Rend le nombre de biens détachés. Lève si l'écriture échoue — l'appelant ne
   doit surtout pas supprimer la SCI dans ce cas.                              */
async function sciDetacherBiens(sciIds) {
  const ids = (Array.isArray(sciIds) ? sciIds : [sciIds]).filter(Boolean);
  if (!ids.length) return 0;
  const vises = allBiens.filter(b => b.sci_id && ids.includes(b.sci_id));
  if (!vises.length) return 0;
  const { error } = await db.from('biens')
    .update({ sci_id: null, mode_detention: null })
    .in('sci_id', ids).eq('user_id', currentUser.id);
  if (error) throw error;
  vises.forEach(b => { b.sci_id = null; b.mode_detention = null; });
  return vises.length;
}

// ── Suppression SCI ──
async function deleteSCI() {
  if (!currentSCIId) return;
  const sci = allSCI.find(s => s.id === currentSCIId);
  const nom = sci?.nom_sci || 'cette SCI';

  /* Supprimer une SCI qui détient des biens n'est pas anodin : ces biens
     perdent leur déclarant. On le dit AVANT, en les nommant — l'ancienne
     version supprimait en silence et les biens disparaissaient de la
     déclaration fiscale sans un mot (défaut n°5 de la revue du 13/08/2026). */
  const detenus = allBiens.filter(b => b.sci_id === currentSCIId);
  let question = `Supprimer la SCI « ${nom} » ? Cette action est irréversible.`;
  if (detenus.length) {
    const liste = detenus.slice(0, 5).map(b => '  · ' + (b.titre || 'Bien sans titre')).join('\n');
    const reste = detenus.length > 5 ? `\n  · … et ${detenus.length - 5} autre(s)` : '';
    question =
      `La SCI « ${nom} » détient ${detenus.length} bien${detenus.length > 1 ? 's' : ''} :\n${liste}${reste}\n\n`
      + `Les biens sont conservés, mais leur mode de détention redeviendra « à renseigner » : `
      + `vous devrez déclarer pour chacun s'il est détenu en propre ou via une autre SCI.\n\n`
      + `Supprimer quand même ?`;
  }
  if (!confirm(question)) return;

  const btn = document.getElementById('sci-btn-delete');
  btn.disabled = true;
  try {
    // L'ordre compte : détacher D'ABORD, supprimer ensuite.
    const detaches = await sciDetacherBiens(currentSCIId);
    const { error } = await db.from('sci').delete().eq('id', currentSCIId);
    if (error) throw error;
    showNotif(detaches
      ? `SCI supprimée · ${detaches} bien${detaches > 1 ? 's' : ''} à redéclarer`
      : 'SCI supprimée');
    closeSCIModal();
    await loadAdminData();
    switchAdminTab('sci');
  } catch(e) {
    // Sans transaction côté client, le détachement peut avoir abouti alors que
    // la suppression échoue. On le dit plutôt que de laisser deviner.
    showNotif('Erreur : ' + e.message + ' — la SCI est toujours là, vérifiez le rattachement de ses biens.', true);
  } finally {
    btn.disabled = false;
  }
}




/* ═══════════════════════════════════════════════════════════════════════════
   LISTES DÉROULANTES — habillage maison
   ═══════════════════════════════════════════════════════════════════════════
   Un <select> natif fait dessiner sa liste d'options PAR LE SYSTÈME
   D'EXPLOITATION : fond blanc, surlignage bleu Windows, police système. Aucune
   règle CSS ne peut l'atteindre. C'est la seule surface de Stonefolio qui
   échappait encore à la charte.

   PARTI : le <select> natif RESTE dans le DOM et garde son rôle de source de
   vérité. Une cinquantaine d'endroits lisent `element.value` et s'abonnent à
   `onchange` ; les remplacer aurait été une réécriture à haut risque pour un
   gain visuel. On se contente de le masquer et de dessiner par-dessus. Chaque
   choix écrit dans le select puis émet un `change` : le reste du code ne voit
   aucune différence.

   MOBILE : aucun habillage. Le sélecteur natif y est meilleur — roulette
   plein écran, gestion du clavier virtuel, accessibilité du système. On ne
   remplace pas un composant qui fait mieux que ce qu'on écrirait.

   Le panneau est posé dans <body> et positionné en `fixed` : sinon un parent
   en `overflow:hidden` (le tableau, une fenêtre modale) le tronquerait.
   ═══════════════════════════════════════════════════════════════════════════ */

const SF_SEUIL_MOBILE = '(max-width: 720px)';
let sfSelectOuvert = null;   // { natif, bouton, panneau, index }
let sfSelectEnCours = false; // garde-fou anti-boucle de l'observateur

function sfSelectMobile() {
  return window.matchMedia(SF_SEUIL_MOBILE).matches;
}

function sfSelectLibelle(natif) {
  const o = natif.options[natif.selectedIndex];
  return o ? o.textContent : '';
}

function sfSelectInit(natif) {
  if (natif.dataset.sfHabille || natif.multiple || natif.size > 1) return;
  natif.dataset.sfHabille = '1';

  const avaitLeFocus = document.activeElement === natif;

  const enveloppe = document.createElement('div');
  enveloppe.className = 'sf-pick';
  natif.parentNode.insertBefore(enveloppe, natif);
  enveloppe.appendChild(natif);
  // Le natif reste present (source de verite) mais sort du parcours clavier :
  // c'est le bouton qui porte l'interaction.
  natif.classList.add('sf-pick__natif');
  natif.setAttribute('tabindex', '-1');

  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'sf-pick__btn';
  bouton.setAttribute('aria-haspopup', 'listbox');
  bouton.setAttribute('aria-expanded', 'false');
  if (natif.getAttribute('aria-label')) bouton.setAttribute('aria-label', natif.getAttribute('aria-label'));
  if (natif.disabled) bouton.disabled = true;
  bouton.innerHTML = `<span class="sf-pick__val"></span>
    <svg class="sf-pick__chev" width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
  enveloppe.appendChild(bouton);

  const sync = () => { bouton.querySelector('.sf-pick__val').textContent = sfSelectLibelle(natif); };
  sync();
  // Une valeur changee par le code (et non par l'utilisateur) doit se voir.
  natif.addEventListener('change', sync);

  /* ⚠️ `enveloppe.appendChild(natif)` ci-dessus DEPLACE le select dans le DOM.
     Un element deplace PERD LE FOCUS, et Chrome ne dispatche pas `blur` dans
     ce cas : la perte est SILENCIEUSE. Un code qui venait de creer un select
     et de le focaliser se retrouvait donc, 30 ms plus tard, avec un champ
     invisible (`.sf-pick__natif` est en `opacity:0; pointer-events:none`) et
     sans focus, sans qu'aucun evenement ne l'en avertisse.
     C'est ce qui cassait la picklist « Statut » de la fiche bien. On rend le
     focus a l'element qui le porte desormais : le bouton. */
  if (avaitLeFocus) bouton.focus();

  bouton.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    sfSelectOuvert && sfSelectOuvert.natif === natif ? sfSelectFermer() : sfSelectOuvrir(natif, bouton);
  });
  bouton.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault(); sfSelectOuvrir(natif, bouton);
    }
  });
}

/* `auFermer` — rappel optionnel, joue A LA FERMETURE du panneau, quelle qu'en
   soit la cause (choix, Echap, clic dehors, defilement). L'edition en ligne
   s'en sert pour rendre au champ son apparence de lecture : sans lui, un
   panneau referme sans choix laisserait le badge remplace par un bouton. */
function sfSelectOuvrir(natif, bouton, auFermer) {
  sfSelectFermer();
  if (natif.disabled || !natif.options.length) return;

  const panneau = document.createElement('div');
  panneau.className = 'sf-pick__panel';
  panneau.setAttribute('role', 'listbox');
  panneau.innerHTML = [...natif.options].map((o, i) => `
    <div class="sf-pick__opt${i === natif.selectedIndex ? ' est-choisi' : ''}"
         role="option" aria-selected="${i === natif.selectedIndex}" data-i="${i}">
      <span class="sf-pick__lbl">${esc(o.textContent)}</span>
      <svg class="sf-pick__ok" width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>
    </div>`).join('');
  document.body.appendChild(panneau);

  // Positionnement : sous le bouton, ou au-dessus s'il n'y a pas la place.
  const r = bouton.getBoundingClientRect();
  panneau.style.minWidth = r.width + 'px';
  const h = panneau.offsetHeight;
  const dessous = window.innerHeight - r.bottom;
  panneau.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panneau.offsetWidth - 8)) + 'px';
  panneau.style.top = (dessous < h + 12 && r.top > h + 12 ? r.top - h - 6 : r.bottom + 6) + 'px';

  bouton.setAttribute('aria-expanded', 'true');
  sfSelectOuvert = { natif, bouton, panneau, index: natif.selectedIndex, auFermer };

  panneau.addEventListener('mousedown', e => {
    const opt = e.target.closest('.sf-pick__opt');
    if (!opt) return;
    e.preventDefault();
    sfSelectChoisir(parseInt(opt.dataset.i, 10));
  });
  sfSelectSurligner(natif.selectedIndex, false);
  panneau.querySelector('.est-choisi')?.scrollIntoView({ block: 'nearest' });
}

function sfSelectSurligner(i, defiler = true) {
  if (!sfSelectOuvert) return;
  const opts = sfSelectOuvert.panneau.querySelectorAll('.sf-pick__opt');
  if (!opts.length) return;
  const n = ((i % opts.length) + opts.length) % opts.length;
  opts.forEach(o => o.classList.remove('est-survole'));
  opts[n].classList.add('est-survole');
  if (defiler) opts[n].scrollIntoView({ block: 'nearest' });
  sfSelectOuvert.index = n;
}

function sfSelectChoisir(i) {
  if (!sfSelectOuvert) return;
  const { natif } = sfSelectOuvert;
  if (natif.selectedIndex !== i) {
    natif.selectedIndex = i;
    // `change` et non `input` : c'est l'evenement auquel tout le code existant
    // est abonne. `bubbles` pour que les gestionnaires poses plus haut voient.
    natif.dispatchEvent(new Event('change', { bubbles: true }));
  }
  sfSelectFermer();
}

function sfSelectFermer() {
  if (!sfSelectOuvert) return;
  const { panneau, bouton, auFermer } = sfSelectOuvert;
  panneau.remove();
  bouton.setAttribute('aria-expanded', 'false');
  // Remis a null AVANT le rappel : celui-ci peut vouloir rouvrir un panneau,
  // ou detruire le bouton — il doit trouver un etat propre.
  sfSelectOuvert = null;
  if (auFermer) auFermer();
}

// Clavier au niveau du document : le panneau n'a pas le focus (il est dans
// <body>), c'est le bouton qui le garde — donc on ecoute globalement.
document.addEventListener('keydown', e => {
  if (!sfSelectOuvert) return;
  const n = sfSelectOuvert.panneau.querySelectorAll('.sf-pick__opt').length;
  switch (e.key) {
    case 'Escape':    e.preventDefault(); sfSelectOuvert.bouton.focus(); sfSelectFermer(); break;
    case 'ArrowDown': e.preventDefault(); sfSelectSurligner(sfSelectOuvert.index + 1); break;
    case 'ArrowUp':   e.preventDefault(); sfSelectSurligner(sfSelectOuvert.index - 1); break;
    case 'Home':      e.preventDefault(); sfSelectSurligner(0); break;
    case 'End':       e.preventDefault(); sfSelectSurligner(n - 1); break;
    case 'Enter':
    case ' ':         e.preventDefault(); sfSelectChoisir(sfSelectOuvert.index); sfSelectOuvert?.bouton.focus(); break;
    case 'Tab':       sfSelectFermer(); break;
    default:
      // Saisie au clavier : on saute a la premiere option qui commence ainsi,
      // comme le fait un select natif.
      if (e.key.length === 1) {
        const opts = [...sfSelectOuvert.panneau.querySelectorAll('.sf-pick__lbl')];
        const j = opts.findIndex(o => o.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
        if (j >= 0) sfSelectSurligner(j);
      }
  }
});
/* Un clic HORS du composant referme la liste.
   ⚠️ DÉFAUT CORRIGÉ LE 14/08/2026 — « je ne peux pas descendre jusqu'à Acheté ».
   Ce test s'écrivait `!e.target.closest('.sf-pick')`. Or LE PANNEAU NE VIT PAS
   DANS `.sf-pick` : il est posé dans <body> (en `fixed`, pour qu'aucun parent
   en `overflow:hidden` ne le tronque) et porte `.sf-pick__panel`. Depuis lui,
   `closest('.sf-pick')` rend donc NULL — et tout appui souris sur le panneau
   AILLEURS QUE SUR UNE OPTION refermait la liste : la BARRE DE DÉFILEMENT, ses
   flèches, la marge intérieure.
   Une seule liste en souffrait, « Statut » : avec ses 19 entrées, c'est la
   seule assez longue pour avoir un ascenseur. Descendre jusqu'à « Acheté »
   demandait précisément de cliquer dessus.
   Choisir une option, lui, ne marchait que PAR ACCIDENT : le gestionnaire du
   panneau passe en premier et remet `sfSelectOuvert` à null, ce qui désamorçait
   celui-ci. Une seule ligne de plus dans l'ordre des écouteurs et le composant
   devenait inutilisable.
   → Un composant dont une partie est TÉLÉPORTÉE dans <body> doit être reconnu
     comme sien par tous les gardes globaux. On teste donc les DEUX morceaux. */
document.addEventListener('mousedown', e => {
  if (!sfSelectOuvert) return;
  const cible = e.target;
  if (cible instanceof Element && cible.closest('.sf-pick, .sf-pick__panel')) return;
  sfSelectFermer();
});
window.addEventListener('resize', sfSelectFermer);

/* La page qui defile sous un panneau `fixed` le laisserait flotter loin de son
   bouton : on ferme. `true` — la phase de capture attrape aussi le defilement
   d'un conteneur interne, qui ne remonte pas jusqu'a window.
   ⚠️ MAIS LE PANNEAU LUI-MEME DEFILE (`max-height` + `overflow-y:auto`), et ce
   defilement-la n'est pas la page qui bouge : c'est l'utilisateur qui PARCOURT
   LA LISTE. Sans cette exception, descendre jusqu'a « Achete » refermait la
   liste — meme cause de fond que le garde `mousedown` ci-dessus : le panneau
   est teleporte dans <body>, les gardes globaux ne le reconnaissaient pas. */
window.addEventListener('scroll', e => {
  if (!sfSelectOuvert) return;
  const cible = e.target;
  if (cible instanceof Element && cible.closest('.sf-pick, .sf-pick__panel')) return;
  sfSelectFermer();
}, true);

// Habille tous les selects presents. Idempotent : `data-sf-habille` empeche de
// traiter deux fois le meme element.
function sfAmeliorerSelects() {
  if (sfSelectMobile()) return;
  sfSelectEnCours = true;
  try { document.querySelectorAll('select:not([data-sf-habille])').forEach(sfSelectInit); }
  finally { sfSelectEnCours = false; }
}

/* Habille UN select immediatement, sans attendre l'observateur.
   ⚠️ Raison d'etre : l'observateur passe 30 ms apres l'insertion. Pour un
   select cree en reaction a un clic, ces 30 ms sont visibles — le champ change
   de forme, de taille et de nature SOUS LE CURSEUR, et le premier clic tombe
   sur une cible qui n'existe deja plus. Un appelant qui sait qu'il vient de
   creer un select l'habille donc lui-meme, du meme geste.
   Rend `true` si le select est desormais habille (faux en mobile, ou le
   selecteur natif est meilleur et reste seul en piste). */
function sfSelectHabillerMaintenant(natif) {
  if (sfSelectMobile()) return false;
  sfSelectEnCours = true;
  try { sfSelectInit(natif); }
  finally { sfSelectEnCours = false; }
  return !!natif.closest('.sf-pick');
}

// Les ecrans se redessinent par innerHTML un peu partout : plutot que d'aller
// appeler sfAmeliorerSelects() dans une cinquantaine de fonctions de rendu — et
// d'en oublier — on observe le document. Le drapeau evite que nos propres
// insertions relancent le traitement en boucle.
(function sfObserverSelects() {
  let minuteur = null;
  new MutationObserver(() => {
    if (sfSelectEnCours) return;
    clearTimeout(minuteur);
    minuteur = setTimeout(sfAmeliorerSelects, 30);
  }).observe(document.documentElement, { childList: true, subtree: true });
  sfAmeliorerSelects();
})();
