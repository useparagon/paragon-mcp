import crypto from "crypto";
import NodeCache from "node-cache";

import { MINUTES } from "./utils";

let accessTokensById: NodeCache;

export function createAccessTokenStore() {
  accessTokensById = new NodeCache({
    stdTTL: MINUTES * 5,
  });
}

export function createAccessToken(token: string) {
  const id = crypto.randomUUID();
  accessTokensById.set(id, token);

  return id;
}

export function getAccessTokenById(id: string) {
  const result = accessTokensById.get<string | undefined>(id);

  if (!result) {
    return null;
  }

  return result;
}
