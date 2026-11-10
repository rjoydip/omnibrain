import { DotIcon, GlobeIcon } from "./icons";
import { BrandLogo } from "./BrandLogo";

const BRANDS = new Set(["notion", "x", "keep", "raindrop", "browser", "github"]);

/**
 * Source mark that follows the active accent: a brand path in `currentColor`,
 * a globe for the web, or a dot for generic sources. Never a first letter.
 */
export function SourceGlyph({ id, size = 12 }: { id: string; size?: number }) {
  if (id === "web") return <GlobeIcon size={size} />;
  if (BRANDS.has(id)) return <BrandLogo id={id} size={size} />;
  return <DotIcon size={size} className="opacity-70" />;
}
