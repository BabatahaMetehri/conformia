/**
 * Règle ESLint locale — propriétés CSS logiques obligatoires.
 *
 * POURQUOI. L'interface est en français seul en v1. La contrainte ne coûte donc
 * rien aujourd'hui : `ms-4` s'écrit aussi vite que `ml-4`. Mais elle transforme
 * l'ajout de l'arabe en travail de TRADUCTION plutôt qu'en REFONTE — sans elle,
 * chaque marge, chaque alignement et chaque bordure devrait être réexaminé un par
 * un, sur toute l'application, le jour où le sens de lecture s'inverse.
 *
 * Ce n'est pas une préférence de style : c'est une décision d'architecture dont
 * le coût se paie maintenant, en une frappe, ou plus tard, en semaines.
 *
 * Portée : les chaînes de classes, c'est-à-dire l'attribut `className` et les
 * appels aux assembleurs (`cn`, `clsx`, `classnames`, `cva`, `twMerge`).
 */

/** Physique → logique. L'ordre importe : les entrées longues d'abord. */
const REPLACEMENTS = [
  ["text-left", "text-start"],
  ["text-right", "text-end"],
  ["ml-", "ms-"],
  ["mr-", "me-"],
  ["pl-", "ps-"],
  ["pr-", "pe-"],
  ["border-l", "border-s"],
  ["border-r", "border-e"],
  ["rounded-l", "rounded-s"],
  ["rounded-r", "rounded-e"],
  ["left-", "start-"],
  ["right-", "end-"],
  ["scroll-ml-", "scroll-ms-"],
  ["scroll-mr-", "scroll-me-"],
  ["scroll-pl-", "scroll-ps-"],
  ["scroll-pr-", "scroll-pe-"],
];

/** Assembleurs de classes dont les arguments sont eux aussi des classes. */
const CLASS_BUILDERS = new Set(["cn", "clsx", "classnames", "cva", "twMerge", "twJoin"]);

/**
 * Un utilitaire Tailwind peut porter des variantes (`md:`, `hover:`, `dark:`) et
 * une négation (`-ml-2`). On isole donc le cœur du jeton avant de le comparer.
 */
function coreOf(token) {
  const withoutVariants = token.slice(token.lastIndexOf(":") + 1);
  return withoutVariants.startsWith("-") ? withoutVariants.slice(1) : withoutVariants;
}

function findViolation(core) {
  for (const [physical, logical] of REPLACEMENTS) {
    if (physical.endsWith("-")) {
      // Préfixe : `ml-4`, `ml-[3px]`, `ml-auto`.
      if (core.startsWith(physical) && core.length > physical.length) {
        return { physical, logical };
      }
    } else if (core === physical || core.startsWith(`${physical}-`)) {
      // Jeton exact (`text-left`) ou famille (`border-l-2`).
      return { physical, logical };
    }
  }
  return null;
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Impose les propriétés CSS logiques (ms/me/ps/pe/start/end) à la place des propriétés physiques, pour que le passage en RTL reste une traduction.",
    },
    schema: [],
    messages: {
      physical:
        "Classe physique « {{token}} » interdite : utilisez « {{logical}} ». Les propriétés logiques rendent l'interface RTL sans refonte (cf. CLAUDE.md §2 i18n).",
    },
  },

  create(context) {
    // Un `cn(...)` place dans un `className` est visite deux fois : par
    // JSXAttribute puis par CallExpression. Sans memoire, chaque violation
    // serait signalee en double.
    const alreadyReported = new WeakSet();

    function checkClassString(node, value) {
      if (alreadyReported.has(node)) return;
      if (typeof value !== "string" || value.length === 0) return;

      for (const token of value.split(/\s+/)) {
        if (token.length === 0) continue;
        const violation = findViolation(coreOf(token));
        if (violation !== null) {
          alreadyReported.add(node);
          context.report({
            node,
            messageId: "physical",
            data: { token, logical: token.replace(violation.physical, violation.logical) },
          });
          // Un signalement par chaîne suffit à faire échouer le lint.
          return;
        }
      }
    }

    /** Parcourt une expression pouvant contenir des classes. */
    function inspect(node) {
      if (node === null || node === undefined) return;

      switch (node.type) {
        case "Literal":
          checkClassString(node, node.value);
          break;
        case "TemplateLiteral":
          for (const quasi of node.quasis) {
            checkClassString(quasi, quasi.value.cooked);
          }
          for (const expression of node.expressions) inspect(expression);
          break;
        case "JSXExpressionContainer":
          inspect(node.expression);
          break;
        case "ArrayExpression":
          for (const element of node.elements) inspect(element);
          break;
        case "ObjectExpression":
          // `cn({ "ml-2": actif })` — la clé porte la classe.
          for (const property of node.properties) {
            if (property.type === "Property") inspect(property.key);
          }
          break;
        case "ConditionalExpression":
          inspect(node.consequent);
          inspect(node.alternate);
          break;
        case "LogicalExpression":
          inspect(node.left);
          inspect(node.right);
          break;
        case "CallExpression":
          if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name)) {
            for (const argument of node.arguments) inspect(argument);
          }
          break;
        default:
          break;
      }
    }

    return {
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : "";
        if (name !== "className" && name !== "class") return;
        inspect(node.value);
      },

      // `cva("... ml-4 ...")` hors JSX : les variantes de composants shadcn
      // déclarent leurs classes dans un appel, pas dans un attribut.
      CallExpression(node) {
        if (node.callee.type === "Identifier" && CLASS_BUILDERS.has(node.callee.name)) {
          for (const argument of node.arguments) inspect(argument);
        }
      },
    };
  },
};

export default rule;
