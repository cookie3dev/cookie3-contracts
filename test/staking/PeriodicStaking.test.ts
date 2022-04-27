import { waffle, ethers } from "hardhat";
import { expect } from "chai";
import {
  getBigNumber,
  setNextBlockTimestamp,
  latestBlockTimeNumber,
  createProductionStakingPools,
  createZeroMinZeroAPRZeroFeeOneMonthStakingPool,
  MONTH,
  YEAR,
  calculateRewards,
} from "../utilities";

import { toBuffer } from "ethereumjs-util";
import { signTypedData_v4 } from "eth-sig-util";

import PeriodicStakingArtifacts from "../../artifacts/contracts/staking/PeriodicStaking.sol/PeriodicStaking.json";
import ERC20MockArtifacts from "../../artifacts/contracts/mocks/ERC20Mock.sol/ERC20Mock.json";

import { PeriodicStaking, ERC20Mock } from "../../typechain";

import { Wallet, BigNumber, utils } from "ethers";

const { provider, deployContract } = waffle;

describe("'Synapse Staking Pools' Periodic Tier staking unit tests", () => {
  const [deployer, alice, bob, fee, rewardDistributor] = provider.getWallets() as Wallet[];

  let periodicStaking: PeriodicStaking;
  let tokenContract: ERC20Mock;

  let lastBlockTime: number;
  let chainId: number;

  const STAKING_POOL_NOT_EXISTS_ERR: string = "Staking Pool doesn't exist";
  const MINIMUM_TO_STAKE_ERR: string = "Too low amount";
  const STAKE_NOT_EXISTS_ERR: string = "Stake doesn't exist";
  const REQUEST_UNSTAKE_BEFORE_END_LOCK_TIME_ERR: string = "Cannot before lock time";
  const TOKEN_TRANSFER_ERR: string = "SafeERC20: Transfer failed";
  const TOKEN_TRANSFER_FROM_ERR: string = "SafeERC20: TransferFrom failed";

  const STAKE_ADDED_EVENT: string = "StakeAdded";
  const CLAIM_EVENT: string = "Claim";
  const UNSTAKE_WITH_FEE_EVENT: string = "UnstakeWithFee";

  beforeEach(async () => {
    tokenContract = (await deployContract(deployer, ERC20MockArtifacts, ["Test", "TST", 18, getBigNumber(1_000_000)])) as ERC20Mock;
    periodicStaking = (await deployContract(deployer, PeriodicStakingArtifacts, [tokenContract.address])) as PeriodicStaking;

    await tokenContract.connect(rewardDistributor).approve(periodicStaking.address, getBigNumber(200_000));
    await tokenContract.connect(alice).approve(periodicStaking.address, getBigNumber(100_000));
    await tokenContract.connect(bob).approve(periodicStaking.address, getBigNumber(100_000));

    await tokenContract.transfer(rewardDistributor.address, getBigNumber(200_000));
    await tokenContract.transfer(alice.address, getBigNumber(100_000));
    await tokenContract.transfer(bob.address, getBigNumber(100_000));

    await periodicStaking.init(rewardDistributor.address, fee.address);

    await createProductionStakingPools(periodicStaking);
  });

  describe("'addStake' function tests", () => {
    it("Should work correctly and add new stake", async () => {
      const preStakeData = await periodicStaking.userStake(alice.address, 1);
      const preUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const preStakingPoolData = await periodicStaking.stakingPools(1);
      const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const preStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();

      const stakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(stakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(1, getBigNumber(10_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 1, 1, stakeAddTime, stakeAddTime + MONTH, 500, getBigNumber(10_000));

      const postStakeData = await periodicStaking.userStake(alice.address, 1);
      const postUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postStakingPoolData = await periodicStaking.stakingPools(1);
      const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postStakerBalance = await tokenContract.balanceOf(alice.address);

      // Before perform add stake

      expect(preStakeData.stakingPoolId).to.be.equal(0);
      expect(preStakeData.startTime).to.be.equal(0);
      expect(preStakeData.stakedTokens).to.be.equal(0);
      expect(preStakeData.apr).to.be.equal(0);
      expect(preStakeData.lockTime).to.be.equal(0);

      expect(preUserStakesDTOs).to.be.empty;

      expect(preStakingPoolData.minimumToStake).to.be.equal(getBigNumber(5000));
      expect(preStakingPoolData.apr).to.be.equal(500);
      expect(preStakingPoolData.lockPeriod).to.be.equal(MONTH);
      expect(preStakingPoolData.unstakeFee).to.be.equal(1200);

      expect(preContractBalance).to.be.equal(0);

      expect(preStakerBalance).to.be.equal(getBigNumber(100_000));

      // After perform add stake

      expect(postStakeData.stakingPoolId).to.be.equal(1);
      expect(postStakeData.startTime).to.be.equal(stakeAddTime);
      expect(postStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
      expect(postStakeData.apr).to.be.equal(500);
      expect(postStakeData.lockTime).to.be.equal(stakeAddTime + MONTH);

      expect(postUserStakesDTOs.length).to.be.equal(1);
      expect(postUserStakesDTOs[0][1]).to.be.equal(stakeAddTime);

      expect(postStakingPoolData.minimumToStake).to.be.equal(getBigNumber(5000));
      expect(postStakingPoolData.apr).to.be.equal(500);
      expect(postStakingPoolData.lockPeriod).to.be.equal(MONTH);
      expect(postStakingPoolData.unstakeFee).to.be.equal(1200);

      const rewards: BigNumber = await calculateRewards(stakeAddTime, stakeAddTime + MONTH, 500, getBigNumber(10_000));
      expect(postContractBalance).to.be.equal(getBigNumber(10_000).add(rewards));

      expect(postStakerBalance).to.be.equal(getBigNumber(90_000));
    });

    it("Should work correctly and add new stake for two different stakers", async () => {
      lastBlockTime = await latestBlockTimeNumber();
      const firstStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(firstStakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(1, getBigNumber(20_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 1, 1, firstStakeAddTime, firstStakeAddTime + MONTH, 500, getBigNumber(20_000));

      const postFirstStakeData = await periodicStaking.userStake(alice.address, 1);
      const postFirstUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postFirstStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const secondStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(secondStakeAddTime);

      await expect(periodicStaking.connect(bob).addStake(8, getBigNumber(10_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(bob.address, 2, 8, secondStakeAddTime, secondStakeAddTime + MONTH * 6, 4000, getBigNumber(10_000));

      const postSecondStakeData = await periodicStaking.userStake(bob.address, 2);
      const postSecondUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(bob.address);
      const postSecondContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postSecondStakerBalance = await tokenContract.balanceOf(bob.address);

      // After perform first add stake

      expect(postFirstStakeData.stakingPoolId).to.be.equal(1);
      expect(postFirstStakeData.startTime).to.be.equal(firstStakeAddTime);
      expect(postFirstStakeData.stakedTokens).to.be.equal(getBigNumber(20_000));
      expect(postFirstStakeData.apr).to.be.equal(500);
      expect(postFirstStakeData.lockTime).to.be.equal(firstStakeAddTime + MONTH);

      expect(postFirstUserStakesDTOs.length).to.be.equal(1);
      expect(postFirstUserStakesDTOs[0][2]).to.be.equal(getBigNumber(20_000));

      const firstRewards: BigNumber = await calculateRewards(firstStakeAddTime, firstStakeAddTime + MONTH, 500, getBigNumber(20_000));
      expect(postFirstContractBalance).to.be.equal(getBigNumber(20_000).add(firstRewards));

      expect(postFirstStakerBalance).to.be.equal(getBigNumber(80_000));

      // After perform second add stake

      expect(postSecondStakeData.stakingPoolId).to.be.equal(8);
      expect(postSecondStakeData.startTime).to.be.equal(secondStakeAddTime);
      expect(postSecondStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
      expect(postSecondStakeData.apr).to.be.equal(4000);
      expect(postSecondStakeData.lockTime).to.be.equal(secondStakeAddTime + MONTH * 6);

      expect(postSecondUserStakesDTOs.length).to.be.equal(1);
      expect(postSecondUserStakesDTOs[0][2]).to.be.equal(getBigNumber(10_000));

      const secondRewards: BigNumber = await calculateRewards(secondStakeAddTime, secondStakeAddTime + MONTH * 6, 4000, getBigNumber(10_000));
      expect(postSecondContractBalance).to.be.equal(getBigNumber(30_000).add(firstRewards).add(secondRewards));

      expect(postSecondStakerBalance).to.be.equal(getBigNumber(90_000));
    });

    it("Should work correctly and add 2 stakes in 2 different pools for same staker", async () => {
      const preUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const preFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const preFirstStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const firstStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(firstStakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(3, getBigNumber(15_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 1, 3, firstStakeAddTime, firstStakeAddTime + MONTH * 6, 2000, getBigNumber(15_000));

      const postFirstStakeData = await periodicStaking.userStake(alice.address, 1);
      const postFirstUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postFirstStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const secondStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(secondStakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(15, getBigNumber(30_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 2, 15, secondStakeAddTime, secondStakeAddTime + YEAR * 2, 18000, getBigNumber(30_000));

      const postSecondStakeData = await periodicStaking.userStake(alice.address, 2);
      const postSecondUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postSecondContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postSecondStakerBalance = await tokenContract.balanceOf(alice.address);

      // Before perform first add stake

      expect(preUserStakesDTOs).to.be.empty;

      expect(preFirstContractBalance).to.be.equal(0);

      expect(preFirstStakerBalance).to.be.equal(getBigNumber(100_000));

      // After perform first add stake

      expect(postFirstStakeData.stakingPoolId).to.be.equal(3);
      expect(postFirstStakeData.startTime).to.be.equal(firstStakeAddTime);
      expect(postFirstStakeData.stakedTokens).to.be.equal(getBigNumber(15_000));
      expect(postFirstStakeData.apr).to.be.equal(2000);
      expect(postFirstStakeData.lockTime).to.be.equal(firstStakeAddTime + MONTH * 6);

      expect(postFirstUserStakesDTOs.length).to.be.equal(1);
      expect(postFirstUserStakesDTOs[0][2]).to.be.equal(getBigNumber(15_000));

      const firstRewards: BigNumber = await calculateRewards(firstStakeAddTime, firstStakeAddTime + MONTH * 6, 2000, getBigNumber(15_000));
      expect(postFirstContractBalance).to.be.equal(getBigNumber(15_000).add(firstRewards));

      expect(postFirstStakerBalance).to.be.equal(getBigNumber(85_000));

      // After perform second add stake

      expect(postSecondStakeData.stakingPoolId).to.be.equal(15);
      expect(postSecondStakeData.startTime).to.be.equal(secondStakeAddTime);
      expect(postSecondStakeData.stakedTokens).to.be.equal(getBigNumber(30_000));
      expect(postSecondStakeData.apr).to.be.equal(18000);
      expect(postSecondStakeData.lockTime).to.be.equal(secondStakeAddTime + YEAR * 2);

      expect(postSecondUserStakesDTOs.length).to.be.equal(2);
      expect(postSecondUserStakesDTOs[0][3]).to.be.equal(2000);
      expect(postSecondUserStakesDTOs[1][3]).to.be.equal(18000);

      const secondRewards: BigNumber = await calculateRewards(secondStakeAddTime, secondStakeAddTime + YEAR * 2, 18000, getBigNumber(30_000));
      expect(postSecondContractBalance).to.be.equal(getBigNumber(45_000).add(firstRewards).add(secondRewards));

      expect(postSecondStakerBalance).to.be.equal(getBigNumber(55_000));
    });

    it("Should work correctly and add 2 stakes in same pool for same staker", async () => {
      const preUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const preFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const preFirstStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const firstStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(firstStakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(3, getBigNumber(15_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 1, 3, firstStakeAddTime, firstStakeAddTime + MONTH * 6, 2000, getBigNumber(15_000));

      const postFirstStakeData = await periodicStaking.userStake(alice.address, 1);
      const postFirstUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postFirstStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const secondStakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(secondStakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(3, getBigNumber(30_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 2, 3, secondStakeAddTime, secondStakeAddTime + MONTH * 6, 2000, getBigNumber(30_000));

      const postSecondStakeData = await periodicStaking.userStake(alice.address, 2);
      const postSecondUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postSecondContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postSecondStakerBalance = await tokenContract.balanceOf(alice.address);

      // Before perform first add stake

      expect(preUserStakesDTOs).to.be.empty;

      expect(preFirstContractBalance).to.be.equal(0);

      expect(preFirstStakerBalance).to.be.equal(getBigNumber(100_000));

      // After perform first add stake

      expect(postFirstStakeData.stakingPoolId).to.be.equal(3);
      expect(postFirstStakeData.startTime).to.be.equal(firstStakeAddTime);
      expect(postFirstStakeData.stakedTokens).to.be.equal(getBigNumber(15_000));
      expect(postFirstStakeData.apr).to.be.equal(2000);
      expect(postFirstStakeData.lockTime).to.be.equal(firstStakeAddTime + MONTH * 6);

      expect(postFirstUserStakesDTOs.length).to.be.equal(1);
      expect(postFirstUserStakesDTOs[0][2]).to.be.equal(getBigNumber(15_000));

      const firstRewards: BigNumber = await calculateRewards(firstStakeAddTime, firstStakeAddTime + MONTH * 6, 2000, getBigNumber(15_000));
      expect(postFirstContractBalance).to.be.equal(getBigNumber(15_000).add(firstRewards));

      expect(postFirstStakerBalance).to.be.equal(getBigNumber(85_000));

      // After perform second add stake

      expect(postSecondStakeData.stakingPoolId).to.be.equal(3);
      expect(postSecondStakeData.startTime).to.be.equal(secondStakeAddTime);
      expect(postSecondStakeData.stakedTokens).to.be.equal(getBigNumber(30_000));
      expect(postSecondStakeData.apr).to.be.equal(2000);
      expect(postSecondStakeData.lockTime).to.be.equal(secondStakeAddTime + MONTH * 6);

      expect(postSecondUserStakesDTOs.length).to.be.equal(2);
      expect(postSecondUserStakesDTOs[0][3]).to.be.equal(2000);
      expect(postSecondUserStakesDTOs[1][3]).to.be.equal(2000);

      const secondRewards: BigNumber = await calculateRewards(secondStakeAddTime, secondStakeAddTime + MONTH * 6, 2000, getBigNumber(30_000));
      expect(postSecondContractBalance).to.be.equal(getBigNumber(45_000).add(firstRewards).add(secondRewards));

      expect(postSecondStakerBalance).to.be.equal(getBigNumber(55_000));
    });

    it("Should perform correctly and calculate correctly reward for stake when APR is zero", async () => {
      await createZeroMinZeroAPRZeroFeeOneMonthStakingPool(periodicStaking);

      const preUserStakesDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const preStakerBalance = await tokenContract.balanceOf(alice.address);

      lastBlockTime = await latestBlockTimeNumber();
      const stakeAddTime = lastBlockTime + 10;

      await setNextBlockTimestamp(stakeAddTime);

      await expect(periodicStaking.connect(alice).addStake(21, getBigNumber(10_000)))
        .to.emit(periodicStaking, STAKE_ADDED_EVENT)
        .withArgs(alice.address, 1, 21, stakeAddTime, stakeAddTime + MONTH, 0, getBigNumber(10_000));

      lastBlockTime = await latestBlockTimeNumber();

      const postStakeData = await periodicStaking.userStake(alice.address, 1);
      const postUserStakeDTOs = await periodicStaking.getAllStakesDTOForUser(alice.address);
      const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
      const postStakerBalance = await tokenContract.balanceOf(alice.address);

      // Before perform add stake

      expect(preUserStakesDTOs).to.be.empty;

      expect(preContractBalance).to.be.equal(0);

      expect(preStakerBalance).to.be.equal(getBigNumber(100_000));

      // After perform add stake

      expect(postStakeData.stakingPoolId).to.be.equal(21);
      expect(postStakeData.startTime).to.be.equal(lastBlockTime);
      expect(postStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
      expect(postStakeData.apr).to.be.equal(0);
      expect(postStakeData.lockTime).to.be.equal(lastBlockTime + MONTH);

      expect(postUserStakeDTOs.length).to.be.equal(1);
      expect(postUserStakeDTOs[0][2]).to.be.equal(getBigNumber(10_000));

      expect(postContractBalance).to.be.equal(getBigNumber(10_000));

      expect(postStakerBalance).to.be.equal(getBigNumber(90_000));
    });

    it("Should revert when Staking Pool doesn't exist", async () => {
      await expect(periodicStaking.connect(alice).addStake(21, getBigNumber(1_000))).to.be.revertedWith(STAKING_POOL_NOT_EXISTS_ERR);
    });

    it("Should revert when amount which user want to stake is below minimum possible value", async () => {
      await expect(periodicStaking.connect(alice).addStake(20, getBigNumber(99_999))).to.be.revertedWith(MINIMUM_TO_STAKE_ERR);
    });
  });

  // describe("'claim' function tests", () => {
  //   it("Should revert when stake type is Periodic", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(10_000));

  //     await expect(periodicStaking.connect(alice).collectReward(1)).to.be.revertedWith(CANNOT_FOR_PERIODIC_STAKE_ERR);
  //   });
  // });

  // describe("'unstakeWithFee' function tests", () => {
  //   it("Should perform correctly and unstake tokens when user have only one stake (deleted data verification)", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + DAY * 3);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, BigNumber.from("10020547945205479331200"));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(2);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + DAY * 3);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("79274479959411"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(1);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);

  //     expect(preContractBalance).to.be.equal(getBigNumber(10_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(90_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(0);

  //     expect(postContractBalance).to.be.equal(0);

  //     expect(postStakerBalance).to.be.equal(BigNumber.from("100020547945205479331200"));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(BigNumber.from("99979452054794520668800"));
  //   });

  //   it("Should perform correctly and unstake tokens when user have few more stakes (deleted data verification)", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(5_000));

  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(7_000));

  //     await periodicStaking.connect(alice).addStake(3, 3, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await periodicStaking.connect(alice).addStake(3, 5, getBigNumber(15_000));

  //     await setNextBlockTimestamp(addStakeTime + WEEK);

  //     await periodicStaking.connect(alice).requestUnstake(4);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 4);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(4))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 4, BigNumber.from("10076712328767123078400"));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 4);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(3);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + WEEK);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("126839167935058"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(5);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);
  //     expect(preUserStakeIdsData[1]).to.be.equal(2);
  //     expect(preUserStakeIdsData[2]).to.be.equal(3);
  //     expect(preUserStakeIdsData[3]).to.be.equal(4);
  //     expect(preUserStakeIdsData[4]).to.be.equal(5);

  //     expect(preContractBalance).to.be.equal(getBigNumber(47_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(53_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(4);
  //     expect(postUserStakeIdsData[0]).to.be.equal(1);
  //     expect(postUserStakeIdsData[1]).to.be.equal(2);
  //     expect(postUserStakeIdsData[2]).to.be.equal(3);
  //     expect(postUserStakeIdsData[3]).to.be.equal(5);

  //     expect(postContractBalance).to.be.equal(getBigNumber(37_000));

  //     expect(postStakerBalance).to.be.equal(BigNumber.from("63076712328767123078400"));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(BigNumber.from("99923287671232876921600"));
  //   });

  //   it("Should perform correctly and unstake tokens when user have few more stakes (deleted data verification - unstake last added stake)", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(5_000));

  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(7_000));

  //     await periodicStaking.connect(alice).addStake(3, 3, getBigNumber(10_000));

  //     await periodicStaking.connect(alice).addStake(3, 5, getBigNumber(15_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + MONTH);

  //     await periodicStaking.connect(alice).requestUnstake(5);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 5);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(5))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 5, BigNumber.from("16232876712328765056000"));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 5);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(5);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(15_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + MONTH);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("475646879756468"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(5);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);
  //     expect(preUserStakeIdsData[1]).to.be.equal(2);
  //     expect(preUserStakeIdsData[2]).to.be.equal(3);
  //     expect(preUserStakeIdsData[3]).to.be.equal(4);
  //     expect(preUserStakeIdsData[4]).to.be.equal(5);

  //     expect(preContractBalance).to.be.equal(getBigNumber(47_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(53_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(4);
  //     expect(postUserStakeIdsData[0]).to.be.equal(1);
  //     expect(postUserStakeIdsData[1]).to.be.equal(2);
  //     expect(postUserStakeIdsData[2]).to.be.equal(3);
  //     expect(postUserStakeIdsData[3]).to.be.equal(4);

  //     expect(postContractBalance).to.be.equal(getBigNumber(32_000));

  //     expect(postStakerBalance).to.be.equal(BigNumber.from("69232876712328765056000"));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(BigNumber.from("98767123287671234944000"));
  //   });

  //   it("Should perform correctly and unstake tokens when user have few more stakes (deleted data verification - unstake first added stake)", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(5_000));

  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(7_000));

  //     await periodicStaking.connect(alice).addStake(3, 3, getBigNumber(10_000));

  //     await periodicStaking.connect(alice).addStake(3, 5, getBigNumber(15_000));

  //     await setNextBlockTimestamp(addStakeTime + WEEK * 2);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, BigNumber.from("10230136986301369235200"));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(4);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + WEEK * 2);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("190258751902587"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(5);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);
  //     expect(preUserStakeIdsData[1]).to.be.equal(2);
  //     expect(preUserStakeIdsData[2]).to.be.equal(3);
  //     expect(preUserStakeIdsData[3]).to.be.equal(4);
  //     expect(preUserStakeIdsData[4]).to.be.equal(5);

  //     expect(preContractBalance).to.be.equal(getBigNumber(47_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(53_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(4);
  //     expect(postUserStakeIdsData[0]).to.be.equal(5);
  //     expect(postUserStakeIdsData[1]).to.be.equal(2);
  //     expect(postUserStakeIdsData[2]).to.be.equal(3);
  //     expect(postUserStakeIdsData[3]).to.be.equal(4);

  //     expect(postContractBalance).to.be.equal(getBigNumber(37_000));

  //     expect(postStakerBalance).to.be.equal(BigNumber.from("63230136986301369235200"));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(BigNumber.from("99769863013698630764800"));
  //   });

  //   it("Should perform correctly and unstake tokens when user have few more stakes (deleted data verification - unstake more than one stake)", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     const addFirstStakeTime = await latestBlockTimeNumber();

  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(5_000));

  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(7_000));

  //     const addSecondStakeTime = await latestBlockTimeNumber();

  //     await periodicStaking.connect(alice).addStake(3, 3, getBigNumber(10_000));

  //     await periodicStaking.connect(alice).addStake(3, 5, getBigNumber(15_000));

  //     await setNextBlockTimestamp(addFirstStakeTime + WEEK * 2);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const firstRequestUnstakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addSecondStakeTime + WEEK * 2);

  //     await periodicStaking.connect(alice).requestUnstake(3);

  //     const secondRequestUnstakeTime = await latestBlockTimeNumber();

  //     const preFirstStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preFirstUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preFirstStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFirstFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preFirstRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, BigNumber.from("10230136986301369235200"));

  //     const postFirstStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postFirstUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postFirstContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postFirstStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFirstFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postFirstRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     const preSecondStakeData = await periodicStaking.userStake(alice.address, 3);
  //     const preSecondUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preSecondContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preSecondStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preSecondFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preSecondRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(3))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 3, BigNumber.from("7067123287671232844800"));

  //     const postSecondStakeData = await periodicStaking.userStake(alice.address, 3);
  //     const postSecondUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postSecondContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postSecondStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postSecondFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postSecondRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before first unstake stake data

  //     expect(preFirstStakeData.stakingTierId).to.be.equal(3);
  //     expect(preFirstStakeData.stakingPoolId).to.be.equal(4);
  //     expect(preFirstStakeData.stakeType).to.be.equal(1);
  //     expect(preFirstStakeData.startTime).to.be.equal(addFirstStakeTime);
  //     expect(preFirstStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preFirstStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preFirstStakeData.lockTime).to.be.equal(addFirstStakeTime + WEEK * 2);
  //     expect(preFirstStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preFirstStakeData.unstakeFee).to.be.equal(0);
  //     expect(preFirstStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preFirstStakeData.requestUnstakeTime).to.be.equal(firstRequestUnstakeTime);
  //     expect(preFirstStakeData.withdrawalPossibleAt).to.be.equal(firstRequestUnstakeTime);
  //     expect(preFirstStakeData.rewardRate).to.be.equal(BigNumber.from("190258751902587"));
  //     expect(preFirstStakeData.exists).to.be.equal(true);

  //     expect(preFirstUserStakeIdsData.length).to.be.equal(5);
  //     expect(preFirstUserStakeIdsData[0]).to.be.equal(1);
  //     expect(preFirstUserStakeIdsData[1]).to.be.equal(2);
  //     expect(preFirstUserStakeIdsData[2]).to.be.equal(3);
  //     expect(preFirstUserStakeIdsData[3]).to.be.equal(4);
  //     expect(preFirstUserStakeIdsData[4]).to.be.equal(5);

  //     expect(preFirstContractBalance).to.be.equal(getBigNumber(47_000));

  //     expect(preFirstStakerBalance).to.be.equal(getBigNumber(53_000));

  //     expect(preFirstFeeCollectorBalance).to.be.equal(0);

  //     expect(preFirstRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After first unstake stake data

  //     expect(postFirstStakeData.stakingTierId).to.be.equal(0);
  //     expect(postFirstStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postFirstStakeData.stakeType).to.be.equal(0);
  //     expect(postFirstStakeData.startTime).to.be.equal(0);
  //     expect(postFirstStakeData.stakedTokens).to.be.equal(0);
  //     expect(postFirstStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postFirstStakeData.lockTime).to.be.equal(0);
  //     expect(postFirstStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postFirstStakeData.unstakeFee).to.be.equal(0);
  //     expect(postFirstStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postFirstStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postFirstStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postFirstStakeData.rewardRate).to.be.equal(0);
  //     expect(postFirstStakeData.exists).to.be.equal(false);

  //     expect(postFirstUserStakeIdsData.length).to.be.equal(4);
  //     expect(postFirstUserStakeIdsData[0]).to.be.equal(5);
  //     expect(postFirstUserStakeIdsData[1]).to.be.equal(2);
  //     expect(postFirstUserStakeIdsData[2]).to.be.equal(3);
  //     expect(postFirstUserStakeIdsData[3]).to.be.equal(4);

  //     expect(postFirstContractBalance).to.be.equal(getBigNumber(37_000));

  //     expect(postFirstStakerBalance).to.be.equal(BigNumber.from("63230136986301369235200"));

  //     expect(postFirstFeeCollectorBalance).to.be.equal(0);

  //     expect(postFirstRewardDistributorBalance).to.be.equal(BigNumber.from("99769863013698630764800"));

  //     // Before second unstake stake data

  //     expect(preSecondStakeData.stakingTierId).to.be.equal(3);
  //     expect(preSecondStakeData.stakingPoolId).to.be.equal(2);
  //     expect(preSecondStakeData.stakeType).to.be.equal(1);
  //     expect(preSecondStakeData.startTime).to.be.equal(addSecondStakeTime);
  //     expect(preSecondStakeData.stakedTokens).to.be.equal(getBigNumber(7_000));
  //     expect(preSecondStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preSecondStakeData.lockTime).to.be.equal(addSecondStakeTime + DAY * 3);
  //     expect(preSecondStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preSecondStakeData.unstakeFee).to.be.equal(0);
  //     expect(preSecondStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preSecondStakeData.requestUnstakeTime).to.be.equal(secondRequestUnstakeTime);
  //     expect(preSecondStakeData.withdrawalPossibleAt).to.be.equal(secondRequestUnstakeTime);
  //     expect(preSecondStakeData.rewardRate).to.be.equal(BigNumber.from("55492135971588"));
  //     expect(preSecondStakeData.exists).to.be.equal(true);

  //     expect(preSecondUserStakeIdsData.length).to.be.equal(4);
  //     expect(preSecondUserStakeIdsData[0]).to.be.equal(5);
  //     expect(preSecondUserStakeIdsData[1]).to.be.equal(2);
  //     expect(preSecondUserStakeIdsData[2]).to.be.equal(3);
  //     expect(preSecondUserStakeIdsData[3]).to.be.equal(4);

  //     expect(preSecondContractBalance).to.be.equal(getBigNumber(37_000));

  //     expect(preSecondStakerBalance).to.be.equal(BigNumber.from("63230136986301369235200"));

  //     expect(preSecondFeeCollectorBalance).to.be.equal(0);

  //     expect(preSecondRewardDistributorBalance).to.be.equal(BigNumber.from("99769863013698630764800"));

  //     // After second unstake stake data

  //     expect(postSecondStakeData.stakingTierId).to.be.equal(0);
  //     expect(postSecondStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postSecondStakeData.stakeType).to.be.equal(0);
  //     expect(postSecondStakeData.startTime).to.be.equal(0);
  //     expect(postSecondStakeData.stakedTokens).to.be.equal(0);
  //     expect(postSecondStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postSecondStakeData.lockTime).to.be.equal(0);
  //     expect(postSecondStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postSecondStakeData.unstakeFee).to.be.equal(0);
  //     expect(postSecondStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postSecondStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postSecondStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postSecondStakeData.rewardRate).to.be.equal(0);
  //     expect(postSecondStakeData.exists).to.be.equal(false);

  //     expect(postSecondUserStakeIdsData.length).to.be.equal(3);
  //     expect(postSecondUserStakeIdsData[0]).to.be.equal(5);
  //     expect(postSecondUserStakeIdsData[1]).to.be.equal(2);
  //     expect(postSecondUserStakeIdsData[2]).to.be.equal(4);

  //     expect(postSecondContractBalance).to.be.equal(getBigNumber(30_000));

  //     expect(postSecondStakerBalance).to.be.equal(BigNumber.from("70297260273972602080000"));

  //     expect(postSecondFeeCollectorBalance).to.be.equal(0);

  //     expect(postSecondRewardDistributorBalance).to.be.equal(BigNumber.from("99702739726027397920000"));
  //   });

  //   it("Should perform correctly and correctly calculate rewards when Staking Tier reward end time ends between stake start time and request unstake time", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + WEEK);

  //     await periodicStaking.updateStakingTierEndTime(3, addStakeTime + WEEK);

  //     await setNextBlockTimestamp(addStakeTime + WEEK * 2);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, BigNumber.from("10115068493150684617600"));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(4);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + WEEK * 2);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("190258751902587"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(1);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);

  //     expect(preContractBalance).to.be.equal(getBigNumber(10_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(90_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(0);

  //     expect(postContractBalance).to.be.equal(0);

  //     expect(postStakerBalance).to.be.equal(BigNumber.from("100115068493150684617600"));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(BigNumber.from("99884931506849315382400"));
  //   });

  //   it("Should perform correctly and correctly calculate rewards when Staking Tier reward end time ends before stake start time", async () => {
  //     lastBlockTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(lastBlockTime + 10);

  //     await periodicStaking.updateStakingTierEndTime(3, lastBlockTime + 10);

  //     lastBlockTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(lastBlockTime + 5);

  //     await periodicStaking.connect(alice).addStake(3, 4, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + WEEK * 2);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, getBigNumber(10_000));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(3);
  //     expect(preStakeData.stakingPoolId).to.be.equal(4);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + WEEK * 2);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(BigNumber.from("190258751902587"));
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(1);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);

  //     expect(preContractBalance).to.be.equal(getBigNumber(10_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(90_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(0);

  //     expect(postContractBalance).to.be.equal(0);

  //     expect(postStakerBalance).to.be.equal(getBigNumber(100_000));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(getBigNumber(100_000));
  //   });

  //   it("Should perform correctly when stake is with zero 'rewardRate' (Tier with 0% APR Pools)", async () => {
  //     await createSimplifiedPeriodicZeroAprStakingTierWithPools(periodicStaking);

  //     await periodicStaking.connect(alice).addStake(4, 2, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + DAY * 3);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     const requestUnstakeTime = await latestBlockTimeNumber();

  //     const preStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const preUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const preContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const preStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const preFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const preRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1))
  //       .to.be.emit(periodicStaking, STAKE_REMOVED_EVENT)
  //       .withArgs(alice.address, 1, getBigNumber(10_000));

  //     const postStakeData = await periodicStaking.userStake(alice.address, 1);
  //     const postUserStakeIdsData = await periodicStaking.getUserStakeIds(alice.address);
  //     const postContractBalance = await tokenContract.balanceOf(periodicStaking.address);
  //     const postStakerBalance = await tokenContract.balanceOf(alice.address);
  //     const postFeeCollectorBalance = await tokenContract.balanceOf(fee.address);
  //     const postRewardDistributorBalance = await tokenContract.balanceOf(rewardDistributor.address);

  //     // Before unstake stake data

  //     expect(preStakeData.stakingTierId).to.be.equal(4);
  //     expect(preStakeData.stakingPoolId).to.be.equal(2);
  //     expect(preStakeData.stakeType).to.be.equal(1);
  //     expect(preStakeData.startTime).to.be.equal(addStakeTime);
  //     expect(preStakeData.stakedTokens).to.be.equal(getBigNumber(10_000));
  //     expect(preStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(preStakeData.lockTime).to.be.equal(addStakeTime + DAY * 3);
  //     expect(preStakeData.unstakePeriod).to.be.equal(0);
  //     expect(preStakeData.unstakeFee).to.be.equal(0);
  //     expect(preStakeData.isWithdrawing).to.be.equal(true);
  //     expect(preStakeData.requestUnstakeTime).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.withdrawalPossibleAt).to.be.equal(requestUnstakeTime);
  //     expect(preStakeData.rewardRate).to.be.equal(0);
  //     expect(preStakeData.exists).to.be.equal(true);

  //     expect(preUserStakeIdsData.length).to.be.equal(1);
  //     expect(preUserStakeIdsData[0]).to.be.equal(1);

  //     expect(preContractBalance).to.be.equal(getBigNumber(10_000));

  //     expect(preStakerBalance).to.be.equal(getBigNumber(90_000));

  //     expect(preFeeCollectorBalance).to.be.equal(0);

  //     expect(preRewardDistributorBalance).to.be.equal(getBigNumber(100_000));

  //     // After unstake stake data

  //     expect(postStakeData.stakingTierId).to.be.equal(0);
  //     expect(postStakeData.stakingPoolId).to.be.equal(0);
  //     expect(postStakeData.stakeType).to.be.equal(0);
  //     expect(postStakeData.startTime).to.be.equal(0);
  //     expect(postStakeData.stakedTokens).to.be.equal(0);
  //     expect(postStakeData.compoundPossibleAt).to.be.equal(0);
  //     expect(postStakeData.lockTime).to.be.equal(0);
  //     expect(postStakeData.unstakePeriod).to.be.equal(0);
  //     expect(postStakeData.unstakeFee).to.be.equal(0);
  //     expect(postStakeData.isWithdrawing).to.be.equal(false);
  //     expect(postStakeData.requestUnstakeTime).to.be.equal(0);
  //     expect(postStakeData.withdrawalPossibleAt).to.be.equal(0);
  //     expect(postStakeData.rewardRate).to.be.equal(0);
  //     expect(postStakeData.exists).to.be.equal(false);

  //     expect(postUserStakeIdsData.length).to.be.equal(0);

  //     expect(postContractBalance).to.be.equal(0);

  //     expect(postStakerBalance).to.be.equal(getBigNumber(100_000));

  //     expect(postFeeCollectorBalance).to.be.equal(0);

  //     expect(postRewardDistributorBalance).to.be.equal(getBigNumber(100_000));
  //   });

  //   it("Should revert when stake doesn't exist", async () => {
  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1)).to.be.revertedWith(STAKE_NOT_EXISTS_ERR);
  //   });

  //   it("Should revert when user want unstake before request unstake", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 1, getBigNumber(10_000));

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1)).to.be.revertedWith(REQUEST_UNSTAKE_FIRST_ERR);
  //   });

  //   it("Should revert when reward distributor doesn't have enough tokens to transfer rewards", async () => {
  //     await periodicStaking.connect(alice).addStake(3, 2, getBigNumber(10_000));

  //     const addStakeTime = await latestBlockTimeNumber();

  //     await setNextBlockTimestamp(addStakeTime + DAY * 3);

  //     await periodicStaking.connect(alice).requestUnstake(1);

  //     await tokenContract.connect(rewardDistributor).transfer(signer.address, getBigNumber(100_000));

  //     await expect(periodicStaking.connect(alice).unstakeWithFee(1)).to.be.revertedWith(TOKEN_TRANSFER_FROM_ERR);
  //   });
  // });
});
