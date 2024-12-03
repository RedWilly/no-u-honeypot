import {createExfiltrateBundle, getWalletOrThrow, getEnvironment} from '../src';

const [victimPrivateKey] = process.argv.slice(2);

void (async () => {
  try {
    const {provider, flashbotsProvider} = await getEnvironment();
    const [signedTransactionsBundle, targetBlockNumber] = await createExfiltrateBundle({
      victimWallet: getWalletOrThrow({entropy: String(victimPrivateKey), provider}),
      simulateRefinedBlock: true,
    });

    const flashbotsTransactionResponse = await flashbotsProvider.sendBundle(
      signedTransactionsBundle,
      targetBlockNumber,
    );

    console.log(flashbotsTransactionResponse);
  } catch (e) {
    console.error(e);
  }
})();
