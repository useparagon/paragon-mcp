import crypto from "crypto";
import NodeCache from "node-cache";

import { MINUTES } from "./utils";

let accessTokensById: NodeCache | undefined;

export function createAccessTokenStore() {
  if (accessTokensById) {
    return;
  }

  accessTokensById = new NodeCache({
    stdTTL: MINUTES * 5,
  });
}

export function createAccessToken(token: string) {
  createAccessTokenStore();
  const id = crypto.randomUUID();
  accessTokensById!.set(id, token);

  return id;
}

export function getAccessTokenById(id: string) {
  const result = accessTokensById?.get<string | undefined>(id);

  if (!result) {
    return null;
  }

  return result;
}
