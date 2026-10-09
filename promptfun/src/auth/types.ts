export interface AccessTokenClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  sub: string;
  email: string;
}
