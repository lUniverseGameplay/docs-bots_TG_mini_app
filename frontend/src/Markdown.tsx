import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";
import type { Root, Text } from "mdast";
import type { ImageRef, RagResult } from "./types";
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
export function Markdown({
  text,
  images = [],
}: {
  text: string;
  images?: ImageRef[];
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, galleryMarkers(images)]}
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
        <button onClick={() => setRetry((n) => n + 1)}>
          Повторить загрузку изображения
        </button>
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
export function Answer({ result }: { result: RagResult }) {
  return (
    <>
      <Markdown text={result.answer_text} images={result.images} />
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
