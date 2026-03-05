import { cre, Runner, getNetwork } from "@chainlink/cre-sdk";
import { onHttpTrigger } from "./httpCallback";

export type Config = {
  worldcoinAppId: string;
  worldcoinAction: string;
  sepoliaContractAddress: `0x${string}`;
  arbSepoliaContractAddress: `0x${string}`;
  sepoliaChainSelectorName: string;
  arbChainSelectorName: string;
  gasLimit: string;
};

export const initWorkflow = (config: Config) => {
  // Initialize HTTP capability
  const httpCapability = new cre.capabilities.HTTPCapability();
  const httpTrigger = httpCapability.trigger({});

  return [
    // HTTP Trigger - Market Creation
    cre.handler(httpTrigger, onHttpTrigger),
  ];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}

main();
