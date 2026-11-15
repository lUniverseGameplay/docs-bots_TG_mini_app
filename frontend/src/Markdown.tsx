import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";
import type { Root as HtmlRoot, Element as HtmlElement } from "hast";
import type { ImageRef, RagResult } from "./types";
import { Orb } from "./UI";
import { imageBlob } from "./api";

export function galleryMarkers(images: ImageRef[]) {
  const normalize = (id: string) => id.replace(/[{}-]/g, "").toLowerCase();
  const allowed = new Set(images.map((image) => normalize(image.image_id)));
  const scrub = (value: string) =>
    value.replace(/image:\/\/([^)\s<>`]+)/gi, (_, id: string) =>
      allowed.has(normalize(id)) ? "[изображение ниже]" : "",
    );
  return () => (tree: Root) => {
    visit(tree, (node, index, parent) => {
      if (["text", "code", "inlineCode"].includes(node.type) && "value" in node)
        node.value = scrub(String(node.value));
      if (index === undefined || !parent) return;
      if (node.type === "image" || node.type === "imageReference") {
        const approved =
          node.type === "image" &&
          node.url.toLowerCase().startsWith("image://") &&
          allowed.has(normalize(node.url.slice(8)));
        parent.children[index] = {
          type: "text",
          value:
            scrub(node.alt ?? "") + (approved ? " [изображение ниже]" : ""),
        } as Text;
      } else if (
        node.type === "link" &&
        node.url.toLowerCase().startsWith("image://")
      ) {
        parent.children[index] = {
          type: "text",
          value: scrub(
            node.children
              .map((child) => ("value" in child ? String(child.value) : ""))
              .join(""),
          ),
        } as Text;
      }
    });
  };
}
// Build reveal units from the parsed HTML tree, never from partial Markdown.
function revealUnits() {
  return (tree: HtmlRoot) => {
    const mark = (element: HtmlElement) => {
      element.properties = { ...element.properties, "data-reveal-unit": "" };
    };
    for (const block of tree.children) {
      if (block.type !== "element") continue;
      if (block.tagName === "p") {
        block.children = block.children.flatMap<
          HtmlElement["children"][number]
        >((child) => {
          if (child.type === "text")
            return (child.value.match(/(?:\S+\s*){1,3}|\s+/g) ?? []).map(
              (value) => ({
                type: "element" as const,
                tagName: "span",
                properties: { "data-reveal-unit": "" },
                children: [{ type: "text" as const, value }],
              }),
            );
          if (child.type === "element") mark(child);
          return [child];
        });
      } else if (block.tagName === "ul" || block.tagName === "ol") {
        for (const child of block.children)
          if (child.type === "element") mark(child);
      } else mark(block);
    }
  };
}
export function Markdown({
  text,
  images = [],
  reveal = false,
}: {
  text: string;
  images?: ImageRef[];
  reveal?: boolean;
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, galleryMarkers(images)]}
        rehypePlugins={reveal ? [revealUnits] : []}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
function GalleryImage({ image }: { image: ImageRef }) {
  const [url, setUrl] = useState(""),
    [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0),
    [zoom, setZoom] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setFailed(false);
    setUrl("");
    imageBlob(image.image_id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [image.image_id, retry]);
  return (
    <figure>
      {url ? (
        <button
          className="image-button"
          onClick={() => setZoom(true)}
          aria-label={"Увеличить: " + image.description}
        >
          <img src={url} alt={image.description} />
        </button>
      ) : failed ? (
        <div>
          <p role="alert">
            Не удалось загрузить изображение «{image.description}».
          </p>
          <button onClick={() => setRetry((n) => n + 1)}>
            Повторить загрузку изображения
          </button>
        </div>
      ) : (
        <p role="status">Загрузка изображения…</p>
      )}
      <figcaption>{image.description}</figcaption>
      {zoom && (
        <div
          className="image-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          onKeyDown={(event) => {
            if (event.key === "Escape") setZoom(false);
          }}
        >
          <button autoFocus onClick={() => setZoom(false)}>
            Закрыть
          </button>
          <img src={url} alt={image.description} />
        </div>
      )}
    </figure>
  );
}
// Reveal parsed phrases with stable layout; Markdown syntax is never sliced.
export function MarkdownReveal({
  text,
  images = [],
  animate = true,
}: {
  text: string;
  images?: ImageRef[];
  animate?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const revealed = useRef<string | null>(null);
  const [active, setActive] = useState(false);
  const finish = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const nodes = Array.from(
      ref.current?.querySelectorAll("[data-reveal-unit]") ?? [],
    ) as HTMLElement[];
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    let timer: ReturnType<typeof setTimeout>;
    let deadline: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const showAll = () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      nodes.forEach((node) => {
        node.style.visibility = "visible";
        node.style.opacity = "1";
        node.classList.remove("reveal-cursor");
      });
      revealed.current = text;
      setActive(false);
    };
    finish.current = showAll;
    if (
      !animate ||
      motion?.matches ||
      nodes.length < 2 ||
      revealed.current === text
    ) {
      showAll();
      return;
    }
    setActive(true);
    nodes.forEach((node, index) => {
      node.style.visibility = index > 0 ? "hidden" : "visible";
      node.style.opacity = index > 0 ? "0" : "1";
    });
    nodes[0]?.classList.add("reveal-cursor");
    let index = 1;
    const step = () => {
      if (cancelled) return;
      if (index >= nodes.length) {
        showAll();
        return;
      }
      nodes[index - 1]?.classList.remove("reveal-cursor");
      const node = nodes[index++];
      node.style.visibility = "visible";
      node.style.opacity = "1";
      node.classList.add("reveal-cursor");
      // Overlapping phrase fades keep layout stable and finish in about 4s.
      const delay = Math.min(120, 3500 / nodes.length);
      timer = setTimeout(step, delay);
    };
    timer = setTimeout(step, 180);
    // Readers can always skip; very long answers finish within 4.5 seconds.
    deadline = setTimeout(showAll, 4500);
    motion?.addEventListener?.("change", showAll);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(deadline);
      nodes.forEach((node) => {
        node.style.visibility = "visible";
        node.style.opacity = "1";
        node.classList.remove("reveal-cursor");
      });
      motion?.removeEventListener?.("change", showAll);
    };
  }, [text, animate]);
  return (
    <div ref={ref} className={active ? "reveal reveal-active" : "reveal"}>
      <Markdown text={text} images={images} reveal />
      {!active && animate && (
        <span className="completion-orb">
          <Orb />
        </span>
      )}
      {active && (
        <div className="reveal-controls">
          <button onClick={() => finish.current()}>Показать сразу</button>
        </div>
      )}
    </div>
  );
}
export function Answer({
  result,
  animate = false,
}: {
  result: RagResult;
  animate?: boolean;
}) {
  return (
    <>
      <MarkdownReveal
        text={result.answer_text}
        images={result.images}
        animate={animate}
      />
      {result.images.length > 0 && (
        <div className="gallery" aria-label="Изображения к ответу">
          {result.images.map((image) => (
            <GalleryImage key={image.image_id} image={image} />
          ))}
        </div>
      )}
      {result.sources.length > 0 && (
        <details className="sources">
          <summary>Источники ({result.sources.length})</summary>
          <ul>
            {result.sources.map((source) => (
              <li key={source.chunk_id}>
                <a
                  href={"/sources/" + source.document_id}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {source.source_name}
                </a>
                {source.locator?.page && <> · стр. {source.locator.page}</>}
                {source.locator?.section && <> · {source.locator.section}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
