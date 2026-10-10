import { LiveBoard } from "@/components/LiveBoard";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const catalog = await loadCatalog(true);
  return (
    <main>
      <section className="hero">
        <h1>Fair Mode · USDC · live catalog</h1>
        <p>
          The board watches the factory every couple of seconds. Any new launch appears here automatically — no indexer,
          no hidden test tickers.
        </p>
      </section>
      <LiveBoard
        initial={catalog.tokens}
        empty="Board is quiet — be the first launch on this factory."
        showStats
      />
    </main>
  );
}
