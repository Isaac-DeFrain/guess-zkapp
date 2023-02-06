// TODO how initialize with parameter?
// TODO how to finalize after endBlock? is deployer action required?
// TODO is block length sufficient?
// TODO do we need to explicitly wait for and check canonical?

import { Submission, HashedSubmission, maxElem, dist } from './Guess.lib';
import {
  Field,
  SmartContract,
  state,
  State,
  method,
  Poseidon,
  PublicKey,
  UInt32,
  UInt64,
  Bool,
  AccountUpdate,
} from 'snarkyjs';
export { Guess, Submission, HashedSubmission };

class Guess extends SmartContract {
  // -----
  // state
  // -----

  // on-chain
  @state(Bool) active = State<Bool>(); // is the game active?
  @state(PublicKey) origin = State<PublicKey>(); // contract originator
  @state(UInt32) startBlock = State<UInt32>(); // block before which the game is invalid
  @state(UInt32) endBlock = State<UInt32>(); // block after which the game is invalid
  @state(UInt64) fee = State<UInt64>(); // contract originator fee
  @state(Field) submissionHash = State<Field>(); // merkle root of submissions
  @state(Field) secretNumberHash = State<Field>(); // hash of a secret number

  // off-chain -- TODO write to/read from file
  duration: UInt32;
  secretNumber: Field;
  submissions: Submission[] = [];

  events = {
    'new-submission': HashedSubmission,
  };

  // ----------
  // initialize
  // ----------
  init() {
    super.init();

    let currBlock = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(currBlock);

    // initialize startBlock + endBlock
    this.duration = new UInt32(100);
    this.startBlock.set(currBlock);
    this.endBlock.set(currBlock.add(this.duration));

    // initialize secretNumber to random a Field element, store hash on chain
    this.secretNumber = Field.random();
    this.secretNumberHash.set(Poseidon.hash([this.secretNumber]));

    // initialize contract fee + active + origin
    let fee = new UInt64(2e9);
    this.fee.set(fee);
    this.active.set(Bool(true));
    this.origin.set(this.sender);
  }

  // -------
  // methods
  // -------
  @method submitGuesses(submission: Submission) {
    // game is active and valid
    this.isValidAndActive().assertTrue;

    // validate submissionHash
    let submissionHash = this.submissionHash.get();
    this.submissionHash.assertEquals(submissionHash);

    // player must send at least one guess
    let numGuesses = Field(submission.guesses.length);
    numGuesses.assertGte(1);

    // player pays 1 MINA per guess
    let amount = new UInt64(numGuesses.mul(1e9));
    let playerUpdate = AccountUpdate.createSigned(submission.player);
    playerUpdate.send({ to: this.address, amount });

    // add submission + update submissionHash
    this.submissions.push(submission);
    this.emitEvent('new-submission', submission.toHashed());
    this.submissionHash.set(Poseidon.hash([submission.hash(), submissionHash]));
  }

  @method conclude() {
    // game can finish
    this.canFinish().assertTrue;

    // only contract originator can end the game
    let origin = this.origin.get();
    this.sender.assertEquals(origin);

    // set to inactive
    this.active.set(Bool(false));

    // contract deployer receives small fee
    let contractUpdate = AccountUpdate.createSigned(this.address);
    let fee = this.fee.get();
    let balance = this.account.balance.get();
    contractUpdate.send({ to: origin, amount: fee });
    this.account.balance.assertEquals(balance.sub(fee));

    // closest guesser receives remaining account balance
    let winner = this.winner();
    contractUpdate.send({ to: winner, amount: this.account.balance.get() });
    this.account.balance.assertEquals(new UInt64(0));
  }

  // -------
  // helpers
  // -------
  isValidAndActive(): Bool {
    // verify active
    let active = this.active.get();
    this.active.assertEquals(active);
    this.active.assertEquals(Bool(true));

    // verify startBlock
    let startBlock = this.startBlock.get();
    this.startBlock.assertEquals(startBlock);

    // verify endBlock
    let endBlock = this.endBlock.get();
    this.endBlock.assertEquals(endBlock);

    // verify current block
    let currBlock = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(currBlock);

    // check: startBlock <= currBlock <= endBlock
    let lowerBound = currBlock.gte(startBlock);
    let upperBound = currBlock.lte(endBlock);
    return lowerBound.and(upperBound);
  }

  canFinish(): Bool {
    // verify active
    let active = this.active.get();
    this.active.assertEquals(active);
    this.active.assertEquals(Bool(true));

    // verify endBlock
    let endBlock = this.endBlock.get();
    this.endBlock.assertEquals(endBlock);

    // verify current block
    let currBlock = this.network.blockchainLength.get();
    this.network.blockchainLength.assertEquals(currBlock);
    return currBlock.gt(endBlock);
  }

  winner(): PublicKey {
    // verify secret number
    let secret = this.secretNumber;
    let secretNumberHash = this.secretNumberHash.get();
    this.secretNumberHash.assertEquals(secretNumberHash);
    this.secretNumberHash.assertEquals(Poseidon.hash([secret]));

    // compute the winner
    // TODO how to deal with tie?
    let winning: [PublicKey, Field] = [PublicKey.empty(), maxElem()];
    for (let i = 0; i < this.submissions.length; i++) {
      let smallestDelta = maxElem();
      let guesses = this.submissions[i].guesses;
      for (let j = 0; j < guesses.length; j++) {
        let delta = dist(guesses[j], secret);
        if (delta.lt(smallestDelta)) {
          smallestDelta = delta;
        }
      }
      if (smallestDelta.lt(winning[1])) {
        winning[0] = this.submissions[i].player;
      }
    }
    return winning[0];
  }
}
