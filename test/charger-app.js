/* ═══════════════════════════════════════════════════════════════════════════
   CHARGEUR DE app.js POUR LES TESTS
   `app.js` est un script de navigateur : pas de modules, pas d'exports, et il
   crée un client Supabase dès sa ligne 4. On l'exécute donc dans un contexte
   `vm` muni de doublures minimales, puis on lit ses fonctions dans ce contexte.

   Aucune dépendance, aucune étape de build : `node --test` suffit. C'est ce qui
   rend ces tests tenables sur ce dépôt, qui se déploie tel quel sur Pages.

   ⚠️ LE TEMPS EST INJECTABLE. `mfMoisEcoules` et `sfLoyerEtat` lisent l'horloge.
   Un test qui dépend de la date du jour passe en août et échoue en janvier :
   `charger({ maintenant })` fige donc la date vue par app.js.
   ═══════════════════════════════════════════════════════════════════════════ */
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'app.js');

// Doublure d'élément DOM : tout accès rend un objet inerte plutôt que de lever.
function elementInerte() {
  const el = {
    style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    children: [], childNodes: [],
    appendChild(){}, removeChild(){}, remove(){}, insertBefore(){}, setAttribute(){},
    getAttribute(){ return null; }, removeAttribute(){}, addEventListener(){},
    removeEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    closest(){ return null; }, focus(){}, blur(){}, click(){}, scrollIntoView(){},
    getBoundingClientRect(){ return { top:0, left:0, right:0, bottom:0, width:0, height:0 }; },
    innerHTML: '', textContent: '', value: '', options: [], selectedIndex: -1,
  };
  return el;
}

function faireDocument() {
  const doc = {
    documentElement: elementInerte(),
    body: elementInerte(),
    head: elementInerte(),
    createElement: () => elementInerte(),
    createTextNode: () => ({}),
    createRange: () => ({ selectNodeContents(){}, getBoundingClientRect(){ return {}; } }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener(){}, removeEventListener(){},
    styleSheets: [],
  };
  return doc;
}

// Client Supabase inerte : toute chaîne d'appels retourne le même proxy, et
// `await` sur ce proxy rend `{ data: [], error: null }`.
function faireDb() {
  const reponse = { data: [], error: null };
  const proxy = new Proxy(function(){}, {
    get(_, prop) {
      if (prop === 'then') return (res) => Promise.resolve(reponse).then(res);
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return {
    from: () => proxy,
    rpc: () => proxy,
    storage: { from: () => proxy },
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe(){} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => ({ data: {}, error: null }),
    },
  };
}

/**
 * Charge app.js dans un contexte isolé.
 * @param {{maintenant?: Date}} options — `maintenant` fige l'horloge vue par app.js.
 * @returns le contexte, dans lequel toutes les fonctions de app.js sont lisibles.
 */
function charger({ maintenant } = {}) {
  const document = faireDocument();

  // Horloge figée : `new Date()` sans argument rend `maintenant`, tout le reste
  // se comporte normalement. Sans cela, les tests dépendraient du jour où on
  // les lance.
  const DateReelle = Date;
  const DateFigee = maintenant
    ? new Proxy(DateReelle, {
        construct(cible, args) {
          return args.length === 0
            ? new DateReelle(maintenant.getTime())
            : new cible(...args);
        },
        get(cible, prop) {
          if (prop === 'now') return () => maintenant.getTime();
          return Reflect.get(cible, prop);
        },
      })
    : DateReelle;

  const contexte = {
    console, Math, JSON, Object, Array, String, Number, Boolean, Error,
    Promise, Set, Map, RegExp, Intl, isNaN, parseInt, parseFloat,
    Date: DateFigee,
    setTimeout: () => 0, clearTimeout(){}, setInterval: () => 0, clearInterval(){},
    requestAnimationFrame: () => 0,
    document,
    localStorage: { getItem: () => null, setItem(){}, removeItem(){}, clear(){} },
    sessionStorage: { getItem: () => null, setItem(){}, removeItem(){}, clear(){} },
    location: { href: '', pathname: '/', hash: '', search: '', reload(){} },
    history: { replaceState(){}, pushState(){} },
    navigator: { userAgent: 'test', clipboard: { writeText: async () => {} } },
    supabase: { createClient: faireDb },
    Chart: Object.assign(function(){ return { destroy(){}, update(){} }; },
                         { defaults: { color: '', font: {} } }),
    MutationObserver: function(){ return { observe(){}, disconnect(){} }; },
    matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    URL: { createObjectURL: () => 'blob:', revokeObjectURL(){} },
    Blob: function(){ return {}; },
    alert(){}, confirm: () => true, prompt: () => null,
    addEventListener(){}, removeEventListener(){},
    innerWidth: 1440, innerHeight: 900, scrollTo(){},
  };
  contexte.window = contexte;
  contexte.globalThis = contexte;
  contexte.self = contexte;

  vm.createContext(contexte);
  vm.runInContext(fs.readFileSync(SOURCE, 'utf8'), contexte,
                  { filename: 'app.js', displayErrors: true });
  return contexte;
}

/* ⚠️ Les `let` de app.js (allBiens, allLoyers, mfExercice…) NE SONT PAS des
   propriétés du contexte : une déclaration `let` au sommet d'un script crée un
   lien dans la portée lexicale globale, pas sur l'objet global. Seules les
   `function` y apparaissent. Pour lire ou écrire cet état, il faut donc
   exécuter du code DANS le contexte. */
function injecter(contexte, valeurs) {
  contexte.__injection = valeurs;
  const code = Object.keys(valeurs).map(k => `${k} = __injection.${k};`).join('\n');
  vm.runInContext(code, contexte);
  delete contexte.__injection;
}

function lire(contexte, expression) {
  return vm.runInContext(expression, contexte);
}

module.exports = { charger, injecter, lire };
