// SPDX-License-Identifier: MIT

import { Ownable } from "../helpers/Ownable.sol";
import { IERC20 } from "../interfaces/IERC20.sol";
import { SafeERC20 } from "../libraries/SafeERC20.sol";

pragma solidity 0.8.12;

contract PeriodicStaking is Ownable {
    using SafeERC20 for IERC20;

    address public rewardDistributor;
    address public feeCollector;

    address public immutable stakingToken;

    uint256 private stakeNonce;
    uint256 private totalStakingPools;

    uint256 private constant YEAR = 365 days;

    struct StakingPool {
        uint256 minimumToStake;
        uint256 apr;
        uint256 lockPeriod;
        uint256 unstakeFee;
    }

    struct Stake {
        uint256 stakingPoolId;
        uint256 startTime;
        uint256 stakedTokens;
        uint256 apr;
        uint256 lockTime;
    }

    struct StakeDTO {
        uint256 stakingPoolId;
        uint256 startTime;
        uint256 stakedTokens;
        uint256 apr;
        uint256 lockTime;
        uint256 earned;
        uint256 unstakeFee;
    }

    mapping(uint256 => StakingPool) public stakingPools;
    mapping(address => mapping(uint256 => Stake)) public userStake;
    mapping(address => uint256[]) private userStakeIds;

    event StakeAdded(
        address indexed user,
        uint256 indexed stakeId,
        uint256 stakingPoolId,
        uint256 startTime,
        uint256 lockTime,
        uint256 apr,
        uint256 tokensAmount
    );
    event Claim(address indexed user, uint256 indexed stakeId, uint256 tokens, uint256 rewards);
    event UnstakeWithFee(address indexed user, uint256 indexed stakeId, uint256 tokens, uint256 fee);

    modifier hasStake(address user, uint256 stakeId) {
        require(userStake[user][stakeId].startTime > 0, "Stake doesn't exist");
        _;
    }

    modifier doesStakingPoolExist(uint256 stakingPoolId) {
        require(stakingPoolId <= totalStakingPools, "Staking Pool doesn't exist");
        _;
    }

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "_stakingToken address(0)");

        stakingToken = _stakingToken;
    }

    function init(address _rewardDistributor, address _feeCollector) external onlyOwner {
        require(_rewardDistributor != address(0), "_rewardDistributor address(0)");
        require(_feeCollector != address(0), "_feeCollector address(0)");

        rewardDistributor = _rewardDistributor;
        feeCollector = _feeCollector;
    }

    function updateRewardDistributor(address _rewardDistributor) external onlyOwner {
        require(_rewardDistributor != address(0), "_rewardDistributor address(0)");
        rewardDistributor = _rewardDistributor;
    }

    function updateFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "_feeCollector address(0)");
        feeCollector = _feeCollector;
    }

    function addStakingPool(
        uint256 _minimumToStake,
        uint256 _apr,
        uint256 _lockPeriod,
        uint256 _unstakeFee
    ) external onlyOwner {
        StakingPool storage stakingPool = stakingPools[++totalStakingPools];

        stakingPool.minimumToStake = _minimumToStake;
        stakingPool.apr = _apr;
        stakingPool.lockPeriod = _lockPeriod;
        stakingPool.unstakeFee = _unstakeFee;
    }

    function updateStakingPoolMinimumToStake(uint256 stakingPoolId, uint256 _minimumToStake)
        external
        onlyOwner
        doesStakingPoolExist(stakingPoolId)
    {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.minimumToStake = _minimumToStake;
    }

    function updateStakingPoolApr(uint256 stakingPoolId, uint256 _apr) external onlyOwner doesStakingPoolExist(stakingPoolId) {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.apr = _apr;
    }

    function updateStakingPoolLockPeriod(uint256 stakingPoolId, uint256 _lockPeriod) external onlyOwner doesStakingPoolExist(stakingPoolId) {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.lockPeriod = _lockPeriod;
    }

    function updateStakingPoolUnstakeFee(uint256 stakingPoolId, uint256 _unstakeFee) external onlyOwner doesStakingPoolExist(stakingPoolId) {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.unstakeFee = _unstakeFee;
    }

    function addStake(uint256 stakingPoolId, uint256 amount) external doesStakingPoolExist(stakingPoolId) {
        require(amount >= stakingPools[stakingPoolId].minimumToStake, "Too low amount");

        amount = _transferFrom(stakingToken, msg.sender, address(this), amount);

        uint256 stakeId = ++stakeNonce;
        userStakeIds[msg.sender].push(stakeId);
        _setStake(stakeId, stakingPoolId, amount);

        emit StakeAdded(
            msg.sender,
            stakeId,
            stakingPoolId,
            block.timestamp,
            userStake[msg.sender][stakeId].lockTime,
            userStake[msg.sender][stakeId].apr,
            amount
        );
    }

    function claim(uint256 stakeId) external hasStake(msg.sender, stakeId) {
        Stake memory stake = userStake[msg.sender][stakeId];
        require(block.timestamp >= stake.lockTime, "Cannot before lock time");

        uint256 rewards = _calculateRewards(stake.startTime, stake.lockTime, stake.apr, stake.stakedTokens);
        uint256 tokens = stake.stakedTokens;

        _transfer(stakingToken, msg.sender, tokens + rewards);

        _deleteStake(stakeId);

        emit Claim(msg.sender, stakeId, tokens, rewards);
    }

    function unstakeWithFee(uint256 stakeId) external hasStake(msg.sender, stakeId) {
        Stake memory stake = userStake[msg.sender][stakeId];
        require(block.timestamp < stake.lockTime, "Can claim without fee");

        uint256 fee = (stake.stakedTokens * stakingPools[stake.stakingPoolId].unstakeFee) / 10000;
        uint256 tokens = stake.stakedTokens - fee;

        if (fee > 0) {
            _transfer(stakingToken, feeCollector, fee);
        }
        _transfer(stakingToken, msg.sender, tokens);

        _returnRewardsToRewardDistributor(stake.startTime, stake.lockTime, stake.apr, stake.stakedTokens);

        _deleteStake(stakeId);

        emit UnstakeWithFee(msg.sender, stakeId, tokens, fee);
    }

    function getAllStakesDTOForUser(address user) external view returns (StakeDTO[] memory) {
        uint256[] memory stakeIds = userStakeIds[user];
        StakeDTO[] memory userStakes = new StakeDTO[](stakeIds.length);

        for (uint256 i; i < stakeIds.length; i++) {
            Stake memory stake = userStake[user][stakeIds[i]];
            StakingPool memory stakingPool = stakingPools[stake.stakingPoolId];

            StakeDTO memory stakeDto = StakeDTO({
                stakingPoolId: stake.stakingPoolId,
                startTime: stake.startTime,
                stakedTokens: stake.stakedTokens,
                apr: stake.apr,
                lockTime: stake.lockTime,
                unstakeFee: stakingPool.unstakeFee,
                earned: earned(user, stakeIds[i])
            });

            userStakes[i] = stakeDto;
        }

        return userStakes;
    }

    function _setStake(
        uint256 stakeId,
        uint256 stakingPoolId,
        uint256 amount
    ) private {
        StakingPool memory stakingPool = stakingPools[stakingPoolId];
        Stake storage stake = userStake[msg.sender][stakeId];

        stake.stakingPoolId = stakingPoolId;
        stake.startTime = block.timestamp;
        stake.stakedTokens = amount;
        stake.apr = stakingPool.apr;
        stake.lockTime = block.timestamp + stakingPool.lockPeriod;

        uint256 rewardsToLock = _calculateRewardRate(stakingPool.apr, amount) * stakingPool.lockPeriod;

        require(_transferFrom(stakingToken, rewardDistributor, address(this), rewardsToLock) == rewardsToLock, "Exclude distributor from fee");
    }

    function _deleteStake(uint256 stakeId) private {
        delete userStake[msg.sender][stakeId];
        _deleteFromUserStakeIds(msg.sender, stakeId);
    }

    function _returnRewardsToRewardDistributor(
        uint256 rewardStartTime,
        uint256 rewardEndTime,
        uint256 apr,
        uint256 tokens
    ) private {
        _transfer(stakingToken, rewardDistributor, _calculateRewards(rewardStartTime, rewardEndTime, apr, tokens));
    }

    function earned(address user, uint256 stakeId) private view returns (uint256) {
        Stake memory stake = userStake[user][stakeId];
        uint256 toTime = block.timestamp > stake.lockTime ? stake.lockTime : block.timestamp;

        return _calculateRewards(stake.startTime, toTime, stake.apr, stake.stakedTokens);
    }

    function _deleteFromUserStakeIds(address user, uint256 stakeId) private {
        uint256 arrLength = userStakeIds[user].length;

        if (arrLength > 1) {
            for (uint256 i; i < arrLength; i++) {
                if (userStakeIds[user][i] == stakeId) {
                    userStakeIds[user][i] = userStakeIds[user][arrLength - 1];
                    userStakeIds[user].pop();
                    break;
                }
            }
        } else {
            userStakeIds[user].pop();
        }
    }

    function _calculateRewardRate(uint256 apr, uint256 tokens) private pure returns (uint256) {
        return (tokens * apr) / YEAR / 10000;
    }

    function _calculateRewards(
        uint256 startTime,
        uint256 toTime,
        uint256 apr,
        uint256 tokens
    ) private pure returns (uint256) {
        return _calculateRewardRate(apr, tokens) * (toTime - startTime);
    }

    function _transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private returns (uint256) {
        return IERC20(token).safeTransferFromDeluxe(from, to, amount);
    }

    function _transfer(
        address token,
        address to,
        uint256 amount
    ) private {
        IERC20(token).safeTransfer(to, amount);
    }
}
