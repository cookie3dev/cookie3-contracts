import { BigNumber } from "ethers";
import { PeriodicStaking } from "../../typechain";
import { getBigNumber, MONTH, YEAR } from "../utilities";

export async function createProductionStakingPools(stakingContract: PeriodicStaking): Promise<void> {
  await createTier1StakingPools(stakingContract);
  await createTier2StakingPools(stakingContract);
  await createTier3StakingPools(stakingContract);
  await createTier4StakingPools(stakingContract);
}

export async function createZeroMinZeroAPRZeroFeeOneMonthStakingPool(stakingContract: PeriodicStaking): Promise<void> {
  await stakingContract.addStakingPool(0, 0, MONTH, 0);
}

export async function calculateRewards(startTime: number, toTime: number, apr: number, tokens: BigNumber): Promise<BigNumber> {
  return (await calculateRewardRate(apr, tokens)).mul(BigNumber.from(toTime - startTime));
}

async function calculateRewardRate(apr: number, tokens: BigNumber): Promise<BigNumber> {
  return tokens.mul(BigNumber.from(apr)).div(BigNumber.from(31536000)).div(10000);
}

async function createTier1StakingPools(stakingContract: PeriodicStaking): Promise<void> {
  await createStakingPools(stakingContract, 500, 5000);
}

async function createTier2StakingPools(stakingContract: PeriodicStaking): Promise<void> {
  await createStakingPools(stakingContract, 1000, 10000);
}

async function createTier3StakingPools(stakingContract: PeriodicStaking): Promise<void> {
  await createStakingPools(stakingContract, 1500, 30000);
}

async function createTier4StakingPools(stakingContract: PeriodicStaking): Promise<void> {
  await createStakingPools(stakingContract, 2000, 100000);
}

async function createStakingPools(stakingContract: PeriodicStaking, apr: number, minimumToStake: number): Promise<void> {
  // 1 M
  await stakingContract.addStakingPool(getBigNumber(minimumToStake), apr, MONTH, 1200);
  // 3 M
  await stakingContract.addStakingPool(getBigNumber(minimumToStake), apr * 2, MONTH * 3, 1400);
  // 6 M
  await stakingContract.addStakingPool(getBigNumber(minimumToStake), apr * 4, MONTH * 6, 1600);
  // 12 M
  await stakingContract.addStakingPool(getBigNumber(minimumToStake), apr * 8, YEAR, 1800);
  // 24 M
  await stakingContract.addStakingPool(getBigNumber(minimumToStake), apr * 12, YEAR * 2, 2000);
}
