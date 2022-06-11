// SPDX-License-Identifier: MIT

pragma solidity 0.8.12;

import { StableMath } from "../libraries/StableMath.sol";
import { IERC20 } from "../interfaces/IERC20.sol";
import { Ownable } from "../helpers/Ownable.sol";
import { Lockable } from "../helpers/Lockable.sol";

/**
 * @title   Vesting
 * @notice  Vesting contract
 * @dev     Vesting is constantly releasing vested tokens every block every second
 */
contract Vesting is Ownable, Lockable {
    using StableMath for uint256;

    /// @notice address of vested token
    address public token;
    /// @notice total tokens vested in contract
    uint256 public totalVested;
    /// @notice total tokens already claimed form vesting
    uint256 public totalClaimed;

    struct Vest {
        uint256 dateStart; // start of claiming, can claim startTokens
        uint256 dateEnd; // after it all tokens can be claimed
        uint256 totalTokens; // total tokens to claim
        uint256 startTokens; // tokens to claim on start
        uint256 claimedTokens; // tokens already claimed
        uint256 cliffLength;
    }
    /// @notice storage of vestings
    Vest[] internal vestings;
    /// @notice map of vestings for user
    mapping(address => uint256[]) internal user2vesting;

    /// @dev events
    event Claimed(address indexed user, uint256 amount);
    event Vested(address indexed user, uint256 totalAmount, uint256 endDate);

    /**
     * @dev Contract initiator
     * @param _token address of vested token
     */
    function init(address _token) external onlyOwner {
        require(_token != address(0), "_token address cannot be 0");
        require(token == address(0), "init already done");
        token = _token;
    }

    /**
     * @dev Add multiple vesting to contract by arrays of data
     * @param _users[] addresses of holders
     * @param _startTokens[] tokens that can be withdrawn at startDate
     * @param _totalTokens[] total tokens in vesting
     * @param _startDate date from when tokens can be claimed
     * @param _cliff cliff length after TGE initial distribution
     * @param _duration duration of the vesting after the cliff
     */
    function massAddHolders(
        address[] calldata _users,
        uint256[] calldata _startTokens,
        uint256[] calldata _totalTokens,
        uint256 _startDate,
        uint256 _cliff,
        uint256 _duration
    ) external onlyOwner whenNotLocked {
        uint256 len = _users.length; //cheaper to use one variable
        require((len == _startTokens.length) && (len == _totalTokens.length), "data size mismatch");

        uint256 vested = 0;

        for (uint256 i = 0; i < len; i++) {
            _addHolder(_users[i], _startTokens[i], _totalTokens[i], _startDate, _cliff, _duration);
            vested += _totalTokens[i];
        }

        totalVested += vested;
    }

    /**
     * @dev Add new vesting to contract
     * @param _user address of a holder
     * @param _startTokens how many tokens are claimable at start date
     * @param _totalTokens total number of tokens in added vesting
     * @param _startDate date from when tokens can be claimed
     * @param _cliff cliff length after TGE initial distribution
     * @param _duration duration of the vesting after the cliff
     */
    function _addHolder(
        address _user,
        uint256 _startTokens,
        uint256 _totalTokens,
        uint256 _startDate,
        uint256 _cliff,
        uint256 _duration
    ) internal {
        require(_user != address(0), "user address cannot be 0");

        Vest memory v = Vest({
            dateStart: _startDate,
            dateEnd: (_startDate + _cliff + _duration),
            totalTokens: _totalTokens,
            startTokens: _startTokens,
            claimedTokens: 0,
            cliffLength: _cliff
        });

        vestings.push(v);
        user2vesting[_user].push(vestings.length); // we are skipping index "0" for reasons
        emit Vested(_user, v.totalTokens, v.dateEnd);
    }

    /**
     * @dev Claim tokens from msg.sender vestings
     */
    function claim() external {
        _claim(msg.sender, msg.sender);
    }

    /**
     * @dev Claim tokens from msg.sender vestings to external address
     * @param _target transfer address for claimed tokens
     */
    function claimTo(address _target) external {
        _claim(msg.sender, _target);
    }

    /**
     * @dev internal claim function
     * @param _user address of holder
     * @param _target where tokens should be send
     * @return amt number of tokens claimed
     */
    function _claim(address _user, address _target) internal returns (uint256 amt) {
        require(_target != address(0), "claim, then burn");
        uint256 len = user2vesting[_user].length;
        require(len > 0, "no vestings for user");

        for (uint256 i = 0; i < len; i++) {
            Vest storage v = vestings[user2vesting[_user][i] - 1];
            uint256 cl = _claimable(v);
            v.claimedTokens += cl;
            amt += cl;
        }

        if (amt > 0) {
            totalClaimed += amt;
            emit Claimed(_user, amt);

            _transfer(_target, amt);
        } else revert("nothing to claim");
    }

    /**
     * @dev Internal function to send out claimed tokens
     * @param _user address that we send tokens
     * @param _amt amount of tokens
     */
    function _transfer(address _user, uint256 _amt) internal {
        require(IERC20(token).transfer(_user, _amt), "token transfer failed");
    }

    /**
     * @dev Count how many tokens can be claimed from vesting to date
     * @param _vesting Vesting object
     * @return canWithdraw number of tokens
     */
    function _claimable(Vest memory _vesting) internal view returns (uint256 canWithdraw) {
        uint256 currentTime = block.timestamp;
        uint256 cliffTime = _vesting.dateStart + _vesting.cliffLength;

        // not started
        if (_vesting.dateStart > currentTime) return 0;

        if (currentTime <= cliffTime) {
            // we are after start but before cliff
            canWithdraw = _vesting.startTokens;
        } else if (currentTime > cliffTime && currentTime < _vesting.dateEnd) {
            // we are somewhere in the middle

            // how much time passed (as fraction * 10^18)
            // timeRatio = (time passed * 1e18) / duration
            uint256 timeRatio = (currentTime - cliffTime).divPrecisely(_vesting.dateEnd - cliffTime);
            // how much tokens we can get in total to date
            canWithdraw = (_vesting.totalTokens - _vesting.startTokens).mulTruncate(timeRatio) + _vesting.startTokens;
        }
        // time has passed, we can take all tokens
        else {
            canWithdraw = _vesting.totalTokens;
        }
        // but maybe we take something earlier?
        canWithdraw -= _vesting.claimedTokens;
    }

    /**
     * @dev Read number of claimable tokens by user and vesting no
     * @param _user address of holder
     * @param _id his vesting number (starts from 0)
     * @return amount number of tokens
     */
    function getClaimable(address _user, uint256 _id) external view returns (uint256 amount) {
        amount = _claimable(vestings[user2vesting[_user][_id] - 1]);
    }

    /**
     * @dev Read total amount of tokens that user can claim to date from all vestings
     *      Function also includes tokens to claim from sale contracts that were not
     *      yet initiated for user.
     * @param _user address of holder
     * @return amount number of tokens
     */
    function getAllClaimable(address _user) external view returns (uint256 amount) {
        uint256 len = user2vesting[_user].length;
        for (uint256 i = 0; i < len; i++) {
            amount += _claimable(vestings[user2vesting[_user][i] - 1]);
        }
    }

    struct VestReturn {
        uint256 dateStart; // start of claiming, can claim startTokens
        uint256 dateEnd; // after it all tokens can be claimed
        uint256 totalTokens; // total tokens to claim
        uint256 startTokens; // tokens to claim on start
        uint256 claimedTokens; // tokens already claimed
    }

    /**
     * @dev Extract all the vestings for the user
     *      Also extract not initialized vestings from
     *      sale contracts.
     * @param _user address of holder
     * @return v array of Vest objects
     */
    function getVestings(address _user) external view returns (VestReturn[] memory) {
        uint256 len = user2vesting[_user].length;
        VestReturn[] memory v = new VestReturn[](len);

        for (uint256 i = 0; i < len; i++) {
            v[i].dateStart = vestings[user2vesting[_user][i] - 1].dateStart;
            v[i].dateEnd = vestings[user2vesting[_user][i] - 1].dateEnd;
            v[i].totalTokens = vestings[user2vesting[_user][i] - 1].totalTokens;
            v[i].startTokens = vestings[user2vesting[_user][i] - 1].startTokens;
            v[i].claimedTokens = vestings[user2vesting[_user][i] - 1].claimedTokens;
        }

        return v;
    }

    /**
     * @dev Read total number of vestings registered
     * @return number of registered vestings on contract
     */
    function getVestingsCount() external view returns (uint256) {
        return vestings.length;
    }

    /**
     * @dev Read single registered vesting entry
     * @param _id index of vesting in storage
     * @return Vest object
     */
    function getVestingByIndex(uint256 _id) external view returns (VestReturn memory) {
        return
            VestReturn({
                dateStart: vestings[_id].dateStart,
                dateEnd: vestings[_id].dateEnd,
                totalTokens: vestings[_id].totalTokens,
                startTokens: vestings[_id].startTokens,
                claimedTokens: vestings[_id].claimedTokens
            });
    }

    /**
     * @dev Read registered vesting list by range from-to
     * @param _start first index
     * @param _end last index
     * @return array of Vest objects
     */
    function getVestingsByRange(uint256 _start, uint256 _end) external view returns (VestReturn[] memory) {
        uint256 cnt = _end - _start + 1;
        uint256 len = vestings.length;
        require(_end < len, "range error");
        VestReturn[] memory v = new VestReturn[](cnt);

        for (uint256 i = 0; i < cnt; i++) {
            v[i].dateStart = vestings[_start + i].dateStart;
            v[i].dateEnd = vestings[_start + i].dateEnd;
            v[i].totalTokens = vestings[_start + i].totalTokens;
            v[i].startTokens = vestings[_start + i].startTokens;
            v[i].claimedTokens = vestings[_start + i].claimedTokens;
        }

        return v;
    }

    /**
     * @dev Recover ETH from contract to owner address.
     */
    function recoverETH() external onlyOwner {
        payable(owner).transfer(address(this).balance);
    }

    /**
     * @dev Recover given ERC20 token from contract to owner address.
     *      Can't recover vested tokens.
     * @param _token address of ERC20 token to recover
     */
    function recoverErc20(address _token) external onlyOwner {
        require(_token != token, "not allowed");
        uint256 amt = IERC20(_token).balanceOf(address(this));
        require(amt > 0, "nothing to recover");
        IBadErc20(_token).transfer(owner, amt);
    }
}

/**
 * @title IBadErc20
 * @dev Interface for emergency recover any ERC20-tokens,
 *      even non-erc20-compliant like USDT not returning boolean
 */
interface IBadErc20 {
    function transfer(address _recipient, uint256 _amount) external;
}
