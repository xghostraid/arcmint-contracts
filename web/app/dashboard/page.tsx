import { CreatorTokens } from "@/components/CreatorTokens";
import { loadCatalog } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const catalog = await loadCatalog();
  return (
    <main>
      <section className="hero">
        <h1>Your hub</h1>
        <p>Tokens you created on this factory, read directly from chain.</p>
      </section>
      <CreatorTokens tokens={catalog.tokens} />
    </main>
  );
}
