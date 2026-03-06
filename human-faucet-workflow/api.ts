import express, { Request, Response } from "express";
import { execSync } from "child_process";
import cors from "cors";

const app = express();

// Middleware
app.use(express.json());
app.use(cors());

// POST route to trigger the CRE workflow
app.post("/trigger", (req: Request, res: Response) => {
  try {
    console.log("Received payload from frontend, triggering CRE...");

    // Stringify the incoming payload from the World IDKit
    const payload = JSON.stringify(req.body);
    console.log("Payload to be sent to CRE CLI:\n", payload);

    // Escape single quotes to prevent command injection in the terminal
    const escapedPayload = payload.replace(/'/g, "'\\''");

    // Execute the CRE CLI command synchronously
    const result = execSync(
      `cre workflow simulate human-faucet-workflow --non-interactive --trigger-index 0 --http-payload '${escapedPayload}' --broadcast`,
      { encoding: "utf-8" },
    );

    console.log("CLI Execution Output:\n", result);

    // Extract the transaction hash from the CLI output using Regex
    // This looks for the exact log you wrote in httpCallback.ts
    const txHashMatch = result.match(
      /✓ Transaction successful:\s+(0x[a-fA-F0-9]+)/,
    );

    if (txHashMatch && txHashMatch[1]) {
      const txHash = txHashMatch[1];

      // Return the exact JSON structure the Next.js frontend expects
      res.status(200).json({
        success: true,
        transactionHash: txHash,
      });
    } else {
      // If the workflow ran but didn't output a hash, treat it as an error
      res.status(500).json({
        error:
          "Workflow executed but no transaction hash was found in the output.",
        details: result, // Send the raw output back for debugging
      });
    }
  } catch (error: unknown) {
    console.error("CLI Execution Error:", error);
    res.status(500).json({
      error: "CLI execution failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

const PORT = 4000;

app.listen(PORT, () => {
  console.log(`🚀 CRE API listening on http://localhost:${PORT}!`);
});
