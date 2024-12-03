import {createAlchemyWeb3} from '@alch/alchemy-web3';
import {FlashbotsBundleProvider} from '@flashbots/ethers-provider-bundle';
import {JsonRpcProvider, Signer} from 'ethers';

export type Address = `0x${string}`;

export type ParsedEnvironment = {
  readonly attackerWallet: Signer;
  readonly isTest: boolean;
  readonly web3: ReturnType<typeof createAlchemyWeb3>;
  readonly provider: JsonRpcProvider;
  readonly flashbotsProvider: FlashbotsBundleProvider;
  readonly chainId: number;
  readonly type: number;
};

export type Transaction = {
  readonly data?: string;
  readonly to: Address,
  readonly chainId: number;
  readonly maxFeePerGas: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly value: bigint;
  readonly nonce: number;
  readonly from: Address;
  readonly gasLimit: bigint;
  readonly type: number;
};
