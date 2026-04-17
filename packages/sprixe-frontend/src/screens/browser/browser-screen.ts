/**
 * BrowserScreen — game browser = game list (left) + video preview (right).
 *
 * Wires GameList selection changes into VideoPreview, and maps the
 * GamepadNav NavActions onto list navigation (up/down) + confirm.
 *
 * Phase 1 stops at rendering and gamepad nav — Phase 1.6 layers the
 * filter bar on top, Phase 1.10 populates with the real catalogue
 * (right now we consume MOCK_GAMES directly as a convenience default).
 */

import type { GameEntry } from "../../data/games";
import type { NavAction } from "../../input/gamepad-nav";
import { GameList } from "./game-list";
import { VideoPreview } from "./video-preview";

export interface BrowserScreenOptions {
  initialGames?: readonly GameEntry[];
}

export class BrowserScreen {
  readonly root: HTMLDivElement;

  private readonly list: GameList;
  private readonly preview: VideoPreview;

  constructor(container: HTMLElement, options: BrowserScreenOptions = {}) {
    this.root = document.createElement("div");
    this.root.className = "af-browser-screen";
    this.root.setAttribute("data-testid", "browser-screen");

    const listPane = document.createElement("div");
    listPane.className = "af-browser-list-pane";
    this.root.appendChild(listPane);

    const previewPane = document.createElement("div");
    previewPane.className = "af-browser-preview-pane";
    this.root.appendChild(previewPane);

    this.list = new GameList(listPane);
    this.preview = new VideoPreview(previewPane);

    this.list.onChange((game) => this.preview.setGame(game));

    if (options.initialGames) {
      this.setGames(options.initialGames);
    }

    container.appendChild(this.root);
  }

  setGames(games: readonly GameEntry[]): void {
    this.list.setItems(games);
    this.preview.setGame(this.list.getSelectedGame());
  }

  getList(): GameList {
    return this.list;
  }

  getPreview(): VideoPreview {
    return this.preview;
  }

  /** Routes a NavAction onto list navigation. Returns true if handled. */
  handleNavAction(action: NavAction): boolean {
    switch (action) {
      case "up":
        this.list.moveSelection(-1);
        return true;
      case "down":
        this.list.moveSelection(1);
        return true;
      case "confirm":
        this.list.confirm();
        return true;
      default:
        return false;
    }
  }
}
