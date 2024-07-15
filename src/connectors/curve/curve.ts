import {
  BigNumber,
  Contract,
  ContractInterface,
  ethers,
  Transaction,
  Wallet,
} from 'ethers';
import { Uniswapish, UniswapishTrade } from '../../services/common-interfaces';
import { Ethereum } from '../../chains/ethereum/ethereum';
import { Polygon } from '../../chains/polygon/polygon';
import { CurveConfig } from './curve.config';
import { Avalanche } from '../../chains/avalanche/avalanche';
import tokens from './curve_tokens.json';
import { CurveTokenList } from './types';
import { CurrencyAmount, Fraction, Token } from '@uniswap/sdk-core';
import { logger } from '../../services/logger';
import routerAbi from './curve_router_abi.json';
import oomukade, { Query } from 'oomukade';
import { floatStringWithDecimalToBigNumber } from '../../services/base';
import { BigNumberish } from '../../../vendor/@ethersproject-xdc/bignumber';

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
  private chainName: string;
  private network: string;
  private tokenList: Record<string, Token> = {};
  private tokenbySymbol: Record<string, Token> = {};
  private _ready: boolean = false;
  public router: string;
  public routerAbi;
  public ttl: number;
  private _config: typeof CurveConfig.config;

  private constructor(chain: string, network: string) {
    this._config = CurveConfig.config;
    this.chain = this.pickNetwork(chain, network);
    this.router = this._config.routerAddress(network);
    this.chainId = this.chain.chainId;
    this.ttl = this._config.ttl;
    this.chainName = chain;
    this.network = network;
    this.gasLimitEstimate = this._config.gasLimitEstimate;
    this.routerAbi = routerAbi;
    const curveList: CurveTokenList = tokens;
    let chainTokens;
    if (chain == 'ethereum') {
      chainTokens = curveList[network];
    } else {
      chainTokens = curveList[chain];
    }

    for (const token of chainTokens.tokens) {
      if (token.chainId === this.chainId) {
        const converted = new Token(
          this.chainId,
          token.address,
          token.decimals,
          token.symbol,
          token.name,
        );
        this.tokenList[token.address.toLowerCase()] = converted;
        this.tokenbySymbol[token.symbol] = converted;
      }
    }
  }

  getTokenByAddress(address: string): Token {
    return this.tokenList[address.toLowerCase()];
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

  public getPair(base: string, quote: string): [Token, Token] {
    let baseToken = this.getToken(base);
    if (baseToken == undefined) {
      const baseOverride = this._config.curve_mapping(this.chainName)(base);
      baseToken = this.getToken(baseOverride);
    }
    let secondary;
    if (this.chainName == 'ethereum') {
      secondary = this._config.secondary(this.network);
    } else {
      secondary = this._config.secondary(this.chainName);
    }
    const instance = CurveFi.getInstance(secondary.chain, secondary.network);

    const quoteToken = instance.getToken(quote);
    return [baseToken, quoteToken];
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
    const result = scan.pop();
    if (result != undefined) {
      const expectedAmount = CurrencyAmount.fromRawAmount(
        quoteToken,
        result.amountOutWithoutSlippage,
      );
      const executionPrice = this.calcPrice(
        result.amountIn,
        baseToken,
        result.amountOutWithoutSlippage,
        quoteToken,
      );
      const tradeInfo = {
        trade: {
          from: baseToken.address,
          to: quoteToken.address,
          amount: Number(amount.toString()),
          expected: expectedAmount.toSignificant(8),
          executionPrice: executionPrice.asFraction,
          isBuy: false,
          query: query,
        },
        expectedAmount: expectedAmount,
      };
      return tradeInfo;
    }
    throw new Error(`Can't find trade for ${baseToken}-${quoteToken}`);
  }

  tokenToNumber(amount: BigNumberish, token: Token): number {
    const tokenUnits = ethers.utils.formatUnits(amount, token.decimals);
    const result = Number(tokenUnits);
    return result;
  }

  calcPrice(
    amountIn: BigNumberish,
    baseToken: Token,
    amountOut: BigNumberish,
    quoteToken: Token,
  ) {
    const inAmount = this.tokenToNumber(amountIn, baseToken);
    const outAmount = this.tokenToNumber(amountOut, quoteToken);
    const price = outAmount / inAmount;
    const correctAmount = floatStringWithDecimalToBigNumber(
      price.toString(),
      quoteToken.decimals,
    );
    if (correctAmount == null) {
      throw new Error('Cant get correct amount');
    }
    const executionPrice = new Fraction(
      correctAmount.toString(),
      BigNumber.from(10).pow(quoteToken.decimals).toString(),
    );
    return executionPrice;
  }

  async estimateBuyTrade(
    quoteToken: Token,
    baseToken: Token,
    amount: BigNumber,
    allowedSlippage?: string | undefined,
  ) {
    let tradeInfo;
    if (quoteToken.symbol != undefined && baseToken.symbol != undefined) {
      const [fixedQuote, fixedBase] = this.getPair(
        quoteToken.symbol,
        baseToken.symbol,
      );
      // try to understand how much usdt we need
      tradeInfo = await this.estimateSellTrade(
        fixedBase,
        fixedQuote,
        amount,
        allowedSlippage,
      );
      const fixed = floatStringWithDecimalToBigNumber(
        tradeInfo.expectedAmount.toSignificant(),
        fixedQuote.decimals,
      );
      const second = await this.estimateSellTrade(
        fixedQuote,
        fixedBase,
        BigNumber.from(fixed),
        allowedSlippage,
      );
      const denom = floatStringWithDecimalToBigNumber(
        second.trade.expected,
        fixedBase.decimals,
      );
      if (denom == null) {
        throw new Error("Can't calculate demon");
      }
      const proportion: BigNumber = amount.mul(second.trade.amount).div(denom);
      tradeInfo = await this.estimateSellTrade(
        fixedQuote,
        fixedBase,
        proportion,
        allowedSlippage,
      );
      const expected = CurrencyAmount.fromRawAmount(
        fixedQuote,
        proportion.toString(),
      );
      const price = this.calcPrice(amount, fixedBase, proportion, fixedQuote);
      tradeInfo.trade.amount = Number(amount.toString());
      tradeInfo.trade.expected = expected.toSignificant(8);
      tradeInfo.trade.executionPrice = price.asFraction.invert();
      tradeInfo.expectedAmount = expected;
    } else {
      throw new Error('Undefined tokens for trade');
    }
    tradeInfo.trade.isBuy = true;
    return tradeInfo;
  }

  async executeTrade(
    wallet: Wallet,
    trade: UniswapishTrade,
    gasPrice: number,
    _uniswapRouter: string,
    _ttl: number,
    _abi: ContractInterface,
    gasLimit: number,
    nonce?: number | undefined,
    maxFeePerGas?: BigNumber | undefined,
    maxPriorityFeePerGas?: BigNumber | undefined,
  ): Promise<Transaction> {
    const castedTrade = <CurveTrade>trade;
    const query = castedTrade.query;
    const scan = await oomukade.scanRoute(query);
    const scanResult = scan.pop();
    if (scanResult == undefined) {
      throw new Error(`Dont have route data or query: ${castedTrade.query}`);
    }
    const estimate = await oomukade.estimatePriceForRoute(scanResult);
    if (estimate == undefined) {
      throw new Error(`Dont have estimate data or query: ${castedTrade.query}`);
    }
    const transactionData = await oomukade.createTransactionForRoute(
      wallet.address,
      wallet.address,
      scanResult,
      estimate,
    );

    if (transactionData == undefined) {
      throw new Error(
        `Can't create transaction or query: ${castedTrade.query}`,
      );
    }

    const value = BigNumber.from(transactionData.value).add(
      BigNumber.from(estimate.executionPrice),
    );

    let overrideParams: {
      gasLimit: string | number;
      value: string | number;
      nonce: number | undefined;
      maxFeePerGas?: BigNumber | undefined;
      maxPriorityFeePerGas?: BigNumber | undefined;
      gasPrice?: string;
    };
    if (maxFeePerGas || maxPriorityFeePerGas) {
      overrideParams = {
        gasPrice: (gasPrice * 1e9).toFixed(0),
        gasLimit: gasLimit.toFixed(0),
        value: value.toString(),
        nonce: nonce,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };
    } else {
      overrideParams = {
        gasPrice: (gasPrice * 1e9).toFixed(0),
        gasLimit: gasLimit.toFixed(0),
        value: value.toString(),
        nonce: nonce,
      };
    }
    const contract = new Contract(
      transactionData.to,
      [transactionData.abi],
      wallet,
    );
    const args = [
      transactionData.args[0],
      transactionData.args[1],
      [
        transactionData.args[2].executionPrice,
        transactionData.args[2].deadline,
        transactionData.args[2].v,
        transactionData.args[2].r,
        transactionData.args[2].s,
      ],
    ];

    const tx = await contract.start(...args, overrideParams);
    logger.info(JSON.stringify(tx));
    return tx;
  }

  private getToken(symbol: string): Token {
    return this.tokenbySymbol[symbol];
  }

  private pickNetwork(chain: string, network: string) {
    if (chain === 'ethereum') {
      return Ethereum.getInstance(network);
    } else if (chain === 'avalanche') {
      return Avalanche.getInstance(network);
    } else {
      return Polygon.getInstance(network);
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
