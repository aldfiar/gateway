import { Ethereumish } from '../services/common-interfaces';
import { TokensRequest } from '../network/network.requests';
import { TokenInfo } from '../services/base';

export async function getTokens(connection: Ethereumish, req: TokensRequest) {
  let tokens: TokenInfo[] = [];
  if (!req.tokenSymbols) {
    tokens = connection.storedTokenList;
  } else {
    for (const t of req.tokenSymbols as []) {
      tokens.push(connection.getTokenForSymbol(t) as TokenInfo);
    }
  }

  return { tokens };
}
