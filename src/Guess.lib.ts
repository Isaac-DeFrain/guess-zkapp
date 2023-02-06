import { Field, Poseidon, PublicKey, Struct } from 'snarkyjs';
export { Submission, HashedSubmission, dist, maxElem };

class Submission extends Struct({
  player: PublicKey,
  guesses: [Field],
}) {
  hash(): Field {
    let guessesHash = Poseidon.hash(this.guesses);
    return Poseidon.hash([this.player.x, guessesHash]);
  }

  toHashed(): HashedSubmission {
    let salt = Field.random();
    let guessHashes = this.guesses.map((guess) => Poseidon.hash([guess, salt]));
    return new HashedSubmission({ player: this.player, salt, guessHashes });
  }
}

class HashedSubmission extends Struct({
  player: PublicKey,
  salt: Field,
  guessHashes: [Field],
}) {}

function dist(x: Field, y: Field): Field {
  if (x.gte(y)) {
    return x.sub(y);
  } else {
    return y.sub(x);
  }
}

function maxElem(): Field {
  return Field(0).sub(1);
}
