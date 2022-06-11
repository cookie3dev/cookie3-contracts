// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import { Ownable } from "./Ownable.sol";

contract TransactionThrottler is Ownable {
    bool private initialized;
    bool private restrictionActive;
    uint256 private tradingStart;
    uint256 private maxTransferAmount;
    uint256 private constant delayBetweenTx = 30;
    mapping(address => uint256) private previousTx;

    mapping(address => bool) public isWhitelisted;
    mapping(address => bool) public isUnthrottled;

    event TradingTimeChanged(uint256 tradingTime);
    event RestrictionActiveChanged(bool active);
    event MaxTransferAmountChanged(uint256 maxTransferAmount);
    event MarkedWhitelisted(address indexed account, bool isWhitelisted);
    event MarkedUnthrottled(address indexed account, bool isUnthrottled);

    function initAntibot(uint256 tradingStart_, uint256 maxTransferAmount_) external onlyOwner {
        require(!initialized, "Protection: Already initialized");
        initialized = true;
        restrictionActive = true;
        tradingStart = tradingStart_;
        maxTransferAmount = maxTransferAmount_;

        isUnthrottled[owner] = true;

        emit RestrictionActiveChanged(restrictionActive);
        emit TradingTimeChanged(tradingStart);
        emit MaxTransferAmountChanged(maxTransferAmount);
        emit MarkedUnthrottled(owner, true);
    }

    function setTradingStart(uint256 time) external onlyOwner {
        require(tradingStart > block.timestamp, "Protection: To late");
        tradingStart = time;
        emit TradingTimeChanged(tradingStart);
    }

    function setMaxTransferAmount(uint256 amount) external onlyOwner {
        maxTransferAmount = amount;
        emit MaxTransferAmountChanged(maxTransferAmount);
    }

    function setRestrictionActive(bool active) external onlyOwner {
        restrictionActive = active;
        emit RestrictionActiveChanged(restrictionActive);
    }

    function unthrottleAccount(address account, bool unthrottled) external onlyOwner {
        require(account != address(0), "zero address");
        isUnthrottled[account] = unthrottled;
        emit MarkedUnthrottled(account, unthrottled);
    }

    function whitelistAccount(address account, bool whitelisted) external onlyOwner {
        require(account != address(0), "zero address");
        isWhitelisted[account] = whitelisted;
        emit MarkedWhitelisted(account, whitelisted);
    }

    modifier transactionThrottler(
        address sender,
        address recipient,
        uint256 amount
    ) {
        if (restrictionActive && !isUnthrottled[recipient] && !isUnthrottled[sender]) {
            require(block.timestamp >= tradingStart, "Protection: Transfers disabled");

            if (maxTransferAmount > 0) {
                require(amount <= maxTransferAmount, "Protection: Limit exceeded");
            }

            if (!isWhitelisted[recipient]) {
                require(previousTx[recipient] + delayBetweenTx <= block.timestamp, "Protection: 30 sec/tx allowed");
                previousTx[recipient] = block.timestamp;
            }

            if (!isWhitelisted[sender]) {
                require(previousTx[sender] + delayBetweenTx <= block.timestamp, "Protection: 30 sec/tx allowed");
                previousTx[sender] = block.timestamp;
            }
        }
        _;
    }
}
