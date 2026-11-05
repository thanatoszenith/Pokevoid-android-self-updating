import { ExternalGame } from './external-game';
import { checkGameUpdates } from './update-gate';

/** The title is usable before any online request starts. Capture the launch ID
 * at Phaser construction and confirm the actual rendered title first.
 */
export function armNativeLaunch(game: any): void {
  const launch = ExternalGame.status();
  game.events.once('pokevoid-native-ready', () => {
    void launch.then(state =>
      ExternalGame.confirmLaunch({ launchId: state.launchId })
    ).then(() => {
      // Never make a failed or offline feed delay native startup.
      // A verified, resumed download can still continue after title composition.
      void checkGameUpdates().catch(error => console.warn('[UpdateGate] Post-title check failed', error));
    }).catch(error => console.error('External launch confirmation failed', error));
  });
}
