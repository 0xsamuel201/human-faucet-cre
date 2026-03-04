// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {HumanFaucet} from "../src/HumanFaucet.sol";
import {Test} from "forge-std/Test.sol";

contract HumanFaucetTest is Test {
    HumanFaucet public faucet;

    address public owner = makeAddr("owner");
    address public forwarder = makeAddr("forwarder");
    address public newForwarder = makeAddr("newForwarder");

    function setUp() public {
        // Deploy the HumanFaucet contract with a dummy forwarder address
        vm.deal(owner, 10 ether); // Fund the owner with some ETH for testing

        vm.prank(owner);
        faucet = new HumanFaucet(forwarder);
    }

    function testSetFaucetAmount() public {
        // Set the faucet amount to 1 ether
        uint256 newAmount = 1 ether;

        vm.prank(owner);
        faucet.setFaucetAmount(newAmount);
        assertEq(
            faucet.faucetAmount(),
            newAmount,
            "Faucet amount should be updated"
        );
    }

    function testSetFaucetAmountZero() public {
        // Attempt to set the faucet amount to zero, which should revert
        vm.prank(owner);
        vm.expectRevert(HumanFaucet.InvalidFaucetAmount.selector);
        faucet.setFaucetAmount(0);
    }

    function testSetFaucetAmountByNonOwner() public {
        // Attempt to set the faucet amount by a non-owner, which should revert
        vm.prank(makeAddr("nonOwner"));
        vm.expectRevert();
        faucet.setFaucetAmount(1 ether);
    }

    function testWithdraw() public {
        // Fund the faucet with some ETH
        vm.deal(address(faucet), 1 ether);

        // Withdraw the funds to the owner's address
        vm.prank(owner);
        faucet.withdraw();

        // Check that the owner's balance has increased by 1 ether
        assertEq(
            owner.balance,
            11 ether,
            "Owner should receive withdrawn funds"
        );
    }

    function testOwnerChangeForwarder() public {
        // non-owner should not be able to change the forwarder address
        vm.prank(makeAddr("nonOwner"));
        vm.expectRevert();
        faucet.setForwarderAddress(newForwarder);
        assertEq(
            faucet.getForwarderAddress(),
            forwarder,
            "Forwarder address should not be changed"
        );

        // Change the forwarder address
        vm.prank(owner);
        faucet.setForwarderAddress(newForwarder);

        // Verify that the forwarder address has been updated
        assertEq(
            faucet.getForwarderAddress(),
            newForwarder,
            "Forwarder address should be updated"
        );
    }

    function testOnlyForwarderCanCallOnReport() public {
        // Attempt to call onReport from a non-forwarder address, which should revert
        vm.prank(makeAddr("nonForwarder"));
        vm.expectRevert();

        // create random bytes for the report
        bytes memory randomBytes = bytes("random report data");
        faucet.onReport(randomBytes, randomBytes);
    }
}
