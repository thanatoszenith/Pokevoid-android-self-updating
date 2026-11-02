import { ExternalGame } from './external-game';

/** Upstream signals this only when its deferred title-screen composition is complete. */
export function armNativeLaunch(game: any): void {
  const launch = ExternalGame.status();
  game.events.once('pokevoid-native-ready', () => {
    void launch.then(state =>
      ExternalGame.confirmLaunch({ launchId: state.launchId })
    ).catch(error => console.error('External launch confirmation failed', error));
  });
}
