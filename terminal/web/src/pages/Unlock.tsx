import { useState } from "react";
import { api, setToken, type Status } from "../api";
import { ErrorBox, Field, useAction } from "../components/ui";

export function Unlock({ status, onDone }: { status: Status; onDone: () => void }) {
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [restore, setRestore] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [shownPhrase, setShownPhrase] = useState<string | null>(null);
  const a = useAction<void>();

  if (shownPhrase) {
    return (
      <div className="center">
        <div className="card narrow">
          <h2>Write down your recovery phrase</h2>
          <p className="muted">Every generated wallet derives from this phrase. Anyone with it controls those wallets. It is shown once here; you can reveal it again later under Settings with your passphrase.</p>
          <div className="phrase">
            {shownPhrase.split(" ").map((w, i) => (
              <span key={i}>
                <em>{i + 1}</em> {w}
              </span>
            ))}
          </div>
          <button className="primary" onClick={onDone}>
            I saved it — continue
          </button>
        </div>
      </div>
    );
  }

  const create = () =>
    a.run(async () => {
      if (pass !== pass2) throw new Error("Passphrases don’t match");
      const r = await api<{ token: string }>("POST", "/vault/init", { passphrase: pass, mnemonic: restore ? phrase : undefined });
      setToken(r.token);
      if (restore) return onDone();
      const m = await api<{ mnemonic: string }>("POST", "/vault/mnemonic", { passphrase: pass });
      setShownPhrase(m.mnemonic);
    });

  const unlock = () =>
    a.run(async () => {
      const r = await api<{ token: string }>("POST", "/vault/unlock", { passphrase: pass });
      setToken(r.token);
      onDone();
    });

  return (
    <div className="center">
      <form
        className="card narrow"
        onSubmit={(e) => {
          e.preventDefault();
          void (status.vault.initialized ? unlock() : create());
        }}
      >
        <div className="brand big">
          ▲ Terminal <span className={`net net-${status.network}`}>{status.network}</span>
        </div>
        {status.vault.initialized ? (
          <>
            <p className="muted">Your keys are encrypted on this machine. Enter your passphrase to unlock them.</p>
            <Field label="Passphrase">
              <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <button className="primary" disabled={a.busy || !pass}>
              {a.busy ? "Unlocking…" : "Unlock"}
            </button>
          </>
        ) : (
          <>
            <p className="muted">Create a vault. The passphrase encrypts every private key at rest (scrypt + AES-256-GCM). It never leaves this server and cannot be recovered.</p>
            <Field label="Passphrase" hint="10+ characters">
              <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
            </Field>
            <Field label="Repeat passphrase">
              <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={restore} onChange={(e) => setRestore(e.target.checked)} /> Restore from an existing recovery phrase
            </label>
            {restore && (
              <Field label="Recovery phrase">
                <textarea rows={3} value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="12 or 24 words" />
              </Field>
            )}
            <button className="primary" disabled={a.busy || pass.length < 10}>
              {a.busy ? "Creating…" : "Create vault"}
            </button>
          </>
        )}
        <ErrorBox error={a.error} />
      </form>
    </div>
  );
}
