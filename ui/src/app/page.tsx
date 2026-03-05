"use client";

import { useState, useEffect } from "react";
import { IDKitWidget, VerificationLevel, ISuccessResult, useIDKit } from "@worldcoin/idkit";
import { isAddress } from "viem";
import { sepolia, arbitrumSepolia } from "viem/chains";
import { 
  createPublicClient, 
  http, 
  parseAbiItem,
  createWalletClient, 
  custom, 
  parseEther,
  formatEther,
} from "viem";

// Chain Configuration
const CHAINS = [
  { id: 11155111, name: "Sepolia", color: "bg-blue-600", chain: sepolia },
  { id: 421614, name: "Arbitrum Sepolia", color: "bg-cyan-600", chain: arbitrumSepolia },
];

// Minimal ABI to read the cooldown from HumanFaucet.sol
const FAUCET_ABI = [
  parseAbiItem("function getNextDripTime(uint256 nullifierHash) external view returns (uint256)"),
  parseAbiItem("function faucetAmount() external view returns (uint256)"),
];

const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: process.env.NEXT_PUBLIC_SEPOLIA_CONTRACT_ADDRESS as `0x${string}`,
  421614: process.env.NEXT_PUBLIC_ARB_SEPOLIA_CONTRACT_ADDRESS as `0x${string}`,
};

