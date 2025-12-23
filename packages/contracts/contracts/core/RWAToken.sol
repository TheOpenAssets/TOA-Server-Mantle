// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./ComplianceModule.sol";

contract RWAToken is ERC20 {
    bytes32 public assetId;
    ComplianceModule public compliance;
    address public identityRegistry;
    address public issuer;
    address public owner;
    bool public paused;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier whenNotPaused() {
        require(!paused, "Token paused");
        _;
    }

    constructor(
        bytes32 _assetId,
        address _compliance,
        address _identityRegistry,
        uint256 _totalSupply,
        address _platformCustody,
        string memory _name,
        string memory _symbol,
        address _issuer
    ) ERC20(_name, _symbol) {
        owner = msg.sender;
        assetId = _assetId;
        compliance = ComplianceModule(_compliance);
        identityRegistry = _identityRegistry;
        issuer = _issuer;
        
        _mint(_platformCustody, _totalSupply);
    }

    function _update(address from, address to, uint256 amount) internal virtual override {
        if (!paused && from != address(0) && to != address(0)) {
             require(compliance.canTransfer(from, to, amount), "Compliance check failed");
        }
        super._update(from, to, amount);
    }

    function forcedTransfer(address from, address to, uint256 amount) external onlyOwner {
        _transfer(from, to, amount);
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    function setCompliance(address _compliance) external onlyOwner {
        compliance = ComplianceModule(_compliance);
    }
}
