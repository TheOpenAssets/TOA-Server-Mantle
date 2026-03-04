// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract USCCreditVerifier {
    address public owner;
    address private constant USC_PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    event CrossChainEventVerified(
        address indexed wallet,
        string sourceChain,
        uint8 eventType,
        int256 scoreDelta,
        uint256 timestamp
    );

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "USC: not owner");
        _;
    }

    function verifyAndRecord(
        address wallet,
        string calldata sourceChain,
        uint8 eventType,
        int256 scoreDelta,
        bytes calldata proof
    ) external onlyOwner {
        (bool success, bytes memory result) = USC_PRECOMPILE.staticcall(proof);
        require(success && result.length > 0 && result[0] != 0, "USC: proof invalid");
        emit CrossChainEventVerified(wallet, sourceChain, eventType, scoreDelta, block.timestamp);
    }
}
