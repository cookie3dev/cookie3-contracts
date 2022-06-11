// SPDX-License-Identifier: MIT

import { Ownable } from "../helpers/Ownable.sol";
import { IERC20 } from "../interfaces/IERC20.sol";
import { SafeERC20 } from "../libraries/SafeERC20.sol";

pragma solidity 0.8.12;

/**
 * @title Periodic Staking contract
 *
 * @notice Staking contract allows stake ERC-20 token and get rewards in the same token. User choose
 * and join to one of previously created by the owner Staking Pools.
 *
 * Every time when user join as new staker, lock time restriction is calculated and assigned to user stake.
 * User can claim his staked tokens with rewards only after lock time. User can withdraw his staked tokens
 * before lock time, but in this case all rewards are returned to the reward distributor. Additionally if
 * fee is greater than 0% in given Staking Pool, then penalty fee calculated from the staked tokens is sent
 * to the fee collector.
 */
contract PeriodicStaking is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Reward distributor address
    address public rewardDistributor;
    /// @notice Fee collector address
    address public feeCollector;

    /// @notice Stake and reward token address
    address public immutable stakingToken;

    /// @dev Id of last added stake
    uint256 private stakeNonce;
    /// @dev Total amount of all Staking Pools
    uint256 private totalStakingPools;

    /// @dev Constant value used to calculate reward rate
    uint256 private constant YEAR = 365 days;

    /// @dev Staking Pool struct
    struct StakingPool {
        /// @notice Minimum value needed to stake
        uint256 minimumToStake;
        /// @notice APR - Annual Percentage Rate
        uint256 apr;
        /// @notice Period after which user can unstake his tokens without any additional fee
        uint256 lockPeriod;
        /// @notice Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
        uint256 unstakeFee;
    }

    /// @dev Stake struct. This object is created every time, when user add his tokens to the contract
    struct Stake {
        /// @dev Id of the Staking Pool to which Stake belongs
        uint256 stakingPoolId;
        /// @notice Timestamp of Stake start time
        uint256 startTime;
        /// @notice Amount of staked tokens in the given Stake
        uint256 stakedTokens;
        /// @notice APR - Annual Percentage Rate
        uint256 apr;
        /// @notice Timestamp to which user cannot unstake his tokens without additional fee
        uint256 lockTime;
    }

    /// @dev StakeDTO struct. This object is return in view function to dApp with all needed data.
    struct StakeDTO {
        /// @dev Id of the Staking Pool to which Stake belongs
        uint256 stakingPoolId;
        /// @notice Timestamp of Stake start time
        uint256 startTime;
        /// @notice Amount of staked tokens in the given Stake
        uint256 stakedTokens;
        /// @notice APR - Annual Percentage Rate
        uint256 apr;
        /// @notice Timestamp to which user cannot unstake his tokens without additional fee
        uint256 lockTime;
        /// @notice Earned rewards to the last block
        uint256 earned;
        /// @notice Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
        uint256 unstakeFee;
    }

    /// @notice Staking Pools. Id => Staking Pool
    mapping(uint256 => StakingPool) public stakingPools;
    /// @notice User Stakes. Address => Stake Id => Stake
    mapping(address => mapping(uint256 => Stake)) public userStake;
    /// @notice All user Stakes ids
    mapping(address => uint256[]) private userStakeIds;

    /**
     * @dev Emitted when reward distributor address is updated
     * @param newRewardDistributor New reward distributor address
     */
    event RewardsDistributorUpdated(address newRewardDistributor);

    /**
     * @dev Emitted when fee collector address is updated
     * @param newFeeCollector New fee collector address
     */
    event FeeCollectorUpdated(address newFeeCollector);

    /**
     * @dev Emitted when new Staking Pool is added
     * @param stakingPoolId Staking Pool Id
     * @param minimumToStake Minimum value needed to stake
     * @param apr APR - Annual Percentage Rate (100 is 1%)
     * @param lockPeriod Period after which user can unstake his tokens without any additional fee
     * @param unstakeFee Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
     */
    event StakingPoolAdded(
        uint256 stakingPoolId,
        uint256 minimumToStake,
        uint256 apr,
        uint256 lockPeriod,
        uint256 unstakeFee
    );

    /**
     * @dev Emitted when Staking Pool 'minimumToStake' value is updated
     * @param stakingPoolId Staking Pool Id
     * @param minimumToStake New minimum value needed to stake
     */
    event StakingPoolMinimumToStakeUpdated(uint256 stakingPoolId, uint256 minimumToStake);

    /**
     * @dev Emitted when Staking Pool APR value is updated
     * @param stakingPoolId Staking Pool Id
     * @param apr APR - Annual Percentage Rate (100 is 1%)
     */
    event StakingPoolAprUpdated(uint256 stakingPoolId, uint256 apr);

    /**
     * @dev Emitted when Staking Pool lock period value is updated
     * @param stakingPoolId Staking Pool Id
     * @param lockPeriod Period after which user can unstake his tokens without any additional fee
     */
    event StakingPoolLockPeriodUpdated(uint256 stakingPoolId, uint256 lockPeriod);

    /**
     * @dev Emitted when Staking Pool unstake fee value is updated
     * @param stakingPoolId Staking Pool Id
     * @param unstakeFee Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
     */
    event StakingPoolUnstakeFeeUpdated(uint256 stakingPoolId, uint256 unstakeFee);

    /**
     * @dev Emitted when user add new stake to the contract
     * @param user Staker address
     * @param stakeId Stake Id
     * @param stakingPoolId Staking Pool Id for which Stake belongs
     * @param startTime Timestamp when stake has been added to the contract
     * @param lockTime Timestamp to which user cannot unstake his tokens without additional fee
     * @param apr APR - Annual Percentage Rate
     * @param tokensAmount Amount of tokens added to the contract
     */
    event StakeAdded(
        address indexed user,
        uint256 indexed stakeId,
        uint256 stakingPoolId,
        uint256 startTime,
        uint256 lockTime,
        uint256 apr,
        uint256 tokensAmount
    );

    /**
     * @dev Emitted when user claim his staked tokens with rewards from the contract
     * @param user Staker address
     * @param stakeId Stake Id
     * @param tokens User staked tokens
     * @param rewards Earned rewards
     */
    event Claim(address indexed user, uint256 indexed stakeId, uint256 tokens, uint256 rewards);

    /**
     * @dev Emitted when user unstake his tokens before lock time with fee
     * @param user Staker address
     * @param stakeId Stake Id
     * @param tokens Amount of tokens sent to the user
     * @param fee Total amount of penalty fee tokens sent to the fee collector
     */
    event UnstakeWithFee(address indexed user, uint256 indexed stakeId, uint256 tokens, uint256 fee);

    /**
     * @dev Validates if stake for given user and stake id exists
     * @param user Staker address
     * @param stakeId Stake Id
     */
    modifier hasStake(address user, uint256 stakeId) {
        require(userStake[user][stakeId].startTime > 0, "Stake doesn't exist");
        _;
    }

    /**
     * @dev Validates if Staking Pool exists
     * @param stakingPoolId Staking Pool Id
     */
    modifier doesStakingPoolExist(uint256 stakingPoolId) {
        require(stakingPoolId <= totalStakingPools, "Staking Pool doesn't exist");
        _;
    }

    constructor(address _stakingToken) {
        require(_stakingToken != address(0), "_stakingToken address(0)");

        stakingToken = _stakingToken;
    }

    /**
     * @notice One-time initialization contract function
     *
     * @dev Validations :
     * - All of parameters value in this function cannot be zero address
     * - Only contract owner can perform this function
     *
     * @param _rewardDistributor Address of the reward distributor
     * @param _feeCollector Address for which fee will be send
     */
    function init(address _rewardDistributor, address _feeCollector) external onlyOwner {
        require(_rewardDistributor != address(0), "_rewardDistributor address(0)");
        require(_feeCollector != address(0), "_feeCollector address(0)");

        rewardDistributor = _rewardDistributor;
        feeCollector = _feeCollector;
    }

    /**
     * @notice Allows to update reward distributor address
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Reward distributor cannot be zero address
     *
     * Emits a 'RewardsDistributorUpdated' event.
     *
     * @param _rewardDistributor New reward distributor address
     */
    function updateRewardDistributor(address _rewardDistributor) external onlyOwner {
        require(_rewardDistributor != address(0), "_rewardDistributor address(0)");
        rewardDistributor = _rewardDistributor;

        emit RewardsDistributorUpdated(_rewardDistributor);
    }

    /**
     * @notice Allows to update fee collector address
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Fee collector cannot be zero address
     *
     * Emits a 'FeeCollectorUpdated' event.
     *
     * @param _feeCollector New fee collector address
     */
    function updateFeeCollector(address _feeCollector) external onlyOwner {
        require(_feeCollector != address(0), "_feeCollector address(0)");
        feeCollector = _feeCollector;

        emit FeeCollectorUpdated(_feeCollector);
    }

    /**
     * @notice Adds new Staking Pool to the contract.
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     *
     * Staking Pool Id is assign automatically.
     *
     * Emits a 'StakingPoolAdded' event.
     *
     * @param _minimumToStake Minimum value needed to stake
     * @param _apr APR - Annual Percentage Rate (100 is 1%)
     * @param _lockPeriod Period after which user can unstake his tokens without any additional fee
     * @param _unstakeFee Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
     */
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

        emit StakingPoolAdded(totalStakingPools, _minimumToStake, _apr, _lockPeriod, _unstakeFee);
    }

    /**
     * @notice Allows to update Staking Pool minimum to stake value
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Staking Pool with id given in 'stakingPoolId' must exists
     *
     * Emits a 'StakingPoolMinimumToStakeUpdated' event.
     *
     * @param stakingPoolId Staking Pool Id
     * @param _minimumToStake Minimum value needed to stake
     */
    function updateStakingPoolMinimumToStake(uint256 stakingPoolId, uint256 _minimumToStake)
        external
        onlyOwner
        doesStakingPoolExist(stakingPoolId)
    {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.minimumToStake = _minimumToStake;

        emit StakingPoolMinimumToStakeUpdated(stakingPoolId, _minimumToStake);
    }

    /**
     * @notice Updates APR in the given Staking Pool.
     *
     * Note that APR update in the Staking Pool doesn't recalculate reward rate for all Stakes in
     * the given Staking Pool.
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Staking Pool with id given in 'stakingPoolId' must exists
     *
     * @param stakingPoolId Staking Pool Id
     * @param _apr APR - Annual Percentage Rate (100 is 1%)
     */
    function updateStakingPoolApr(uint256 stakingPoolId, uint256 _apr)
        external
        onlyOwner
        doesStakingPoolExist(stakingPoolId)
    {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.apr = _apr;

        emit StakingPoolAprUpdated(stakingPoolId, _apr);
    }

    /**
     * @notice Updates lock period in the given Staking Pool.
     *
     * Note that lock period update in the Staking Pool doesn't change 'lockTime' time in
     * Stakes in the given Staking Pool
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Staking Pool with id given in 'stakingPoolId' must exists
     *
     * @param stakingPoolId Staking Pool Id
     * @param _lockPeriod Period after which user can unstake his tokens without any additional fee
     */
    function updateStakingPoolLockPeriod(uint256 stakingPoolId, uint256 _lockPeriod)
        external
        onlyOwner
        doesStakingPoolExist(stakingPoolId)
    {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.lockPeriod = _lockPeriod;

        emit StakingPoolLockPeriodUpdated(stakingPoolId, _lockPeriod);
    }

    /**
     * @notice Updates unstake fee in the given Staking Pool.
     *
     * Note that unstake fee update in the Staking Pool change 'unstakeFee' in
     * Stakes in the given Staking Pool.
     *
     * @dev Validations :
     * - Only contract owner can perform this function
     * - Staking Pool with id given in 'stakingPoolId' must exists
     *
     * @param stakingPoolId Staking Pool Id
     * @param _unstakeFee Amount of fee charged when user withdraw tokens before 'lockTime'. 100 is 1%
     */
    function updateStakingPoolUnstakeFee(uint256 stakingPoolId, uint256 _unstakeFee)
        external
        onlyOwner
        doesStakingPoolExist(stakingPoolId)
    {
        StakingPool storage stakingPool = stakingPools[stakingPoolId];
        stakingPool.unstakeFee = _unstakeFee;

        emit StakingPoolUnstakeFeeUpdated(stakingPoolId, _unstakeFee);
    }

    /**
     * @notice Allows user to add his tokens to staking contract.
     *
     * Note that user must first perform 'approve' function which allows to add his tokens to this
     * staking contract.
     *
     * @dev Validations :
     * - Function is protected against Reentrancy Attacks
     * - Staking Pool with id given in 'stakingPoolId' must exists
     * - Amount of tokens which user want to add to staking contract must be greater than minimum possible value
     * - User must have amount of tokens which he wants to stake on his wallet
     *
     * Emits a 'StakeAdded' event.
     *
     * @param stakingPoolId Staking Pool Id
     * @param amount Amount of tokens which user wants to stake in the staking contract
     */
    function addStake(uint256 stakingPoolId, uint256 amount) external doesStakingPoolExist(stakingPoolId) {
        require(amount >= stakingPools[stakingPoolId].minimumToStake, "Too low amount");

        uint256 stakeId = ++stakeNonce;

        StakingPool memory stakingPool = stakingPools[stakingPoolId];
        Stake storage stake = userStake[msg.sender][stakeId];

        stake.stakingPoolId = stakingPoolId;
        stake.startTime = block.timestamp;
        stake.stakedTokens = amount;
        stake.apr = stakingPool.apr;
        stake.lockTime = block.timestamp + stakingPool.lockPeriod;

        userStakeIds[msg.sender].push(stakeId);

        emit StakeAdded(msg.sender, stakeId, stake.stakingPoolId, stake.startTime, stake.lockTime, stake.apr, amount);

        uint256 rewardsToLock = _calculateRewardRate(stakingPool.apr, amount) * stakingPool.lockPeriod;
        _transferFrom(stakingToken, rewardDistributor, address(this), rewardsToLock);

        _transferFrom(stakingToken, msg.sender, address(this), amount);
    }

    /**
     * @notice Allows user to claim his tokens with earned rewards from the staking contract.
     *
     * @dev Validations :
     * - Function is protected against Reentrancy Attacks
     * - Stake for given id must exists
     * - 'lockTime' for the given Stake must be lower than actual block.timestamp
     *
     * Emits a 'Claim' event.
     *
     * @param stakeId Stake Id for which user want to unstake tokens
     */
    function claim(uint256 stakeId) external hasStake(msg.sender, stakeId) {
        Stake memory stake = userStake[msg.sender][stakeId];
        require(block.timestamp >= stake.lockTime, "Cannot before lock time");

        uint256 rewards = _calculateRewards(stake.startTime, stake.lockTime, stake.apr, stake.stakedTokens);
        uint256 tokens = stake.stakedTokens;

        _deleteStake(stakeId);

        emit Claim(msg.sender, stakeId, tokens, rewards);

        _transfer(stakingToken, msg.sender, tokens + rewards);
    }

    /**
     * @notice Allows user to unstake only staked tokens with penalty fee and without rewards.
     *
     * @dev Validations :
     * - Function is protected against Reentrancy Attacks
     * - Stake for given id must exists
     * - 'lockTime' for the given Stake must be greater than actual block.timestamp
     *
     * Emits a 'UnstakeWithFee' event.
     *
     * @param stakeId Stake Id for which user want to unstake emergency tokens
     */
    function unstakeWithFee(uint256 stakeId) external hasStake(msg.sender, stakeId) {
        Stake memory stake = userStake[msg.sender][stakeId];
        require(block.timestamp < stake.lockTime, "Can claim without fee");

        uint256 fee = (stake.stakedTokens * stakingPools[stake.stakingPoolId].unstakeFee) / 10000;
        uint256 tokens = stake.stakedTokens - fee;

        _deleteStake(stakeId);

        emit UnstakeWithFee(msg.sender, stakeId, tokens, fee);

        _returnRewardsToRewardDistributor(stake.startTime, stake.lockTime, stake.apr, stake.stakedTokens);

        if (fee > 0) {
            _transfer(stakingToken, feeCollector, fee);
        }

        _transfer(stakingToken, msg.sender, tokens);
    }

    /**
     * @notice Allows to get all user StakeDTO
     *
     * @param user User address
     *
     * @return Array of StakeDTO
     */
    function getAllStakesDTOForUser(address user) external view returns (StakeDTO[] memory) {
        uint256[] memory stakeIds = userStakeIds[user];
        StakeDTO[] memory userStakes = new StakeDTO[](stakeIds.length);

        for (uint256 i = 0; i < stakeIds.length; i++) {
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

    /**
     * @dev Internal function that allows to remove Stake.
     *
     * @param stakeId Stake Id which will be deleted
     */
    function _deleteStake(uint256 stakeId) private {
        delete userStake[msg.sender][stakeId];
        _deleteFromUserStakeIds(msg.sender, stakeId);
    }

    /**
     * @dev Internal function that allows remove reward tokens to the reward distributor
     *
     * @param rewardStartTime Rewards earning start time
     * @param rewardEndTime Rewards earning end time
     * @param apr APR - Annual Percentage Rate
     * @param tokens Tokens amount for which rewards to return must be calculated
     */
    function _returnRewardsToRewardDistributor(
        uint256 rewardStartTime,
        uint256 rewardEndTime,
        uint256 apr,
        uint256 tokens
    ) private {
        _transfer(stakingToken, rewardDistributor, _calculateRewards(rewardStartTime, rewardEndTime, apr, tokens));
    }

    /**
     * @notice Internal function which calculated amount of earned tokens for the given Stake.
     *
     * @param user User address
     * @param stakeId Stake Id
     *
     * @return Returns earned tokens in 'uint256' format
     */
    function earned(address user, uint256 stakeId) private view returns (uint256) {
        Stake memory stake = userStake[user][stakeId];
        uint256 toTime = block.timestamp > stake.lockTime ? stake.lockTime : block.timestamp;

        return _calculateRewards(stake.startTime, toTime, stake.apr, stake.stakedTokens);
    }

    /**
     * @dev Internal function that allows to remove Stake id from 'userStakeIds' state variable. This
     * function search array for the given user. When 'stakeId' value is found, last value from the array is
     * moved to the index where 'stakeId' was found and array length is decrease by 1.
     *
     * @param user User for which stake is deleted
     * @param stakeId Stake Id which will be deleted
     */
    function _deleteFromUserStakeIds(address user, uint256 stakeId) private {
        uint256 arrLength = userStakeIds[user].length;

        if (arrLength > 1) {
            for (uint256 i = 0; i < arrLength; i++) {
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

    /**
     * @dev Internal function that verifies APR and calculate reward rate for the given tokens amount
     * and APR, or set zero value if APR is equal zero.
     *
     * @param apr APR - Annual Percentage Rate
     * @param tokens Tokens amount for which reward rate should be calculated
     *
     * @return Returns calculated reward rate
     */
    function _calculateRewardRate(uint256 apr, uint256 tokens) private pure returns (uint256) {
        return (tokens * apr) / YEAR / 10000;
    }

    /**
     * @dev Internal function that calculates Stake rewards.
     *
     * @param startTime Stake start timestamp
     * @param toTime Timestamp to which rewards must be calculated
     * @param apr APR - Annual Percentage Rate
     * @param tokens Amount of tokens for which reward must be calculated
     *
     * @return Returns calculated rewards
     */
    function _calculateRewards(
        uint256 startTime,
        uint256 toTime,
        uint256 apr,
        uint256 tokens
    ) private pure returns (uint256) {
        return _calculateRewardRate(apr, tokens) * (toTime - startTime);
    }

    /**
     * @dev Internal function that uses ERC-20 'transferFrom' function.
     *
     * @param token ERC20 token address
     * @param from Address from which tokens will be transferred
     * @param to Address to which tokens will be transferred
     * @param amount Amount of transferred tokens
     */
    function _transferFrom(
        address token,
        address from,
        address to,
        uint256 amount
    ) private {
        IERC20(token).safeTransferFrom(from, to, amount);
    }

    /**
     * @dev Internal function to transfer ERC20 tokens from staking contract to other addresses.
     *
     * @param token ERC20 token address
     * @param to Address to which tokens will be send
     * @param amount Amount of tokens which will be send
     */
    function _transfer(
        address token,
        address to,
        uint256 amount
    ) private {
        IERC20(token).safeTransfer(to, amount);
    }
}
