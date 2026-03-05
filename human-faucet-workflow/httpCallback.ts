import {
  cre,
  getNetwork,
  type Runtime,
  type HTTPPayload,
  bytesToHex,
  hexToBase64,
  TxStatus,
  decodeJson,
} from "@chainlink/cre-sdk";
import { encodeAbiParameters, parseAbiParameters } from "viem";

interface ClaimPayload {
  recipient: `0x${string}`;
  nullifier_hash: string;
  merkle_root: string;
  proof: string;
  verification_level: string;
  chainId: number;
}

// Define the configuration expected by this workflow
type Config = {
  worldcoinAppId: string;
  worldcoinAction: string;
  sepoliaContractAddress: `0x${string}`;
  arbSepoliaContractAddress: `0x${string}`;
  sepoliaChainSelectorName: string;
  arbChainSelectorName: string;
  gasLimit: string;
};

export function onHttpTrigger(runtime: Runtime<Config>, payload: HTTPPayload) {
  const config = runtime.config;

  // Parse the World ID payload sent from the frontend
  const {
    recipient,
    nullifier_hash,
    merkle_root,
    proof,
    verification_level,
    chainId,
  } = decodeJson(payload.input) as ClaimPayload;

  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  runtime.log(`Recipient: ${recipient}`);
  runtime.log(`Nullifier Hash: ${nullifier_hash}`);
  runtime.log(`Merkle Root: ${merkle_root}`);
  runtime.log(`Verification level: ${verification_level}`);
  runtime.log(`Proof: ${proof}`);
  runtime.log(`Chain ID: ${chainId}`);
  runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // --- STEP 1: Verify World ID Proof Off-Chain ---
  const httpClient = new cre.capabilities.HTTPClient();

  const verifyPayload = {
    nullifier_hash,
    merkle_root,
    proof,
    verification_level,
    action: config.worldcoinAction,
  };

  // Execute the HTTP POST request to Worldcoin and wait for the result
  const worldcoinResponse = httpClient
    .sendRequest(runtime, {
      url: `https://developer.worldcoin.org/api/v2/verify/${config.worldcoinAppId}`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.from(JSON.stringify(verifyPayload)).toString("base64"),
    })
    .result();

  const responseBody = new TextDecoder().decode(worldcoinResponse.body);

  if (worldcoinResponse.statusCode !== 200) {
    throw new Error(`World ID verification failed: ${responseBody}`);
  }

  runtime.log("World ID proof verified successfully via API!");

  // --- STEP 2: Execute EVM Write ---
  // Initialize EVM Client for the target chain (e.g., Arbitrum Sepolia)
  let network = null;
  if (chainId === 11155111) {
    network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: config.sepoliaChainSelectorName,
      isTestnet: true,
    });
  } else if (chainId === 421614) {
    network = getNetwork({
      chainFamily: "evm",
      chainSelectorName: config.arbChainSelectorName,
      isTestnet: true,
    });
  } else {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  if (!network) {
    throw new Error(`Unknown chain selector for chain ID: ${chainId}`);
  }

  const contractAddress =
    chainId === 11155111
      ? config.sepoliaContractAddress
      : config.arbSepoliaContractAddress;

  runtime.log(`Target chain: ${network.chainSelector.name}`);
  runtime.log(`Contract address: ${contractAddress}`);

  const evmClient = new cre.capabilities.EVMClient(
    network.chainSelector.selector,
  );

  // Encode the parameters to match your Solidity contract's castVote function
  // Format: (address recipient, uint256 nullifierHash)
  const reportData = encodeAbiParameters(
    parseAbiParameters("address recipient, uint256 nullifierHash"),
    [recipient, BigInt(nullifier_hash)],
  );

  // Generate a cryptographically signed report via the CRE network
  const reportResponse = runtime
    .report({
      encodedPayload: hexToBase64(reportData),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  // Submit the signed report to HumanVote contract via the CRE Forwarder
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: contractAddress,
      report: reportResponse,
      gasConfig: {
        gasLimit: config.gasLimit,
      },
    })
    .result();

  if (writeResult.txStatus === TxStatus.SUCCESS) {
    const txHash = bytesToHex(writeResult.txHash || new Uint8Array(32));
    runtime.log(`✓ Transaction successful: ${txHash}`);
    runtime.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    // Return success back to the frontend HTTP trigger
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        transactionHash: txHash,
      }),
    };
  }

  throw new Error(`Transaction failed with status: ${writeResult.txStatus}`);
}
