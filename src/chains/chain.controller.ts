import {
  allowances as evlAllowances,
  approve as evmApprove,
  balances as evmBalances,
  cancel as evmCancel,
  nextNonce as evmNextNonce,
  nonce as evmNonce,
  poll as evmPoll,
} from '../chains/ethereum/ethereum.controllers';
import { Chain } from '../services/common-interfaces';

import {
  BalanceRequest,
  BalanceResponse,
  PollRequest,
  PollResponse,
  TokensRequest,
  TokensResponse,
} from '../network/network.requests';
import {
  AllowancesRequest,
  AllowancesResponse,
  ApproveRequest,
  ApproveResponse,
  CancelRequest,
  CancelResponse,
  NonceRequest,
  NonceResponse,
} from './chain.requests';

export async function poll(
  chain: Chain,
  req: PollRequest,
): Promise<PollResponse> {
  const poll = await evmPoll(chain, req);
  return poll;
}

export async function nonce(
  chain: Chain,
  req: NonceRequest,
): Promise<NonceResponse> {
  const nonce = await evmNonce(chain, req);
  return nonce;
}

export async function nextNonce(
  chain: Chain,
  req: NonceRequest,
): Promise<NonceResponse> {
  const nextNonce = await evmNextNonce(chain, req);
  return nextNonce;
}

export async function getTokens(
  chain: Chain,
  req: TokensRequest,
): Promise<TokensResponse> {
  const tokens = await getTokens(chain, req);
  return tokens;
}

export async function allowances(
  chain: Chain,
  req: AllowancesRequest,
): Promise<AllowancesResponse | string> {
  const allowances = await evlAllowances(chain, req);
  return allowances;
}

export async function balances(
  chain: Chain,
  req: BalanceRequest,
): Promise<BalanceResponse | string> {
  const balances = await evmBalances(chain, req);
  return balances;
}

export async function approve(
  chain: Chain,
  req: ApproveRequest,
): Promise<ApproveResponse | string> {
  const approveTx = await evmApprove(chain, req);
  return approveTx;
}

export async function cancel(
  chain: Chain,
  req: CancelRequest,
): Promise<CancelResponse> {
  const cancelTx = await evmCancel(chain, req);

  return cancelTx;
}
