// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract TrustedIssuersRegistry {
    mapping(address => bool) public trustedIssuers;
    address public owner;

    event TrustedIssuerAdded(address indexed issuer, uint256 timestamp);
    event TrustedIssuerRemoved(address indexed issuer, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addTrustedIssuer(address issuer) external onlyOwner {
        trustedIssuers[issuer] = true;
        emit TrustedIssuerAdded(issuer, block.timestamp);
    }

    function removeTrustedIssuer(address issuer) external onlyOwner {
        trustedIssuers[issuer] = false;
        emit TrustedIssuerRemoved(issuer, block.timestamp);
    }

    function isTrustedIssuer(address issuer) external view returns (bool) {
        return trustedIssuers[issuer];
    }
}
