import type { Config } from "../config.js";
export function protectedResourceMetadata(c: Config) {
  return { resource: `${c.publicUrl}/mcp`, authorization_servers: [c.publicUrl] };
}
export function authorizationServerMetadata(c: Config) {
  const b = c.publicUrl;
  return { issuer: b, authorization_endpoint: `${b}/oauth/authorize`, token_endpoint: `${b}/oauth/token`,
    registration_endpoint: `${b}/oauth/register`, code_challenge_methods_supported: ["S256"] };
}
