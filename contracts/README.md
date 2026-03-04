## Deploy on sepolia

```shell
source ../.env
forge create src/HumanFaucet.sol:HumanFaucet --rpc-url "https://ethereum-sepolia-rpc.publicnode.com" --private-key $CRE_ETH_PRIVATE_KEY --broadcast --constructor-args $SEPOLIA_CRE_FORWARDER_ADDRESS
```

## Verify contract

```shell
export CONTRACT=0xBcbE48B2cAac8645cF9528415244369c4c7466C1
forge verify-contract $CONTRACT src/HumanFaucet.sol:HumanFaucet --rpc-url "https://ethereum-sepolia-rpc.publicnode.com" --etherscan-api-key $ETHERSCAN_API_KEY --constructor-args $(cast abi-encode "constructor(address)" $SEPOLIA_CRE_FORWARDER_ADDRESS)
```

## Deploy on arb-sepolia

```shell
source ../.env
forge create src/HumanFaucet.sol:HumanFaucet --rpc-url "https://sepolia-rollup.arbitrum.io/rpc" --private-key $CRE_ETH_PRIVATE_KEY --broadcast --constructor-args $ARB_SEPOLIA_CRE_FORWARDER_ADDRESS
```

## Verify contract

```shell
export CONTRACT=0x880D2Cc47742387815b1326082D77B92b9Eca922
forge verify-contract $CONTRACT src/HumanFaucet.sol:HumanFaucet --rpc-url "https://sepolia-rollup.arbitrum.io/rpc" --etherscan-api-key $ETHERSCAN_API_KEY --constructor-args $(cast abi-encode "constructor(address)" $ARB_SEPOLIA_CRE_FORWARDER_ADDRESS)
```
