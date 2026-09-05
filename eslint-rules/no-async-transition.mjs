/**
 * Règle ESLint locale — pas de travail asynchrone dans une transition.
 *
 * POURQUOI. `startTransition` ne suit que ce qui s'exécute AVANT le premier
 * `await`. React le documente lui-même, à « React doesn't treat my state update
 * as a Transition » : tout ce qui suit l'attente retombe hors du champ de la
 * transition. Le `router.refresh()` écrit après un `await` n'est donc pas un
 * rafraîchissement transitionnel — c'est une requête isolée, qu'une seconde
 * transition démarrée entre-temps peut emporter.
 *
 * Ce que cela donne à l'écran : la Server Action a bien écrit, l'écran affiche
 * encore l'ancien état, et rien ne signale l'incident. L'utilisateur recommence
 * son geste — sur un dossier de conformité, il valide deux fois, ou il croit
 * avoir perdu un dépôt qui est en base.
 *
 * Le défaut ne se voit pas au test manuel : il demande deux gestes en moins de
 * temps qu'il n'en faut pour relire l'écran. Il se voit chez la personne qui
 * enchaîne, c'est-à-dire chez celle qui connaît le logiciel. D'où une garde
 * mécanique.
 *
 * ⚠️ TROIS FORMES, UN SEUL DÉFAUT. Les deux premières sont celles de l'audit ;
 * la troisième est la même faute déguisée, et il a fallu la rencontrer pour
 * penser à la nommer — un rappel SYNCHRONE dans lequel on jette une promesse
 * (`void action().then(...)`, ou une fonction asynchrone auto-appelée). La
 * transition se referme alors immédiatement, avant même le premier résultat :
 * c'est le cas le plus trompeur des trois, puisqu'il a l'air correct.
 *
 * Remède : `useActionRunner` (src/hooks/use-action-runner.ts), et la
 * revalidation serveur plutôt qu'un rafraîchissement client. Voir
 * docs/state-management.md.
 */

const DOC = "Voir docs/state-management.md et src/hooks/use-action-runner.ts.";

const MESSAGES = {
  asyncCallback:
    "Rappel ASYNCHRONE passé à startTransition : React ne suit que ce qui précède le premier `await`, " +
    "et la suite peut être emportée par une autre transition. Employez useActionRunner. " +
    DOC,
  refreshAfterAwait:
    "`router.refresh()` placé après un `await` : il n'appartient plus à aucune transition et peut être " +
    "annulé. La Server Action doit appeler revalidatePath/revalidateTag ; supprimez ce rafraîchissement. " +
    DOC,
  floatingPromise:
    "Promesse jetée dans une transition SYNCHRONE : la transition se referme avant le premier résultat, " +
    "l'état d'attente retombe aussitôt et la suite s'exécute hors suivi. Employez useActionRunner. " +
    DOC,
};

/** Les deux façons d'obtenir la fonction : le hook, ou l'import direct. */
const TRANSITION_NAMES = new Set(["startTransition"]);

function isTransitionCall(node) {
  const { callee } = node;
  if (callee.type === "Identifier") return TRANSITION_NAMES.has(callee.name);
  // `React.startTransition(...)`
  return (
    callee.type === "MemberExpression" &&
    callee.property.type === "Identifier" &&
    TRANSITION_NAMES.has(callee.property.name)
  );
}

function isFunctionNode(node) {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionExpression" ||
    node.type === "FunctionDeclaration"
  );
}

/** `<quelquechose>.refresh()` — le nom du routeur importe peu, l'appel suffit. */
function isRouterRefresh(node) {
  return (
    node.type === "CallExpression" &&
    node.callee.type === "MemberExpression" &&
    node.callee.property.type === "Identifier" &&
    node.callee.property.name === "refresh"
  );
}

/**
 * Parcourt un sous-arbre sans franchir les frontières de fonction.
 *
 * ⚠️ NE PAS DESCENDRE DANS LES FONCTIONS IMBRIQUÉES : un `await` du corps
 * courant ne dit rien de ce qui se passe dans un rappel déclaré à l'intérieur,
 * lequel a son propre ordre d'exécution. Descendre y produirait des accusations
 * fausses, et une garde qui crie à tort finit désactivée.
 */
function walkSameFunction(node, visit) {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walkSameFunction(child, visit);
    return;
  }
  if (typeof node.type !== "string") return;

  visit(node);
  if (isFunctionNode(node)) return;

  for (const key of Object.keys(node)) {
    if (key === "parent") continue;
    walkSameFunction(node[key], visit);
  }
}

const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Interdit le travail asynchrone dans une transition React et le rafraîchissement client après une attente.",
    },
    schema: [],
    messages: MESSAGES,
  },

  create(context) {
    /**
     * Un `await` précède-t-il cette position dans le MÊME corps de fonction ?
     *
     * On compare les positions dans le source plutôt que de reconstruire un
     * graphe de flot : à l'intérieur d'un corps de fonction, l'ordre du texte
     * est l'ordre d'exécution — sauf dans les fonctions imbriquées, que
     * `walkSameFunction` écarte déjà.
     */
    function awaitBefore(body, position) {
      let found = false;
      walkSameFunction(body, (node) => {
        if (node.type === "AwaitExpression" && node.range[1] <= position) found = true;
      });
      return found;
    }

    function checkFunctionBody(node) {
      if (node.async !== true) return;
      walkSameFunction(node.body, (child) => {
        if (!isRouterRefresh(child)) return;
        if (!awaitBefore(node.body, child.range[0])) return;
        context.report({ node: child, messageId: "refreshAfterAwait" });
      });
    }

    return {
      CallExpression(node) {
        if (isTransitionCall(node)) {
          const [callback] = node.arguments;
          if (callback !== undefined && isFunctionNode(callback)) {
            if (callback.async === true) {
              context.report({ node: callback, messageId: "asyncCallback" });
              return;
            }

            /*
             * Rappel synchrone : on cherche la promesse qu'on y aurait jetée.
             * `.then(` ou une fonction asynchrone déclarée dedans — l'un comme
             * l'autre survivent à la fermeture de la transition.
             */
            walkSameFunction(callback.body, (child) => {
              const jete =
                (child.type === "CallExpression" &&
                  child.callee.type === "MemberExpression" &&
                  child.callee.property.type === "Identifier" &&
                  child.callee.property.name === "then") ||
                (isFunctionNode(child) && child.async === true);
              if (jete) context.report({ node: child, messageId: "floatingPromise" });
            });
          }
        }
      },

      ArrowFunctionExpression: checkFunctionBody,
      FunctionExpression: checkFunctionBody,
      FunctionDeclaration: checkFunctionBody,
    };
  },
};

export default rule;