export default function Home() {
  const [walletAddress, setWalletAddress] = useState("");
  const [selectedChainId, setSelectedChainId] = useState(CHAINS[0].id);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Dynamic Drip Amount State
  const [dripAmount, setDripAmount] = useState<string>("...");

  // Funding State
  const [fundAmount, setFundAmount] = useState("0.01");
  const [fundTxHash, setFundTxHash] = useState("");
  const [fundError, setFundError] = useState("");
  const [isFunding, setIsFunding] = useState(false);

  const { setOpen } = useIDKit();

  // --- Fetch Faucet Amount on Chain Switch ---
  useEffect(() => {
    const fetchFaucetAmount = async () => {
      setDripAmount("..."); // Show loading state while fetching
      const chainConfig = CHAINS.find(c => c.id === selectedChainId);
      const contractAddress = CONTRACT_ADDRESSES[selectedChainId];
      
      if (!contractAddress) return;

      const client = createPublicClient({
        chain: chainConfig?.chain,
        transport: http(),
      });

      try {
        const amountWei = await client.readContract({
          address: contractAddress,
          abi: FAUCET_ABI,
          functionName: "faucetAmount",
        });
        
        // Convert the returned BigInt (wei) to a readable ETH string
        setDripAmount(formatEther(amountWei as bigint));
      } catch (err) {
        console.error("Failed to fetch faucet amount:", err);
        setDripAmount("?");
      }
    };

    fetchFaucetAmount();
  }, [selectedChainId]); // Re-run whenever the user switches chains

  const checkEligibility = async (nullifierHash: string) => {
    const chainConfig = CHAINS.find(c => c.id === selectedChainId);
    const contractAddress = CONTRACT_ADDRESSES[selectedChainId];
    
    if (!contractAddress) throw new Error("Contract address not configured for this chain");

    // Initialize a lightweight read-only client
    const client = createPublicClient({
      chain: chainConfig?.chain,
      transport: http(),
    });

    console.log(`Checking eligibility for nullifier ${nullifierHash} on ${chainConfig?.name}...`);

    try {
      // Call getNextDripTime(nullifierHash)
      const nextDripTime = await client.readContract({
        address: contractAddress,
        abi: FAUCET_ABI,
        functionName: "getNextDripTime",
        args: [BigInt(nullifierHash)], // Convert hex string to BigInt for uint256
      });

      const nowSeconds = Math.floor(Date.now() / 1000);

      // Logic from HumanFaucet.sol: if (block.timestamp < lastDripTime + 1 days)
      if (Number(nextDripTime) > nowSeconds) {
        const waitTimeHours = ((Number(nextDripTime) - nowSeconds) / 3600).toFixed(1);
        throw new Error(`Cooldown active. Try again in ${waitTimeHours} hours.`);
      }

    } catch (err: any) {
      // If the error is our custom cooldown error, rethrow it
      if (err.message.includes("Cooldown")) throw err;
      
      console.error("Failed to read contract:", err);
      // Optional: You might want to allow the user to proceed if the RPC fails 
      // and let the backend handle the final check.
    }
  };

  // 1. The Core Logic: Verify Proof & Call CRE Backend
  const handleVerify = async (proofResult: ISuccessResult) => {
    setLoading(true);
    setError("");
    setTxHash("");

    try {
      // Step 1: Check eligibility on smart contract BEFORE calling backend
      await checkEligibility(proofResult.nullifier_hash);

      // Step 2: Prepare payload for CRE backend
      const payload = {
        recipient: walletAddress,
        nullifier_hash: proofResult.nullifier_hash,
        merkle_root: proofResult.merkle_root,
        proof: proofResult.proof,
        verification_level: proofResult.verification_level,
        chainId: selectedChainId,
      };

      console.log("Sending payload to CRE:", payload);

      const res = await fetch(process.env.NEXT_PUBLIC_CRE_API_URL!, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      console.log("Received response from CRE:", data);

      if (!res.ok) {
        throw new Error(data.message || "Failed to claim faucet");
      }

      // CRE code returns { success: true, transactionHash: "0x..." }
      if (data.transactionHash) {
        setTxHash(data.transactionHash);
      } else {
        throw new Error("No transaction hash returned from CRE");
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong");

      // Force the modal to close immediately
      setOpen(false);

      throw err; // Re-throw to alert the World ID widget
    } finally {
      setLoading(false);
    }
  };

  // --- Funding Logic ---
  const handleFund = async () => {
    setIsFunding(true);
    setFundError("");
    setFundTxHash("");

    try {
      // Check if user has a browser wallet extension
      if (typeof window === "undefined" || !(window as any).ethereum) {
        throw new Error("No Web3 wallet found. Please install MetaMask or Rabby.");
      }

      const chainConfig = CHAINS.find(c => c.id === selectedChainId);
      const contractAddress = CONTRACT_ADDRESSES[selectedChainId];

      if (!contractAddress) {
        throw new Error("Contract address not configured for this chain.");
      }

      // 1. Setup Wallet Client (for signing and sending)
      const walletClient = createWalletClient({
        chain: chainConfig?.chain,
        transport: custom((window as any).ethereum)
      });

      // 2. Setup Public Client (for reading live network data)
      const publicClient = createPublicClient({
        chain: chainConfig?.chain,
        transport: http()
      });

      // Request account access
      const [account] = await walletClient.requestAddresses();

      // Switch to the correct network if needed
      try {
        await walletClient.switchChain({ id: selectedChainId });
      } catch (switchError: any) {
        throw new Error(`Please switch your wallet to ${chainConfig?.name} first.`);
      }

      // 3. Fetch the absolute latest fee recommendations from the network
      const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

      // Calculate a 20% buffer for maxFeePerGas to survive sudden network spikes
      // We use BigInt math: (value * 120n) / 100n
      const bufferedMaxFeePerGas = maxFeePerGas ? (maxFeePerGas * BigInt(120)) / BigInt(100) : undefined;

      // 4. Send the transaction with the explicit gas limits
      const hash = await walletClient.sendTransaction({
        account,
        to: contractAddress,
        value: parseEther(fundAmount),
        maxFeePerGas: bufferedMaxFeePerGas,
        maxPriorityFeePerGas: maxPriorityFeePerGas,
      });

      setFundTxHash(hash);
    } catch (err: any) {
      console.error(err);
      setFundError(err.shortMessage || err.message || "Transaction failed");
    } finally {
      setIsFunding(false);
    }
  };

  const onSuccess = () => {
    console.log("Verification flow completed.");
  };

  const onWorldAppError = (error: any) => {
    console.error("World ID Error:", error);
    setError("Verification cancelled or failed in World App.");
    setOpen(false); // Close the modal
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-24 bg-zinc-950 text-white font-mono">
      <div className="z-10 max-w-lg w-full">
        
        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
            Human Faucet 💧
          </h1>
          <p className="text-zinc-400 text-sm">
            Claim testnet ETH on multi-chain with your World ID.
          </p>
        </div>

        {/* Global Chain Selection */}
        <div className="mb-6">
          <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-3 text-center">
            Select Target Network
          </label>
          <div className="grid grid-cols-2 gap-3">
            {CHAINS.map((chain) => (
              <button
                key={chain.id}
                onClick={() => setSelectedChainId(chain.id)}
                className={`py-3 rounded-lg text-sm font-semibold transition-all border ${
                  selectedChainId === chain.id
                    ? `${chain.color} border-transparent text-white shadow-lg`
                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {chain.name}
              </button>
            ))}
          </div>
        </div>

        {/* Main Claim Card */}
        <div className="bg-zinc-900/80 backdrop-blur-md p-8 rounded-2xl border border-zinc-800 shadow-2xl mb-6">
          
          <h2 className="text-lg font-bold mb-4 text-zinc-200">Claim {dripAmount} ETH</h2>

          {/* Input Form */}
          <div className="mb-8">
            <label className="block text-xs uppercase tracking-wider text-zinc-500 mb-2">
              Recipient Address
            </label>
            <input
              type="text"
              placeholder="0x..."
              value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              disabled={loading || !!txHash}
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition font-mono text-sm"
            />
          </div>

          {/* WORLD ID WIDGET */}
          <div className="flex justify-center">
            {txHash ? (
              <SuccessMessage txHash={txHash} chainId={selectedChainId} />
            ) : (
              <IDKitWidget
                app_id={process.env.NEXT_PUBLIC_WLD_APP_ID as `app_${string}`}
                action={process.env.NEXT_PUBLIC_WLD_ACTION!}
                // signal={walletAddress} // Security: Binds proof to this specific address
                onSuccess={onSuccess}
                onError={onWorldAppError}
                handleVerify={handleVerify}
                verification_level={VerificationLevel.Orb} 
              >
                {({ open }) => (
                  <button
                    onClick={open}
                    disabled={!isAddress(walletAddress) || loading}
                    className={`w-full py-4 rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 ${
                      isAddress(walletAddress) && !loading
                        ? "bg-white text-black hover:bg-zinc-200 shadow-[0_0_20px_rgba(255,255,255,0.2)]"
                        : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                    }`}
                  >
                    {loading ? (
                      <>
                        <span className="w-5 h-5 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin"></span>
                        Processing...
                      </>
                    ) : !isAddress(walletAddress) ? (
                      "Enter Valid Address"
                    ) : (
                      "Verify & Claim"
                    )}
                  </button>
                )}
              </IDKitWidget>
            )}
          </div>

          {/* Error Message */}
          {error && (
            <div className="mt-6 p-4 bg-red-900/20 border border-red-800/50 rounded-lg text-red-300 text-center text-xs">
              <span className="font-bold block mb-1">Error</span>
              {error}
            </div>
          )}
        </div>

        {/* --- Fund Card --- */}
        <div className="bg-zinc-900/40 p-6 rounded-2xl border border-zinc-800/50">
          <h2 className="text-sm font-bold mb-3 text-zinc-400">Keep the faucet alive ❤️</h2>
          <div className="flex gap-3">
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={fundAmount}
              onChange={(e) => setFundAmount(e.target.value)}
              className="w-24 bg-zinc-950 border border-zinc-700 rounded-lg p-3 text-white focus:ring-2 focus:ring-cyan-500 outline-none transition text-sm"
            />
            <button
              onClick={handleFund}
              disabled={isFunding || !fundAmount}
              className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3 rounded-lg transition-all disabled:opacity-50 text-sm border border-zinc-700 flex items-center justify-center gap-2"
            >
              {isFunding ? (
                <>
                  <span className="w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin"></span>
                  Sending...
                </>
              ) : (
                `Donate ${fundAmount} ETH`
              )}
            </button>
          </div>
          
          {fundTxHash && (
            <div className="mt-3 text-center text-xs text-green-400">
              Thanks for the gas! <a href={selectedChainId === 11155111 ? `https://sepolia.etherscan.io/tx/${fundTxHash}` : `https://sepolia.arbiscan.io/tx/${fundTxHash}`} target="_blank" className="underline">View Tx</a>
            </div>
          )}
          {fundError && (
            <div className="mt-3 text-center text-xs text-red-400">
              {fundError}
            </div>
          )}
        </div>
        {/* --- Footer --- */}
        <footer className="pt-8 pb-4 text-center text-zinc-500 text-base">
          Made with ☕ by corporal <span className="text-zinc-400 hover:text-cyan-400 transition-colors cursor-pointer"><a href="https://x.com/0xsamuel201" target="_blank" rel="noopener noreferrer">@0xsamuel201</a></span>
        </footer>
      </div>
      
    </main>
  );
}

function SuccessMessage({ txHash, chainId }: { txHash: string; chainId: number }) {
  const explorerUrl =
    chainId === 11155111
      ? "https://sepolia.etherscan.io/tx/"
      : "https://sepolia.arbiscan.io/tx/";

  return (
    <div className="text-center w-full animate-fade-in-up">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 text-green-400 mb-4 border border-green-500/20 shadow-[0_0_30px_rgba(74,222,128,0.1)]">
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-xl font-bold text-white mb-2">Funds Sent!</h3>
      <p className="text-zinc-400 text-xs mb-4">
        Your Proof of Human was verified off-chain.
      </p>
      <a
        href={`${explorerUrl}${txHash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300 transition-colors text-sm border border-blue-900/50 bg-blue-900/10 px-4 py-2 rounded-full"
      >
        View on Explorer
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
      </a>
    </div>
  );
}