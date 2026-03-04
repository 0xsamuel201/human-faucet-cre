// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";

contract HumanFaucet is ReceiverTemplate {
    // --- State Variables ---

    // amount of token to drip per request, can be updated by the owner
    uint256 public faucetAmount;

    // Maps a World ID nullifier hash to a timestamp of when they last received a drip
    mapping(uint256 => uint256) public nullifierHashesTimestamp;

    // --- Events ---

    event FaucetDripped(address indexed recipient, uint256 amount);

    // --- Errors ---

    error InvalidAddress();
    error InsufficientBalance();
    error FaucetCooldownActive(uint256 nextAvailableTime);
    error InvalidFaucetAmount();

    // --- Constructor ---

    /**
     * @param _forwarderAddress The wallet address that the Chainlink CRE workflow
     * uses to execute EVM writes.
     */
    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {
        // set default faucet amount to 0.01 ether
        faucetAmount = 0.01 ether;
    }

    // --- Core Functions ---

    /**
     * @notice withdraw ETH from the faucet. Can only be called by the owner of the contract.
     */
    function withdraw() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }

    /**
     * @notice Sets the amount of ETH to drip per request. Can only be called by the owner of the contract.
     * @param amount The new amount of ETH to drip per request (in wei).
     */
    function setFaucetAmount(uint256 amount) external onlyOwner {
        if (amount == 0) {
            revert InvalidFaucetAmount();
        }
        faucetAmount = amount;
    }

    /**
     * @notice Drips a small amount of ETH to the recipient. Can only be called
     * by the CRE workflow after it verifies the World ID proof off-chain.
     * @param recipient The address receiving the faucet drip.
     * @param nullifierHash The nullifier hash of the World ID proof.
     */
    function _dripFaucet(address recipient, uint256 nullifierHash) internal {
        if (recipient == address(0)) {
            revert InvalidAddress();
        }
        if (address(this).balance < faucetAmount) {
            revert InsufficientBalance();
        }
        uint256 lastDripTime = nullifierHashesTimestamp[nullifierHash];
        if (block.timestamp < lastDripTime + 1 days) {
            revert FaucetCooldownActive(lastDripTime + 1 days);
        }

        nullifierHashesTimestamp[nullifierHash] = block.timestamp;

        (bool success, ) = recipient.call{value: faucetAmount}("");
        require(success, "Faucet transfer failed");

        emit FaucetDripped(recipient, faucetAmount);
    }

    /// @inheritdoc ReceiverTemplate
    function _processReport(bytes calldata report) internal override {
        (address recipient, uint256 nullifierHash) = abi.decode(
            report,
            (address, uint256)
        );
        _dripFaucet(recipient, nullifierHash);
    }

    // --- View Functions ---
    /**
     * @notice Returns the next available drip time for a given nullifier hash.
     * @param nullifierHash The nullifier hash to check.
     * @return The timestamp of when the next drip will be available for the given nullifier hash.
     */
    function getNextDripTime(
        uint256 nullifierHash
    ) external view returns (uint256) {
        uint256 lastDripTime = nullifierHashesTimestamp[nullifierHash];
        if (lastDripTime == 0) {
            return 0; // If never dripped before, the next drip time is immediately available
        }
        return lastDripTime + 1 days;
    }

    // Allow the contract to receive ETH
    receive() external payable {}
}
