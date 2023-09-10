import { UniswapishPriceError } from '../../services/error-handler';
import { isFractionString } from '../../services/validators';
import { UbeswapConfig } from './ubeswap.config';
import routerAbi from './ubeswap_router_abi.json';
import {
  ContractInterface,
  ContractTransaction,
} from '@ethersproject/contracts';
import { BigNumber, Contract, Transaction, Wallet } from 'ethers';
import { logger } from '../../services/logger';
import { percentRegexp } from '../../services/config-manager-v2';
import { ExpectedTrade, Uniswapish } from '../../services/common-interfaces';
import { Celo } from '../../chains/celo/celo';
import {
  Percent,
  Token,
  TokenAmount,
  Router,
  Fetcher,
  Pair,
  Trade,
} from '@ubeswap/sdk';
import { SwapParameters } from '@ubeswap/sdk/dist/router';

export class Ubeswap implements Uniswapish {
  private static _instances: { [name: string]: Ubeswap };
  private chain: Celo;
  private _router: string;
  private _routerAbi: ContractInterface;
  private _gasLimitEstimate: number;
  private _ttl: number;
  private _maximumHops: number;
  private chainId;
  private tokenList: Record<string, Token> = {};
  private _ready: boolean = false;

  private constructor(network: string) {
    const config = UbeswapConfig.config;
    this.chain = Celo.getInstance(network);
    this.chainId = this.chain.chainId;
    this._ttl = UbeswapConfig.config.ttl;
    this._maximumHops = UbeswapConfig.config.maximumHops;
    this._routerAbi = routerAbi.abi;
    this._gasLimitEstimate = UbeswapConfig.config.gasLimitEstimate;
    this._router = config.routerAddress(network);
  }

  public static getInstance(chain: string, network: string): Ubeswap {
    if (Ubeswap._instances === undefined) {
      Ubeswap._instances = {};
    }
    if (!(chain + network in Ubeswap._instances)) {
      Ubeswap._instances[chain + network] = new Ubeswap(network);
    }

    return Ubeswap._instances[chain + network];
  }

  /**
   * Given a token's address, return the connector's native representation of
   * the token.
   *
   * @param address Token address
   */
  public getTokenByAddress(address: string): Token {
    return this.tokenList[address];
  }

  public async init() {
    if (!this.chain.ready()) {
      await this.chain.init();
    }
    for (const token of this.chain.storedTokenList) {
      this.tokenList[token.address] = new Token(
        this.chainId,
        token.address,
        token.decimals,
        token.symbol,
        token.name
      );
    }
    this._ready = true;
  }

  public ready(): boolean {
    return this._ready;
  }

  /**
   * Router address.
   */
  public get router(): string {
    return this._router;
  }

  /**
   * Router smart contract ABI.
   */
  public get routerAbi(): ContractInterface {
    return this._routerAbi;
  }

  /**
   * Default gas limit used to estimate gasCost for swap transactions.
   */
  public get gasLimitEstimate(): number {
    return this._gasLimitEstimate;
  }

  /**
   * Default time-to-live for swap transactions, in seconds.
   */
  public get ttl(): number {
    return this._ttl;
  }

  /**
   * Default maximum number of hops for to go through for a swap transactions.
   */
  public get maximumHops(): number {
    return this._maximumHops;
  }

  /**
   * Gets the allowed slippage percent from the optional parameter or the value
   * in the configuration.
   *
   * @param allowedSlippageStr (Optional) should be of the form '1/10'.
   */
  public getAllowedSlippage(allowedSlippageStr?: string): Percent {
    if (allowedSlippageStr != null && isFractionString(allowedSlippageStr)) {
      const fractionSplit = allowedSlippageStr.split('/');
      return new Percent(fractionSplit[0], fractionSplit[1]);
    }

    const allowedSlippage = UbeswapConfig.config.allowedSlippage;
    const nd = allowedSlippage.match(percentRegexp);
    if (nd) return new Percent(nd[1], nd[2]);
    throw new Error(
      'Encountered a malformed percent string in the config for ALLOWED_SLIPPAGE.'
    );
  }

