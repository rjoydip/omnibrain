import type { ComponentType, SVGProps } from "react";
import C from "~icons/vscode-icons/file-type-cpp";
import Cpp from "~icons/vscode-icons/file-type-cpp";
import Csharp from "~icons/vscode-icons/file-type-csharp";
import Css from "~icons/vscode-icons/file-type-css";
import Go from "~icons/vscode-icons/file-type-go";
import Html from "~icons/vscode-icons/file-type-html";
import Java from "~icons/vscode-icons/file-type-java";
import Js from "~icons/vscode-icons/file-type-js";
import Json from "~icons/vscode-icons/file-type-json";
import Md from "~icons/vscode-icons/file-type-markdown";
import Php from "~icons/vscode-icons/file-type-php";
import Py from "~icons/vscode-icons/file-type-python";
import Ruby from "~icons/vscode-icons/file-type-ruby";
import Rust from "~icons/vscode-icons/file-type-rust";
import Bash from "~icons/vscode-icons/file-type-shell";
import Sql from "~icons/vscode-icons/file-type-sql";
import Ts from "~icons/vscode-icons/file-type-typescript";
import Yaml from "~icons/vscode-icons/file-type-yaml";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS: Record<string, Icon> = {
  typescript: Ts,
  ts: Ts,
  tsx: Ts,
  javascript: Js,
  js: Js,
  jsx: Js,
  python: Py,
  py: Py,
  markdown: Md,
  md: Md,
  shell: Bash,
  bash: Bash,
  sh: Bash,
  json: Json,
  yaml: Yaml,
  yml: Yaml,
  sql: Sql,
  go: Go,
  rust: Rust,
  rs: Rust,
  java: Java,
  csharp: Csharp,
  cs: Csharp,
  cpp: Cpp,
  "c++": Cpp,
  c: C,
  ruby: Ruby,
  rb: Ruby,
  php: Php,
  html: Html,
  css: Css,
};

/** Colorful file-type language icon (vscode-icons via Iconify/Icones). */
export function LangIcon({ lang, size = 13 }: { lang?: string; size?: number }) {
  const Icon = ICONS[(lang ?? "").toLowerCase()];
  if (!Icon) {
    return (
      <span
        className="grid shrink-0 place-items-center rounded-[3px] bg-raised font-mono text-muted"
        style={{ width: size, height: size, fontSize: Math.max(6, Math.round(size * 0.5)) }}
        aria-hidden="true"
      >
        ?
      </span>
    );
  }
  return <Icon width={size} height={size} aria-hidden="true" />;
}
