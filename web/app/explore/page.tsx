import { LiveBoard } from "@/components/LiveBoard";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ExplorePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q = "" } = await searchParams;
  const catalog = await loadCatalog(true);

  return (
    <main>
      <section className="hero">
        <h1>Browse launches</h1>
        <p>Live list of every factory token. Search filters the same chain feed as it updates.</p>
      </section>
      <form>
        <input className="search" name="q" defaultValue={q} placeholder="Search tokens" />
      </form>
      <LiveBoard
        initial={catalog.tokens}
        query={q}
        empty="No launches match that search."
        notify={false}
      />
    </main>
  );
}
