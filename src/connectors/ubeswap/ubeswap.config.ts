import { ConfigManagerV2 } from '../../services/config-manager-v2';
import { AvailableNetworks } from '../../services/config-manager-types';

export namespace UbeswapConfig {
  export interface NetworkConfig {
    allowedSlippage: string;
    gasLimitEstimate: number;
    ttl: number;
    routerAddress: (network: string) => string;
    tradingTypes: Array<string>;
    availableNetworks: Array<AvailableNetworks>;
    maximumHops: number;
  }

  export const config: NetworkConfig = {
    allowedSlippage: ConfigManagerV2.getInstance().get(
      'ubeswap.allowedSlippage'
    ),
    gasLimitEstimate: ConfigManagerV2.getInstance().get(
      'ubeswap.gasLimitEstimate'
    ),
    ttl: ConfigManagerV2.getInstance().get('ubeswap.ttl'),
    maximumHops: ConfigManagerV2.getInstance().get(`ubeswap.maximumHops`),
    routerAddress: (network: string) =>
      ConfigManagerV2.getInstance().get(
        'ubeswap.contractAddresses.' + network + '.routerAddress'
      ),
    tradingTypes: ['EVM_AMM'],
    availableNetworks: [{ chain: 'mainnet', networks: ['mainnet', 'mumbai'] }],
  };
}