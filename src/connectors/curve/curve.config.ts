import { AvailableNetworks } from '../../services/config-manager-types';
import { ConfigManagerV2 } from '../../services/config-manager-v2';

export namespace CurveConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    ttl: number;
    routerAddress: (network: string) => string;
    tradingTypes: Array<string>;
    availableNetworks: Array<AvailableNetworks>;
    maximumHops: number;
    chainType: string;
    token: (chain: string) => string;
    secondary: {
      chain: string;
      network: string;
    };
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get('curve.allowedSlippage'),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      'curve.gasLimitEstimate',
    ),
    ttl: ConfigManagerV2.getInstance().get('curve.ttl'),
    maximumHops: ConfigManagerV2.getInstance().get(`curve.maximumHops`),
    routerAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        'curve.contractAddresses.' + network + '.routerAddress',
      ),
    tradingTypes: ['AMM'],
    chainType: 'EVM',
    token: (chain: string) =>
      ConfigManagerV2.getInstance().get(`curve.tokens.${chain}.token`),
    availableNetworks: [
      { chain: 'polygon', networks: ['mainnet', 'mumbai'] },
      { chain: 'avalanche', networks: ['avalanche', 'fuji'] },
      { chain: 'etherium', networks: ['mainnet', 'arbitrum_one', 'optimism'] },
    ],
    secondary: {
      chain: ConfigManagerV2.getInstance().get('curve.secondary.chain'),
      network: ConfigManagerV2.getInstance().get('curve.secondary.network'),
    },
  };
}
