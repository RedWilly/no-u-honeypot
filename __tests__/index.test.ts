import 'jest';

import {parseEther} from 'ethers';

import {
  createExfiltrateBundle,
  createExfiltrateTransactions,
  getEnvironment,
  getWalletOrThrow,
} from '../src';

jest.setTimeout(10_000);

// https://www.youtube.com/watch?v=aq0n0T0wAeQ
// Great analysis, thank you! I have a quick question: I have a SafePal wallet with USDT, and I have the seed phrase. (alarm fetch churn bridge exercise tape speak race clerk couch crater letter). Could you explain how to move them to Binance?
const ORIGIN_STORY = 'alarm fetch churn bridge exercise tape speak race clerk couch crater letter';

describe('no-u-honeypot', () => {
  it('is test environment', expect(getEnvironment().then(({isTest}) => isTest)).resolves.toBeTruthy);
  it('fails to parse invalid wallet', () => {
    expect(() => getWalletOrThrow({entropy: ''})).toThrow();
  });
  it('parses "leaked" wallet', () => {
    expect(getWalletOrThrow({entropy: ORIGIN_STORY})).toBeTruthy()
  });
  it('get account tokens', async () => {
    const {web3} = await getEnvironment();
    const {tokenBalances} = await web3.alchemy.getTokenBalances(
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be',
      ['0x607f4c5bb672230e8672085532f7e901544a7375']
    );
    expect(Array.isArray(tokenBalances)).toBeTruthy();
    expect(tokenBalances.length).toBe(1);
  });
  it('create exfiltrate tokens transactions', async () => {
    const {provider} = await getEnvironment();
    const to = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045';
    const victimWallet = getWalletOrThrow({entropy: ORIGIN_STORY, provider});
    const {maxPriorityFeePerGas} = await provider.getFeeData();
    await createExfiltrateTransactions({
      to,
      victimWallet,
      maxPriorityFeePerGas: maxPriorityFeePerGas!,
      maxBaseFeeInFutureBlock: parseEther('0.1'),
    });
  })
  it('create exfiltrate tokens bundle', async () => {
    const {provider} = await getEnvironment();
    const victimWallet = getWalletOrThrow({entropy: ORIGIN_STORY, provider});
    await createExfiltrateBundle({victimWallet, simulateRefinedBlock: true});
  })
});
