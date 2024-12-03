# no-u-honeypot

There's this interesting attack designed to target unsophisticated crypto users.

Basically, an attacker will masquerade like a victim that has straight up rocks for brains and shares their seed phrase on social media:

<p align="center">
  <img src="public/honeypot.jpg" width="100%">
</p>

> Found on [**Double entry point issues**](https://www.youtube.com/watch?v=aq0n0T0wAeQ) by [**@holajotola**](https://x.com/holajotola).

Once the address is derived, consulting the block explorer will reveal an EOA that has a some ERC-20 balance, but no underlying ether which can be used to get the tokens out.

Would-be attakers, now lured in by the promise of free tokens, will attempt to send a transfer a little ether to cover the cost of exfiltrating the tokens via the public mempool.

However, **the attacker is smarter than they are**.

They are monitoring the public mempool, and upon detection of a pending donation, they'll immediately backrun with a `transfer`. This results in the would-be attacker's transaction to fail, the attacker to make off with the donation, and the ERC-20s remain inside the EOA for the next sucka.

## how to exploit the exploiters

This whole attack works because no-one is going to go to the effort of writing a Flashbots transaction bundle to atomically transfer the ether and withdraw the tokens... _right_?

```shell
git clone git@github.com:cawfree/no-u-honeypot.git
cd no-u-honeypot
cp .env.example .env # add required variables
yarn
yarn eat "alarm fetch churn bridge exercise tape speak race clerk couch crater letter" # take the tokens
```

> btw you might also like [`piggyback`](https://github.com/cawfree/piggyback), a poison erc20 deployer

## license
[**CC0-1.0**](LICENSE)
