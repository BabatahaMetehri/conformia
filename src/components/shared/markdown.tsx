import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";
import { cn } from "@/lib/utils";

/**
 * Rendu Markdown.
 *
 * ⚠️ AUCUN `dangerouslySetInnerHTML`, nulle part. Chaque nœud devient un élément
 * React ; React échappe le texte qu'il insère. Il n'existe donc pas d'endroit où
 * une balise saisie par un utilisateur puisse être interprétée — ce n'est pas
 * une précaution ajoutée, c'est une propriété de la construction.
 *
 * Les liens externes portent `rel="noopener noreferrer"` : sans `noopener`, la
 * page ouverte accède à `window.opener` et peut rediriger l'onglet d'origine.
 */

function renderInline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${String(index)}`;

    switch (node.type) {
      case "text":
        return <Fragment key={key}>{node.value}</Fragment>;
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children)}
          </strong>
        );
      case "emphasis":
        return (
          <em key={key} className="italic">
            {renderInline(node.children)}
          </em>
        );
      case "code":
        return (
          <code key={key} className="rounded bg-surface-raised px-1 py-0.5 text-xs">
            {node.value}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {node.label}
          </a>
        );
    }
  });
}

function renderBlock(block: BlockNode, index: number): ReactNode {
  const key = `${block.type}-${String(index)}`;

  switch (block.type) {
    case "heading": {
      /*
       * Un h1 est réservé au titre de l'écran : une procédure qui en produirait
       * un second casserait la hiérarchie annoncée aux lecteurs d'écran. On
       * décale donc d'un niveau — le « # » de l'auteur devient un h2.
       */
      const Tag = (["h2", "h3", "h4"] as const)[block.level - 1] ?? "h4";
      const size = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold"][
        block.level - 1
      ];
      return (
        <Tag key={key} className={cn("mt-5 mb-2 text-text-primary first:mt-0", size)}>
          {renderInline(block.children)}
        </Tag>
      );
    }

    case "paragraph":
      return (
        <p key={key} className="my-2 text-sm leading-relaxed text-text-secondary">
          {renderInline(block.children)}
        </p>
      );

    case "list": {
      const Tag = block.ordered ? "ol" : "ul";
      return (
        <Tag
          key={key}
          className={cn(
            "my-2 space-y-1 ps-5 text-sm text-text-secondary",
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {block.items.map((item, itemIndex) => (
            <li key={`${key}-${String(itemIndex)}`}>{renderInline(item)}</li>
          ))}
        </Tag>
      );
    }

    case "quote":
      return (
        <blockquote
          key={key}
          className="my-3 border-s-2 border-border-strong ps-3 text-sm text-text-muted italic"
        >
          {renderInline(block.children)}
        </blockquote>
      );

    case "codeBlock":
      return (
        <pre
          key={key}
          className="my-3 overflow-x-auto rounded-md bg-surface-raised p-3 text-xs text-text-primary"
        >
          <code>{block.value}</code>
        </pre>
      );

    case "rule":
      return <hr key={key} className="my-4 border-border" />;
  }
}

export function Markdown({
  source,
  className,
}: {
  readonly source: string;
  readonly className?: string;
}) {
  const blocks = parseMarkdown(source);

  return (
    <div className={cn("max-w-prose", className)}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}
