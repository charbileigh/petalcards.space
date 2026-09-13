import Link from "next/link";
import { Layers3 } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="brand" aria-label="Petalcards home">
      <span className="brand-mark" aria-hidden="true">
        <Layers3 />
      </span>
      {!compact && <span>petalcards</span>}
    </Link>
  );
}
