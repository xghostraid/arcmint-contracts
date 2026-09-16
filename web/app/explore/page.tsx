import { TokenGrid } from "@/components/TokenCard";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const catalog = await loadCatalog();
  const query = q.trim().toLowerCase();
  const tokens = query
    ? catalog.tokens.filter(
        (t) =>
          t.name.toLowerCase().includes(query) ||
          t.symbol.toLowerCase().includes(query) ||
          t.token.toLowerCase().includes(query),
      )
    : catalog.tokens;

  return (
    <main>
      <section className="hero">
        <h1>Browse launches</h1>
        <p>Search name, ticker, or token address. Results come from on-chain catalog reads.</p>
      </section>
      <form>
        <input className="search" name="q" defaultValue={q} placeholder="Search tokens" />
      </form>
      <TokenGrid tokens={tokens} empty="No launches match that search." />
    </main>
  );
}
