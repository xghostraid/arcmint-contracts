export interface PrivyLinkedAccount {
  type: string;
  address?: string;
  chain_type?: string;
  connector_type?: string;
}

export interface PrivyUser {
  id: string;
  linked_accounts?: PrivyLinkedAccount[];
}

export type PrivyFetch = typeof fetch;

export class PrivyApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PrivyApiError";
  }
}

export class PrivyApiClient {
  private readonly authHeader: string;

  constructor(
    readonly appId: string,
    appSecret: string,
    private readonly fetchImpl: PrivyFetch = fetch,
  ) {
    this.authHeader = `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`https://api.privy.io${path}`, {
      method,
      headers: {
        Authorization: this.authHeader,
        "privy-app-id": this.appId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new PrivyApiError(text || `Privy API ${method} ${path} failed`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  lookupUserByEmail(email: string): Promise<PrivyUser | null> {
    return this.request<PrivyUser>("POST", "/v1/users/email/address", { address: email }).catch((err) => {
      if (err instanceof PrivyApiError && err.status === 404) return null;
      throw err;
    });
  }

  createUserWithSolanaWallet(email: string): Promise<PrivyUser> {
    return this.request<PrivyUser>("POST", "/v1/users", {
      linked_accounts: [{ type: "email", address: email }],
      wallets: [{ chain_type: "solana" }],
    });
  }

  createSolanaWalletForUser(privyUserId: string): Promise<{ address: string }> {
    return this.request<{ address: string }>("POST", "/v1/wallets", {
      chain_type: "solana",
      owner: { user_id: privyUserId },
    });
  }
}

export function solanaEmbeddedAddress(user: PrivyUser): string | null {
  for (const ac of user.linked_accounts ?? []) {
    if (ac.type !== "wallet") continue;
    if (ac.chain_type !== "solana") continue;
    if (ac.connector_type && ac.connector_type !== "embedded") continue;
    const addr = ac.address?.trim();
    if (addr) return addr;
  }
  return null;
}