  /**
   * Given the amount of `baseToken` to put into a transaction, calculate the
   * amount of `quoteToken` that can be expected from the transaction.
   *
   * This is typically used for calculating token sell prices.
   *
   * @param baseToken Token input for the transaction
   * @param quoteToken Output from the transaction
   * @param amount Amount of `baseToken` to put into the transaction
   */
  async estimateSellTrade(
    baseToken: Token,
    quoteToken: Token,
    amount: BigNumber,
    allowedSlippage?: string
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount: TokenAmount = new TokenAmount(
      baseToken,
      amount.toString()
    );

    const pair: Pair = await Fetcher.fetchPairData(
      baseToken,
      quoteToken,
      this.chain.provider
    );

    logger.info(
      `Fetching trade data for ${baseToken.symbol}-${quoteToken.symbol}.`
    );
    const trades: Trade[] = Trade.bestTradeExactIn(
      [pair],
      nativeTokenAmount,
      quoteToken,
      { maxHops: 1 }
    );

    if (!trades || trades.length === 0) {
      throw new UniswapishPriceError(
        `priceSwapIn: no trade pair found for ${baseToken} to ${quoteToken}.`
      );
    }

    logger.info(
      `Best trade for ${baseToken.symbol}-${quoteToken.symbol}: ` +
        `${trades[0].executionPrice.toFixed(6)} ` +
        `${baseToken.symbol}.`
    );
    const expectedAmount = trades[0].minimumAmountOut(
      this.getAllowedSlippage(allowedSlippage)
    );
    return { trade: trades[0], expectedAmount };
  }

  /**
   * Given the amount of `baseToken` desired to acquire from a transaction,
   * calculate the amount of `quoteToken` needed for the transaction.
   *
   * This is typically used for calculating token buy prices.
   *
   * @param quoteToken Token input for the transaction
   * @param baseToken Token output from the transaction
   * @param amount Amount of `baseToken` desired from the transaction
   */
  async estimateBuyTrade(
    quoteToken: Token,
    baseToken: Token,
    amount: BigNumber,
    allowedSlippage?: string
  ): Promise<ExpectedTrade> {
    const nativeTokenAmount: TokenAmount = new TokenAmount(
      baseToken,
      amount.toString()
    );

    const pair: Pair = await Fetcher.fetchPairData(
      quoteToken,
      baseToken,
      this.chain.provider
    );

    logger.info(`Fetching pair data for ${quoteToken.symbol}-${baseToken.symbol}.`);
    const trades: Trade[] = Trade.bestTradeExactOut(
      [pair],
      quoteToken,
      nativeTokenAmount,
      { maxHops: 1 }
    );
    if (!trades || trades.length === 0) {
      throw new UniswapishPriceError(
        `priceSwapOut: no trade pair found for ${quoteToken.symbol} to ${baseToken.symbol}.`
      );
    }
    logger.info(
      `Best trade for ${quoteToken.symbol}-${baseToken.symbol}: ` +
        `${trades[0].executionPrice.invert().toFixed(6)} ` +
        `${baseToken.symbol}.`
    );

    const expectedAmount = trades[0].maximumAmountIn(
      this.getAllowedSlippage(allowedSlippage)
    );
    return { trade: trades[0], expectedAmount };
  }

  /**
   * Given a wallet and a Uniswap trade, try to execute it on blockchain.
   *
   * @param wallet Wallet
   * @param trade Expected trade
   * @param gasPrice Base gas price, for pre-EIP1559 transactions
   * @param uniswapRouter Router smart contract address
   * @param ttl How long the swap is valid before expiry, in seconds
   * @param _abi Router contract ABI
   * @param gasLimit Gas limit
   * @param nonce (Optional) EVM transaction nonce
   * @param maxFeePerGas (Optional) Maximum total fee per gas you want to pay
   * @param maxPriorityFeePerGas (Optional) Maximum tip per gas you want to pay
   */
  async executeTrade(
    wallet: Wallet,
    trade: Trade,
    gasPrice: number,
    uniswapRouter: string,
    ttl: number,
    _abi: ContractInterface,
    gasLimit: number,
    nonce?: number,
    maxFeePerGas?: BigNumber,
    maxPriorityFeePerGas?: BigNumber,
    allowedSlippage?: string
  ): Promise<Transaction> {
    const result: SwapParameters = Router.swapCallParameters(trade, {
      ttl,
      recipient: wallet.address,
      allowedSlippage: this.getAllowedSlippage(allowedSlippage),
    });
    const contract: Contract = new Contract(uniswapRouter, _abi, wallet);

    return this.chain.nonceManager.provideNonce(
      nonce,
      wallet.address,
      async (nextNonce) => {
        let tx: ContractTransaction;
        if (maxFeePerGas !== undefined || maxPriorityFeePerGas !== undefined) {
          tx = await contract[result.methodName](...result.args, {
            gasLimit: gasLimit.toFixed(0),
            value: result.value,
            nonce: nextNonce,
            maxFeePerGas,
            maxPriorityFeePerGas,
          });
        } else {
          tx = await contract[result.methodName](...result.args, {
            gasPrice: (gasPrice * 1e9).toFixed(0),
            gasLimit: gasLimit.toFixed(0),
            value: result.value,
            nonce: nextNonce,
          });
        }

        logger.info(JSON.stringify(tx));
        return tx;
      }
    );
  }
}
