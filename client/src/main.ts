import './ui/tokens.css';
import { loadRapier } from './engine/physics';
import { ExploreGame } from './explore/ExploreGame';

type BootUi = { done(): void; error(t: string): void };
const boot = (window as Window & { __boot?: BootUi }).__boot;
// start the physics chunk + wasm download right away (its wasm is also preloaded from index.html)
void loadRapier().catch(() => {});

const game = new ExploreGame();
game
  .boot(document.getElementById('app')!)
  .then(() => boot?.done())
  .catch((err) => {
    console.error(err);
    boot?.error(String(err));
    (window as unknown as { __gameError: string }).__gameError = String(err);
  });

// handy for debugging in the console / headless checks
(window as unknown as { game: ExploreGame }).game = game;
