// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

contract OwnableData {
    address public owner;
    address public pendingOwner;
}

contract Ownable is OwnableData {
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev `owner` defaults to msg.sender on construction.
     */
    constructor() {
        _setOwner(msg.sender);
    }

    /**
     * @dev Transfers ownership to `newOwner`. Either directly or claimable by the new pending owner.
     *      Can only be invoked by the current `owner`.
     * @param newOwner Address of the new owner.
     * @param direct True if `_newOwner` should be set immediately. False if `_newOwner` needs to use `claimOwnership`.
     */
    function transferOwnership(address newOwner, bool direct) external onlyOwner {
        require(newOwner != address(0), "zero address");

        if (direct) {
            _setOwner(newOwner);
        } else {
            pendingOwner = newOwner;
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions anymore. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby removing any functionality that is only available to the owner.
     */
    function renounceOwnership() external onlyOwner {
        _setOwner(address(0));
    }

    /**
     * @dev Needs to be called by `pendingOwner` to claim ownership.
     */
    function claimOwnership() external {
        require(msg.sender == pendingOwner, "caller != pending owner");

        _setOwner(pendingOwner);
    }

    /**
     * @dev Throws if called by any account other than the Owner.
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "caller is not the owner");
        _;
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Set pendingOwner to address(0)
     * Internal function without access restriction.
     */
    function _setOwner(address newOwner) internal {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
        pendingOwner = address(0);
    }
}
