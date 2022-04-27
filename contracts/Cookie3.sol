// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import { ERC20 } from "./ERC20.sol";
import { Ownable } from "./helpers/Ownable.sol";
import { TransactionThrottler } from "./helpers/TransactionThrottler.sol";

contract Cookie3 is Ownable, ERC20, TransactionThrottler {
    constructor(address _owner) ERC20("Cookie3", "COOKIE", 18) {
        _setOwner(_owner);
        _mint(_owner, 100_000_000 * 10**18);
    }

    function _transfer(
        address sender,
        address recipient,
        uint256 amount
    ) internal override transactionThrottler(sender, recipient, amount) {
        super._transfer(sender, recipient, amount);
    }
}
