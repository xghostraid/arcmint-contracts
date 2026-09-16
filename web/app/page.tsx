import { TokenGrid } from "@/components/TokenCard";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const catalog = await loadCatalog();
  return (
    <main>
      <section className="hero">
        <h1>Fair Mode · USDC · live catalog</h1>
        <p>Launches are read from the factory on Arc Mainnet, not a private index that can go stale.</p>
      </section>
      <p className="stats">
        {catalog.launchCount} launches · synced from chain at block {catalog.toBlock}
      </p>
      <TokenGrid tokens={catalog.tokens} empty="Board is quiet — be the first launch on this factory." />
    </main>
  );
}
