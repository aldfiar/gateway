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
    secondary: (chain: string) => {
      chain: string;
      network: string;
    };
    curve_mapping: (chain: string) => (token: string) => string;
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
        `curve.contractAddresses.${network}.routerAddress`,
      ),
    tradingTypes: ['AMM'],
    chainType: 'EVM',
    token: (chain: string) =>
      ConfigManagerV2.getInstance().get(`curve.tokens.${chain}.token`),
    availableNetworks: [
      { chain: 'polygon', networks: ['mainnet', 'mumbai'] },
      { chain: 'avalanche', networks: ['avalanche', 'fuji'] },
      { chain: 'ethereum', networks: ['mainnet', 'arbitrum_one', 'optimism'] },
    ],
    secondary: (chain: string) => getSecondary(chain),
    curve_mapping: (chain: string) => getTokensForNetwork(chain),
  };
}

export function getTokensForNetwork(chain: string) {
  return (token: string) => getToken(chain, token);
}

export function getToken(chain: string, token: string) {
  return ConfigManagerV2.getInstance().get(
    `curve.curve_mapping.${chain}.${token}`,
  );
}

export function getSecondary(chain: string) {
  return {
    chain: ConfigManagerV2.getInstance().get(`curve.secondary.${chain}.chain`),
    network: ConfigManagerV2.getInstance().get(
      `curve.secondary.${chain}.network`,
    ),
  };
}
