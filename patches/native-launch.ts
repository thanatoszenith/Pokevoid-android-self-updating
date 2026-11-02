import { ExternalGame } from './external-game';

/** A document load is insufficient: wait for the battle scene's create event. */
export function armNativeLaunch(game: any): void {
  game.events.once('ready', () => {
    const battle = game.scene.getScene('battle');
    if (!battle) throw new Error('Battle scene missing');
    battle.events.once('create', () => {
      void ExternalGame.status().then(state =>
        ExternalGame.confirmLaunch({ launchId: state.launchId })
      ).catch(error => console.error('External launch confirmation failed', error));
    });
  });
}
