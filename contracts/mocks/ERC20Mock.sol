// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    uint8 private _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 supply
    ) ERC20(name_, symbol_) {
        _decimals = decimals_;
        _mint(msg.sender, supply);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
