import { Guess, Submission } from './Guess';
import {
  isReady,
  shutdown,
  Field,
  Mina,
  PrivateKey,
  PublicKey,
  AccountUpdate,
  Poseidon,
  Bool,
} from 'snarkyjs';

let proofsEnabled = false;

describe('Guess', () => {
  let deployerAccount: PublicKey,
    deployerKey: PrivateKey,
    senderAccount: PublicKey,
    senderKey: PrivateKey,
    zkAppAddress: PublicKey,
    zkAppPrivateKey: PrivateKey,
    zkApp: Guess;

  beforeAll(async () => {
    await isReady;
    if (proofsEnabled) Guess.compile();
  });

  beforeEach(() => {
    const Local = Mina.LocalBlockchain({ proofsEnabled });
    Mina.setActiveInstance(Local);
    ({ privateKey: deployerKey, publicKey: deployerAccount } =
      Local.testAccounts[0]);
    ({ privateKey: senderKey, publicKey: senderAccount } =
      Local.testAccounts[1]);
    zkAppPrivateKey = PrivateKey.random();
    zkAppAddress = zkAppPrivateKey.toPublicKey();
    zkApp = new Guess(zkAppAddress);
  });

  afterAll(() => {
    // `shutdown()` internally calls `process.exit()` which will exit the running Jest process early.
    // Specifying a timeout of 0 is a workaround to defer `shutdown()` until Jest is done running all tests.
    // This should be fixed with https://github.com/MinaProtocol/mina/issues/10943
    setTimeout(shutdown, 0);
  });

  async function localDeploy() {
    const txn = await Mina.transaction(deployerAccount, () => {
      AccountUpdate.fundNewAccount(deployerAccount);
      zkApp.deploy();
    });
    await txn.prove();
    // this tx needs .sign(), because `deploy()` adds an account update that requires signature authorization
    await txn.sign([deployerKey, zkAppPrivateKey]).send();
  }

  it('generates and deploys the contract with correct initial vlues', async () => {
    await localDeploy();

    let duration = zkApp.duration,
      currBlock = zkApp.network.blockchainLength.get(),
      // state variables
      active = zkApp.active.get(),
      origin = zkApp.origin.get(),
      startBlock = zkApp.startBlock.get(),
      endBlock = zkApp.endBlock.get(),
      fee = zkApp.fee.get(),
      submissions = zkApp.submissions,
      submissionHash = zkApp.submissionHash.get(),
      secretNumberHash = zkApp.secretNumberHash.get();

    // TODO read duration + fee from Guess.parameters.json
    let readFee;
    let readDuration;
    expect(readDuration).toEqual(duration);

    // TODO read secretNumber from Guess.secretNumber
    let readSecretNumber = Field(0);

    expect(active).toEqual(Bool(true));
    expect(origin).toEqual(deployerAccount);
    expect(startBlock).toEqual(currBlock);
    expect(endBlock).toEqual(currBlock.add(duration));
    expect(fee).toEqual(readFee);
    expect(submissionHash).toEqual(Field(0));
    expect(submissions).toEqual<Submission[]>([]);
    expect(secretNumberHash).toEqual(Poseidon.hash([readSecretNumber]));
  });

  it('correctly updates and charges the player', async () => {
    await localDeploy();

    // senderAccount submits guesses
    let guesses = [Field(0), Field(1)];
    let submission = new Submission({ player: senderAccount, guesses });
    let oldSubmissionHash = zkApp.submissionHash.get();

    // TODO get player balance

    // submit guesses transaction
    let txn = await Mina.transaction(senderAccount, () => {
      zkApp.submitGuesses(submission);
    });
    await txn.prove();
    await txn.sign([senderKey]).send();

    // TODO check player balance decreased by 2 MINA

    let newSubmissionsHash = zkApp.submissionHash.get();
    let expectHash = Poseidon.hash([submission.hash(), oldSubmissionHash]);

    expect(newSubmissionsHash).toEqual(expectHash);
  });
});
