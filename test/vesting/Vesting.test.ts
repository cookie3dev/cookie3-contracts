import { waffle } from "hardhat";
import { expect } from "chai";

import VestingArtifacts from "../../artifacts/contracts/vesting/Vesting.sol/Vesting.json";
import TokenArtifacts from "../../artifacts/contracts/Cookie3.sol/Cookie3.json";
import ERC20MockArtifact from "../../artifacts/contracts/mocks/ERC20Mock.sol/ERC20Mock.json";

import { Vesting, Cookie3, ERC20Mock } from "../../typechain";
import { Wallet, BigNumber } from "ethers";
import { getBigNumber, latest, duration, advanceTime, advanceTimeAndBlock, countClaimable } from "../utilities";

const { provider, deployContract } = waffle;

describe("Vesting", () => {
  const [deployer, alice, bob, carol, don] = provider.getWallets() as Wallet[];

  let vesting: Vesting;
  let token: Cookie3;

  let now: BigNumber;

  let timestamp: BigNumber;
  let claimed: BigNumber;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

  beforeEach(async () => {
    token = (await deployContract(deployer, TokenArtifacts, [deployer.address])) as Cookie3;
    vesting = (await deployContract(deployer, VestingArtifacts, [])) as Vesting;
    await vesting.init(token.address);
    now = await latest();
  });

  describe("init", () => {
    it("should revert when token address is 0", async function () {
      await expect(vesting.init(ZERO_ADDRESS)).to.be.revertedWith("_token address cannot be 0");
    });

    it("should revert when already initialized", async function () {
      await expect(vesting.init(token.address)).to.be.revertedWith("init already done");
    });
  });

  describe("initialization", () => {
    it("should initialize as expected", async function () {
      expect(await vesting.token()).to.be.equal(token.address);
      expect(await vesting.owner()).to.be.equal(deployer.address);
      expect(await vesting.totalVested()).to.be.equal(0);
      expect(await vesting.totalClaimed()).to.be.equal(0);
    });
  });

  describe("onlyOwner", () => {
    it("should revert if restricted function's caller is not owner", async () => {
      const _vesting = (await deployContract(deployer, VestingArtifacts, [])) as Vesting;
      await expect(vesting.connect(alice).massAddHolders([], [], [], 1, 2, 3)).to.be.revertedWith("caller is not the owner");
      await expect(_vesting.connect(alice).init(token.address)).to.be.revertedWith("caller is not the owner");
      await expect(_vesting.connect(alice).recoverErc20(token.address)).to.be.revertedWith("caller is not the owner");
    });
  });

  describe("whenNotLocked", () => {
    it("should revert if function is locked", async () => {
      await vesting.lock();
      await expect(vesting.massAddHolders([], [], [], 1, 2, 3)).to.be.revertedWith("Lockable: locked");
    });
  });

  describe("massAddHolders", () => {
    it("should revert with incorrect arrays lengths", async function () {
      await expect(vesting.massAddHolders([alice.address, bob.address], [100], [1000], 1, 2, 3)).to.be.revertedWith("data size mismatch");
      await expect(vesting.massAddHolders([alice.address], [100, 100], [1000], 1, 2, 3)).to.be.revertedWith("data size mismatch");
      await expect(vesting.massAddHolders([alice.address, bob.address], [100], [1000, 1000], 1, 2, 3)).to.be.revertedWith("data size mismatch");
      await expect(vesting.massAddHolders([alice.address], [100], [1000, 1000], 1, 2, 3)).to.be.revertedWith("data size mismatch");
    });

    it("should revert when user address is 0", async function () {
      await expect(vesting.massAddHolders([ZERO_ADDRESS], [100], [1000], 1, 2, 3)).to.be.revertedWith("user address cannot be 0");
    });

    it("should allow to add single vesting", async function () {
      await expect(vesting.massAddHolders([alice.address], [100], [1000], 1, 2, 3))
        .to.emit(vesting, "Vested")
        .withArgs(alice.address, 1000, 6);
    });

    it("should allow to add multiple vestings", async function () {
      await expect(vesting.massAddHolders([alice.address, bob.address, carol.address], [100, 200, 300], [1000, 2000, 3000], 150, 0, 200))
        .to.emit(vesting, "Vested")
        .withArgs(alice.address, 1000, 350)
        .and.to.emit(vesting, "Vested")
        .withArgs(bob.address, 2000, 350)
        .and.to.emit(vesting, "Vested")
        .withArgs(carol.address, 3000, 350);
    });

    it("should correctly track totalVested", async function () {
      await vesting.massAddHolders([alice.address, bob.address, carol.address], [100, 200, 300], [1000, 2000, 3000], 150, 100, 250);

      let totalVested = await vesting.totalVested();
      expect(totalVested).to.be.equal(6000);

      await vesting.massAddHolders([alice.address, bob.address, carol.address], [100, 200, 300], [2000, 5000, 8000], 150, 100, 250);

      totalVested = await vesting.totalVested();
      expect(totalVested).to.be.equal(21000);
    });
  });

  describe("claim", () => {
    it("should revert if nothing to claim when no vestings", async function () {
      await expect(vesting.claim()).to.be.revertedWith("no vestings for user");
    });

    it("should revert if nothing to claim when before start time", async function () {
      await vesting.massAddHolders([alice.address], [100], [1000], now.add(duration.days(1)), 0, duration.days(2));
      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
    });

    it("should claim startTokens when block timestamp = startDate", async function () {
      await token.transfer(vesting.address, 100);
      await vesting.massAddHolders([alice.address], [100], [1000], now.add(3), 0, duration.days(2));
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, 100);
    });

    it("should claim correctly every 100 sec with minimal amount", async function () {
      await token.transfer(vesting.address, 11);
      await vesting.massAddHolders([alice.address], [1], [11], now.add(3), 0, 1000);

      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, 1);
      await advanceTimeAndBlock(199);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, 2);
      await advanceTimeAndBlock(1300);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, 8);

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
      expect(await vesting.totalVested()).to.be.equal(11);
      expect(await token.balanceOf(alice.address)).to.be.equal(11);
    });

    it("should claim correctly every 100 sec with normal amount", async function () {
      await token.transfer(vesting.address, getBigNumber(55000));
      await vesting.massAddHolders([alice.address], [getBigNumber(5000)], [getBigNumber(55000)], now.add(3), 100, 1000);

      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(5000));
      await advanceTimeAndBlock(399);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(15000));
      await advanceTimeAndBlock(99);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(5000));
      await advanceTimeAndBlock(850);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(30000));

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
      expect(await vesting.totalVested()).to.be.equal(getBigNumber(55000));
      expect(await token.balanceOf(alice.address)).to.be.equal(getBigNumber(55000));
    });

    it("should claim correctly withing 10 days with normal amount", async function () {
      await token.transfer(vesting.address, getBigNumber(550000));
      await vesting.massAddHolders(
        [alice.address],
        [getBigNumber(50000)],
        [getBigNumber(550000)],
        now.add(duration.days(1)).add(2),
        duration.days(1),
        duration.days(10)
      );

      await advanceTimeAndBlock(duration.days(3).toNumber() - 1);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(100000));
      await advanceTimeAndBlock(duration.days(4).toNumber() - 1);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(200000));
      await advanceTimeAndBlock(duration.days(5).toNumber() - 1);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(250000));

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
      expect(await vesting.totalVested()).to.be.equal(getBigNumber(550000));
      expect(await token.balanceOf(alice.address)).to.be.equal(getBigNumber(550000));
    });

    it("should claim correctly every 100 sec with totalSupply", async function () {
      await token.transfer(vesting.address, getBigNumber(25000000));
      await vesting.massAddHolders([alice.address], [getBigNumber(5000000)], [getBigNumber(25000000)], now.add(3), 0, 1000);

      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(5000000));
      await advanceTimeAndBlock(99);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(2000000));
      await advanceTimeAndBlock(299);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(6000000));
      await advanceTimeAndBlock(599);
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(12000000));

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
    });

    it("should claim correctly from all vestings", async function () {
      await token.transfer(vesting.address, getBigNumber(10000));

      await vesting.massAddHolders(
        [alice.address],
        [getBigNumber(100)],
        [getBigNumber(1100)],
        now.add(duration.days(1)).add(4),
        0,
        duration.days(10)
      ); // 100 per day

      await vesting.massAddHolders(
        [alice.address],
        [getBigNumber(200)],
        [getBigNumber(2200)],
        now.add(duration.days(2)).add(4),
        0,
        duration.days(20)
      ); // 100 per day

      await vesting.massAddHolders(
        [alice.address],
        [getBigNumber(400)],
        [getBigNumber(4400)],
        now.add(duration.days(4)).add(4),
        0,
        duration.days(40)
      ); // 100 per day

      await advanceTimeAndBlock(duration.days(2).toNumber() - 1); // day 2
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(400));
      await advanceTimeAndBlock(duration.days(2).toNumber() - 1); // day 4
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(800));
      await advanceTimeAndBlock(duration.days(1).toNumber() - 1); // day 5
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(300));

      await advanceTimeAndBlock(duration.days(6).toNumber() - 1); // day 11 - V1 is over
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(1800));
      await advanceTimeAndBlock(duration.days(1).toNumber() - 1); // day 12
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(200));

      await advanceTimeAndBlock(duration.days(10).toNumber() - 1); // day 22 - V2 is over
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(2000));
      await advanceTimeAndBlock(duration.days(1).toNumber() - 1); // day 23
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(100));

      await advanceTimeAndBlock(duration.days(21).toNumber() - 1); // day 44 - V3 is over
      await advanceTimeAndBlock(duration.days(1).toNumber() - 1); // day 45
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(2100));

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");
      expect(await vesting.totalVested()).to.be.equal(getBigNumber(7700));
    });
  });

  describe("claimTo", () => {
    it("should revert if claim to zero address", async function () {
      await expect(vesting.claimTo(ZERO_ADDRESS)).to.be.revertedWith("claim, then burn");
    });

    it("should revert if no vestings for user", async function () {
      await expect(vesting.claimTo(bob.address)).to.be.revertedWith("no vestings for user");
    });

    it("should revert if nothing to claim when before start time", async function () {
      await vesting.massAddHolders([alice.address], [100], [1000], now.add(duration.days(1)), 0, duration.days(2));
      await expect(vesting.connect(alice).claimTo(bob.address)).to.be.revertedWith("nothing to claim");
    });

    it("should claim correctly to external address", async function () {
      await token.transfer(vesting.address, getBigNumber(550000));

      await vesting.massAddHolders(
        [alice.address],
        [getBigNumber(50000)],
        [getBigNumber(550000)],
        now.add(duration.days(1)).add(2),
        0,
        duration.days(10)
      );

      await advanceTime(duration.days(6).toNumber());
      await expect(vesting.connect(alice).claimTo(bob.address))
        .to.emit(vesting, "Claimed")
        .withArgs(alice.address, getBigNumber(300000))
        .and.to.emit(token, "Transfer")
        .withArgs(vesting.address, bob.address, getBigNumber(300000));

      await advanceTime(duration.days(5).toNumber());
      await expect(vesting.connect(alice).claim()).to.emit(vesting, "Claimed").withArgs(alice.address, getBigNumber(250000));

      await expect(vesting.connect(alice).claim()).to.be.revertedWith("nothing to claim");

      expect(await vesting.totalVested()).to.be.equal(getBigNumber(550000));
      expect(await token.balanceOf(alice.address)).to.be.equal(getBigNumber(250000));
      expect(await token.balanceOf(bob.address)).to.be.equal(getBigNumber(300000));
    });
  });

  describe("getClaimable", () => {
    it("should return claimable for given parameters", async function () {
      timestamp = await latest();

      await vesting.massAddHolders([alice.address], [123451], [12345611], timestamp.add(duration.days(1)), 0, duration.days(7)); // 100 per day
      await vesting.massAddHolders([bob.address], [2345673], [23456783], timestamp.add(duration.days(2)), 0, duration.days(13)); // 100 per day
      await vesting.massAddHolders([carol.address], [3456789], [34567890], timestamp.add(duration.days(4)), 0, duration.days(27)); // 100 per day

      claimed = BigNumber.from(0);
      let actual: number;
      let expected: number;

      await advanceTimeAndBlock(duration.days(5).toNumber() - 3);

      actual = (await vesting.getClaimable(alice.address, 0)).toNumber();
      expected = (
        await countClaimable(
          timestamp.add(duration.days(5)),
          timestamp.add(duration.days(1)),
          BigNumber.from(0),
          duration.days(7),
          BigNumber.from(123451),
          BigNumber.from(12345611),
          claimed
        )
      ).toNumber();

      expect(actual).to.be.closeTo(expected, 100);

      actual = (await vesting.getClaimable(bob.address, 0)).toNumber();
      expected = (
        await countClaimable(
          timestamp.add(duration.days(5)),
          timestamp.add(duration.days(2)),
          BigNumber.from(0),
          duration.days(13),
          BigNumber.from(2345673),
          BigNumber.from(23456783),
          claimed
        )
      ).toNumber();

      expect(actual).to.be.closeTo(expected, 100);

      actual = (await vesting.getClaimable(carol.address, 0)).toNumber();
      expected = (
        await countClaimable(
          timestamp.add(duration.days(5)),
          timestamp.add(duration.days(4)),
          BigNumber.from(0),
          duration.days(27),
          BigNumber.from(3456789),
          BigNumber.from(34567890),
          claimed
        )
      ).toNumber();

      expect(actual).to.be.closeTo(expected, 100);
    });
  });

  describe("getAllClaimable", () => {
    it("should return 0 if nothing to claim", async function () {
      const actual = (await vesting.getAllClaimable(alice.address)).toNumber();
      expect(actual).to.be.equal(0);
    });

    it("should return all claimable for given address", async function () {
      timestamp = await latest();

      await vesting.massAddHolders([alice.address], [123451], [12345611], timestamp.add(duration.days(1)), 0, duration.days(7));
      await vesting.massAddHolders([alice.address], [2345673], [23456783], timestamp.add(duration.days(2)), 0, duration.days(13));
      await vesting.massAddHolders([alice.address], [3456789], [34567890], timestamp.add(duration.days(4)), 0, duration.days(27));

      claimed = BigNumber.from(0);
      let actual: number;

      actual = (await vesting.getAllClaimable(alice.address)).toNumber();
      expect(actual).to.be.equal(0);

      await advanceTimeAndBlock(duration.days(5).toNumber() - 3);

      actual = (await vesting.getAllClaimable(alice.address)).toNumber();

      const expected: number =
        (
          await countClaimable(
            timestamp.add(duration.days(5)),
            timestamp.add(duration.days(1)),
            BigNumber.from(0),
            duration.days(7),
            BigNumber.from(123451),
            BigNumber.from(12345611),
            claimed
          )
        ).toNumber() +
        (
          await countClaimable(
            timestamp.add(duration.days(5)),
            timestamp.add(duration.days(2)),
            BigNumber.from(0),
            duration.days(13),
            BigNumber.from(2345673),
            BigNumber.from(23456783),
            claimed
          )
        ).toNumber() +
        (
          await countClaimable(
            timestamp.add(duration.days(5)),
            timestamp.add(duration.days(4)),
            BigNumber.from(0),
            duration.days(27),
            BigNumber.from(3456789),
            BigNumber.from(34567890),
            claimed
          )
        ).toNumber();

      expect(actual).to.be.closeTo(expected, 100);
    });
  });

  describe("getVestings & getVestingsCount & getVestingByIndex & getVestingsByRange", () => {
    beforeEach(async () => {
      timestamp = await latest();

      await vesting.massAddHolders(
        [alice.address, alice.address, bob.address, carol.address, carol.address],
        [123451, 1233, 2333, 4444, 5555],
        [12345611, 6666, 7777, 8888, 9999],
        timestamp.add(duration.days(1)),
        0,
        duration.days(7)
      );

      await vesting.massAddHolders(
        [alice.address, bob.address, carol.address, carol.address, bob.address, carol.address, carol.address],
        [2345673, 2, 3, 4, 5, 6, 7],
        [23456783, 22, 44, 55, 66, 77, 88],
        timestamp.add(duration.days(2)),
        0,
        duration.days(13)
      );

      await vesting.massAddHolders(
        [alice.address, alice.address, bob.address, carol.address, carol.address, bob.address, carol.address],
        [3456789, 22, 33, 44, 55, 66, 77],
        [34567890, 333, 555, 666, 777, 888, 111],
        timestamp.add(duration.days(4)),
        0,
        duration.days(27)
      );
    });

    describe("getVestings", () => {
      it("should return 0 if no vestings", async function () {
        const array: unknown[] = await vesting.getVestings(don.address);
        expect(array).to.be.lengthOf(0);
      });

      it("should return correct number of vestings for given address", async function () {
        let array: unknown[] = await vesting.getVestings(alice.address);
        expect(array).to.be.lengthOf(5);

        array = await vesting.getVestings(bob.address);
        expect(array).to.be.lengthOf(5);

        array = await vesting.getVestings(carol.address);
        expect(array).to.be.lengthOf(9);
      });
    });

    describe("getVestingsCount", () => {
      it("should return number of vestings", async function () {
        const number = await vesting.getVestingsCount();
        expect(number).to.be.equal(19);
      });
    });

    describe("getVestingByIndex", () => {
      it("should revert if outside of range", async function () {
        await expect(vesting.getVestingByIndex(19)).to.be.revertedWith("reverted with panic code 0x32");
      });

      it("should correctly return vesting by index", async function () {
        expect(await vesting.getVestingByIndex(16)).to.exist;
      });
    });

    describe("getVestingsByRange", () => {
      it("should revert if incorrect range", async function () {
        await expect(vesting.getVestingsByRange(3, 2)).to.be.revertedWith("reverted with panic code 0x11");
      });

      it("should revert if outside of range", async function () {
        await expect(vesting.getVestingsByRange(2, 19)).to.be.revertedWith("range error");
      });

      it("should correctly return vestings array", async function () {
        expect(await vesting.getVestingsByRange(12, 17)).to.be.lengthOf(6);
      });
    });
  });

  describe("recoverETH", () => {
    it("should recover ETH correctly", async function () {
      await expect(vesting.connect(alice).recoverETH()).to.not.be.reverted;
      await expect(vesting.recoverETH()).to.not.be.reverted;
    });
  });

  describe("recoverErc20", () => {
    it("should revert if nothing to recover", async function () {
      const erc20 = (await deployContract(deployer, ERC20MockArtifact, ["Token", "TK", 18, 100000])) as ERC20Mock;
      await expect(vesting.recoverErc20(erc20.address)).to.be.revertedWith("nothing to recover");
    });

    it("should correctly recover ERC20 to owner address", async function () {
      const erc20 = (await deployContract(bob, ERC20MockArtifact, ["Token", "TK", 18, 100000])) as ERC20Mock;
      await erc20.connect(bob).transfer(vesting.address, 1000);

      await expect(vesting.recoverErc20(erc20.address)).to.emit(erc20, "Transfer").withArgs(vesting.address, deployer.address, 1000);
      expect(await erc20.balanceOf(deployer.address)).to.be.equal(1000);
    });
  });
});
