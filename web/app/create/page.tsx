import { CreateForm } from "@/components/CreateForm";

export default function CreatePage() {
  return (
    <main>
      <section className="hero">
        <h1>Launch a token</h1>
        <p>
          One factory transaction on Arc Mainnet — no IPFS pin required. You get a toast as soon as the
          transaction lands, and Live reads the new token from chain.
        </p>
      </section>
      <CreateForm />
    </main>
  );
}
