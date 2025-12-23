// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./RWAToken.sol";
import "./ComplianceModule.sol";
import "./YieldVault.sol";
import "./AttestationRegistry.sol";

contract TokenFactory {
    struct TokenSuite {
        address token;
        address compliance;
        uint256 deployedAt;
        uint256 totalSupply;
    }

    address public attestationRegistry;
    address public identityRegistry;
    address public trustedIssuersRegistry;
    address public platformCustody;
    address public yieldVault;
    address public owner;

    mapping(bytes32 => TokenSuite) public deployedTokens;
    address[] public allTokens;
    uint256 public tokenCount;

    event TokenSuiteDeployed(bytes32 indexed assetId, address token, address compliance, uint256 totalSupply);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(
        address _attestationRegistry,
        address _identityRegistry,
        address _trustedIssuersRegistry,
        address _platformCustody,
        address _yieldVault
    ) {
        owner = msg.sender;
        attestationRegistry = _attestationRegistry;
        identityRegistry = _identityRegistry;
        trustedIssuersRegistry = _trustedIssuersRegistry;
        platformCustody = _platformCustody;
        yieldVault = _yieldVault;
    }

    function deployTokenSuite(
        bytes32 assetId,
        uint256 totalSupply,
        string memory name,
        string memory symbol,
        address issuer
    ) external onlyOwner {
        require(deployedTokens[assetId].token == address(0), "Asset already tokenized");
        require(AttestationRegistry(attestationRegistry).isAssetValid(assetId), "Asset not valid");

        // 1. Deploy Compliance
        ComplianceModule compliance = new ComplianceModule(
            identityRegistry,
            attestationRegistry,
            assetId
        );

        // 2. Deploy Token
        RWAToken token = new RWAToken(
            assetId,
            address(compliance),
            identityRegistry,
            totalSupply,
            platformCustody,
            name,
            symbol,
            issuer
        );

        // 3. Link Compliance (RWAToken already sets compliance, but if Compliance needed token ref, do it here)
        // In this design, Compliance checks Registry directly, doesn't need token callback usually.

        // 4. Register in YieldVault
        YieldVault(yieldVault).registerAsset(address(token), assetId, issuer);

        // 5. Store Suite
        deployedTokens[assetId] = TokenSuite({
            token: address(token),
            compliance: address(compliance),
            deployedAt: block.timestamp,
            totalSupply: totalSupply
        });

        allTokens.push(address(token));
        tokenCount++;

        emit TokenSuiteDeployed(assetId, address(token), address(compliance), totalSupply);
    }

    function getTokenByAssetId(bytes32 assetId) external view returns (TokenSuite memory) {
        return deployedTokens[assetId];
    }

    function getAllTokens() external view returns (address[] memory) {
        return allTokens;
    }
}
