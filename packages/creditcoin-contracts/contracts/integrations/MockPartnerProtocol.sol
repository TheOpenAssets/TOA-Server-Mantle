// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MockPartnerProtocol
 * @notice Demo partner contract representing an external lending protocol (e.g. "Aave Demo").
 *
 * The Open Assets platform (owner) calls:
 *   - recordLoan()  after disbursing USDC to this contract on behalf of a user
 *   - repay()       when a user repays their loan through the platform
 *
 * Both actions emit events visible on the Creditcoin testnet explorer, making the
 * full borrow/repay lifecycle verifiable on-chain.
 */
contract MockPartnerProtocol {
    address public owner;

    struct Loan {
        address user;
        uint256 amount;
        uint256 disbursedAt;
        uint256 repaidAt;
        bool repaid;
    }

    mapping(bytes32 => Loan) public loans;
    mapping(address => bytes32[]) private _userLoanIds;

    event LoanDisbursed(
        address indexed user,
        uint256 amount,
        bytes32 indexed loanId,
        uint256 timestamp
    );

    event LoanRepaid(
        address indexed user,
        uint256 amount,
        bytes32 indexed loanId,
        uint256 timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "MockPartner: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    /**
     * @notice Record a loan disbursement. Called by platform after transferring USDC.
     * @param user      Borrower wallet address
     * @param amount    Amount disbursed in USDC (6 decimals)
     * @param loanId    Unique loan identifier (keccak256 of partner loan ID string)
     */
    function recordLoan(
        address user,
        uint256 amount,
        bytes32 loanId
    ) external onlyOwner {
        require(user != address(0), "MockPartner: zero address");
        require(amount > 0, "MockPartner: zero amount");
        require(loans[loanId].amount == 0, "MockPartner: loan already exists");

        loans[loanId] = Loan({
            user: user,
            amount: amount,
            disbursedAt: block.timestamp,
            repaidAt: 0,
            repaid: false
        });

        _userLoanIds[user].push(loanId);

        emit LoanDisbursed(user, amount, loanId, block.timestamp);
    }

    /**
     * @notice Record a loan repayment. Called by platform after receiving repayment.
     * @param loanId    Loan identifier
     */
    function repay(bytes32 loanId) external onlyOwner {
        Loan storage loan = loans[loanId];
        require(loan.amount > 0, "MockPartner: loan not found");
        require(!loan.repaid, "MockPartner: already repaid");

        loan.repaid = true;
        loan.repaidAt = block.timestamp;

        emit LoanRepaid(loan.user, loan.amount, loanId, block.timestamp);
    }

    /**
     * @notice Get all loan IDs for a user.
     */
    function getUserLoanIds(address user) external view returns (bytes32[] memory) {
        return _userLoanIds[user];
    }

    /**
     * @notice Get loan details by ID.
     */
    function getLoan(bytes32 loanId) external view returns (Loan memory) {
        return loans[loanId];
    }
}
