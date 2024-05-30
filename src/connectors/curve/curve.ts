import {
  BigNumber,
  Contract,
  ContractInterface,
  ContractTransaction,
  Transaction,
  Wallet,
} from 'ethers';
import { Uniswapish, UniswapishTrade } from '../../services/common-interfaces';
import { Ethereum } from '../../chains/ethereum/ethereum';
import { Polygon } from '../../chains/polygon/polygon';
import { CurveConfig, Mapping } from './curve.config';
import { Avalanche } from '../../chains/avalanche/avalanche';
import tokens from './curve_tokens.json';
import { CurveTokenList } from './types';
import { CurrencyAmount, Fraction, Token } from '@uniswap/sdk-core';
import { logger } from '../../services/logger';
import { EVMTxBroadcaster } from '../../chains/ethereum/evm.broadcaster';
import routerAbi from './curve_router_abi.json';
import oomukade, { Query } from 'oomukade';

export interface CurveTrade {
  from: string;
  to: string;
  amount: number;
  expected: string;
  executionPrice: Fraction;
  isBuy: boolean;
  query: Query;
}

export class CurveFi implements Uniswapish {
  private static _instances: { [name: string]: CurveFi };
  public gasLimitEstimate: number;
  private chain: Ethereum | Polygon | Avalanche;
  private chainId;
  private tokenList: Record<string, Token> = {};
  private _ready: boolean = false;
  private network: string;
  public router: string;
  public routerAbi;
  public ttl: number;
  private _config: typeof CurveConfig.config;
  private _secondary_chains: Array<Mapping>;
  private constructor(chain: string, network: string) {
    this._config = CurveConfig.config;
    if (chain === 'ethereum') {
      this.chain = Ethereum.getInstance(network);
    } else if (chain === 'avalanche') {
      this.chain = Avalanche.getInstance(network);
    } else {
      this.chain = Polygon.getInstance(network);
    }
    this.router = this._config.routerAddress(network);
    this._secondary_chains = this._config.secondaryNetwork;
    this.chainId = this.chain.chainId;
    this.ttl = this._config.ttl;
    this.gasLimitEstimate = this._config.gasLimitEstimate;
    this.routerAbi = routerAbi;
    this.network = network;
    const curveList: CurveTokenList = tokens;
    const chainTokens = curveList[chain];
    for (const token of chainTokens.tokens) {
      if (token.chainId === this.chainId)
        this.tokenList[token.address] = new Token(
          this.chainId,
          token.address,
          token.decimals,
          token.symbol,
          token.name,
        );
    }
  }

  public static getInstance(chain: string, network: string): CurveFi {
    if (CurveFi._instances === undefined) {
      CurveFi._instances = {};
    }
    if (!(chain + network in CurveFi._instances)) {
      CurveFi._instances[chain + network] = new CurveFi(chain, network);
    }

    return CurveFi._instances[chain + network];
  }

  public async init() {
    if (!this.chain.ready()) {
      await this.chain.init();
    }
    this._ready = true;
  }

  getTokenByAddress(address: string): Token {
    return this.tokenList[address];
  }

  getTokenBySymbol(symbol: string): Token | null {
    const mapping = this._secondary_chains.pop();

    if (mapping != undefined && mapping.key === this.network) {
      return this.tokenList[symbol];
    }
    return this.tokenList[symbol] ? this.tokenList[symbol] : null;
  }

  async estimateSellTrade(
    baseToken: Token,
    quoteToken: Token,
    amount: BigNumber,
    allowedSlippage?: string | undefined,
  ) {
    logger.info(
      `Fetching pair data for ${quoteToken.address}-${baseToken.address}.`,
    );
    const query: Query = {
      params: {
        tokenIn: baseToken.address,
        chainIdIn: baseToken.chainId,
        tokenOut: quoteToken.address,
        chainIdOut: quoteToken.chainId,
        amountIn: amount.toString(),
      },
      slippage:
        allowedSlippage === undefined
          ? 0.5
          : Number.parseFloat(allowedSlippage),
    };

    const scan = await oomukade.scanRoute(query);
    const route = scan.route;
    if (route != undefined) {
      // const prices = await oomukade.estimatePriceForRoute(route);
      const expectedAmount = CurrencyAmount.fromRawAmount(
        quoteToken,
        scan.amountIn,
      );
      const tradeInfo = {
        trade: {
          from: baseToken.address,
          to: quoteToken.address,
          amount: Number(amount.toString()),
          expected: expectedAmount.toSignificant(8),
          executionPrice: expectedAmount.asFraction,
          isBuy: false,
          query: query,
        },
        expectedAmount: expectedAmount,
      };
      return tradeInfo;
    }
    throw new Error(`Can't find trade for ${baseToken}-${quoteToken}`);
  }

  async estimateBuyTrade(
    quoteToken: Token,
    baseToken: Token,
    amount: BigNumber,
    allowedSlippage?: string | undefined,
  ) {
    const tradeInfo = await this.estimateSellTrade(
      baseToken,
      quoteToken,
      amount,
      allowedSlippage,
    );
    tradeInfo.trade.isBuy = true;
    tradeInfo.trade.executionPrice = tradeInfo.trade.executionPrice.invert();
    return tradeInfo;
  }

  async executeTrade(
    wallet: Wallet,
    trade: UniswapishTrade,
    gasPrice: number,
    uniswapRouter: string,
    _ttl: number,
    _abi: ContractInterface,
    gasLimit: number,
    nonce?: number | undefined,
    maxFeePerGas?: BigNumber | undefined,
    maxPriorityFeePerGas?: BigNumber | undefined,
  ): Promise<Transaction> {
    const castedTrade = <CurveTrade>trade;
    const transactionData = await oomukade.createTransaction(
      wallet.address,
      uniswapRouter,
      castedTrade.query,
    );

    let overrideParams: {
      gasLimit: string | number;
      value: number;
      nonce: number | undefined;
      maxFeePerGas?: BigNumber | undefined;
      maxPriorityFeePerGas?: BigNumber | undefined;
      gasPrice?: string;
    };
    if (maxFeePerGas || maxPriorityFeePerGas) {
      overrideParams = {
        gasLimit: gasLimit,
        value: 0,
        nonce: nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
    } else {
      overrideParams = {
        gasPrice: (gasPrice * 1e9).toFixed(0),
        gasLimit: gasLimit.toFixed(0),
        value: 0,
        nonce: nonce,
      };
    }
    if (transactionData == undefined) {
      throw new Error(
        `Dont have transaction data or query: ${castedTrade.query}`,
      );
    } else {
      const contract = new Contract(this.router, routerAbi, wallet);
      const tx = await contract['start'](
        ...transactionData.args,
        overrideParams,
      );
      const txResponse: ContractTransaction =
        await EVMTxBroadcaster.getInstance(
          this.chain,
          wallet.address,
        ).broadcast(tx);
      logger.info(`Transaction Details: ${JSON.stringify(txResponse.hash)}`);
      return tx;
    }
  }

  public ready(): boolean {
    return this._ready;
  }

  /**
   * Gets the allowed slippage percent from the optional parameter or the value
   * in the configuration.
   *
   * @param allowedSlippageStr (Optional) should be of the form '1/10'.
   */
  public getAllowedSlippage(allowedSlippageStr?: string): number {
    if (allowedSlippageStr != null) {
      const fractionSplit = allowedSlippageStr.split('/');
      return Number(fractionSplit[0]) / Number(fractionSplit[1]);
    }
    const allowedSlippage = this._config.allowedSlippage;
    return Number(allowedSlippage);
  }
}
